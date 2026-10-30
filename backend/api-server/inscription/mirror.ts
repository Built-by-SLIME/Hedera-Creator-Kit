// @ts-nocheck — vendored inscription core (HCS-1/HCS-6), source: SLIME new-tools shared/core
// Hedera mirror nodes: which hosts are asked, in what order, and how fast.
// One copy of this serves the whole tool, so every view shares the same pacing and the same idea of which host
// is resting after a rate limit.

import { config } from "./config.js";

// Public mirror nodes per network. Requests alternate between the hosts of a network.
// Both mainnet hostnames are run by Hedera and share a limiter, so alternating is a mild help, not a cure.
export const MIRROR_HOSTS = {
  mainnet: ["https://mainnet-public.mirrornode.hedera.com", "https://mainnet.mirrornode.hedera.com"],
  testnet: ["https://testnet.mirrornode.hedera.com"],
  previewnet: ["https://previewnet.mirrornode.hedera.com"],
};
// The public hosts for a network name; an unknown name gets the mainnet hosts.
const hostsFor = (net) => MIRROR_HOSTS[net] || MIRROR_HOSTS.mainnet;

// A promise that resolves after `ms` milliseconds.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* A mirror node of your own choosing (a keyed provider such as Hgraph, Arkhia or Validation Cloud), used for
   every network while it is set. Kept for the visit only: it may carry a key, so it is never stored. */
let CUSTOM = "";
/**
 * Set the mirror node of your own choosing, used for every network from the next request on. `url` is its
 * base address, with or without "/api/v1" on the end; "" (or nothing) goes back to the configured or
 * public nodes.
 */
export const setCustomMirror = (url) => {
  CUSTOM = String(url || "").trim().replace(/\/+$/, "");
};
// A base address with "/api/v1" added unless it already ends that way; "" stays "".
const withApi = (base) => (base ? base + (base.endsWith("/api/v1") ? "" : "/api/v1") : "");
/** The custom mirror node typed into the page, as a base URL ending in /api/v1, or "" when none is set. */
export const customMirror = () => withApi(CUSTOM);
/**
 * The mirror node of our own that a network's requests go to, ending in /api/v1, or "" for the public nodes:
 * the one typed into the page if there is one, else the host site's (config.mirror[net]).
 */
export const ownMirror = (net) =>
  customMirror() || withApi(String(config.mirror[net] || "").trim().replace(/\/+$/, ""));

// Hosts resting after a rate limit: host -> time it may be asked again.
let COOL = {};
let TURN = 0;
/**
 * Forget which public hosts are resting after a rate limit, so all of them are asked again straight away.
 * For a fresh start, such as a new search. The slowed-down request rate is not reset.
 */
export const clearMirrorCooldowns = () => {
  COOL = {};
};
// Next host in turn for a network, skipping any that are resting.
function pickHost(net) {
  const hosts = hostsFor(net);
  const now = Date.now();
  for (let i = 0; i < hosts.length; i++) {
    const h = hosts[TURN++ % hosts.length];
    if (!(COOL[h] > now)) return h;
  }
  return hosts[TURN++ % hosts.length];
}

/** Base URL for building a request by hand: "https://host/api/v1". mirrorFetch moves it to the host whose turn it is. */
export function mirrorBase(net) {
  return ownMirror(net) || hostsFor(net)[0] + "/api/v1";
}
// Rewrite a public mirror URL onto another public host of the same network.
function onHost(url, net, host) {
  for (const h of hostsFor(net)) if (url.startsWith(h)) return host + url.slice(h.length);
  return url;
}
// Turn "/api/v1/…" into a full URL on our own node or on the given host.
function fullUrl(path, host, net) {
  const c = ownMirror(net);
  if (!c) return host + path;
  return c + (path.startsWith("/api/v1") ? path.slice(7) : path);
}

