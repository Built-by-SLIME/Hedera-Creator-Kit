import { Request, Response } from 'express';
import { Client, PrivateKey } from '@hashgraph/sdk';
import { v4 as uuidv4 } from 'uuid';
import {
  sha256hex,
  bytesToB64,
  chunkify,
  inscribe,
  registerEntry,
  buildMetadata,
  HEDERA_FEES_USD,
  messagesUsd,
  makeInscribeContext,
  compressZstd,
} from '../inscription';
import { createInscribeJob, updateInscribeJob } from '../inscribeJobStore';

/**
 * Metadata update for HCS-6 (updatable) inscriptions. The media topic is reused;
 * only a new metadata topic is inscribed and a new version is registered on the
 * existing registry. The NFT's on-chain pointer (hcs://6/<registry>) never changes.
 */

const MAINNET_MIRROR = 'https://mainnet-public.mirrornode.hedera.com';

const BACKEND_ACCOUNT_ID = process.env.BACKEND_ACCOUNT_ID || process.env.TREASURY_ID;
const BACKEND_PRIVATE_KEY = process.env.BACKEND_PRIVATE_KEY || process.env.TREASURY_PK;

async function mirrorGet(path: string): Promise<any> {
  const url = path.startsWith('http') ? path
    : path.startsWith('/api/v1') ? MAINNET_MIRROR + path
    : `${MAINNET_MIRROR}/api/v1${path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Mirror node returned ${res.status}`);
  return res.json();
}

async function hbarPerUsd(): Promise<number> {
  const res = await fetch(`${MAINNET_MIRROR}/api/v1/network/exchangerate`);
  const j: any = await res.json();
  const r = j.current_rate;
  return Number(r.hbar_equivalent) / (Number(r.cent_equivalent) / 100);
}

/** Register messages on a registry topic (paginated), for the next version number. */
async function registerMessages(registryTopic: string): Promise<any[]> {
  const out: any[] = [];
  let path: string | null = `/topics/${registryTopic}/messages?limit=100&order=asc`;
  while (path) {
    const j = await mirrorGet(path);
    for (const m of j.messages || []) {
      try {
        const parsed = JSON.parse(Buffer.from(m.message, 'base64').toString('utf8'));
        if (parsed && parsed.p === 'hcs-6' && parsed.op === 'register' && parsed.t_id) out.push(parsed);
      } catch { /* non-register message */ }
    }
    path = j.links?.next ? MAINNET_MIRROR + j.links.next : null;
  }
  return out;
}

async function assertRegistry(registryTopic: string): Promise<void> {
  if (!/^0\.0\.\d+$/.test(registryTopic || '')) throw new Error('Invalid registry topic ID');
  const info = await mirrorGet(`/topics/${registryTopic}`);
  if (!/^hcs-6:1:/.test(info.memo || '')) {
    throw new Error('That topic is not an HCS-6 registry (memo must start "hcs-6:1:")');
  }
}

/** POST /api/inscribe/update-quote { registryTopic } — cost + next version number */
export async function updateQuote(req: Request, res: Response): Promise<void> {
  try {
    const { registryTopic } = req.body || {};
    await assertRegistry(registryTopic);
    const registers = await registerMessages(registryTopic);
    // metadata JSON is small (a few KB compressed → a few 1 KB chunks)
    const dummy = chunkify('data:application/json;base64,' + 'QUJD'.repeat(700));
    const estUsd = HEDERA_FEES_USD.topic + messagesUsd(HEDERA_FEES_USD, dummy) + HEDERA_FEES_USD.msg + 0.01;
    const rate = await hbarPerUsd().catch(() => 14);
    res.json({
      success: true,
      nextVersion: registers.length + 1,
      estCostUsd: +estUsd.toFixed(4),
      estCostHbar: +(estUsd * rate * 1.25).toFixed(4),
    });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message || 'Failed to quote update' });
  }
}

/** POST /api/inscribe/update — inscribe new metadata topic + register the new version */
export async function startUpdate(req: Request, res: Response): Promise<void> {
  try {
    const { registryTopic, name, creator, description, image, attributes } = req.body || {};
    if (!registryTopic || !name || !creator || !image) {
      res.status(400).json({ success: false, error: 'registryTopic, name, creator and image are required' });
      return;
    }
    if (!BACKEND_ACCOUNT_ID || !BACKEND_PRIVATE_KEY) {
      res.status(500).json({ success: false, error: 'Backend operator credentials not configured' });
      return;
    }
    await assertRegistry(registryTopic);

    const metadata = buildMetadata({
      name,
      creator,
      description: description || '',
      image,
      attributes,
      standard: 'HCS-6',
    });
    const metaBytes = new TextEncoder().encode(JSON.stringify(metadata));
    const metaSha = await sha256hex(metaBytes);
    const metaComp = await compressZstd(metaBytes);
    const metaChunks = chunkify('data:application/json;base64,' + bytesToB64(metaComp));

    const jobId = uuidv4();
    createInscribeJob(jobId, metaChunks.length);
    res.json({ success: true, jobId, status: 'queued', message: 'Poll /api/inscribe/status/:jobId' });

    runUpdateJob(jobId, registryTopic, metaChunks, metaSha, metaBytes.length).catch((err) => {
      console.error(`[InscribeUpdate ${jobId}] unhandled:`, err);
      updateInscribeJob(jobId, { status: 'failed', error: err.message || String(err) });
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to start update' });
  }
}

async function runUpdateJob(
  jobId: string,
  registryTopic: string,
  metaChunks: string[],
  metaSha: string,
  metaSize: number,
): Promise<void> {
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
    updateInscribeJob(jobId, { step: 'inscribing metadata' });
    const metaResult = await inscribe(ctx, metaChunks, metaSha, {
      topicKey: 'meta',
      doneKey: 'metaDone',
      onProgress: (_d: number, _t: number, msg: string) => {
        const m = msg.match(/chunk (\d+) of (\d+)/);
        updateInscribeJob(jobId, m
          ? { chunksDone: Number(m[1]), chunksTotal: Number(m[2]), step: 'inscribing metadata' }
          : { step: `metadata: ${msg.toLowerCase()}` });
      },
    });
    updateInscribeJob(jobId, { metaTopic: metaResult.topicId, step: 'metadata verified' });

    updateInscribeJob(jobId, { step: 'registering new version' });
    const registers = await registerMessages(registryTopic);
    const note = `v${registers.length + 1}`;
    await registerEntry(ctx, registryTopic, metaResult.topicId, note);

    updateInscribeJob(jobId, {
      status: 'completed',
      step: 'done',
      registryTopic,
      pointer: `hcs://6/${registryTopic}`,
      metaTopic: metaResult.topicId,
    });
    console.log(`[InscribeUpdate ${jobId}] ✅ ${registryTopic} ${note} -> ${metaResult.topicId} (${metaSize} bytes)`);
  } catch (err: any) {
    console.error(`[InscribeUpdate ${jobId}] failed:`, err);
    updateInscribeJob(jobId, { status: 'failed', error: err.message || String(err) });
  } finally {
    client.close();
  }
}
