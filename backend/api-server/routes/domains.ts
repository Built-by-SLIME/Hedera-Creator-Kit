import { Request, Response } from 'express';
import {
  Client,
  PrivateKey,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  TopicId,
} from '@hashgraph/sdk';
import { pool } from '../db';

const BACKEND_ACCOUNT_ID  = process.env.BACKEND_ACCOUNT_ID || process.env.TREASURY_ID;
const BACKEND_PRIVATE_KEY = process.env.BACKEND_PRIVATE_KEY || process.env.TREASURY_PK;
const DOMAIN_ADMIN_KEY    = process.env.DOMAIN_ADMIN_KEY;         // protects init-topics
const DOMAIN_ADMIN_ACCOUNT = process.env.DOMAIN_ADMIN_ACCOUNT;   // treasury wallet — free registrations
const DOMAIN_FEE_ACCOUNT  = process.env.DOMAIN_FEE_ACCOUNT || BACKEND_ACCOUNT_ID;
const MIRROR_NODE_URL     = 'https://mainnet-public.mirrornode.hedera.com';

const SUPPORTED_TLDS = ['hedera', 'slime', 'gib'] as const;
type SupportedTld = typeof SUPPORTED_TLDS[number];

// ─── Operator helpers ──────────────────────────────────────────────────────

function getOperatorClient(): Client {
  if (!BACKEND_ACCOUNT_ID || !BACKEND_PRIVATE_KEY) {
    throw new Error('Backend operator account not configured');
  }
  const client = Client.forMainnet();
  let pk: PrivateKey;
  try { pk = PrivateKey.fromStringECDSA(BACKEND_PRIVATE_KEY); }
  catch { pk = PrivateKey.fromStringED25519(BACKEND_PRIVATE_KEY); }
  client.setOperator(BACKEND_ACCOUNT_ID, pk);
  return client;
}

function getOperatorKey(): PrivateKey {
  if (!BACKEND_PRIVATE_KEY) throw new Error('Backend private key not configured');
  try { return PrivateKey.fromStringECDSA(BACKEND_PRIVATE_KEY); }
  catch { return PrivateKey.fromStringED25519(BACKEND_PRIVATE_KEY); }
}

function getTopicId(tld: SupportedTld): string | undefined {
  return process.env[`DOMAIN_TOPIC_ID_${tld.toUpperCase()}`];
}

// ─── Pricing ──────────────────────────────────────────────────────────────

function isPremiumName(name: string): boolean {
  return /[^\u0000-\u007F]/.test(name);
}

function getAnnualUsdPrice(name: string, isPremium: boolean): number {
  const len = [...name].length; // Unicode-aware
  if (isPremium) {
    if (len === 1) return 250;
    if (len === 2) return 150;
    return 50;
  }
  if (len === 1) return 100;
  if (len === 2) return 50;
  return 10;
}

// ─── HBAR price feed (1-minute in-memory cache) ────────────────────────────

let hbarPriceCache: { usd: number; fetchedAt: number } | null = null;

async function getHbarPriceUsd(): Promise<number> {
  const now = Date.now();
  if (hbarPriceCache && now - hbarPriceCache.fetchedAt < 60_000) {
    return hbarPriceCache.usd;
  }
  const res = await fetch(
    'https://api.coingecko.com/api/v3/simple/price?ids=hedera-hashgraph&vs_currencies=usd'
  );
  if (!res.ok) throw new Error(`CoinGecko price fetch failed: HTTP ${res.status}`);
  const data = await res.json() as { 'hedera-hashgraph': { usd: number } };
  const usd = data['hedera-hashgraph'].usd;
  hbarPriceCache = { usd, fetchedAt: now };
  console.log(`[domains] HBAR price refreshed: $${usd}`);
  return usd;
}

// ─── Mirror Node payment verification ────────────────────────────────────

/**
 * Convert SDK txId format "0.0.X@seconds.nanos" → Mirror Node "0.0.X-seconds-nanos"
 */
function normalizeTxId(txId: string): string {
  if (txId.includes('@')) {
    const [account, timestamp] = txId.split('@');
    const [seconds, nanos] = timestamp.split('.');
    return `${account}-${seconds}-${nanos}`;
  }
  return txId;
}

interface VerifyResult {
  valid: boolean;
  reason?: string;
  amountTinybars?: number;
}