// Token-bucket rate limiter shared by every mirror request. It slows down when a node pushes back and
// creeps back up while answers are coming through.
const limiter = { max: 30, perSec: 30, tokens: 30, last: Date.now(), pauseUntil: 0, hits: 0 };
// Wait for a turn to make one request. Resolves when the request may go; rejects with an AbortError as soon as
// the given AbortSignal (optional) is aborted.
async function rateLimit(signal) {
  for (;;) {
    if (signal && signal.aborted) throw new DOMException("Aborted", "AbortError");
    const now = Date.now();
    if (now < limiter.pauseUntil) await sleep(Math.min(500, limiter.pauseUntil - now));
    else {
      limiter.tokens = Math.min(limiter.perSec, limiter.tokens + ((now - limiter.last) / 1e3) * limiter.perSec);
      limiter.last = now;
      if (limiter.tokens >= 1) return void (limiter.tokens -= 1);
      await sleep(Math.ceil(((1 - limiter.tokens) / limiter.perSec) * 1e3));
    }
  }
}
// A host answered "slow down": rest that host for `wait` milliseconds, hold every request for as long, cut
// the request rate to 60% (never below 5 a second) and count the pushback.
const pushedBack = (host, wait) => {
  COOL[host] = Date.now() + wait;
  limiter.hits++;
  limiter.perSec = Math.max(5, 0.6 * limiter.perSec);
  limiter.pauseUntil = Math.max(limiter.pauseUntil, Date.now() + wait);
};
// A request was answered: raise the request rate a little, up to the limiter's maximum.
const wentThrough = () => {
  limiter.perSec = Math.min(limiter.max, limiter.perSec + 0.02);
};

/* ---- ids from the mirror node are checked before anything uses them ----
   The pages write entity ids (accounts, tokens, topics), serial numbers and timestamps from mirror node answers
   straight into their HTML, as the ids they are. A mirror node of a site's own, or a proxy in front of one, that
   was compromised could answer with markup in such a field. Every answer is walked once as it is read: a field
   that should hold an id but doesn't is replaced by INVALID_ID (and a serial or timestamp by null), so nothing
   from it reaches a page as markup. Text fields (names, memos, symbols) are left alone; the pages escape those. */
