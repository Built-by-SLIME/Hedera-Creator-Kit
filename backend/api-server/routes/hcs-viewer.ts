import { Request, Response } from 'express';
import { verifyTopic, memoAlgo, decompress, makeInscribeContext } from '../inscription';

/**
 * Read-only HCS endpoints for the Topic Viewer (Tool #16).
 * Talks to the public mirror node server-side so the vendored HCS-1 decode
 * core stays single-sourced in the backend. Nothing here sends a transaction.
 */

const MAINNET_MIRROR = 'https://mainnet-public.mirrornode.hedera.com';
const TESTNET_MIRROR = 'https://testnet.mirrornode.hedera.com';

function mirrorFor(network?: string): string {
  return network === 'testnet' ? TESTNET_MIRROR : MAINNET_MIRROR;
}

function readCtx(network?: string) {
  // makeInscribeContext with no client/operatorKey is read-only safe:
  // only mirror(), get (mirrorJson) and decompress (vendored fzstd) are used.
  return makeInscribeContext(null as any, null as any, mirrorFor(network));
}

async function mirrorGet(base: string, path: string): Promise<any> {
  // Mirror pagination links come back as full paths that already include /api/v1.
  const url = path.startsWith('http') ? path
    : path.startsWith('/api/v1') ? base + path
    : `${base}/api/v1${path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Mirror node returned ${res.status} for ${path}`);
  return res.json();
}

/** GET /api/hcs/topic/:topicId/info?network=mainnet */
export async function topicInfo(req: Request, res: Response): Promise<void> {
  try {
    const { topicId } = req.params;
    const network = req.query.network as string | undefined;
    const base = mirrorFor(network);
    const [info, msgs] = await Promise.all([
      mirrorGet(base, `/topics/${topicId}`),
      mirrorGet(base, `/topics/${topicId}/messages?limit=1&order=desc`),
    ]);
    const memo: string = info.memo || '';
    const lastSeq = msgs.messages?.[0]?.sequence_number ?? 0;
    res.json({
      success: true,
      topicId,
      memo,
      running: info.running !== false,
      sequenceEnd: lastSeq,
      // what kind of topic is this?
      kind: /^hcs-6:1:/.test(memo) ? 'hcs6-registry'
        : /^[0-9a-f]{64}:[a-z0-9-]+:base64$/i.test(memo) ? 'hcs1-file'
        : 'raw',
      compression: memoAlgo(memo) || undefined,
      sha256: /^[0-9a-f]{64}$/i.test(memo.split(':')[0] || '') ? memo.split(':')[0] : undefined,
    });
  } catch (err: any) {
    res.status(404).json({ success: false, error: err.message || 'Topic not found' });
  }
}

/** GET /api/hcs/topic/:topicId/messages?network=mainnet — paged, capped at 500 */
export async function topicMessages(req: Request, res: Response): Promise<void> {
  try {
    const { topicId } = req.params;
    const network = req.query.network as string | undefined;
    const base = mirrorFor(network);
    const raw: any[] = [];
    let path: string | null = `/topics/${topicId}/messages?limit=100&order=asc`;
    while (path && raw.length < 500) {
      const j = await mirrorGet(base, path);
      raw.push(...(j.messages || []));
      path = j.links?.next ? j.links.next : null;
    }
    const messages = raw.map((m) => {
      let text = '';
      try { text = Buffer.from(m.message, 'base64').toString('utf8'); } catch { /* binary */ }
      let kind = 'text';
      let parsed: any;
      try {
        parsed = JSON.parse(text);
        kind = parsed && Number.isInteger(parsed.o) && typeof parsed.c === 'string' ? 'hcs1-chunk'
          : parsed && parsed.p === 'hcs-6' && parsed.op === 'register' ? 'hcs6-register'
          : 'json';
      } catch { /* plain text */ }
      return {
        sequence: m.sequence_number,
        consensusTimestamp: m.consensus_timestamp,
        size: (m.message || '').length,
        kind,
        // chunk payloads are huge and meaningless on their own — truncate them
        preview: kind === 'hcs1-chunk' ? text.slice(0, 60) + '…' : text.slice(0, 2000),
        parsed: kind === 'hcs6-register' ? parsed : undefined,
      };
    });
    res.json({ success: true, topicId, truncated: raw.length >= 500, count: messages.length, messages });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to read topic' });
  }
}

/**
 * GET /api/hcs/topic/:topicId/file?network=mainnet
 * Reassembles an HCS-1 topic, decompresses and hash-verifies against the memo.
 * Returns base64 (not raw bytes) with the sniffed MIME so the FRONTEND controls
 * rendering: SVG is <img>-only, HTML is plain text, nothing is ever executed.
 */
export async function topicFile(req: Request, res: Response): Promise<void> {
  try {
    const { topicId } = req.params;
    const network = req.query.network as string | undefined;
    const v = await verifyTopic(readCtx(network), topicId as any);
    if (!v.ok) {
      res.status(422).json({ success: false, error: `File could not be verified: ${v.reason}`, missing: v.missing });
      return;
    }
    res.json({
      success: true,
      topicId,
      mime: v.mime,
      sha256: v.hash,
      size: v.bytes.length,
      chunks: v.chunks,
      base64: Buffer.from(v.bytes).toString('base64'),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to reassemble file' });
  }
}

/** GET /api/hcs/resolve/:pointer?network=mainnet — resolve hcs://1/x or hcs://6/x */
export async function resolvePointer(req: Request, res: Response): Promise<void> {
  try {
    const pointer = decodeURIComponent(req.params.pointer);
    const network = req.query.network as string | undefined;
    const m = pointer.match(/^hcs:\/\/([16])\/(0\.0\.\d+)$/);
    if (!m) {
      res.status(400).json({ success: false, error: 'Pointer must be hcs://1/<topic> or hcs://6/<registry>' });
      return;
    }
    const base = mirrorFor(network);
    if (m[1] === '1') {
      const info = await mirrorGet(base, `/topics/${m[2]}`);
      res.json({ success: true, kind: 'hcs1', metaTopic: m[2], memo: info.memo || '' });
      return;
    }
    // HCS-6: follow the registry to the latest registered metadata topic
    const msgs = await mirrorGet(base, `/topics/${m[2]}/messages?limit=100&order=desc`);
    const entry = (msgs.messages || []).map((x: any) => {
      try { return JSON.parse(Buffer.from(x.message, 'base64').toString('utf8')); } catch { return null; }
    }).find((x: any) => x && x.p === 'hcs-6' && x.op === 'register' && x.t_id);
    if (!entry) {
      res.status(404).json({ success: false, error: 'Registry has no register messages yet' });
      return;
    }
    res.json({ success: true, kind: 'hcs6', registryTopic: m[2], metaTopic: entry.t_id, note: entry.m || '' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to resolve pointer' });
  }
}
