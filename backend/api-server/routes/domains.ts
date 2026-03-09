import { Request, Response } from 'express';
import {
  Client,
  PrivateKey,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  TopicId,
  TokenMintTransaction,
  TokenId,
  AccountId,
  TransferTransaction,
  Hbar,
} from '@hashgraph/sdk';
import sharp from 'sharp';
import axios from 'axios';
import FormData from 'form-data';
import { pool } from '../db';


const BACKEND_ACCOUNT_ID  = process.env.BACKEND_ACCOUNT_ID || process.env.TREASURY_ID;
const BACKEND_PRIVATE_KEY = process.env.BACKEND_PRIVATE_KEY || process.env.TREASURY_PK;
const DOMAIN_ADMIN_KEY    = process.env.DOMAIN_ADMIN_KEY;         // protects init-topics
const DOMAIN_ADMIN_ACCOUNT = process.env.DOMAIN_ADMIN_ACCOUNT;   // treasury wallet — free registrations
const DOMAIN_FEE_ACCOUNT  = process.env.DOMAIN_FEE_ACCOUNT || BACKEND_ACCOUNT_ID;
const MIRROR_NODE_URL     = 'https://mainnet-public.mirrornode.hedera.com';
const NETWORK_FEE_TINYBARS = BigInt(50_000_000); // 0.5 HBAR — flat reimbursement to operator for mint/transfer/HCS fees

// ─── Domain NFT config ────────────────────────────────────────────────────────
const DOMAIN_NFT_TOKEN_ID      = process.env.DOMAIN_NFT_TOKEN_ID;      // e.g. 0.0.10354981
const DOMAIN_NFT_SUPPLY_KEY    = process.env.DOMAIN_NFT_SUPPLY_KEY;    // supply key for minting
const DOMAIN_NFT_TREASURY_ID   = process.env.DOMAIN_NFT_TREASURY_ID;   // treasury that holds minted NFTs (0.0.9463056)
const DOMAIN_NFT_TREASURY_KEY  = process.env.DOMAIN_NFT_TREASURY_KEY;  // private key for that treasury account
const PINATA_API_KEY        = process.env.PINATA_API_KEY;
const PINATA_API_SECRET     = process.env.PINATA_API_SECRET;
// Base logo image pinned to IPFS — fetched once and cached in memory
const DOMAIN_BASE_IMAGE_CID = process.env.DOMAIN_NFT_BASE_IMAGE_CID
  || 'QmZ3LyEANVuKBjPtjCvKBMTEV2rqWrB8VS839wTbS1hyZp';

const SUPPORTED_TLDS = ['hedera', 'slime', 'gib', 'tigers'] as const;
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

function getDomainSupplyKey(): PrivateKey {
  if (!DOMAIN_NFT_SUPPLY_KEY) throw new Error('DOMAIN_NFT_SUPPLY_KEY is not configured');
  // Use fromString() for auto-detection — avoids ECDSA silently "succeeding"
  // on a raw ED25519 hex key (both are 32 bytes) and producing the wrong key.
  try { return PrivateKey.fromString(DOMAIN_NFT_SUPPLY_KEY); }
  catch { return PrivateKey.fromStringED25519(DOMAIN_NFT_SUPPLY_KEY); }
}

// ─── Domain NFT helpers ────────────────────────────────────────────────────

let _baseImageCache: Buffer | null = null;

/** Fetches the base SLIME graphic from IPFS (cached in memory after first call). */
async function getBaseImage(): Promise<Buffer> {
  if (_baseImageCache) return _baseImageCache;
  const url = `https://gateway.pinata.cloud/ipfs/${DOMAIN_BASE_IMAGE_CID}`;
  const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 15_000 });
  _baseImageCache = Buffer.from(res.data as ArrayBuffer);
  console.log('[domains] Base image fetched from IPFS and cached');
  return _baseImageCache;
}

/**
 * Returns the base SLIME graphic as the domain NFT image.
 * The domain name is already set as the NFT's on-chain name, making it
 * visible in wallets and secondary markets without needing a text overlay.
 */