export const INVALID_ID = "(invalid id)";
const ENTITY = /^\d{1,10}\.\d{1,10}\.\d{1,20}(-[a-z]{5})?$/; // 0.0.1234, optionally with its checksum
const EVM = /^(0x)?[0-9a-fA-F]{40}$/;
const ID_KEYS = new Set([
  "account", "account_id", "token_id", "topic_id", "contract_id", "entity_id", "treasury_account_id",
  "payer_account_id", "sender_account_id", "receiver_account_id", "collector_account_id", "fee_collector_account_id",
  "auto_renew_account", "spender", "owner", "delegating_spender", "node_account_id", "file_id", "schedule_id",
  "creator_account_id", "payer", "sender", "receiver",
]);
const INT_KEYS = new Set(["serial_number", "sequence_number", "decimals_count"]);
const TIME_KEYS = new Set(["consensus_timestamp", "created_timestamp", "modified_timestamp", "valid_start_timestamp", "expiry_timestamp", "timestamp"]);
const TXID = /^\d{1,10}\.\d{1,10}\.\d{1,20}-\d{1,20}-\d{1,20}$/;
const TIME = /^\d{1,20}(\.\d{1,9})?$/;
function cleanValue(key, v) {
  if (v === null || v === undefined) return v;
  if (ID_KEYS.has(key)) return typeof v === "string" && (ENTITY.test(v) || EVM.test(v)) ? v : INVALID_ID;
  if (INT_KEYS.has(key)) return Number.isSafeInteger(v) || (typeof v === "string" && /^\d{1,20}$/.test(v)) ? v : null;
  if (TIME_KEYS.has(key)) return (typeof v === "string" && TIME.test(v)) || Number.isFinite(v) ? v : null;
  if (key === "transaction_id") return typeof v === "string" && (TXID.test(v) || ENTITY.test(v.split(/[-@]/)[0] || "")) && !/[<>"'&]/.test(v) ? v : INVALID_ID;
  return v;
}
/** A mirror node answer with every id-like field checked (see above). Walks objects and arrays; returns the same object. */
export function cleanIds(json, depth = 0) {
  if (!json || typeof json !== "object" || depth > 20) return json;
  if (Array.isArray(json)) {
    for (let i = 0; i < json.length; i++) json[i] = cleanIds(json[i], depth + 1);
    return json;
  }
  for (const k of Object.keys(json)) {
    const v = json[k];
    json[k] = v && typeof v === "object" ? cleanIds(v, depth + 1) : cleanValue(k, v);
  }
  return json;
}

/** Thrown when no mirror node could be reached at all. */
export class MirrorError extends Error {}

/**
 * GET JSON from the mirror node. `path` is "/api/v1/…" (or a full URL, used as it is).
 * Paced, alternates hosts, retries rate limits and server errors. Throws an Error carrying .status for HTTP failures.
 */
export async function mirrorGet(net, path, signal) {
  for (let n = 0; ; n++) {
    await rateLimit(signal);
    const host = pickHost(net);
    const url = path.startsWith("http") ? path : fullUrl(path, host, net);
    let res;
    try {
      res = await fetch(url, { signal, headers: { accept: "application/json" } });
    } catch (e) {
      if (signal && signal.aborted) throw e;
      if (n >= 2) throw new MirrorError("unreachable");
      await sleep(400 * (n + 1));
      continue;
    }
    if (res.ok) return wentThrough(), res.json().then(cleanIds);
    if ((res.status === 429 || res.status >= 500) && n < 7) {
      const asked = 1e3 * Number(res.headers.get("retry-after"));
      const wait = asked > 0 ? asked : Math.min(15e3, 800 * 2 ** n);
      if (res.status === 429) pushedBack(host, wait);
      else {
        COOL[host] = Date.now() + wait;
        await sleep(wait);
      }
      continue;
    }
    const err: any = new Error(
      res.status === 429 ? "The mirror node is rate-limiting this connection" : "Mirror node returned " + res.status,
    );
    err.status = res.status;
    throw err;
  }
}

// Details of the last mirrorFetch answer, for honest error messages.
let LAST = {};
/**
 * What the most recent mirrorFetch request got back: { status, url, attempts, retryAfter }, where retryAfter
 * is the Retry-After header as text ("" when there was none). An empty object before the first answer.
 */
export const lastMirrorAnswer = () => LAST;
// Called with (host, status, waitMs, attempt, maxAttempts) each time mirrorFetch has to wait out a rate limit.
let onWait = null;
/**
 * Set the one function to be told each time mirrorFetch waits out a rate limit (429 or 503), for showing
 * progress. It is called as fn(host, status, waitMs, attempt, maxAttempts) just before the wait. Replaces any
 * function set earlier; pass null to stop.
 */
export const onMirrorWait = (fn) => {
  onWait = fn;
};

/**
 * fetch() for a mirror URL built from mirrorBase(net), returning the Response whatever its status.
 * Paced with everything else, moved to the host whose turn it is, and retried on 429/503 (honouring Retry-After).
 */
export async function mirrorFetch(url, net, opts?, maxAttempts?) {
  const MAX = maxAttempts || 5;
  let attempt = 0;
  let lastRes = null;
  while (attempt < MAX) {
    await rateLimit(opts && opts.signal);
    const host = ownMirror(net) ? "" : pickHost(net);
    const ask = host ? onHost(url, net, host) : url;
    let r;
    try {
      r = await fetch(ask, opts || {});
    } catch (e) {
      if (attempt >= MAX - 1 || (opts && opts.signal && opts.signal.aborted)) throw e;
      await sleep(400 * Math.pow(2, attempt));
      attempt++;
      continue;
    }
    LAST = { status: r.status, url: ask, attempts: attempt + 1, retryAfter: r.headers.get("retry-after") || "" };
    if (r.status !== 429 && r.status !== 503) {
      wentThrough();
      // the answer's ids are checked when it is read (cleanIds)
      const read = r.json.bind(r);
      r.json = () => read().then(cleanIds);
      return r;
    }
    lastRes = r;
    let wait = parseFloat(r.headers.get("retry-after") || "0") * 1000;
    if (!wait || isNaN(wait)) wait = Math.min(8000, 600 * Math.pow(2, attempt));
    if (host) pushedBack(host, wait);
    else limiter.hits++;
    if (onWait) onWait(new URL(ask, location.href).host, r.status, wait, attempt + 1, MAX);
    await sleep(wait);
    attempt++;
  }
  return lastRes;
}

/** How many times a mirror node has pushed back (429/503) so far this visit. */
export const mirrorPushbacks = () => limiter.hits;

/* ---- for a tool that builds its own addresses (ĦashPress) ---- */
/** One public mirror node per network, as ĦashPress uses them (a site can point it at its own: HASHPRESS_CONFIG.mirror). */
export const PUBLIC_MIRRORS = {
  testnet: "https://testnet.mirrornode.hedera.com",
  mainnet: "https://mainnet.mirrornode.hedera.com",
};

/**
 * GET JSON from a complete mirror node address, with the same pacing, retries and rate-limit handling as mirrorGet
 * (the address is used exactly as given; it is not moved to another host). Throws an Error carrying .status for an
 * HTTP failure (e.g. 404 for something that does not exist), or a MirrorError when no node could be reached.
 */
export function mirrorJson(url, signal?) {
  const net = Object.keys(MIRROR_HOSTS).find((n) => MIRROR_HOSTS[n].some((h) => url.startsWith(h))) || "mainnet";
  return mirrorGet(net, url, signal);
}