async function verifyHbarPayment(
  txId: string,
  expectedRecipient: string,
  minTinybars: bigint
): Promise<VerifyResult> {
  const mirrorTxId = normalizeTxId(txId);
  const url = `${MIRROR_NODE_URL}/api/v1/transactions/${encodeURIComponent(mirrorTxId)}`;

  // Mirror Node can take up to ~15s to index a transaction — retry up to 5 times
  const MAX_ATTEMPTS = 5;
  const RETRY_DELAY_MS = 3000;
  let res: globalThis.Response | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    res = await fetch(url);
    if (res.ok) break;
    if (res.status !== 404 || attempt === MAX_ATTEMPTS) break;
    console.log(`[verifyHbarPayment] Mirror Node 404 for ${mirrorTxId} — retrying in ${RETRY_DELAY_MS / 1000}s (attempt ${attempt}/${MAX_ATTEMPTS})`);
    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
  }
  if (!res || !res.ok) {
    const status = res?.status ?? 0;
    return { valid: false, reason: `Mirror Node returned HTTP ${status} for tx ${txId} after ${MAX_ATTEMPTS} attempts` };
  }
  const data = await res.json() as {
    transactions?: Array<{
      result: string;
      consensus_timestamp: string;
      transfers: Array<{ account: string; amount: number }>;
    }>;
  };
  const tx = data.transactions?.[0];
  if (!tx) return { valid: false, reason: 'Transaction not found on Mirror Node' };
  if (tx.result !== 'SUCCESS') return { valid: false, reason: `Transaction result: ${tx.result}` };

  // Reject transactions older than 15 minutes
  const ageMs = Date.now() - parseFloat(tx.consensus_timestamp) * 1000;
  if (ageMs > 15 * 60 * 1000) return { valid: false, reason: 'Transaction is older than 15 minutes' };

  const recipientTransfer = tx.transfers.find(t => t.account === expectedRecipient && t.amount > 0);
  if (!recipientTransfer) {
    return { valid: false, reason: `No positive HBAR transfer found to ${expectedRecipient}` };
  }
  if (BigInt(recipientTransfer.amount) < minTinybars) {
    return {
      valid: false,
      reason: `Payment too small: received ${recipientTransfer.amount} tinybars, need at least ${minTinybars}`,
    };
  }
  return { valid: true, amountTinybars: recipientTransfer.amount };
}



// ─── ADMIN: Initialize HCS Topics ────────────────────────────────────────────

/**
 * POST /api/domains/init-topics
 * One-time admin setup — creates one HCS topic per TLD with the operator's submitKey.
 * Body: { adminKey: string }
 */
