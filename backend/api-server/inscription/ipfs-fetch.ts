// @ts-nocheck — vendored inscription core (HCS-1/HCS-6), source: SLIME new-tools shared/core
// Support for the gateway race: one request, pacing, timeouts, answer checks and the in-visit file cache.
import { folderNames, ipfsFromBlocks } from "./ipfs-blocks";

// One request to a gateway. An address ending "?format=car&dag-scope=entity" stands for "put the file
// together from its blocks": the answer is made here and handed back as if a gateway had served the file.
export async function gatewayFetch(url, signal) {
  const m = /^https:\/\/trustless-gateway\.link\/ipfs\/([^?#]+)\?format=car&dag-scope=entity$/.exec(url);
  if (!m) return fetch(url, { signal, mode: "cors", credentials: "omit", referrerPolicy: "no-referrer" });
  return new Response(await ipfsFromBlocks(m[1], signal), { status: 200 });
}

/**
 * Ask one gateway once, with a time limit. `url` is the address, `ms` the time allowed in milliseconds (three
 * times as long for an address that stands for "build the file from its blocks"), and `ctrl` an
 * AbortController the caller keeps: it is aborted when the time runs out, and the caller can abort it too.
 * Resolves with the Response when its status is a success. Otherwise rejects with an Error whose message is
 * "HTTP <status>", "timed out" or the connection error, and which carries .again (true when another try
 * could help: 408, 429, 5xx, a dropped connection or a timeout), .unhurried (true when a long pause is needed
 * first: a busy gateway or a timeout) and, for an HTTP refusal, .retryAfter (seconds the gateway asked for, or 0).
 */
export async function askGateway(url, ms, ctrl) {
  const timer = setTimeout(() => ctrl.abort(), /format=car/.test(url) ? 3 * ms : ms); // a file built from blocks gets longer
  try {
    const r = await gatewayFetch(url, ctrl.signal);
    if (r.ok) return r;
    const refused: any = new Error("HTTP " + r.status);
    refused.again = r.status === 408 || r.status === 429 || r.status >= 500;
    refused.unhurried = refused.again; // a busy or timed-out gateway needs a real pause before the next try
    refused.retryAfter = Number(r.headers.get("retry-after")) || 0;
    throw refused;
  } catch (e) {
    if (e.again !== undefined) throw e;
    const dropped: any = new Error(e.name === "AbortError" ? "timed out" : e.message || String(e));
    dropped.again = true;
    dropped.unhurried = e.name === "AbortError";
    throw dropped;
  } finally {
    clearTimeout(timer);
  }
}

/* Fetch an off-chain file. Every gateway is asked at the same moment and the first one to answer
     wins, so one slow or broken gateway no longer holds up the ones behind it. Up to three passes:
     a dropped or slow connection (common on cellular) gets further goes, and a gateway that answered
     with a definite "no" (404 and the like) is not asked again.
     Between passes it waits: briefly after dropped connections, but 8 and then 15 seconds when a gateway
     was busy (429), gave up searching (5xx) or timed out, since those need time before asking again.
     opts.from / opts.to pick which passes to run; opts.stop is an AbortSignal that calls it off;
     opts.wait is how long to hold off before the first of them (the `wait` a previous call returned). */
export const RETRY_PAUSES = [3000, 6000];

// A gateway that answers 502, 503 or 504 has usually started fetching the file from the IPFS network and
// given up waiting before it arrived. Asking the same gateway again a few seconds later, inside the same try,
// often finds it ready, without waiting for the whole try to end and the next to start.
export const ASK_AGAIN_SOON = [3000, 5000, 8000];

// Files already fetched in this visit, by their id. An IPFS or Arweave id always names the same bytes, so a
// file fetched once (for an icon, a preview, an earlier look) is not fetched again.
export const FILE_CACHE = new Map();

// kept small on purpose: a phone's browser closes a page that holds a few hundred megabytes
export const FILE_CACHE_ITEM = 8 * 1024 * 1024;

// The most FILE_CACHE holds altogether, in bytes (32 MB); the files fetched longest ago are dropped beyond that.
export const FILE_CACHE_TOTAL = 32 * 1024 * 1024;

/**
 * The key a pointer's file is kept under in FILE_CACHE: "ipfs:<cid and path>" for { kind: 'ipfs', cid },
 * "ar:<id>" for { kind: 'arweave', id }. Returns "" for every other kind of pointer: those are not kept,
 * because their address does not always name the same bytes.
 */
export const fileCacheKey = (ptr) =>
  "ipfs" === ptr.kind ? "ipfs:" + ptr.cid : "arweave" === ptr.kind ? "ar:" + ptr.id : "";

/**
 * Keep a fetched file in FILE_CACHE for the rest of the visit. `key` comes from fileCacheKey; `file` is any
 * object with a `bytes` Uint8Array (the apps store { bytes, mime, unwrapped, url, gateway }).
 * Nothing is kept when the key is "" or the file is larger than FILE_CACHE_ITEM. If the cache then holds more
 * than FILE_CACHE_TOTAL, the files remembered longest ago are dropped until it fits.
 */
export function rememberFile(key, file) {
  if (!key || file.bytes.length > FILE_CACHE_ITEM) return;
  FILE_CACHE.delete(key);
  FILE_CACHE.set(key, file);
  let total = 0;
  FILE_CACHE.forEach((f) => (total += f.bytes.length));
  for (const k of FILE_CACHE.keys()) {
    if (total <= FILE_CACHE_TOTAL) break;
    total -= FILE_CACHE.get(k).bytes.length;
    FILE_CACHE.delete(k);
  }
}

// "· 3.2 s, on the second try" for a fetched file; says so when it came from this visit's memory instead.
export function tookText(off) {
  if (!off) return "";
  if (off.cached) return " · already fetched earlier in this visit";
  if (!off.ms) return "";
  return ` · ${(off.ms / 1000).toFixed(1)} s${off.pass > 1 ? `, on try ${off.pass}` : ""}${off.asks > 1 ? `, after asking it ${off.asks} times` : ""}`;
}

/* Being a polite client, so gateways keep serving us. A gateway that answers "slow down" (429) is left
     alone until the time it asked for has passed (20 seconds when it names none, 2 minutes at most), and
     that is remembered from one file and one NFT to the next. On the last pass it still gets its turn,
     timed for the moment its wait is over, while the other gateways are asked straight away: whichever
     delivers first wins. Requests to any one gateway are also kept a little apart. */
export const GATEWAY_REST = new Map(); // gateway name -> the time (ms) before which it must not be asked again

// When each gateway was last asked, so that requests to the same one are kept GATEWAY_GAP apart.
export const GATEWAY_LAST = new Map(); // gateway name -> when it was last asked

// The least time, in milliseconds, between two requests to the same gateway.
export const GATEWAY_GAP = 400;

/**
 * How many milliseconds a gateway must still be left alone after telling us to slow down; 0 when it may be
 * asked now. `name` is the gateway's name as used for the keys of GATEWAY_REST (see gatewayName).
 */
export const restLeft = (name) => Math.max(0, (GATEWAY_REST.get(name) || 0) - Date.now());

// How long, in milliseconds, a gateway gets to answer on the first, second and third pass.
export const GATEWAY_TIMEOUTS = [25000, 35000, 35000]; // how long the gateways get on pass 1, 2 and 3

/* A gateway saying "here it is" isn't proof that what follows is the file: some send a verification screen,
     an error page or a one-line refusal with a success code. Every answer is looked at before it can win the
     race. Returns "" when the answer is acceptable, otherwise what was wrong with it (always starting "sent").
     expect: "json" for metadata, or the type the metadata gives the file ("image/png", "video/mp4", …); ""
     when nothing is known, in which case only answers that are plainly not a file are turned away. */
export function badAnswer(bytes, expect) {
  if (!bytes || !bytes.length) return "sent an empty answer";
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 4000));
  if (/^\s*This IPFS gateway is switching to a service worker gateway/i.test(head))
    return "sent a notice that it has been retired";
  const isPage = /^\s*(<!doctype html|<html[\s>])/i.test(head);
  if (
    isPage &&
    /just a moment|challenge-platform|cf-browser-verification|cf-chl|captcha|attention required|verify(ing)? (that )?you are (a )?human|access denied|<title>\s*(error|[45]\d\d\b)/i.test(
      head,
    )
  )
    return "sent a verification or error page, not the file";
  const want = String(expect || "").toLowerCase();
  if (!want) return "";
  const media = /^(image|video|audio|model|font)\b/.test(want) || "json" === want;
  // a web page where a picture, video or metadata was expected (a folder listing is a real answer, and is kept)
  if (isPage && media && !folderNames(bytes)) return "sent a web page, not the file";
  if (media && bytes.length < 600) {
    const text = head.trim();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    // a small JSON object holding nothing but an error
    if (json && "object" === typeof json && !Array.isArray(json)) {
      const keys = Object.keys(json);
      if (
        keys.length &&
        keys.every((k) =>
          /^(error|errors|message|msg|status|statuscode|code|detail|details|reason|ok|success)$/i.test(k),
        ) &&
        keys.some((k) => /^(error|errors|message|msg|detail|reason)$/i.test(k))
      )
        return "sent an error message, not the file";
    } else if (
      !json &&
      /^[\x20-\x7e\s]+$/.test(text) &&
      /\b(error|not found|too many requests|rate limit|denied|forbidden|unauthori[sz]ed|bad gateway|timed? ?out|unavailable|blocked)\b/i.test(
        text,
      )
    )
      return "sent an error message, not the file";
  }
  return "";
}

