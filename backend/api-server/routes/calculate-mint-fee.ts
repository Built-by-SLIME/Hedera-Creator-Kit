import { Request, Response } from 'express';

interface CalculateFeeRequest {
  metadataCIDs: string[];
}

interface CalculateFeeResponse {
  success: boolean;
  feePerBatch?: number;
  totalBatches?: number;
  totalFee?: number;
  totalFeeWithBuffer?: number;
  feeSchedule?: {
    perNFT_USD: number;
    perNFT_HBAR: number;
    hbarUsdRate: number;
  };
  error?: string;
}

// Hedera fee schedule: TokenMint (non-fungible) = $0.05 per NFT
// Source: https://hedera.com/blog/new-hedera-token-service-features-nfts-metadata-and-custom-fees
const MINT_FEE_PER_NFT_USD = 0.05;

// Approximate HBAR/USD exchange rate (update this periodically or fetch from an API)
// As of 2026, using ~$0.12 per HBAR as a conservative estimate
const HBAR_USD_RATE = 0.12;

// Calculate HBAR cost per NFT
const MINT_FEE_PER_NFT_HBAR = MINT_FEE_PER_NFT_USD / HBAR_USD_RATE;

/**
 * POST /api/calculate-mint-fee
 * Calculates minting fees using Hedera's published fee schedule
 *
 * Flow:
 * 1. Takes metadata CIDs array
 * 2. Uses Hedera's published fee schedule ($0.05 per NFT)
 * 3. Calculates total fee for all NFTs with 20% buffer
 * 4. Returns fee breakdown
 *
 * NOTE: Hedera SDK does NOT provide a getCost() method for transactions.
 * We use the published fee schedule instead.
 */
export async function calculateMintFee(req: Request, res: Response): Promise<void> {
  try {
    const { metadataCIDs } = req.body as CalculateFeeRequest;

    // Validate inputs
    if (!metadataCIDs || !Array.isArray(metadataCIDs) || metadataCIDs.length === 0) {
      res.status(400).json({
        success: false,
        error: 'Missing or invalid required field: metadataCIDs (must be non-empty array)',
      });
      return;
    }

    const totalNFTs = metadataCIDs.length;
    const batchSize = 10;
    const totalBatches = Math.ceil(totalNFTs / batchSize);

    // Calculate fees based on Hedera's published fee schedule
    const totalFeeHbar = totalNFTs * MINT_FEE_PER_NFT_HBAR;
    const totalFeeWithBuffer = totalFeeHbar * 1.20; // 20% buffer for safety

    const feePerBatch = (totalFeeHbar / totalBatches);

    res.json({
      success: true,
      feePerBatch,
      totalBatches,
      totalFee: totalFeeHbar,
      totalFeeWithBuffer,
      feeSchedule: {
        perNFT_USD: MINT_FEE_PER_NFT_USD,
        perNFT_HBAR: MINT_FEE_PER_NFT_HBAR,
        hbarUsdRate: HBAR_USD_RATE,
      },
    });
  } catch (err: any) {
    console.error('Calculate mint fee error:', err);
    res.status(500).json({
      success: false,
      error: err.message || 'Failed to calculate mint fee',
    });
  }
}

