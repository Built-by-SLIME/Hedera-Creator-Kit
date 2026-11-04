/**
 * Batch inscription: inscribe a whole generated collection (ZIP of
 * images/ + metadata/ from the Art Generator's download mode) and mint every
 * NFT against an existing collection, using the same proven HCS-1/HCS-6 core
 * as the single inscription tool.
 *
 * Flow:  POST /api/inscribe-batch/prepare  (multipart ZIP, field "zip")
 *        → wallet pays estCostHbar + mint fee in ONE transfer (frontend)
 *        POST /api/inscribe-batch/start    { preparedBatchId, tokenId, supplyKey, userAccountId, updatable }
 *        GET  /api/inscribe-batch/status/:jobId
 *        POST /api/inscribe-batch/resume/:jobId   (after a disconnect/restart)
 *
 * Per-item state is persisted to disk after every step, and the inscribe()
 * core itself resumes from its own record, so a restart mid-job picks up
 * where it left off. Items stuck in 'minting' on resume are reconciled
 * against the mirror node by their unique hcs:// pointer before any new
 * mint is sent, so a crash can never duplicate an NFT.
 */
import { Request, Response } from 'express';
import { Client, PrivateKey, TokenMintTransaction, Hbar } from '@hashgraph/sdk';
import fs from 'fs-extra';
import path from 'path';
import AdmZip from 'adm-zip';
import {
  sha256hex,
  bytesToB64,
  chunkify,
  inscribe,
  createRegistry,
  registerEntry,
  sniffMime,
  HEDERA_FEES_USD,
  messagesUsd,
  makeInscribeContext,
  compressZstd,
} from '../inscription';
import {
  BatchJob,
  BatchItem,
  newBatchJobId,
  batchJobDir,
  saveBatchJob,
  loadBatchJob,
} from '../batchInscribeStore';

const BACKEND_ACCOUNT_ID = process.env.BACKEND_ACCOUNT_ID || process.env.TREASURY_ID;
const BACKEND_PRIVATE_KEY = process.env.BACKEND_PRIVATE_KEY || process.env.TREASURY_PK;

const MIRROR = 'https://mainnet-public.mirrornode.hedera.com';

/** Same formats the single inscription tool accepts (magic bytes, not the client's claim). */
const ALLOWED_MIME = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp', 'image/svg+xml',
]);

/** How many NFTs are inscribed concurrently. Each inscribe() already pipelines 8 messages. */
const INSCRIBE_CONCURRENCY = 2;
const MINT_BATCH = 10;
const PREPARED_TTL = 60 * 60 * 1000; // 1 hour to review the quote and pay

const activeWorkers = new Set<string>();

const preparedDir = () => batchJobDir('prepared');

async function hbarPerUsd(): Promise<number> {
  const res = await fetch('https://mainnet-public.mirrornode.hedera.com/api/v1/network/exchangerate');
  const j: any = await res.json();
  const r = j.current_rate;
  return Number(r.hbar_equivalent) / (Number(r.cent_equivalent) / 100);
}

/** Per-NFT quote, mirroring the single tool's formula (line in routes/inscribe.ts). */
function quoteItemUsd(chunks: number): number {
  return 2 * HEDERA_FEES_USD.topic          // media topic + metadata topic
    + messagesUsd(HEDERA_FEES_USD, chunks)  // media message stream
    + HEDERA_FEES_USD.topic + HEDERA_FEES_USD.msg // registry topic + register message
    + 0.01;                                 // same flat allowance as the single tool
}

/** "37.png" → 37. Art-gen output is numbered by serial. */
function serialOf(filename: string): number | null {
  const m = filename.match(/^(\d+)/);
  return m ? Number(m[1]) : null;
}

/** Extract "images/" + "metadata/" from an art-gen ZIP, paired by leading serial number. */
async function extractCollection(zipPath: string, destDir: string) {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries().filter(e => !e.isDirectory);

  const findDir = (name: string) => {
    const hit = entries.filter(e =>
      e.entryName.toLowerCase().startsWith(name.toLowerCase() + '/'));
    return hit.length ? hit : null;
  };

  const imageEntries = findDir('images');
  const metadataEntries = findDir('metadata');
  if (!imageEntries || !metadataEntries) {
    throw new Error('ZIP must contain "images/" and "metadata/" folders (use the Art Generator\'s Download ZIP output).');
  }

  await fs.ensureDir(path.join(destDir, 'images'));
  await fs.ensureDir(path.join(destDir, 'metadata'));

  const items: { serial: number; image: string; metadata: string }[] = [];
  const unpaired: string[] = [];

  for (const e of imageEntries) {
    const base = path.basename(e.entryName);
    const serial = serialOf(base);
    if (serial == null) { unpaired.push(base); continue; }
    const metaEntry = metadataEntries.find(m => serialOf(path.basename(m.entryName)) === serial);
    if (!metaEntry) { unpaired.push(base); continue; }
    await fs.writeFile(path.join(destDir, 'images', base), e.getData());
    await fs.writeFile(path.join(destDir, 'metadata', `${serial}.json`), metaEntry.getData());
    items.push({ serial, image: base, metadata: `${serial}.json` });
  }

  items.sort((a, b) => a.serial - b.serial);
  return { items, unpaired };
}

