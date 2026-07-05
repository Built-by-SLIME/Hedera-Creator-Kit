import { Request, Response } from 'express';
import { Client, PrivateKey, TokenMintTransaction, Hbar } from '@hashgraph/sdk';

const BACKEND_ACCOUNT_ID = process.env.BACKEND_ACCOUNT_ID || process.env.TREASURY_ID;
const BACKEND_PRIVATE_KEY = process.env.BACKEND_PRIVATE_KEY || process.env.TREASURY_PK;
const MIRROR_NODE_URL = 'https://mainnet-public.mirrornode.hedera.com';

const BATCH_SIZE = 10;
const HOUR_MS = 60 * 60 * 1000;

interface CalculateFeeRequest {
  tokenId: string;
  metadataCIDs: string[];
}

interface MirrorTransaction {
  charged_tx_fee: number;
  consensus_timestamp: string;
  entity_id: string;
  nonce: number;
  parent_consensus_timestamp: string | null;
  nft_transfers?: Array<{ token_id: string; serial_number: number }>;
}

interface MirrorTransactionsResponse {
  transactions: MirrorTransaction[];
}

interface MirrorTokenResponse {
  custom_fees?: {
    royalty_fees?: unknown[];
    fixed_fees?: unknown[];
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Mirror node request failed: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

async function tokenHasCustomFees(tokenId: string): Promise<boolean> {
  try {
    const data = await fetchJson<MirrorTokenResponse>(
      `${MIRROR_NODE_URL}/api/v1/tokens/${tokenId}`
    );
    const customFees = data.custom_fees;
    if (!customFees) return false;
    return (
      (Array.isArray(customFees.royalty_fees) && customFees.royalty_fees.length > 0) ||
      (Array.isArray(customFees.fixed_fees) && customFees.fixed_fees.length > 0)
    );
  } catch (err) {
    console.warn(`[calculate-mint-fee] Could not determine custom fees for ${tokenId}:`, err);
    return false;
  }
}

/**
 * Fetches recent successful TOKENMINT transactions submitted by the operator.
 * Filters to parent transactions only (child transactions report charged_tx_fee=0).
 */
async function fetchOperatorMintSamples(limit: number): Promise<MirrorTransaction[]> {
  const url =
    `${MIRROR_NODE_URL}/api/v1/transactions` +
    `?account.id=${BACKEND_ACCOUNT_ID}` +
    `&transactiontype=TOKENMINT` +
    `&result=success` +
    `&order=desc` +
    `&limit=${limit}`;
  const data = await fetchJson<MirrorTransactionsResponse>(url);
  return data.transactions;
}

async function fetchNetworkMintSamples(limit: number): Promise<MirrorTransaction[]> {
  const url =
    `${MIRROR_NODE_URL}/api/v1/transactions` +
    `?transactiontype=TOKENMINT` +
    `&result=success` +
    `&order=desc` +
    `&limit=${limit}`;
  const data = await fetchJson<MirrorTransactionsResponse>(url);
  return data.transactions;
}

function isParentTransaction(tx: MirrorTransaction): boolean {
  // Nonce 0 and no parent timestamp => this is the top-level transaction that pays the fee.
  return (tx.nonce === 0 || tx.nonce == null) && !tx.parent_consensus_timestamp;
}

function extractValidFees(transactions: MirrorTransaction[], tokenId?: string): number[] {
  const cutoff = Date.now() - 24 * HOUR_MS;
  return transactions
    .filter((tx) => {
      if (!isParentTransaction(tx)) return false;
      if (!tx.charged_tx_fee || tx.charged_tx_fee <= 0) return false;
      if (tokenId && tx.entity_id !== tokenId) return false;
      const txTimeMs = Number(tx.consensus_timestamp) * 1000;
      if (txTimeMs < cutoff) return false;
      const transfers = tx.nft_transfers || [];
      return transfers.length === BATCH_SIZE;
    })
    .map((tx) => tx.charged_tx_fee);
}

function removeOutliers(values: number[]): number[] {
  if (values.length < 5) return values;
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (median <= 0) return values;
  return values.filter((v) => v <= median * 10);
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

async function sdkFallbackFee(
  tokenId: string,
  metadataCIDs: string[],
  totalBatches: number
): Promise<{ feePerBatch: number; totalFee: number; totalFeeWithBuffer: number }> {
  let backendPrivateKey: PrivateKey;
  try {
    backendPrivateKey = PrivateKey.fromStringECDSA(BACKEND_PRIVATE_KEY!);
  } catch {
    backendPrivateKey = PrivateKey.fromString(BACKEND_PRIVATE_KEY!);
  }
  const client = Client.forMainnet();
  client.setOperator(BACKEND_ACCOUNT_ID!, backendPrivateKey);

  try {
    const sampleBatch = metadataCIDs.slice(0, Math.min(BATCH_SIZE, metadataCIDs.length));
    const metadataList = sampleBatch.map((cid) => {
      const uri = cid.startsWith('ipfs://') ? cid : `ipfs://${cid}`;
      return Buffer.from(uri);
    });

    const tx = new TokenMintTransaction()
      .setTokenId(tokenId)
      .setMetadata(metadataList)
      .setMaxTransactionFee(new Hbar(10));

    const frozenTx = tx.freezeWith(client);
    const maxFee = frozenTx.maxTransactionFee;

    if (!maxFee) {
      throw new Error('Failed to get max transaction fee from SDK');
    }

    const feePerBatch = maxFee.toBigNumber().toNumber();
    const totalFee = feePerBatch * totalBatches;
    const totalFeeWithBuffer = totalFee * 1.5; // 50% buffer when falling back

    return { feePerBatch, totalFee, totalFeeWithBuffer };
  } finally {
    client.close();
  }
}

/**
 * POST /api/calculate-mint-fee
 * Estimates the total HBAR required to mint metadataCIDs in batches of 10.
 *
 * Uses the Hedera mirror node to sample real, recent successful TOKENMINT
 * transactions. Fees automatically track the current network fee schedule and
 * HBAR price. Falls back to the SDK default fee with a larger buffer if mirror
 * node data is unavailable.
 */
export async function calculateMintFee(req: Request, res: Response): Promise<void> {
  try {
    const { tokenId, metadataCIDs } = req.body as CalculateFeeRequest;

    if (!tokenId || !metadataCIDs || !Array.isArray(metadataCIDs) || metadataCIDs.length === 0) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: tokenId, metadataCIDs',
      });
      return;
    }

    const totalBatches = Math.ceil(metadataCIDs.length / BATCH_SIZE);

    let feePerBatchTinybar = 0;
    let source = 'mirror-operator';
    let usedBuffer = 1.3;

    try {
      // First try: use this operator's own recent mint history for the target token.
      // This is the most accurate source because it reflects the exact token and signer.
      const operatorTxs = await fetchOperatorMintSamples(100);
      const operatorFees = removeOutliers(extractValidFees(operatorTxs, tokenId));

      if (operatorFees.length >= 3) {
        feePerBatchTinybar = average(operatorFees);
      } else {
        // Second try: network-wide recent parent TOKENMINT transactions of the same batch size.
        source = 'mirror-network';
        usedBuffer = 1.4;
        const networkTxs = await fetchNetworkMintSamples(100);
        const networkFees = removeOutliers(extractValidFees(networkTxs));

        if (networkFees.length >= 5) {
          feePerBatchTinybar = average(networkFees);
        } else if (networkFees.length > 0) {
          feePerBatchTinybar = average(networkFees);
          usedBuffer = 1.5;
        } else {
          throw new Error('No recent TOKENMINT samples from mirror node');
        }
      }
    } catch (mirrorErr) {
      console.warn('[calculate-mint-fee] Mirror-node estimation failed, falling back to SDK:', mirrorErr);
      source = 'sdk-fallback';
      const fallback = await sdkFallbackFee(tokenId, metadataCIDs, totalBatches);
      res.json({
        success: true,
        source,
        feePerBatch: fallback.feePerBatch,
        totalBatches,
        totalFee: fallback.totalFee,
        totalFeeWithBuffer: fallback.totalFeeWithBuffer,
      });
      return;
    }

    // Hard floor to protect against extremely low samples during quiet network periods.
    const HARD_FLOOR_TINYBAR = 250_000_000; // 2.5 HBAR per batch
    if (feePerBatchTinybar < HARD_FLOOR_TINYBAR) {
      feePerBatchTinybar = HARD_FLOOR_TINYBAR;
      source = `${source}-floor`;
    }

    const totalFeeTinybar = feePerBatchTinybar * totalBatches;
    const totalFeeWithBufferTinybar = totalFeeTinybar * usedBuffer;

    // The frontend expects HBAR values (it multiplies by 1e8 to get tinybars).
    const TINYBAR_PER_HBAR = 100_000_000;

    res.json({
      success: true,
      source,
      hasCustomFees: await tokenHasCustomFees(tokenId),
      feePerBatch: feePerBatchTinybar / TINYBAR_PER_HBAR,
      totalBatches,
      totalFee: totalFeeTinybar / TINYBAR_PER_HBAR,
      totalFeeWithBuffer: totalFeeWithBufferTinybar / TINYBAR_PER_HBAR,
    });
  } catch (err: any) {
    console.error('Calculate mint fee error:', err);
    res.status(500).json({
      success: false,
      error: err.message || 'Failed to calculate mint fee',
    });
  }
}