export async function initTopics(req: Request, res: Response): Promise<void> {
  const { adminKey } = req.body;
  if (!DOMAIN_ADMIN_KEY || adminKey !== DOMAIN_ADMIN_KEY) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }
  try {
    const client      = getOperatorClient();
    const operatorKey = getOperatorKey();
    const results: Record<string, string> = {};

    for (const tld of SUPPORTED_TLDS) {
      const existing = getTopicId(tld);
      if (existing) {
        results[tld] = existing;
        console.log(`[initTopics] .${tld} already configured: ${existing}`);
        continue;
      }
      const topicTx = await new TopicCreateTransaction()
        .setTopicMemo(`Hedera Creator Kit — .${tld} domain registry`)
        .setSubmitKey(operatorKey.publicKey)
        .freezeWith(client)
        .sign(operatorKey);
      const txResponse = await topicTx.execute(client);
      const receipt    = await txResponse.getReceipt(client);
      const topicId    = receipt.topicId!.toString();
      console.log(`[initTopics] Created .${tld} topic: ${topicId}`);
      results[tld] = topicId;
    }

    res.json({
      success: true,
      topics: results,
      instructions:
        'Set these as env vars and redeploy: ' +
        Object.entries(results)
          .map(([tld, id]) => `DOMAIN_TOPIC_ID_${tld.toUpperCase()}=${id}`)
          .join('  '),
    });
  } catch (err: any) {
    console.error('[initTopics] error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

// ─── PUBLIC: Check Domain Availability ───────────────────────────────────────

/**
 * GET /api/domains/check?name=alice&tld=hedera&years=1
 * Returns availability, pricing in USD and HBAR, and the fee account.
 */
export async function checkDomain(req: Request, res: Response): Promise<void> {
  try {
    const { name, tld, years: yearsStr } = req.query as Record<string, string>;

    if (!name || !tld) {
      res.status(400).json({ success: false, error: 'name and tld query params are required' });
      return;
    }
    if (!SUPPORTED_TLDS.includes(tld as SupportedTld)) {
      res.status(400).json({ success: false, error: `tld must be one of: ${SUPPORTED_TLDS.join(', ')}` });
      return;
    }

    const years = parseInt(yearsStr || '1');
    if (![1, 3, 5, 10].includes(years)) {
      res.status(400).json({ success: false, error: 'years must be 1, 3, 5, or 10' });
      return;
    }

    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(name)) {
      res.status(400).json({
        success: false,
        error: 'Domain name must use lowercase letters, numbers, or hyphens (not at start/end)',
      });
      return;
    }

    const existing = await pool.query(
      `SELECT owner_account_id, expires_at
       FROM domain_registrations
       WHERE name = $1 AND tld = $2 AND status = 'active' AND expires_at > NOW()
       LIMIT 1`,
      [name, tld]
    );

    const available = existing.rowCount === 0;
    const owner     = existing.rows[0]?.owner_account_id ?? null;
    const expiresAt = existing.rows[0]?.expires_at ?? null;

    let priceUsd: number | null = null;
    let priceHbar: number | null = null;
    let hbarPriceUsd: number | null = null;

    if (available) {
      const isPremium = isPremiumName(name);
      const annualUsd = getAnnualUsdPrice(name, isPremium);
      priceUsd        = annualUsd * years;
      hbarPriceUsd    = await getHbarPriceUsd();
      priceHbar       = priceUsd / hbarPriceUsd;
    }

    res.json({
      success: true, available, name, tld, years,
      owner, expiresAt, priceUsd, priceHbar, hbarPriceUsd,
      feeAccount: DOMAIN_FEE_ACCOUNT ?? null,
    });
  } catch (err: any) {
    console.error('[checkDomain] error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}


// ─── PUBLIC: Register Domain ──────────────────────────────────────────────────

/**
 * POST /api/domains/register
 * Verifies HBAR payment, submits HCS registration message, stores in DB.
 * Body: { name, tld, years, ownerAccountId, paymentTxId }
 */
export async function registerDomain(req: Request, res: Response): Promise<void> {
  try {
    const { name, tld, years: yearsRaw, ownerAccountId, paymentTxId } = req.body;

    const isAdmin = !!(DOMAIN_ADMIN_ACCOUNT && ownerAccountId === DOMAIN_ADMIN_ACCOUNT);

    if (!name || !tld || !ownerAccountId) {
      res.status(400).json({ success: false, error: 'name, tld, and ownerAccountId are required' });
      return;
    }
    if (!isAdmin && !paymentTxId) {
      res.status(400).json({ success: false, error: 'paymentTxId is required' });
      return;
    }
    if (!SUPPORTED_TLDS.includes(tld as SupportedTld)) {
      res.status(400).json({ success: false, error: `tld must be one of: ${SUPPORTED_TLDS.join(', ')}` });
      return;
    }

    const years = parseInt(yearsRaw || '1');
    if (![1, 3, 5, 10].includes(years)) {
      res.status(400).json({ success: false, error: 'years must be 1, 3, 5, or 10' });
      return;
    }
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(name)) {
      res.status(400).json({ success: false, error: 'Invalid domain name format' });
      return;
    }

    const topicId = getTopicId(tld as SupportedTld);
    if (!topicId) {
      res.status(503).json({ success: false, error: `HCS topic for .${tld} is not configured yet. Contact admin.` });
      return;
    }
    if (!DOMAIN_FEE_ACCOUNT) {
      res.status(503).json({ success: false, error: 'DOMAIN_FEE_ACCOUNT is not configured' });
      return;
    }

    // Check domain is still available
    const existing = await pool.query(
      `SELECT id FROM domain_registrations
       WHERE name = $1 AND tld = $2 AND status = 'active' AND expires_at > NOW()`,
      [name, tld]
    );
    if (existing.rowCount && existing.rowCount > 0) {
      res.status(409).json({ success: false, error: `${name}.${tld} was just registered by someone else` });
      return;
    }

    // Calculate price (always, for HCS message record-keeping)
    const isPremium    = isPremiumName(name);
    const annualUsd    = getAnnualUsdPrice(name, isPremium);
    const priceUsd     = annualUsd * years;
    const hbarPriceUsd = await getHbarPriceUsd();
    const priceHbar    = priceUsd / hbarPriceUsd;

    // Effective payment tx id — admin registrations use a generated reference
    const effectivePaymentTxId = isAdmin
      ? `admin-${ownerAccountId}-${Date.now()}`
      : paymentTxId;

    if (!isAdmin) {
      // Guard against payment replay
      const usedTx = await pool.query(
        'SELECT id FROM domain_registrations WHERE payment_tx_id = $1',
        [effectivePaymentTxId]
      );
      if (usedTx.rowCount && usedTx.rowCount > 0) {
        res.status(409).json({ success: false, error: 'This payment transaction has already been used' });
        return;
      }

      // Verify HBAR payment on Mirror Node
      const expectedTiny = BigInt(Math.floor(priceHbar * 1e8));
      const minTiny      = (expectedTiny * BigInt(95)) / BigInt(100); // 5% tolerance
      const verification = await verifyHbarPayment(effectivePaymentTxId, DOMAIN_FEE_ACCOUNT!, minTiny);
      if (!verification.valid) {
        res.status(400).json({ success: false, error: `Payment verification failed: ${verification.reason}` });
        return;
      }
    } else {
      console.log(`[registerDomain] Admin registration by ${ownerAccountId} — payment skipped`);
    }

    // Submit HCS registration message
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + years);

    const hcsMessage = JSON.stringify({
      action:     isAdmin ? 'admin-register' : 'register',
      name,
      tld,
      owner:      ownerAccountId,
      years,
      expires_at: expiresAt.toISOString(),
      payment_tx: effectivePaymentTxId,
    });

    const client      = getOperatorClient();
    const operatorKey = getOperatorKey();
    const submitTx    = await new TopicMessageSubmitTransaction()
      .setTopicId(TopicId.fromString(topicId))
      .setMessage(hcsMessage)
      .freezeWith(client)
      .sign(operatorKey);
    const submitResponse  = await submitTx.execute(client);
    const submitReceipt   = await submitResponse.getReceipt(client);
    const sequenceNumber  = submitReceipt.topicSequenceNumber?.toString() ?? null;

    // Persist to DB
    const dbResult = await pool.query(
      `INSERT INTO domain_registrations
         (name, tld, owner_account_id, years, expires_at, payment_tx_id,
          hcs_topic_id, hcs_sequence_number, price_usd, price_hbar)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [name, tld, ownerAccountId, years, expiresAt.toISOString(),
       effectivePaymentTxId, topicId, sequenceNumber, priceUsd, priceHbar]
    );

    console.log(`[registerDomain] Registered ${name}.${tld} for ${ownerAccountId} seq=${sequenceNumber}`);
    res.json({
      success: true,
      domain: `${name}.${tld}`,
      registration: dbResult.rows[0],
      hcsTopicId: topicId,
      hcsSequenceNumber: sequenceNumber,
    });
  } catch (err: any) {
    console.error('[registerDomain] error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

// ─── PUBLIC: Resolve Domain ───────────────────────────────────────────────────

/**
 * GET /api/domains/resolve/:name/:tld
 * Returns the owner account ID for an active domain.
 */
export async function resolveDomain(req: Request, res: Response): Promise<void> {
  try {
    const { name, tld } = req.params;

    const result = await pool.query(
      `SELECT owner_account_id, expires_at, registered_at, hcs_topic_id, hcs_sequence_number
       FROM domain_registrations
       WHERE name = $1 AND tld = $2 AND status = 'active' AND expires_at > NOW()
       ORDER BY registered_at DESC
       LIMIT 1`,
      [name, tld]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ success: false, error: `${name}.${tld} is not registered or has expired` });
      return;
    }

    const row = result.rows[0];
    res.json({
      success:           true,
      domain:            `${name}.${tld}`,
      owner:             row.owner_account_id,
      expiresAt:         row.expires_at,
      registeredAt:      row.registered_at,
      hcsTopicId:        row.hcs_topic_id,
      hcsSequenceNumber: row.hcs_sequence_number,
    });
  } catch (err: any) {
    console.error('[resolveDomain] error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}
