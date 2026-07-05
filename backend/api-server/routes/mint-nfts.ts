import { Request, Response } from 'express';
import { Client, PrivateKey, TokenMintTransaction, AccountId, Hbar } from '@hashgraph/sdk';
import { v4 as uuidv4 } from 'uuid';
import { createMintJob, updateMintJob } from '../mintJobStore';

const BACKEND_ACCOUNT_ID = process.env.BACKEND_ACCOUNT_ID || process.env.TREASURY_ID;
const BACKEND_PRIVATE_KEY = process.env.BACKEND_PRIVATE_KEY || process.env.TREASURY_PK;

if (!BACKEND_ACCOUNT_ID || !BACKEND_PRIVATE_KEY) {
  console.warn('⚠️  BACKEND_ACCOUNT_ID or BACKEND_PRIVATE_KEY not set in .env — minting endpoint will fail');
}

interface MintRequest {
  tokenId: string;
  supplyKey: string;
  metadataCIDs: string[];
  userAccountId: string;
}

/**
 * POST /api/mint-nfts
 * Starts a batch minting job and returns a jobId immediately.
 *
 * The actual minting runs in the background so proxies/browsers cannot time out
 * the long-running Hedera consensus process.
 */
export async function mintNfts(req: Request, res: Response): Promise<void> {
  try {
    const { tokenId, supplyKey, metadataCIDs, userAccountId } = req.body as MintRequest;

    // Validate inputs
    if (!tokenId || !supplyKey || !metadataCIDs || !userAccountId) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: tokenId, supplyKey, metadataCIDs, userAccountId',
      });
      return;
    }

    if (!Array.isArray(metadataCIDs) || metadataCIDs.length === 0) {
      res.status(400).json({
        success: false,
        error: 'metadataCIDs must be a non-empty array',
      });
      return;
    }

    // Validate supply key format early
    try {
      PrivateKey.fromString(supplyKey);
    } catch (err) {
      res.status(400).json({
        success: false,
        error: 'Invalid supply key format',
      });
      return;
    }

    const batchSize = 10;
    const totalBatches = Math.ceil(metadataCIDs.length / batchSize);
    const jobId = uuidv4();

    createMintJob(jobId, tokenId, metadataCIDs.length, totalBatches);

    // Run the long minting work in the background. Do NOT await.
    runMintJob(jobId, req.body as MintRequest).catch((error) => {
      console.error(`Unhandled error in mint job ${jobId}:`, error);
      updateMintJob(jobId, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error)
      });
    });

    res.json({
      success: true,
      jobId,
      status: 'queued',
      message: 'Minting job started. Poll /api/mint-status/:jobId for progress.',
      totalBatches,
      totalNFTs: metadataCIDs.length,
    });

  } catch (err: any) {
    console.error('Failed to start minting job:', err);
    res.status(500).json({
      success: false,
      error: err.message || 'Failed to start minting job',
    });
  }
}

/**
 * Background worker: mint NFTs in batches of 10 and update the shared job
 * record as each batch reaches consensus.
 */
async function runMintJob(jobId: string, body: MintRequest): Promise<void> {
  const { tokenId, supplyKey, metadataCIDs } = body;

  try {
    if (!BACKEND_ACCOUNT_ID || !BACKEND_PRIVATE_KEY) {
      throw new Error('Backend operator credentials not configured');
    }

    // Set up Hedera client with backend operator
    const client = Client.forMainnet();
    let backendPrivateKey: PrivateKey;
    try {
      backendPrivateKey = PrivateKey.fromStringECDSA(BACKEND_PRIVATE_KEY);
    } catch {
      backendPrivateKey = PrivateKey.fromString(BACKEND_PRIVATE_KEY);
    }
    client.setOperator(BACKEND_ACCOUNT_ID, backendPrivateKey);

    let supplyPrivateKey: PrivateKey;
    try {
      supplyPrivateKey = PrivateKey.fromString(supplyKey);
    } catch (err) {
      throw new Error('Invalid supply key format');
    }

    const batchSize = 10;
    const batches: string[][] = [];
    for (let i = 0; i < metadataCIDs.length; i += batchSize) {
      batches.push(metadataCIDs.slice(i, i + batchSize));
    }

    const allSerials: number[] = [];
    const errors: string[] = [];

    updateMintJob(jobId, { status: 'minting' });
    console.log(`[Job ${jobId}] Starting mint of ${metadataCIDs.length} NFTs in ${batches.length} batches...`);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];

      const metadataList = batch.map((cid) => {
        const uri = cid.startsWith('ipfs://') ? cid : `ipfs://${cid}`;
        return Buffer.from(uri);
      });

      try {
        const mintTx = new TokenMintTransaction()
          .setTokenId(tokenId)
          .setMetadata(metadataList)
          .setMaxTransactionFee(new Hbar(10));

        const frozenTx = await mintTx.freezeWith(client);
        const signedTx = await frozenTx.sign(supplyPrivateKey);
        const txResponse = await signedTx.execute(client);
        const receipt = await txResponse.getReceipt(client);

        const serials = (receipt.serials || []).map((s: any) =>
          typeof s === 'object' && s.low !== undefined ? s.low : Number(s)
        );
        allSerials.push(...serials);

        updateMintJob(jobId, {
          currentBatch: i + 1,
          serials: [...allSerials]
        });

        console.log(`[Job ${jobId}] Batch ${i + 1}/${batches.length} minted — serials: [${serials.join(', ')}]`);
      } catch (batchErr: any) {
        const msg = `Batch ${i + 1}/${batches.length} failed: ${batchErr.message || String(batchErr)}`;
        console.error(`[Job ${jobId}] ${msg}`);
        errors.push(msg);
        updateMintJob(jobId, {
          currentBatch: i + 1,
          errors: [...errors]
        });
        // Continue with remaining batches rather than failing the entire job
      }
    }

    const status = allSerials.length > 0 ? 'completed' : 'failed';
    const finalError = allSerials.length === 0
      ? (errors[0] || 'All batches failed')
      : (errors.length > 0 ? `${errors.length} batch(es) failed, ${allSerials.length} NFT(s) minted` : undefined);

    updateMintJob(jobId, {
      status,
      serials: allSerials,
      errors,
      error: finalError
    });

    console.log(`[Job ${jobId}] ✅ Minting complete. Minted: ${allSerials.length}/${metadataCIDs.length}, Errors: ${errors.length}`);

  } catch (error: any) {
    console.error(`[Job ${jobId}] Minting error:`, error);
    updateMintJob(jobId, {
      status: 'failed',
      error: error.message || 'Failed to mint NFTs'
    });
  }
}