async function generateDomainImage(_domain: string): Promise<Buffer> {
  const base = await getBaseImage();
  return sharp(base).png().toBuffer();
}

/** Uploads a Buffer to Pinata and returns the IPFS CID. */
async function pinBufferToPinata(buf: Buffer, filename: string, label: string): Promise<string> {
  if (!PINATA_API_KEY || !PINATA_API_SECRET) throw new Error('Pinata credentials not configured');
  const form = new FormData();
  form.append('file', buf, { filename, contentType: 'image/png' });
  form.append('pinataMetadata', JSON.stringify({ name: label }));
  const res = await axios.post('https://api.pinata.cloud/pinning/pinFileToIPFS', form, {
    maxBodyLength: Infinity,
    headers: {
      ...form.getHeaders(),
      pinata_api_key: PINATA_API_KEY,
      pinata_secret_api_key: PINATA_API_SECRET,
    },
  });
  return res.data.IpfsHash as string;
}

/** Uploads a JSON object to Pinata and returns the IPFS CID. */
async function pinJsonToPinata(obj: object, label: string): Promise<string> {
  if (!PINATA_API_KEY || !PINATA_API_SECRET) throw new Error('Pinata credentials not configured');
  const form = new FormData();
  form.append('file', Buffer.from(JSON.stringify(obj, null, 2)), {
    filename: `${label.replace(/[^a-zA-Z0-9]/g, '_')}.json`,
    contentType: 'application/json',
  });
  form.append('pinataMetadata', JSON.stringify({ name: label }));
  const res = await axios.post('https://api.pinata.cloud/pinning/pinFileToIPFS', form, {
    maxBodyLength: Infinity,
    headers: {
      ...form.getHeaders(),
      pinata_api_key: PINATA_API_KEY,
      pinata_secret_api_key: PINATA_API_SECRET,
    },
  });
  return res.data.IpfsHash as string;
}

/**
 * Generates the NFT image, uploads both image and metadata to IPFS, mints
 * a new serial on the domain collection, and transfers it to the registrant.
 * Returns the minted serial number.
 */
