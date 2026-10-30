// @ts-nocheck — vendored inscription core (HCS-1/HCS-6), source: SLIME new-tools shared/core
// HCS-1: writing a file to its own Hedera topic in chunks, and reading it back to prove it landed intact.
//
// The format: the file is zstd-compressed, turned into a data URI ("data:<mime>;base64,…"), and cut into messages
// {"o": <chunk number>, "c": "<part of the data URI>"} of at most 1024 bytes each. The topic's memo is
// "<sha-256 of the original file>:zstd:base64", and it has a submit key but no admin key, so once written it cannot be
// changed by anyone.
//
// Every function that sends a transaction takes a `ctx` (context) object describing how to sign and where to read:
//
//   ctx.sdk          the Hedera JS SDK: window.HederaSDK in the page, or `import * as sdk from '@hiero-ledger/sdk'` on a server
//   ctx.submit(tx)   signs and sends a transaction; resolves to its receipt (needs .topicId for a topic creation)
//   ctx.submitKey()  the public key allowed to write to the new topic (the signer's)
//   ctx.mirror()     the mirror node base address, e.g. 'https://testnet.mirrornode.hedera.com'
//   ctx.decompress(bytes)  zstd-decompress (only needed to verify)
//   ctx.get(url)     optional: GET JSON from the mirror node (defaults to mirrorJson: paced, retried)
//   ctx.paused()     optional: return true to stop between transactions (the run then throws a PauseSignal)
//   ctx.concurrency  optional: how many messages are in flight at once (8)
//   ctx.onMessage(msg)  optional: called after each message lands (e.g. to add up the bytes, which Hedera charges by)
import { sha256hex, bytesToB64, b64ToBytes, b64ToStr, sleep } from './bytes.js';
import { mirrorJson } from './mirror.js';

/** The largest HCS message, in bytes. */
export const MAX_MSG = 1024;
/** How many chunk messages are sent at once unless ctx.concurrency says otherwise. */
export const CONCURRENCY = 8;

/** Thrown to stop a run between transactions when a pause was asked for; callers treat it as "paused", not as a failure (it has .paused = true). */
export class PauseSignal extends Error {
  declare paused: boolean;
  constructor() { super('paused'); this.paused = true; }
}

/** Throw a PauseSignal if ctx.paused() says so; called before each paid step so a run stops between transactions. */
export function stopIfPaused(ctx) {
  if (ctx && ctx.paused && ctx.paused()) throw new PauseSignal();
}

/** Cut a string into HCS-1 messages: JSON strings {"o":index,"c":part}, each at most MAX_MSG bytes. Returns the array in order. */
export function chunkify(str) {
  const out = [];
  let i = 0, o = 0;
  while (i < str.length) {
    let size = Math.min(str.length - i, MAX_MSG - 40);
    for (; size > 0; size -= 8) {
      const json = JSON.stringify({ o, c: str.slice(i, i + size) });
      if (new TextEncoder().encode(json).length <= MAX_MSG) { out.push(json); i += size; o++; break; }
    }
    if (size <= 0) throw new Error('chunking failed');
  }
  return out;
}

/**
 * Get a file ready to inscribe: its SHA-256 (for the topic memo), and the chunk messages of its compressed data URI.
 * compress(bytes) must zstd-compress (the page uses level 19). Returns {sha256, chunks, compressedLen}.
 */
export async function encodeFile(bytes, mime, compress) {
  const sha256 = await sha256hex(bytes);
  const comp = compress(bytes);
  const chunks = chunkify(`data:${mime};base64,` + bytesToB64(comp));
  return { sha256, chunks, compressedLen: comp.length };
}

/** The memo of a file's HCS-1 topic. */
export const topicMemo = (sha256) => `${sha256}:zstd:base64`;

/**
 * Would sending the same transaction again help? Yes after no answer at all (a timeout, a dropped connection) or a node
 * that was busy; no after a refusal that would only repeat: Hedera refused it at consensus (it was charged, and would be
 * again), at precheck for a reason a retry does not change (a bad signature, too little HBAR), or a signing service said
 * no (an HTTP 4xx answer, e.httpStatus). The words matched are the Hedera library's own ("failed precheck with status X",
 * "contained error status X").
 */
export function worthRetrying(e) {
  if (e && e.httpStatus >= 400 && e.httpStatus < 500) return false;
  const m = String((e && e.message) || e);
  if (/contained error status \w+/.test(m)) return false;
  const p = m.match(/failed precheck with status (\w+)/);
  if (p) return /^(BUSY|PLATFORM_TRANSACTION_NOT_CREATED|PLATFORM_NOT_ACTIVE|TRANSACTION_EXPIRED|INVALID_TRANSACTION_START|UNKNOWN)$/.test(p[1]);
  return true;
}

