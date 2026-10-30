import { Request, Response } from 'express';
import { Client, PrivateKey } from '@hashgraph/sdk';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs-extra';
import path from 'path';
import {
  sha256hex,
  bytesToB64,
  chunkify,
  inscribe,
  createRegistry,
  registerEntry,
  buildMetadata,
  sniffMime,
  HEDERA_FEES_USD,
  messagesUsd,
  makeInscribeContext,
  compressZstd,
} from '../inscription';
import { createInscribeJob, updateInscribeJob, getInscribeJob } from '../inscribeJobStore';

// Same resolution as server.ts, without importing it (would be circular).
const BACKEND_ROOT = __dirname.includes('dist')
  ? path.join(__dirname, '../../..')   // dist/api-server/routes -> backend
  : path.join(__dirname, '../..');     // api-server/routes      -> backend

const BACKEND_ACCOUNT_ID = process.env.BACKEND_ACCOUNT_ID || process.env.TREASURY_ID;
const BACKEND_PRIVATE_KEY = process.env.BACKEND_PRIVATE_KEY || process.env.TREASURY_PK;

/** Formats the inscription tool accepts, keyed by sniffed MIME (magic bytes, not the client's claim). */
const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/svg+xml',
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/ogg',
]);

/** Prepared files waiting for the user's go-ahead, on disk so big videos don't sit in RAM. */
const preparedDir = () => path.join(BACKEND_ROOT, 'temp-inscribe');

interface Prepared {
  id: string;
  filePath: string;      // zstd-compressed bytes on disk
  sha256: string;        // of the ORIGINAL file (topic memo)
  mime: string;          // sniffed
  size: number;          // original bytes
  compressedSize: number;
  chunks: number;
  estCostUsd: number;
  createdAt: number;
}

const prepared = new Map<string, Prepared>();
const PREPARED_TTL = 30 * 60 * 1000; // 30 minutes to confirm

setInterval(() => {
  const now = Date.now();
  for (const [id, p] of prepared.entries()) {
    if (now - p.createdAt > PREPARED_TTL) {
      fs.remove(p.filePath).catch(() => {});
      prepared.delete(id);
    }
  }
}, 10 * 60 * 1000).unref();

async function hbarPerUsd(): Promise<number> {
  const res = await fetch('https://mainnet-public.mirrornode.hedera.com/api/v1/network/exchangerate');
  const j: any = await res.json();
  const r = j.current_rate;
  return Number(r.hbar_equivalent) / (Number(r.cent_equivalent) / 100);
}

/**
 * POST /api/inscribe/prepare  (multipart, field "file")
 * Sniffs + validates the file, compresses it, cuts it into HCS-1 chunks and
 * returns a cost quote. Nothing is sent to Hedera yet.
 */
export async function prepareInscribe(req: Request, res: Response): Promise<void> {
  const file = (req as any).file;
  if (!file) {
    res.status(400).json({ success: false, error: 'File is required (multipart field "file")' });
    return;
  }
  try {
    const bytes = new Uint8Array(await fs.readFile(file.path));
    await fs.remove(file.path).catch(() => {});

    const mime = sniffMime(bytes);
    if (!mime || !ALLOWED_MIME.has(mime)) {
      res.status(400).json({
        success: false,
        error: `Unsupported file type${mime ? ` (${mime})` : ''}. Allowed: PNG, JPEG, GIF, WebP, AVIF, BMP, SVG, MP4, MOV, WebM, OGG video.`,
      });
      return;
    }

    const sha256 = await sha256hex(bytes);
    const comp = await compressZstd(bytes);
    const dataUri = 'data:' + mime + ';base64,' + bytesToB64(comp);
    const chunkList = chunkify(dataUri);

    // Fee model from the vendored fee table: one topic create per inscribed file
    // (media + metadata, + registry if updatable) plus the message stream.
    const mediaMsgUsd = messagesUsd(HEDERA_FEES_USD, chunkList);
    const estUsd = 2 * HEDERA_FEES_USD.topic + mediaMsgUsd + HEDERA_FEES_USD.topic + HEDERA_FEES_USD.msg + 0.01;

    const id = uuidv4();
    await fs.ensureDir(preparedDir());
    const filePath = path.join(preparedDir(), id + '.zst');
    await fs.writeFile(filePath, Buffer.from(comp));

    prepared.set(id, {
      id, filePath, sha256, mime,
      size: bytes.length,
      compressedSize: comp.length,
      chunks: chunkList.length,
      estCostUsd: estUsd,
      createdAt: Date.now(),
    });

    const rate = await hbarPerUsd().catch(() => 14); // ~$0.07/HBAR fallback
    res.json({
      success: true,
      preparedId: id,
      sha256,
      mime,
      size: bytes.length,
      compressedSize: comp.length,
      chunks: chunkList.length,
      estCostUsd: estUsd,
      estCostHbar: +(estUsd * rate * 1.25).toFixed(4), // 25% buffer
    });
  } catch (err: any) {
    console.error('Prepare inscription failed:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to prepare file' });
  }
}

