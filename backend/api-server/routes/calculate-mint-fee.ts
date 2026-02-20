import { Request, Response } from 'express';
import { Client, PrivateKey, TokenMintTransaction } from '@hashgraph/sdk';

const BACKEND_ACCOUNT_ID = process.env.BACKEND_ACCOUNT_ID || process.env.TREASURY_ID;
const BACKEND_PRIVATE_KEY = process.env.BACKEND_PRIVATE_KEY || process.env.TREASURY_PK;

interface CalculateFeeRequest {
  tokenId: string;
  metadataCIDs: string[];
}

/**
 * POST /api/calculate-mint-fee
 * Gets network-calculated fee using getMaxTransactionFee() after freezeWith()
 *
 * Pattern from Hedera:
 * 1. Build TokenMintTransaction with metadata
 * 2. freezeWith(client) to finalize transaction body
 * 3. getMaxTransactionFee() returns network-calculated upper bound based on metadata size
 */
export async function calculateMintFee(req: Request, res: Response): Promise<void> {
  try {
    const { tokenId, metadataCIDs } = req.body as CalculateFeeRequest;

    // Validate inputs
    if (!tokenId || !metadataCIDs || !Array.isArray(metadataCIDs) || metadataCIDs.length === 0) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: tokenId, metadataCIDs',
      });
      return;
    }

    // Set up Hedera client
    const client = Client.forMainnet();
    let backendPrivateKey: PrivateKey;
    try {
      backendPrivateKey = PrivateKey.fromStringECDSA(BACKEND_PRIVATE_KEY!);
    } catch {
      backendPrivateKey = PrivateKey.fromString(BACKEND_PRIVATE_KEY!);
    }
    client.setOperator(BACKEND_ACCOUNT_ID!, backendPrivateKey);

    const batchSize = 10;
    const totalBatches = Math.ceil(metadataCIDs.length / batchSize);

    // Take first batch to calculate fee
    const sampleBatch = metadataCIDs.slice(0, Math.min(batchSize, metadataCIDs.length));
    const metadataList = sampleBatch.map(cid => {
      const uri = cid.startsWith('ipfs://') ? cid : `ipfs://${cid}`;
      return Buffer.from(uri);
    });

    // Build transaction with metadata
    const tx = new TokenMintTransaction()
      .setTokenId(tokenId)
      .setMetadata(metadataList);

    // Freeze to finalize transaction body
    const frozenTx = tx.freezeWith(client);

    // Get network-calculated max fee (upper bound based on metadata size)
    // maxTransactionFee is a property, not a method
    const maxFee = frozenTx.maxTransactionFee;

    if (!maxFee) {
      throw new Error('Failed to get max transaction fee from network');
    }

    const feePerBatch = maxFee.toBigNumber().toNumber();
    const totalFee = feePerBatch * totalBatches;
    const totalFeeWithBuffer = totalFee * 1.10; // 10% buffer

    res.json({
      success: true,
      feePerBatch,
      totalBatches,
      totalFee,
      totalFeeWithBuffer,
    });
  } catch (err: any) {
    console.error('Calculate mint fee error:', err);
    res.status(500).json({
      success: false,
      error: err.message || 'Failed to calculate mint fee',
    });
  }
}