// ─── PREPARE ────────────────────────────────────────────────────────────────

/**
 * POST /api/inscribe-batch/prepare  (multipart, field "zip")
 * Validates the collection, compresses every image, and returns an exact
 * per-item + total quote. Nothing is sent to Hedera yet.
 */
export async function prepareBatchInscribe(req: Request, res: Response): Promise<void> {
  const file = (req as any).file;
  if (!file) {
    res.status(400).json({ success: false, error: 'ZIP file is required (multipart field "zip")' });
    return;
  }
  const batchId = newBatchJobId();
  const dir = path.join(preparedDir(), batchId);
  try {
    const { items: pairs, unpaired } = await extractCollection(file.path, dir);
    await fs.remove(file.path).catch(() => {});

    if (pairs.length === 0) {
      await fs.remove(dir).catch(() => {});
      res.status(400).json({
        success: false,
        error: `No image/metadata pairs found${unpaired.length ? ` (unmatched: ${unpaired.slice(0, 5).join(', ')}${unpaired.length > 5 ? '…' : ''})` : ''}. Filenames must be numbered by serial, e.g. images/1.png + metadata/1.json.`,
      });
      return;
    }
    if (pairs.length > 10000) {
      await fs.remove(dir).catch(() => {});
      res.status(400).json({ success: false, error: 'Collections above 10,000 NFTs are not supported in one batch.' });
      return;
    }

    const items: any[] = [];
    let totalUsd = 0;
    let totalChunks = 0;

    for (const pair of pairs) {
      const imagePath = path.join(dir, 'images', pair.image);
      const metaPath = path.join(dir, 'metadata', pair.metadata);
      const bytes = new Uint8Array(await fs.readFile(imagePath));
      const mime = sniffMime(bytes);
      if (!mime || !ALLOWED_MIME.has(mime)) {
        await fs.remove(dir).catch(() => {});
        res.status(400).json({
          success: false,
          error: `Unsupported image type for ${pair.image}${mime ? ` (${mime})` : ''}. Allowed: PNG, JPEG, GIF, WebP, AVIF, BMP, SVG.`,
        });
        return;
      }
      let metaJson: any;
      try {
        metaJson = await fs.readJSON(metaPath);
      } catch {
        await fs.remove(dir).catch(() => {});
        res.status(400).json({ success: false, error: `Invalid metadata JSON: ${pair.metadata}` });
        return;
      }
      const sha256 = await sha256hex(bytes);
      const comp = await compressZstd(bytes);
      const chunks = chunkify('data:' + mime + ';base64,' + bytesToB64(comp)).length;
      const estUsd = quoteItemUsd(chunks);
      totalUsd += estUsd;
      totalChunks += chunks;
      items.push({ serial: pair.serial, name: String(metaJson?.name ?? `#${pair.serial}`), size: bytes.length, chunks, estCostUsd: estUsd });
    }

    const rate = await hbarPerUsd().catch(() => 14);
    await fs.writeJSON(path.join(dir, 'prepared.json'), { createdAt: Date.now(), items: pairs });

    res.json({
      success: true,
      preparedBatchId: batchId,
      count: items.length,
      totalChunks,
      totalSize: items.reduce((a, i) => a + i.size, 0),
      estCostUsd: +totalUsd.toFixed(4),
      estCostHbar: +(totalUsd * rate * 1.25).toFixed(4), // 25% buffer, same as single
      items,
      unpaired: unpaired.length ? unpaired : undefined,
    });
  } catch (err: any) {
    await fs.remove(dir).catch(() => {});
    await fs.remove(file.path).catch(() => {});
    console.error('Prepare batch inscription failed:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to prepare collection' });
  }
}

// ─── START / RESUME ─────────────────────────────────────────────────────────

/**
 * POST /api/inscribe-batch/start
 * Body: { preparedBatchId, tokenId, supplyKey, userAccountId, updatable }
 * Creates the persisted job and kicks off the background worker.
 */