async function mintAndTransferDomainNft(
  name: string, tld: string, years: number, toAccountId: string
): Promise<number> {
  const domain = `${name}.${tld}`;

  // 1. Generate image
  const imageBuffer = await generateDomainImage(domain);
  const imageCid    = await pinBufferToPinata(imageBuffer, `${domain}.png`, `Domain NFT - ${domain}`);
  console.log(`[domains] NFT image pinned: ${imageCid}`);

  // 2. Build HIP-412 metadata
  const metadata = {
    name:        domain,
    description: `Hedera Domain Name — ${domain}`,
    image:       `ipfs://${imageCid}`,
    type:        'image/png',
    attributes: [
      { trait_type: 'Domain',      value: domain },
      { trait_type: 'TLD',         value: tld },
      { trait_type: 'Name',        value: name },
      { trait_type: 'Name Length', value: [...name].length },
      { trait_type: 'Years',       value: years },
    ],
    format: 'HIP412@2.0.0',
  };
  const metadataCid = await pinJsonToPinata(metadata, `Domain NFT Metadata - ${domain}`);
  console.log(`[domains] NFT metadata pinned: ${metadataCid}`);

  // 3. Mint
  const supplyKey  = getDomainSupplyKey();
  const client     = getOperatorClient();
  const mintTx     = await new TokenMintTransaction()
    .setTokenId(DOMAIN_NFT_TOKEN_ID!)
    .setMetadata([Buffer.from(`ipfs://${metadataCid}`)])
    .setMaxTransactionFee(new Hbar(10))
    .freezeWith(client)
    .sign(supplyKey);
  const mintRes     = await mintTx.execute(client);
  const mintReceipt = await mintRes.getReceipt(client);
  const rawSerial   = mintReceipt.serials?.[0];
  if (!rawSerial) throw new Error('Mint transaction returned no serial');
  const serial = typeof rawSerial === 'object' && 'low' in rawSerial
    ? (rawSerial as any).low as number
    : Number(rawSerial);
  console.log(`[domains] Minted serial #${serial} for ${domain}`);

  // 4. Transfer from treasury to registrant
  // Minted NFTs land in the token's treasury account — transfer must originate there.
  const treasuryId  = DOMAIN_NFT_TREASURY_ID || BACKEND_ACCOUNT_ID!;
  const treasuryKey = DOMAIN_NFT_TREASURY_KEY
    ? PrivateKey.fromString(DOMAIN_NFT_TREASURY_KEY)
    : getOperatorKey();
  const transferTx  = await new TransferTransaction()
    .addNftTransfer(
      TokenId.fromString(DOMAIN_NFT_TOKEN_ID!),
      serial,
      AccountId.fromString(treasuryId),
      AccountId.fromString(toAccountId)
    )
    .freezeWith(client)
    .sign(treasuryKey);
  const transferRes = await transferTx.execute(client);
  await transferRes.getReceipt(client);
  console.log(`[domains] NFT serial #${serial} transferred to ${toAccountId}`);

  return serial;
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

// ─── HBAR price feed (5-minute in-memory cache) ────────────────────────────

let hbarPriceCache: { usd: number; fetchedAt: number } | null = null;
const PRICE_CACHE_TTL_MS = 5 * 60_000; // 5 minutes — well within CoinGecko free-tier limits

async function getHbarPriceUsd(): Promise<number> {
  const now = Date.now();
  if (hbarPriceCache && now - hbarPriceCache.fetchedAt < PRICE_CACHE_TTL_MS) {
    return hbarPriceCache.usd;
  }
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=hedera-hashgraph&vs_currencies=usd'
    );
    if (!res.ok) {
      // On rate-limit (429) or any transient error, return the stale cached price
      // rather than throwing — this prevents the UI from breaking on a price blip.
      if (hbarPriceCache) {
        console.warn(`[domains] CoinGecko returned HTTP ${res.status} — using stale cached price $${hbarPriceCache.usd}`);
        return hbarPriceCache.usd;
      }
      throw new Error(`CoinGecko price fetch failed: HTTP ${res.status}`);
    }
    const data = await res.json() as { 'hedera-hashgraph': { usd: number } };
    const usd = data['hedera-hashgraph'].usd;
    hbarPriceCache = { usd, fetchedAt: now };
    console.log(`[domains] HBAR price refreshed: $${usd}`);
    return usd;
  } catch (err: any) {
    // Network error — fall back to stale cache if available
    if (hbarPriceCache) {
      console.warn(`[domains] CoinGecko fetch error — using stale cached price $${hbarPriceCache.usd}:`, err.message);
      return hbarPriceCache.usd;
    }
    throw err;
  }
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

    // Availability is determined by HCS (Mirror Node), not the DB
    const hcsRecord  = await resolveFromHcs(name, tld as SupportedTld);
    const available  = hcsRecord === null;
    const owner      = hcsRecord?.owner ?? hcsRecord?.new_owner ?? null;
    const expiresAt  = hcsRecord?.expires_at ?? null;

    // Always compute price — used for both registration and renewal previews
    const isPremium    = isPremiumName(name);
    const annualUsd    = getAnnualUsdPrice(name, isPremium);
    const priceUsd     = annualUsd * years;
    const hbarPriceUsd = await getHbarPriceUsd();
    const priceHbar    = priceUsd / hbarPriceUsd;

    res.json({
      success: true, available, name, tld, years,
      owner, expiresAt, priceUsd, priceHbar, hbarPriceUsd,
      feeAccount:     DOMAIN_FEE_ACCOUNT ?? null,
      operatorAccount: BACKEND_ACCOUNT_ID ?? null,
      networkFeeHbar:  0.5,
      nftTokenId: DOMAIN_NFT_TOKEN_ID ?? null,
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

    // Check domain is still available — source of truth is HCS, not the DB
    // Admin can override (e.g. NFT was burned, re-registering the same name)
    if (!isAdmin) {
      const hcsExisting = await resolveFromHcs(name, tld as SupportedTld);
      if (hcsExisting !== null) {
        res.status(409).json({ success: false, error: `${name}.${tld} is already registered` });
        return;
      }
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

      if (DOMAIN_FEE_ACCOUNT === BACKEND_ACCOUNT_ID) {
        // Same wallet receives both domain fee and operator reimbursement —
        // verify the combined amount landed in the one account.
        const verification = await verifyHbarPayment(effectivePaymentTxId, DOMAIN_FEE_ACCOUNT!, minTiny + NETWORK_FEE_TINYBARS);
        if (!verification.valid) {
          res.status(400).json({ success: false, error: `Payment verification failed: ${verification.reason}` });
          return;
        }
      } else {
        // Separate wallets — verify each leg independently.
        const verification = await verifyHbarPayment(effectivePaymentTxId, DOMAIN_FEE_ACCOUNT!, minTiny);
        if (!verification.valid) {
          res.status(400).json({ success: false, error: `Payment verification failed: ${verification.reason}` });
          return;
        }
        if (BACKEND_ACCOUNT_ID) {
          const opVerification = await verifyHbarPayment(effectivePaymentTxId, BACKEND_ACCOUNT_ID, NETWORK_FEE_TINYBARS);
          if (!opVerification.valid) {
            res.status(400).json({ success: false, error: `Network fee verification failed: ${opVerification.reason}` });
            return;
          }
        }
      }
    } else {
      console.log(`[registerDomain] Admin registration by ${ownerAccountId} — payment skipped`);
    }

    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + years);

    // Mint + transfer domain NFT (if collection is configured)
    let nftSerial: number | null = null;
    if (DOMAIN_NFT_TOKEN_ID && DOMAIN_NFT_SUPPLY_KEY && PINATA_API_KEY && PINATA_API_SECRET) {
      try {
        nftSerial = await mintAndTransferDomainNft(name, tld, years, ownerAccountId);
      } catch (nftErr: any) {
        console.error('[registerDomain] NFT minting failed — aborting registration:', nftErr.message);
        res.status(500).json({ success: false, error: `NFT minting failed: ${nftErr.message}` });
        return;
      }
    } else {
      console.warn('[registerDomain] Domain NFT config incomplete — skipping NFT mint');
    }

    // Submit HCS registration message
    const hcsMessage = JSON.stringify({
      action:     isAdmin ? 'admin-register' : 'register',
      name,
      tld,
      owner:      ownerAccountId,
      years,
      expires_at: expiresAt.toISOString(),
      payment_tx: effectivePaymentTxId,
      ...(nftSerial !== null && {
        nft_token_id: DOMAIN_NFT_TOKEN_ID,
        nft_serial:   nftSerial,
      }),
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
          hcs_topic_id, hcs_sequence_number, price_usd, price_hbar,
          nft_token_id, nft_serial)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [name, tld, ownerAccountId, years, expiresAt.toISOString(),
       effectivePaymentTxId, topicId, sequenceNumber, priceUsd, priceHbar,
       DOMAIN_NFT_TOKEN_ID ?? null, nftSerial]
    );

    console.log(`[registerDomain] Registered ${name}.${tld} for ${ownerAccountId} seq=${sequenceNumber} nftSerial=${nftSerial}`);
    res.json({
      success: true,
      domain: `${name}.${tld}`,
      registration: dbResult.rows[0],
      hcsTopicId: topicId,
      hcsSequenceNumber: sequenceNumber,
      ...(nftSerial !== null && {
        nftTokenId: DOMAIN_NFT_TOKEN_ID,
        nftSerial,
      }),
    });
  } catch (err: any) {
    console.error('[registerDomain] error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

// ─── ADMIN: Purge All Domain Registrations ───────────────────────────────────

/**
 * POST /api/domains/admin/purge-registrations
 * One-time admin utility — deletes ALL rows from domain_registrations ONLY.
 * No other tables are affected.
 * Body: { adminKey: string }
 */
export async function purgeRegistrations(req: Request, res: Response): Promise<void> {
  const { adminKey } = req.body;
  if (!DOMAIN_ADMIN_KEY || adminKey !== DOMAIN_ADMIN_KEY) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }
  try {
    const result = await pool.query('DELETE FROM domain_registrations');
    const deleted = result.rowCount ?? 0;
    console.log(`[purgeRegistrations] Deleted ${deleted} row(s) from domain_registrations`);
    res.json({ success: true, deleted });
  } catch (err: any) {
    console.error('[purgeRegistrations] error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function transferDomain(_req: Request, res: Response): Promise<void> {
  res.status(410).json({ success: false, error: 'Transfer endpoint removed. Ownership is resolved directly from the Mirror Node NFT holder.' });
}

// ─── PUBLIC: Renew Domain ────────────────────────────────────────────────────

/**
 * POST /api/domains/renew
 * Body: { name, tld, ownerAccountId, years, paymentTxId }
 *
 * Renews an active (or recently-expired) domain by:
 *   1. Verifying the HBAR renewal payment on Mirror Node (same fee structure as registration).
 *   2. Submitting a `renew` HCS message with the updated expiry.
 *   3. Updating the DB cache.
 *
 * The caller must be the current owner according to HCS.
 */
export async function renewDomain(req: Request, res: Response): Promise<void> {
  try {
    const { name, tld, ownerAccountId, years: yearsRaw, paymentTxId } = req.body;

    if (!name || !tld || !ownerAccountId || !paymentTxId) {
      res.status(400).json({ success: false, error: 'name, tld, ownerAccountId, years, and paymentTxId are required' });
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

    const topicId = getTopicId(tld as SupportedTld);
    if (!topicId) {
      res.status(503).json({ success: false, error: `HCS topic for .${tld} is not configured` });
      return;
    }

    // Step 1 — resolve current HCS state
    // Note: we allow recently-expired domains to be renewed too, so we call
    // fetchAllTopicMessages directly and check without the expiry filter.
    const rawMessages = await fetchAllTopicMessages(topicId);
    const domainRecords: HcsDomainRecord[] = [];
    for (const msg of rawMessages) {
      try {
        const text   = Buffer.from(msg.message, 'base64').toString('utf-8');
        const parsed = JSON.parse(text) as HcsDomainRecord;
        if (parsed.name?.toLowerCase() === name.toLowerCase() && parsed.tld?.toLowerCase() === tld.toLowerCase()) {
          parsed.sequence_number = msg.sequence_number;
          domainRecords.push(parsed);
        }
      } catch { /* skip */ }
    }

    if (domainRecords.length === 0) {
      res.status(404).json({ success: false, error: `${name}.${tld} has never been registered` });
      return;
    }
    domainRecords.sort((a, b) => b.sequence_number - a.sequence_number);
    const current = domainRecords[0];
    const currentOwner = current.new_owner ?? current.owner;

    // Only current owner may renew
    if (currentOwner !== ownerAccountId) {
      res.status(403).json({ success: false, error: `Only the current owner (${currentOwner}) can renew this domain` });
      return;
    }

    // Step 2 — guard against payment replay
    const usedTx = await pool.query('SELECT id FROM domain_registrations WHERE payment_tx_id = $1', [paymentTxId]);
    if (usedTx.rowCount && usedTx.rowCount > 0) {
      res.status(409).json({ success: false, error: 'This payment transaction has already been used' });
      return;
    }

    // Step 3 — verify renewal payment (same fee structure as registration)
    const isPremium    = isPremiumName(name);
    const annualUsd    = getAnnualUsdPrice(name, isPremium);
    const priceUsd     = annualUsd * years;
    const hbarPriceUsd = await getHbarPriceUsd();
    const priceHbar    = priceUsd / hbarPriceUsd;
    const expectedTiny = BigInt(Math.floor(priceHbar * 1e8));
    const minTiny      = (expectedTiny * BigInt(95)) / BigInt(100);

    if (DOMAIN_FEE_ACCOUNT === BACKEND_ACCOUNT_ID) {
      const v = await verifyHbarPayment(paymentTxId, DOMAIN_FEE_ACCOUNT!, minTiny + NETWORK_FEE_TINYBARS);
      if (!v.valid) { res.status(400).json({ success: false, error: `Payment verification failed: ${v.reason}` }); return; }
    } else {
      const v = await verifyHbarPayment(paymentTxId, DOMAIN_FEE_ACCOUNT!, minTiny);
      if (!v.valid) { res.status(400).json({ success: false, error: `Payment verification failed: ${v.reason}` }); return; }
      if (BACKEND_ACCOUNT_ID) {
        const ov = await verifyHbarPayment(paymentTxId, BACKEND_ACCOUNT_ID, NETWORK_FEE_TINYBARS);
        if (!ov.valid) { res.status(400).json({ success: false, error: `Network fee verification failed: ${ov.reason}` }); return; }
      }
    }

    // Step 4 — compute new expiry (extend from now or from current expiry, whichever is later)
    const baseDate  = current.expires_at && new Date(current.expires_at) > new Date()
      ? new Date(current.expires_at)
      : new Date();
    const newExpiry = new Date(baseDate);
    newExpiry.setFullYear(newExpiry.getFullYear() + years);

    // Step 5 — submit renew HCS message
    const client      = getOperatorClient();
    const operatorKey = getOperatorKey();

    const hcsMessage = JSON.stringify({
      action:        'renew',
      name, tld,
      owner:         currentOwner,
      years,
      prev_expires_at: current.expires_at,
      expires_at:    newExpiry.toISOString(),
      payment_tx:    paymentTxId,
      ...(current.nft_token_id && { nft_token_id: current.nft_token_id, nft_serial: current.nft_serial }),
    });

    const submitTx = await new TopicMessageSubmitTransaction()
      .setTopicId(TopicId.fromString(topicId))
      .setMessage(hcsMessage)
      .freezeWith(client)
      .sign(operatorKey);
    const submitResponse = await submitTx.execute(client);
    const submitReceipt  = await submitResponse.getReceipt(client);
    const sequenceNumber = submitReceipt.topicSequenceNumber?.toString() ?? null;

    // Update DB cache
    await pool.query(
      `UPDATE domain_registrations
          SET expires_at          = $1,
              hcs_sequence_number = $2,
              payment_tx_id       = $3,
              updated_at          = NOW()
        WHERE name = $4 AND tld = $5 AND status = 'active'`,
      [newExpiry.toISOString(), sequenceNumber, paymentTxId, name, tld]
    );

    res.json({
      success: true,
      domain:  `${name}.${tld}`,
      owner:   currentOwner,
      newExpiresAt:      newExpiry.toISOString(),
      hcsTopicId:        topicId,
      hcsSequenceNumber: sequenceNumber,
    });
  } catch (err: any) {
    console.error('[renewDomain] error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

// ─── PUBLIC: Resolve Domain ───────────────────────────────────────────────────

interface HcsMessage {
  message:         string;  // base64-encoded
  sequence_number: number;
}

interface HcsDomainRecord {
  action:      string;
  name:        string;
  tld:         string;
  owner?:      string;       // set on register / admin-register
  new_owner?:  string;       // set on transfer
  years?:      number;
  expires_at?: string;       // ISO timestamp
  payment_tx?: string;
  nft_token_id?: string;
  nft_serial?:   number;
  // injected locally for sorting
  sequence_number: number;
}

/**
 * Fetches every message from an HCS topic via the Mirror Node,
 * following pagination until exhausted.
 */
async function fetchAllTopicMessages(topicId: string): Promise<HcsMessage[]> {
  const results: HcsMessage[] = [];
  let url: string = `${MIRROR_NODE_URL}/api/v1/topics/${topicId}/messages?limit=100&order=asc`;

  while (url) {
    const resp = await axios.get<{ messages: HcsMessage[]; links?: { next?: string } }>(url);
    const { messages = [], links } = resp.data;
    results.push(...messages);
    const next = links?.next;
    url = next ? (next.startsWith('http') ? next : `${MIRROR_NODE_URL}${next}`) : '';
  }

  return results;
}

/**
 * Shared resolver: reads HCS topic messages for a given domain and returns
 * the latest authoritative record, or null if not registered / expired.
 * Used by both checkDomain (availability) and resolveDomain (resolution).
 */
async function resolveFromHcs(
  name: string,
  tld: SupportedTld,
): Promise<HcsDomainRecord | null> {
  const topicId = getTopicId(tld);
  if (!topicId) return null;

  const rawMessages = await fetchAllTopicMessages(topicId);
  const domainRecords: HcsDomainRecord[] = [];

  for (const msg of rawMessages) {
    try {
      const text   = Buffer.from(msg.message, 'base64').toString('utf-8');
      const parsed = JSON.parse(text) as HcsDomainRecord;
      if (
        parsed.name?.toLowerCase() === name.toLowerCase() &&
        parsed.tld?.toLowerCase()  === tld.toLowerCase()
      ) {
        parsed.sequence_number = msg.sequence_number;
        domainRecords.push(parsed);
      }
    } catch { /* skip malformed */ }
  }

  if (domainRecords.length === 0) return null;

  // Latest sequence number is authoritative
  domainRecords.sort((a, b) => b.sequence_number - a.sequence_number);
  const latest = domainRecords[0];

  // Treat expired domains as not found
  if (!latest.expires_at || new Date(latest.expires_at) <= new Date()) return null;

  return latest;
}

/**
 * GET /api/domains/resolve/:name/:tld
 *
 * Reads the HCS topic for the given TLD directly from the Hedera Mirror Node,
 * applies "latest sequence number wins" resolution, and returns the current owner.
 * This is the canonical source of truth — the DB is NOT consulted.
 */
export async function resolveDomain(req: Request, res: Response): Promise<void> {
  try {
    const { name, tld } = req.params;

    if (!name || !tld) {
      res.status(400).json({ success: false, error: 'name and tld are required' });
      return;
    }
    if (!SUPPORTED_TLDS.includes(tld as SupportedTld)) {
      res.status(400).json({ success: false, error: `tld must be one of: ${SUPPORTED_TLDS.join(', ')}` });
      return;
    }

    const topicId = getTopicId(tld as SupportedTld);
    if (!topicId) {
      res.status(500).json({ success: false, error: `HCS topic for .${tld} is not configured` });
      return;
    }

    const latest = await resolveFromHcs(name, tld as SupportedTld);

    if (!latest) {
      res.status(404).json({ success: false, error: `${name}.${tld} is not registered or has expired` });
      return;
    }

    // The NFT IS the ownership record. Look up who currently holds it on Mirror Node.
    // This means secondary market sales resolve automatically — no manual assertion needed.
    let currentOwner = latest.owner;
    if (latest.nft_serial != null && DOMAIN_NFT_TOKEN_ID) {
      try {
        const nftUrl  = `${MIRROR_NODE_URL}/api/v1/tokens/${DOMAIN_NFT_TOKEN_ID}/nfts/${latest.nft_serial}`;
        const nftResp = await axios.get<{ account_id: string }>(nftUrl);
        if (nftResp.data.account_id) {
          currentOwner = nftResp.data.account_id;
        }
      } catch {
        // Mirror Node unavailable — fall back to the HCS owner field
        console.warn(`[resolveDomain] Could not fetch NFT holder for serial ${latest.nft_serial} — falling back to HCS owner`);
      }
    }

    res.json({
      success:           true,
      domain:            `${name}.${tld}`,
      owner:             currentOwner,
      expiresAt:         latest.expires_at,
      nftTokenId:        DOMAIN_NFT_TOKEN_ID ?? null,
      nftSerial:         latest.nft_serial ?? null,
      hcsTopicId:        topicId,
      hcsSequenceNumber: latest.sequence_number,
    });
  } catch (err: any) {
    console.error('[resolveDomain] error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}