/** How long a message transaction stays valid, in seconds: Hedera takes it only within this time of its valid start. */
export const MESSAGE_VALID_SECONDS = 120;
/** The last moment (ms, in Hedera's time) Hedera could take transaction tx: its valid start plus its valid duration. Its valid start comes from the device's
 *  clock, but Hedera holds the transaction to it in its own time, so this holds whatever the device's clock says. Now plus the duration when tx has no id yet */
function validEnd(tx) {
  let start = NaN; try { start = tx.transactionId.validStart.toDate().getTime(); } catch {}
  return (Number.isFinite(start) ? start : Date.now()) + 1000 * MESSAGE_VALID_SECONDS;
}
/**
 * Send one message to a topic, retrying with growing waits (6 tries by default) while a retry can help; throws after the last failure. Returns the last moment
 * (ms, Hedera's time) Hedera could have taken any try of it (see inscribe: nothing is taken to be missing before the mirror node is past that).
 */
export async function submitMessage(ctx, topicId, msg, tries = 6) {
  const S = ctx.sdk;
  const id = typeof topicId === 'string' ? S.TopicId.fromString(topicId) : topicId;
  let last, until = 0;
  for (let a = 0; a < tries; a++) {
    const tx = new S.TopicMessageSubmitTransaction().setTopicId(id).setMessage(msg).setMaxTransactionFee(new S.Hbar(1)).setTransactionValidDuration(MESSAGE_VALID_SECONDS);
    try {
      await ctx.submit(tx);
      if (ctx.onMessage) ctx.onMessage(msg);
      return Math.max(until, validEnd(tx));
    } catch (e) {
      last = e; until = Math.max(until, validEnd(tx));
      // the library tried another node after one that accepted it went quiet: the message is most likely on the topic (inscribe() reads the topic back and
      // sends again any chunk that is not)
      if (/failed precheck with status DUPLICATE_TRANSACTION/.test(String(e && e.message))) { if (ctx.onMessage) ctx.onMessage(msg); return until; }
      if (!worthRetrying(e)) break;
      await sleep(300 * Math.pow(2, a));
    }
  }
  throw Object.assign(new Error('A chunk failed to submit' + (worthRetrying(last) ? ' after several tries' : '') + ': ' + (last && last.message)), { until });
}

/**
 * Write one file to its own HCS-1 topic and prove it landed. Resumable: progress is kept on `record`.
 *
 *   record[topicKey]            the topic id, once created (if already set, no new topic is created)
 *   record[doneKey]             chunk numbers already sent (only the others are sent)
 *   record[topicKey+'Verified'] true once read back and checked
 *   record[topicKey+'Missing']  chunk numbers counted as sent that were not on the topic when it was read back (the next run reads it again first)
 *   record[topicKey+'SentAt']   the last moment Hedera could take a chunk sent so far (ms, its own time: valid start plus valid duration): nothing is taken
 *                               to be missing until the mirror node is past it
 *
 * Creates the topic if needed (memo "<sha>:zstd:base64", submit key ctx.submitKey(), no admin key), sends the chunks not
 * yet sent, ctx.concurrency at a time, waits for the mirror node to show them all, then verifies the file. Calls
 * persist() after each change worth keeping and onProgress(done, total, message) as it goes. Returns {topicId}; throws
 * on failure or a PauseSignal on pause. Pressing it again with the same record carries on where it stopped.
 */
