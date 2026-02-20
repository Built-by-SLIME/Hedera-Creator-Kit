import { Request, Response } from 'express';
import { Client, PrivateKey, TokenMintTransaction, Hbar } from '@hashgraph/sdk';

const BACKEND_ACCOUNT_ID = process.env.BACKEND_ACCOUNT_ID || process.env.TREASURY_ID;
const BACKEND_PRIVATE_KEY = process.env.BACKEND_PRIVATE_KEY || process.env.TREASURY_PK;

interface CalculateFeeRequest {
  tokenId: string;
  metadataCIDs: string[];
}

interface CalculateFeeResponse {
  success: boolean;
  feePerBatch?: number;
  totalBatches?: number;
  totalFee?: number;
  totalFeeWithBuffer?: number;
  error?: string;
}

/**
 * POST /api/calculate-mint-fee
 * Calculates exact minting fees using getCost() method
 * 
 * Flow:
 * 1. Takes tokenId and metadata CIDs
 * 2. Creates a sample mint transaction with first 10 metadata entries (one batch)
 * 3. Calls getCost() to get exact fee from network
 * 4. Calculates total fee for all batches with 5% buffer
 * 5. Returns fee breakdown
 */
export async function calculateMintFee(req: Request, res: Response): Promise<void> {
  try {
    const { tokenId, metadataCIDs } = req.body as CalculateFeeRequest;

    // Validate inputs
    if (!tokenId || !metadataCIDs || !Array.isArray(metadataCIDs) || metadataCIDs.length === 0) {
      res.status(400).json({
        success: false,
        error: 'Missing or invalid required fields: tokenId, metadataCIDs (must be non-empty array)',
      });
      return;
    }

    // Set up Hedera client with backend operator
    const client = Client.forMainnet();
    let backendPrivateKey: PrivateKey;
    try {
      backendPrivateKey = PrivateKey.fromStringECDSA(BACKEND_PRIVATE_KEY!);
    } catch {
      backendPrivateKey = PrivateKey.fromString(BACKEND_PRIVATE_KEY!);
    }
    client.setOperator(BACKEND_ACCOUNT_ID!, backendPrivateKey);

    // Take first 10 metadata entries (one batch) to calculate cost
    const batchSize = 10;
    const sampleBatch = metadataCIDs.slice(0, Math.min(batchSize, metadataCIDs.length));
    
    // Convert metadata CIDs to Buffer format (same as actual minting)
    const metadataList = sampleBatch.map(cid => {
      const uri = cid.startsWith('ipfs://') ? cid : `ipfs://${cid}`;
      return Buffer.from(uri);
    });

    // Create sample mint transaction
    const mintTx = new TokenMintTransaction()
      .setTokenId(tokenId)
      .setMetadata(metadataList)
      .setMaxTransactionFee(new Hbar(10)); // Same as actual minting

    // Freeze transaction with client
    const frozenTx = await mintTx.freezeWith(client);

    // Get exact cost from network (does NOT execute the transaction)
    const cost = await frozenTx.getCost(client);

    // Calculate total fees
    const numBatches = Math.ceil(metadataCIDs.length / batchSize);
    const feePerBatch = cost.toBigNumber().toNumber(); // Convert Hbar to number
    const totalFee = feePerBatch * numBatches;
    const totalFeeWithBuffer = totalFee * 1.05; // 5% buffer

    res.json({
      success: true,
      feePerBatch,
      totalBatches: numBatches,
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