export async function startBatchInscribe(req: Request, res: Response): Promise<void> {
  try {
    const { preparedBatchId, tokenId, supplyKey, userAccountId, updatable } = req.body || {};
    if (!preparedBatchId || !tokenId || !supplyKey || !userAccountId) {
      res.status(400).json({ success: false, error: 'preparedBatchId, tokenId, supplyKey and userAccountId are required' });
      return;
    }
    if (!BACKEND_ACCOUNT_ID || !BACKEND_PRIVATE_KEY) {
      res.status(500).json({ success: false, error: 'Backend operator credentials not configured' });
      return;
    }
    try { PrivateKey.fromString(supplyKey); } catch {
      res.status(400).json({ success: false, error: 'Invalid supply key format' });
      return;
    }

    const prepDir = path.join(preparedDir(), preparedBatchId);
    const prep = await fs.readJSON(path.join(prepDir, 'prepared.json')).catch(() => null);
    if (!prep) {
      res.status(400).json({ success: false, error: 'Unknown or expired preparedBatchId — re-upload the ZIP' });
      return;
    }

    const jobId = newBatchJobId();
    const job: BatchJob = {
      jobId,
      status: 'running',
      phase: 'inscribing',
      updatable: !!updatable,
      tokenId,
      userAccountId,
      dir: batchJobDir(jobId),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      items: prep.items.map((p: any): BatchItem => ({
        serial: p.serial, image: p.image, metadata: p.metadata,
        mime: '', sha256: '', chunksTotal: 0, name: `#${p.serial}`, record: {},
        status: 'pending',
      })),
    };

    // Move the prepared folder to the job's own dir
    await fs.move(prepDir, job.dir, { overwrite: true });
    await saveBatchJob(job);

    res.json({ success: true, jobId, status: 'running', message: 'Poll /api/inscribe-batch/status/' + jobId });

    runBatchJob(jobId, supplyKey).catch((err) => {
      console.error(`[Batch ${jobId}] unhandled:`, err);
      loadBatchJob(jobId).then(async (j) => {
        if (j && j.status === 'running') {
          j.status = 'failed';
          j.error = err.message || String(err);
          await saveBatchJob(j);
        }
      }).catch(() => {});
      activeWorkers.delete(jobId);
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to start batch inscription' });
  }
}

/** POST /api/inscribe-batch/resume/:jobId — restart a job whose worker is gone (disconnect/restart/crash). */
export async function resumeBatchInscribe(req: Request, res: Response): Promise<void> {
  try {
    const job = await loadBatchJob(req.params.jobId);
    if (!job) { res.status(404).json({ success: false, error: 'Job not found' }); return; }
    const retryable = job.items.some(i => i.status === 'failed' || i.status === 'inscribed' || i.status === 'minting' || i.status === 'pending' || i.status === 'inscribing');
    if (!retryable) { res.status(409).json({ success: false, error: 'Every item is minted — nothing to resume.', job: publicJob(job, false) }); return; }
    if (activeWorkers.has(job.jobId)) { res.json({ success: true, jobId: job.jobId, status: 'running', message: 'Job is already running.' }); return; }

    const supplyKey = req.body?.supplyKey;
    if (!supplyKey) { res.status(400).json({ success: false, error: 'supplyKey is required to resume' }); return; }
    try { PrivateKey.fromString(supplyKey); } catch {
      res.status(400).json({ success: false, error: 'Invalid supply key format' });
      return;
    }

    await reconcileMintingItems(job);
    // Failed items stay retryable: their records keep partial inscription progress
    for (const it of job.items) if (it.status === 'failed') { it.status = 'pending'; it.error = undefined; }
    job.status = 'running';
    if (job.items.every(i => i.status === 'minted')) {
      job.status = 'completed';
      job.phase = 'done';
    }
    await saveBatchJob(job);
    res.json({ success: true, jobId: job.jobId, status: job.status, message: 'Job resumed.' });

    runBatchJob(job.jobId, supplyKey).catch((err) => {
      console.error(`[Batch ${job.jobId}] unhandled after resume:`, err);
      activeWorkers.delete(job.jobId);
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to resume' });
  }
}

// ─── STATUS ─────────────────────────────────────────────────────────────────

function publicJob(job: BatchJob, interrupted: boolean) {
  return {
    jobId: job.jobId,
    status: interrupted ? 'interrupted' : job.status,
    phase: job.phase,
    updatable: job.updatable,
    tokenId: job.tokenId,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    counts: {
      total: job.items.length,
      pending: job.items.filter(i => i.status === 'pending' || i.status === 'inscribing').length,
      inscribed: job.items.filter(i => i.status === 'inscribed').length,
      minting: job.items.filter(i => i.status === 'minting').length,
      minted: job.items.filter(i => i.status === 'minted').length,
      failed: job.items.filter(i => i.status === 'failed').length,
    },
    items: job.items.map(i => ({
      serial: i.serial, name: i.name, status: i.status,
      chunksTotal: i.chunksTotal, pointer: i.pointer,
      mediaTopic: i.mediaTopic, metaTopic: i.metaTopic, registryTopic: i.registryTopic,
      mintedSerial: i.mintedSerial, error: i.error,
    })),
    error: job.error,
    resumeAvailable: interrupted,
  };
}

/** GET /api/inscribe-batch/status/:jobId */
export async function batchInscribeStatus(req: Request, res: Response): Promise<void> {
  const job = await loadBatchJob(req.params.jobId);
  if (!job) { res.status(404).json({ success: false, error: 'Job not found' }); return; }
  const interrupted = job.status === 'running' && !activeWorkers.has(job.jobId);
  res.json({ success: true, job: publicJob(job, interrupted) });
}

// ─── MIRROR RECONCILIATION (crash mid-mint) ────────────────────────────────

/** Adopt serials for items stuck in 'minting' by matching their unique pointer on-chain. */
async function reconcileMintingItems(job: BatchJob): Promise<void> {
  const minting = job.items.filter(i => i.status === 'minting' && i.pointer);
  if (!minting.length) return;
  try {
    const res = await fetch(`${MIRROR}/api/v1/tokens/${job.tokenId}/nfts?limit=100&order=desc`);
    const nfts: any[] = ((await res.json()) as any).nfts || [];
    for (const item of minting) {
      const found = nfts.find(n => {
        const meta = String(n.metadata || '');
        return meta === item.pointer || Buffer.from(meta, 'base64').toString() === item.pointer;
      });
      if (found) {
        item.status = 'minted';
        item.mintedSerial = Number(found.serial_number);
      } else {
        item.status = 'inscribed'; // never landed — safe to re-mint
      }
    }
    await saveBatchJob(job);
  } catch (err) {
    console.warn(`[Batch ${job.jobId}] mint reconciliation failed:`, err);
  }
}

// ─── WORKER ─────────────────────────────────────────────────────────────────

async function runBatchJob(jobId: string, supplyKey: string): Promise<void> {
  if (activeWorkers.has(jobId)) return;
  activeWorkers.add(jobId);
  const job = (await loadBatchJob(jobId))!;
  const client = Client.forMainnet();
  let operatorKey: PrivateKey;
  try { operatorKey = PrivateKey.fromStringECDSA(BACKEND_PRIVATE_KEY!); }
  catch { operatorKey = PrivateKey.fromString(BACKEND_PRIVATE_KEY!); }
  client.setOperator(BACKEND_ACCOUNT_ID!, operatorKey);
  const ctx = makeInscribeContext(client, operatorKey);

  const persist = async () => { await saveBatchJob(job); };

  try {
    // ── Phase 1: inscribe every pending item, a few at a time ───────────────
    const pending = job.items.filter(i => i.status === 'pending' || i.status === 'inscribing');
    let cursor = 0;
    await Promise.all(Array.from({ length: INSCRIBE_CONCURRENCY }, async () => {
      while (cursor < pending.length) {
        const item = pending[cursor++];
        try {
          await inscribeItem(ctx, job, item, persist);
        } catch (err: any) {
          item.status = 'failed';
          item.error = err.message || String(err);
          console.error(`[Batch ${jobId}] item ${item.serial} failed:`, item.error);
          await persist();
        }
      }
    }));
    await persist();

    // ── Phase 2: mint all inscribed items in batches of MINT_BATCH ──────────
    await reconcileMintingItems(job);
    let toMint = job.items.filter(i => i.status === 'inscribed' && i.pointer);
    while (toMint.length > 0) {
      const batch = toMint.slice(0, MINT_BATCH);
      batch.forEach(i => { i.status = 'minting'; });
      await persist();
      try {
        const mintTx = new TokenMintTransaction()
          .setTokenId(job.tokenId)
          .setMetadata(batch.map(i => Buffer.from(i.pointer!)))
          .setMaxTransactionFee(new Hbar(10));
        const frozen = await mintTx.freezeWith(client);
        const signed = await frozen.sign(PrivateKey.fromString(supplyKey));
        const receipt = await (await signed.execute(client)).getReceipt(client);
        const serials = (receipt.serials || []).map((s: any) =>
          typeof s === 'object' && s.low !== undefined ? s.low : Number(s));
        batch.forEach((item, idx) => {
          item.status = 'minted';
          item.mintedSerial = serials[idx] ?? item.serial;
        });
        console.log(`[Batch ${jobId}] minted ${batch.length} (serials ${serials.join(', ')})`);
      } catch (err: any) {
        const msg = err.message || String(err);
        console.error(`[Batch ${jobId}] mint batch failed:`, msg);
        batch.forEach(i => { i.status = 'inscribed'; i.error = `Mint failed: ${msg} — press Resume to retry`; });
      }
      await persist();
      toMint = job.items.filter(i => i.status === 'inscribed' && i.pointer);
    }

    const failed = job.items.filter(i => i.status === 'failed').length;
    job.phase = 'done';
    job.status = failed === job.items.length ? 'failed' : 'completed';
    if (failed > 0) job.error = `${failed} of ${job.items.length} item(s) failed — open the job and press Resume to retry them.`;
    await persist();

    // Free the disk; the state file (with pointers + serials) stays for the status endpoint
    await fs.remove(path.join(job.dir, 'images')).catch(() => {});
    await fs.remove(path.join(job.dir, 'metadata')).catch(() => {});
  } catch (err: any) {
    console.error(`[Batch ${jobId}] job-level failure:`, err);
    job.status = 'failed';
    job.error = err.message || String(err);
    await persist();
  } finally {
    activeWorkers.delete(jobId);
    client.close();
  }
}

/** Inscribe one item: media topic → metadata topic (rewritten image pointer) → optional registry. */
async function inscribeItem(ctx: any, job: BatchJob, item: BatchItem, persist: () => Promise<void>): Promise<void> {
  item.status = 'inscribing';

  // Media
  const imageBytes = new Uint8Array(await fs.readFile(path.join(job.dir, 'images', item.image)));
  const mime = sniffMime(imageBytes) || 'image/png';
  const sha256 = item.sha256 || (item.sha256 = await sha256hex(imageBytes));
  const comp = await compressZstd(imageBytes);
  const mediaChunks = chunkify('data:' + mime + ';base64,' + bytesToB64(comp));
  item.chunksTotal = mediaChunks.length;
  item.mime = mime;
  await persist();

  const media = await inscribe(ctx, mediaChunks, sha256, {
    record: item.record, topicKey: 'media', doneKey: 'mediaDone', persist,
  });
  item.mediaTopic = media.topicId;
  await persist();

  // Metadata: art-gen JSON is the source of truth; only the media pointer is rewritten
  const srcMeta: any = await fs.readJSON(path.join(job.dir, 'metadata', item.metadata));
  const imageUri = `hcs://1/${media.topicId}`;
  const meta = {
    ...srcMeta,
    image: imageUri,
    type: mime,
    files: [{ uri: imageUri, type: mime, is_default_file: true }],
    properties: {
      ...(srcMeta.properties || {}),
      standard: job.updatable ? 'HCS-6' : 'HCS-5',
      inscribed_with: 'BuiltBySlime Creator Kit — Inscribe Collection (Hashinal)',
    },
  };
  const metaBytes = new TextEncoder().encode(JSON.stringify(meta));
  const metaSha = await sha256hex(metaBytes);
  const metaComp = await compressZstd(metaBytes);
  const metaChunks = chunkify('data:application/json;base64,' + bytesToB64(metaComp));
  const metaResult = await inscribe(ctx, metaChunks, metaSha, {
    record: item.record, topicKey: 'meta', doneKey: 'metaDone', persist,
  });
  item.metaTopic = metaResult.topicId;
  await persist();

  // Optional HCS-6 registry so the NFT is updatable
  let pointer = `hcs://1/${metaResult.topicId}`;
  if (job.updatable) {
    if (!item.record.registry) {
      item.record.registry = await createRegistry(ctx);
      await persist();
    }
    item.registryTopic = item.record.registry;
    if (!item.record.registered) {
      await registerEntry(ctx, item.registryTopic, metaResult.topicId, 'v1');
      item.record.registered = true;
      await persist();
    }
    pointer = `hcs://6/${item.registryTopic}`;
  }

  item.pointer = pointer;
  item.status = 'inscribed';
  await persist();
}

// Prepared-folder TTL (mirrors the single tool's PREPARED_TTL pattern)
setInterval(() => {
  const dir = preparedDir();
  fs.readdir(dir).then(entries => {
    for (const e of entries) {
      const stat = fs.stat(path.join(dir, e)).catch(() => null);
      stat.then(s => {
        if (s && Date.now() - s.mtimeMs > PREPARED_TTL) fs.remove(path.join(dir, e)).catch(() => {});
      });
    }
  }).catch(() => {});
}, 10 * 60 * 1000).unref();