export async function inscribe(ctx, chunks, sha256, { record = {}, topicKey = 'topic', doneKey = 'done', persist = async () => {}, onProgress = () => {} }: any = {}) {
  const S = ctx.sdk, rec = record, tKey = topicKey, dKey = doneKey;
  rec[dKey] = rec[dKey] || [];
  if (!rec[tKey]) {
    stopIfPaused(ctx);
    onProgress(0, chunks.length, 'Creating topic…');
    const tx = new S.TopicCreateTransaction().setTopicMemo(topicMemo(sha256)).setSubmitKey(ctx.submitKey()).setMaxTransactionFee(new S.Hbar(5));
    const rcpt = await ctx.submit(tx);
    rec[tKey] = rcpt.topicId.toString(); await persist();
  }
  const topicId = S.TopicId.fromString(rec[tKey]);
  // chunks found missing on the topic last time (see below): read the topic again, and send only those still not there, once the mirror node is past the last
  // moment Hedera could have taken them (a mirror node that was only behind has them by now; otherwise they are left as they are until it has caught up).
  // A record that does not say when that is (from an earlier version, or carried without it) is given the latest it could be: now, plus a message's valid time
  const mKey = tKey + 'Missing', aKey = tKey + 'SentAt';
  if (!Number.isFinite(rec[aKey]) && (rec[dKey].length || rec[mKey])) { rec[aKey] = Date.now() + 1000 * MESSAGE_VALID_SECONDS; await persist(); }
  if (Array.isArray(rec[mKey]) && rec[mKey].length && await mirrorPast(ctx, rec[aKey])) {
    const have = await chunksOnTopic(ctx, rec[tKey]), gone = new Set(rec[mKey].filter((i) => !have.has(i)));
    rec[dKey] = rec[dKey].filter((i) => !gone.has(i)); delete rec[mKey]; await persist();
  }
  const doneSet = new Set(rec[dKey]);
  const pending = chunks.map((_, i) => i).filter((i) => !doneSet.has(i));
  let next = 0, landed = doneSet.size, err = null, until = 0;
  const worker = async () => {
    while (next < pending.length && !err) {
      if (ctx.paused && ctx.paused()) { err = new PauseSignal(); return; }
      const i = pending[next++];
      try { until = Math.max(until, await submitMessage(ctx, topicId, chunks[i])); } catch (e) { until = Math.max(until, e.until || 0); err = e; return; }
      rec[dKey].push(i); landed++;
      if (landed % 5 === 0 || landed === chunks.length) await persist();
      onProgress(landed, chunks.length, `Writing chunk ${landed} of ${chunks.length}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(ctx.concurrency || CONCURRENCY, pending.length || 1) }, worker));
  if (until) rec[aKey] = Math.max(Number.isFinite(rec[aKey]) ? rec[aKey] : 0, until);   // the last moment Hedera could take any chunk sent so far (its own time)
  await persist();
  if (err) throw err;
  if (!rec[tKey + 'Verified']) {
    // a chunk counted as sent that is not on the topic (its send was taken to have landed, and did not) would leave the topic short for good. Once the mirror
    // node is past the time the chunks were sent (so it would show every one that landed), it is noted (record[topicKey+'Missing']), and pressing again reads
    // the topic once more and sends it if it is still not there. A mirror node that is behind gets nothing noted: it is waited for
    const short = async (missing, why) => {
      if (!(await mirrorPast(ctx, rec[aKey]))) throw new Error(`${why} The mirror node is behind: wait a minute, then press Resume to check again. Nothing is sent again until it has caught up.`);
      rec[mKey] = missing; await persist();
      throw new Error(`${why} ${missing.length === 1 ? 'Chunk ' + missing[0] + ' is' : missing.length + ' chunks are'} not on the topic. Press Resume: the topic is read again, and only what is still missing is sent.`);
    };
    onProgress(chunks.length, chunks.length, 'Waiting for the mirror node…');
    try { await waitForMirror(ctx, rec[tKey], chunks.length); }
    catch (e) { const have = await chunksOnTopic(ctx, rec[tKey]); const missing = chunks.map((_, i) => i).filter((i) => !have.has(i)); if (missing.length) await short(missing, 'The mirror node does not show every chunk.'); throw e; }
    onProgress(chunks.length, chunks.length, 'Verifying…');
    const v = await verifyTopic(ctx, rec[tKey], chunks.length);
    if (!v.ok) { if (v.missing && v.missing.length) await short(v.missing, 'Verification found chunks missing.'); throw new Error('Verification failed: ' + v.reason); }
    rec[tKey + 'Verified'] = true; await persist();
  }
  onProgress(chunks.length, chunks.length, 'Verified ✓');
  return { topicId: rec[tKey] };
}

/**
 * How far the mirror node has caught up with Hedera: the consensus time (seconds) of the newest block it has, or, from a mirror node without the blocks list,
 * of the newest transaction it lists; null when it cannot say.
 */
export async function mirrorTime(ctx) {
  const get = ctx.get || mirrorJson, base = ctx.mirror();
  try { const j = await get(`${base}/api/v1/blocks?limit=1&order=desc`); const b = (j.blocks || [])[0], t = b && b.timestamp && (b.timestamp.to || b.timestamp.from); if (t) return parseFloat(t); } catch {}
  try { const j = await get(`${base}/api/v1/transactions?limit=1&order=desc`); const t = ((j.transactions || [])[0] || {}).consensus_timestamp; if (t) return parseFloat(t); } catch {}
  return null;
}
/**
 * Is the mirror node past `until` (ms, Hedera's time: the last moment Hedera could take a chunk sent) with room to spare: 30 seconds past it by its own time,
 * or, when it cannot say how far it has got, 90 seconds by this device's clock? Then it shows every chunk that landed.
 */
async function mirrorPast(ctx, until) {
  if (!Number.isFinite(until)) return false;
  const t = await mirrorTime(ctx);
  return t != null ? t * 1000 > until + 30e3 : Date.now() > until + 90e3;
}

/** Wait (2 minutes by default) until the mirror node shows at least `expected` messages on the topic; throws if it does not in time. */
export async function waitForMirror(ctx, topicId, expected, timeoutMs = 120000) {
  const get = ctx.get || mirrorJson;
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const j = await get(`${ctx.mirror()}/api/v1/topics/${topicId}/messages?limit=1&order=desc`);
      const seq = j.messages && j.messages[0] ? Number(j.messages[0].sequence_number) : 0;
      if (seq >= expected) return;
    } catch {}
    await sleep(2500);
  }
  throw new Error('The mirror node did not show every message in time. They may still be landing — wait a moment and press Resume to re-verify.');
}

/** The chunk messages on a topic, as the mirror node has them now: [{o, c}] in the order they landed. */
async function readChunks(ctx, topicId) {
  const get = ctx.get || mirrorJson, base = ctx.mirror();
  let url = `${base}/api/v1/topics/${topicId}/messages?limit=100&order=asc`, msgs = [];
  while (url) { const j = await get(url); msgs.push(...(j.messages || [])); url = j.links && j.links.next ? base + j.links.next : null; }
  const chunks = [];
  for (const m of msgs) { try { const o = JSON.parse(b64ToStr(m.message)); if (o && Number.isInteger(o.o) && typeof o.c === 'string') chunks.push(o); } catch {} }
  return chunks;
}
/** The chunk numbers on a topic, as the mirror node has them now (a Set). */
export async function chunksOnTopic(ctx, topicId) { return new Set((await readChunks(ctx, topicId)).map((c) => c.o)); }

/**
 * Read an HCS-1 topic back from the mirror node, check no chunk number is missing, rebuild and decompress the file, and
 * compare its SHA-256 with the hash in the topic memo. A chunk that landed twice with identical content is kept once (as
 * readers do); two different contents for one chunk number fail. `expected`, when given, is how many chunks the file has:
 * any of 0..expected-1 not there is missing too. Returns {ok:true, bytes, mime, hash, chunks} or {ok:false, reason, missing?}
 * (missing: the chunk numbers not on the topic). Needs ctx.mirror() and ctx.decompress (and ctx.get, optionally); sends nothing.
 */
export async function verifyTopic(ctx, topicId, expected?) {
  const get = ctx.get || mirrorJson, base = ctx.mirror();
  const info = await get(`${base}/api/v1/topics/${topicId}`);
  const memoHash = (info.memo || '').split(':')[0];
  const chunks = await readChunks(ctx, topicId);
  if (!chunks.length) return { ok: false, reason: 'no chunks found on the topic', missing: expected ? Array.from({ length: expected }, (_, i) => i) : undefined };
  // a chunk can land twice when a transaction went through but its answer was lost and the tool sent it again;
  // an identical repeat is harmless (readers keep the first), a differing one means the topic is not this file
  {
    const seen = new Map(), once = [];
    for (const c of chunks) {
      if (!seen.has(c.o)) { seen.set(c.o, c.c); once.push(c); }
      else if (seen.get(c.o) !== c.c) return { ok: false, reason: 'chunk ' + c.o + ' was written twice with different content' };
    }
    chunks.length = 0; chunks.push(...once);
  }
  chunks.sort((a, b) => a.o - b.o);
  const have = new Set(chunks.map((c) => c.o)), top = Math.max(chunks[chunks.length - 1].o, (expected || 0) - 1);
  const missing = []; for (let i = 0; i <= top; i++) if (!have.has(i)) missing.push(i);
  if (missing.length) return { ok: false, reason: (missing.length === 1 ? 'chunk ' + missing[0] + ' is' : missing.length + ' chunks are') + ' missing', missing };
  let combined = chunks.map((c) => c.c).join(''); let mime = 'application/octet-stream';
  const p = combined.match(/^data:([^;]+);base64,/); if (p) { mime = p[1]; combined = combined.slice(p[0].length); }
  let bytes;
  try { bytes = ctx.decompress(b64ToBytes(combined.replace(/\s+/g, ''))); } catch (e) { return { ok: false, reason: 'decompress failed: ' + (e.message || e) }; }
  const hash = await sha256hex(bytes);
  if (memoHash && /^[0-9a-f]{64}$/i.test(memoHash) && memoHash.toLowerCase() !== hash) return { ok: false, reason: 'hash in the topic memo does not match the reassembled file' };
  return { ok: true, bytes, mime, hash, chunks: chunks.length };
}
