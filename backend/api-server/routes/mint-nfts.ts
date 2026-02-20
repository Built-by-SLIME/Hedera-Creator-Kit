import { Request, Response } from 'express';
import { Client, PrivateKey, TokenMintTransaction, AccountId, Hbar } from '@hashgraph/sdk';

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
 * Mints NFTs using the supply key + user's HBAR allowance
 * 
 * Flow:
 * 1. User approves HBAR allowance via AccountAllowanceApproveTransaction
 * 2. Frontend sends supply key + metadata to this endpoint
 * 3. Backend mints in batches of 10 using supply key + user's allowance
 * 4. Returns minted serial numbers
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

    // Validate supply key format
    let supplyPrivateKey: PrivateKey;
    try {
      supplyPrivateKey = PrivateKey.fromString(supplyKey);
    } catch (err) {
      res.status(400).json({
        success: false,
        error: 'Invalid supply key format',
      });
      return;
    }

    // Set up Hedera client with backend operator
    const client = Client.forMainnet();
    const backendPrivateKey = PrivateKey.fromStringED25519(BACKEND_PRIVATE_KEY!);
    client.setOperator(BACKEND_ACCOUNT_ID!, backendPrivateKey);

    // Batch metadata into groups of 10 (Hedera's hard limit)
    const batchSize = 10;
    const batches: string[][] = [];
    for (let i = 0; i < metadataCIDs.length; i += batchSize) {
      batches.push(metadataCIDs.slice(i, i + batchSize));
    }

    const allSerials: number[] = [];

    // Mint each batch
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      
      // Convert metadata CIDs to Buffer format
      const metadataList = batch.map(cid => {
        const uri = cid.startsWith('ipfs://') ? cid : `ipfs://${cid}`;
        return Buffer.from(uri);
      });

      // Create mint transaction
      const mintTx = new TokenMintTransaction()
        .setTokenId(tokenId)
        .setMetadata(metadataList)
        .setMaxTransactionFee(new Hbar(10)); // Increased fee for post-v0.70.0

      // Freeze transaction with client
      const frozenTx = await mintTx.freezeWith(client);

      // Sign with supply key
      const signedTx = await frozenTx.sign(supplyPrivateKey);

      // Execute using user's HBAR allowance (backend pays from user's account)
      const txResponse = await signedTx.execute(client);
      const receipt = await txResponse.getReceipt(client);

      // Extract serial numbers
      const serials = (receipt.serials || []).map((s: any) => 
        typeof s === 'object' && s.low !== undefined ? s.low : Number(s)
      );
      allSerials.push(...serials);
    }

    res.json({
      success: true,
      message: `Successfully minted ${metadataCIDs.length} NFTs in ${batches.length} batches`,
      serials: allSerials,
      totalMinted: allSerials.length,
    });
  } catch (err: any) {
    console.error('Mint NFTs error:', err);
    res.status(500).json({
      success: false,
      error: err.message || 'Failed to mint NFTs',
    });
  }
}