/**
 * POST /api/inscribe/start
 * Body: { preparedId, name, creator, description?, attributes?, updatable? }
 * Runs the inscription job in the background: media topic -> metadata topic
 * (HIP-412, image = hcs://1/<media>) -> optional HCS-6 registry. The NFT itself
 * is minted afterwards by the caller through /api/mint-nfts with the returned pointer.
 */
export async function startInscribe(req: Request, res: Response): Promise<void> {
  try {
    const { preparedId, name, creator, description, attributes, updatable } = req.body || {};
    const p = prepared.get(preparedId);
    if (!p) {
      res.status(400).json({ success: false, error: 'Unknown or expired preparedId — re-upload the file' });
      return;
    }
    if (!name || !creator) {
      res.status(400).json({ success: false, error: 'name and creator are required' });
      return;
    }
    if (!BACKEND_ACCOUNT_ID || !BACKEND_PRIVATE_KEY) {
      res.status(500).json({ success: false, error: 'Backend operator credentials not configured' });
      return;
    }

    prepared.delete(preparedId);
    const jobId = uuidv4();
    createInscribeJob(jobId, p.chunks);
    res.json({ success: true, jobId, status: 'queued', message: 'Poll /api/inscribe/status/:jobId' });

    runInscribeJob(jobId, p, { name, creator, description, attributes, updatable: !!updatable }).catch((err) => {
      console.error(`[Inscribe ${jobId}] unhandled:`, err);
      updateInscribeJob(jobId, { status: 'failed', error: err.message || String(err) });
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to start inscription' });
  }
}

async function runInscribeJob(
  jobId: string,
  p: Prepared,
  meta: { name: string; creator: string; description?: string; attributes?: any; updatable: boolean },
): Promise<void> {
  const step = (s: string) => updateInscribeJob(jobId, { step: s });
  const client = Client.forMainnet();
  let operatorKey: PrivateKey;
  try {
    operatorKey = PrivateKey.fromStringECDSA(BACKEND_PRIVATE_KEY!);
  } catch {
    operatorKey = PrivateKey.fromString(BACKEND_PRIVATE_KEY!);
  }
  client.setOperator(BACKEND_ACCOUNT_ID!, operatorKey);
  const ctx = makeInscribeContext(client, operatorKey);

  try {
    // ── 1. media file ────────────────────────────────────────────────────────
    step('creating media topic');
    const comp = new Uint8Array(await fs.readFile(p.filePath));
    await fs.remove(p.filePath).catch(() => {});
    const mediaChunks = chunkify('data:' + p.mime + ';base64,' + bytesToB64(comp));
    const media = await inscribe(ctx, mediaChunks, p.sha256, {
      topicKey: 'media',
      doneKey: 'mediaDone',
      onProgress: (_d: number, _t: number, msg: string) => {
        const m = msg.match(/chunk (\d+) of (\d+)/);
        if (m) updateInscribeJob(jobId, { chunksDone: Number(m[1]), chunksTotal: Number(m[2]), step: 'inscribing media' });
      },
    });
    updateInscribeJob(jobId, { mediaTopic: media.topicId, step: 'media verified' });

    // ── 2. HIP-412 metadata pointing at the media topic ─────────────────────
    step('inscribing metadata');
    const metadata = buildMetadata({
      name: meta.name,
      creator: meta.creator,
      description: meta.description || '',
      image: `hcs://1/${media.topicId}`,
      mime: p.mime,
      attributes: meta.attributes,
      standard: meta.updatable ? 'HCS-6' : 'HCS-5',
    });
    const metaBytes = new TextEncoder().encode(JSON.stringify(metadata));
    const metaSha = await sha256hex(metaBytes);
    const metaComp = await compressZstd(metaBytes);
    const metaChunks = chunkify('data:application/json;base64,' + bytesToB64(metaComp));
    const metaResult = await inscribe(ctx, metaChunks, metaSha, {
      topicKey: 'meta',
      doneKey: 'metaDone',
    });
    updateInscribeJob(jobId, { metaTopic: metaResult.topicId, step: 'metadata verified' });

    // ── 3. optional HCS-6 registry so the NFT is updatable ──────────────────
    let registryTopic: string | undefined;
    let pointer = `hcs://1/${metaResult.topicId}`;
    if (meta.updatable) {
      step('creating registry');
      registryTopic = await createRegistry(ctx);
      await registerEntry(ctx, registryTopic, metaResult.topicId, 'v1');
      pointer = `hcs://6/${registryTopic}`;
      updateInscribeJob(jobId, { registryTopic, step: 'registered' });
    }

    updateInscribeJob(jobId, { status: 'completed', step: 'done', pointer });
    console.log(`[Inscribe ${jobId}] ✅ pointer: ${pointer}`);
  } catch (err: any) {
    console.error(`[Inscribe ${jobId}] failed:`, err);
    updateInscribeJob(jobId, { status: 'failed', error: err.message || String(err) });
  } finally {
    client.close();
  }
}

/** GET /api/inscribe/status/:jobId */
export async function inscribeStatus(req: Request, res: Response): Promise<void> {
  const job = getInscribeJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ success: false, error: 'Job not found' });
    return;
  }
  res.json({ success: true, job });
}