// The start of an answer (enough to tell what it is), read as it arrives. Returns { head, rest }: head is the
// first few kilobytes, or the whole answer when it is smaller; rest() downloads what remains and returns it all.
export const ANSWER_HEAD = 4096;

/**
 * Read the start of a fetch Response `r` without downloading all of it. Returns a promise of
 * { head, rest, drop }: `head` is a Uint8Array of at least the first ANSWER_HEAD bytes (the whole answer when
 * it is smaller, or when the browser can't read it piece by piece); `rest()` downloads the remainder and
 * resolves with the complete answer as one Uint8Array; `drop()` cancels the download when the answer is not wanted.
 */
export async function answerHead(r) {
  const join = (parts, size) => {
    if (1 === parts.length) return parts[0];
    const out = new Uint8Array(size);
    let pos = 0;
    for (const p of parts) (out.set(p, pos), (pos += p.length));
    return out;
  };
  const reader = r.body && r.body.getReader ? r.body.getReader() : null;
  if (!reader) {
    const all = new Uint8Array(await r.arrayBuffer());
    return { head: all, rest: async () => all, drop() {} };
  }
  const parts = [];
  let size = 0;
  let ended = false;
  while (size < ANSWER_HEAD) {
    const { done, value } = await reader.read();
    if (done) {
      ended = true;
      break;
    }
    parts.push(value);
    size += value.length;
  }
  const head = join(parts, size);
  return {
    head,
    drop: () => void reader.cancel().catch(() => {}),
    rest: async () => {
      if (ended) return head;
      const all = [head];
      let total = size;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        all.push(value);
        total += value.length;
      }
      return join(all, total);
    },
  };
}

// First try failed: while the page keeps trying, show the file in a frame from a gateway that a tab
// could probably open. Whatever the later tries produce replaces it.
// How long the page fetches on its own before gateways are also asked to display the picture.
export const PREVIEW_HEAD_START = 700;

// How much longer before the in-browser viewer's frame is loaded: most files arrive within a few seconds,
// and a frame that appears and goes again only makes the window jump.
export const VIEWER_WAIT = 4000;
