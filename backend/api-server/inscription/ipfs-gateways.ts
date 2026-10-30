// @ts-nocheck — vendored inscription core (HCS-1/HCS-6), source: SLIME new-tools shared/core
// IPFS gateways: which ones are asked, how their URLs are built, and how their refusals are explained.

import { config } from "./config.js";

// The public gateways ipfs.io and dweb.link stopped serving files to web pages on 21 September 2026 (every
// request now gets "429: This IPFS gateway is switching to a service worker gateway only"), and w3s.link and
// nftstorage.link only ever forwarded to them. They are no longer asked. A link that names one of them is
// still followed, through the gateways that remain.
export const IPFS_GATEWAYS = [
  "https://ipfs.filebase.io/ipfs/",
  "https://ipfs.aleph.cloud/ipfs/",
  "https://ipfs.orbitor.dev/ipfs/",
  "https://gateway.pinata.cloud/ipfs/",
];

// Matches the host name (not the whole address) of a gateway that no longer serves files to web pages,
// subdomains included: test it against new URL(link).hostname.
export const RETIRED_GATEWAYS =
  /(^|\.)(ipfs\.io|dweb\.link|w3s\.link|nftstorage\.link|storacha\.link|cloudflare-ipfs\.com|cf-ipfs\.com)$/i;

/* A pointer's path goes into a URL as-is, so characters that mean something in a URL have to be
     escaped first. The common case is a file name like "SLIME#193.png": unescaped, the browser treats
     everything after # as a page anchor and asks the gateway for "SLIME". */
export function encodePath(path) {
  const q = path.indexOf("?");
  const query = q < 0 ? "" : path.slice(q);
  return (
    (q < 0 ? path : path.slice(0, q))
      .split("/")
      .map((seg) => {
        let raw = seg;
        try {
          raw = decodeURIComponent(seg); // already-escaped names aren't escaped twice
        } catch {}
        return encodeURIComponent(raw);
      })
      .join("/") + query
  );
}

// Three of the gateways answer a plain /ipfs/<cid> address with a redirect to their "subdomain" form,
// https://<cid>.ipfs.<gateway>/. A browser tab follows that happily, but a page's own request can be
// refused at the redirect. Going straight to the subdomain form skips the redirect.
// The subdomain needs the CID in its newer lower-case form (bafy…), so older Qm… CIDs are converted.
export const SUBDOMAIN_GATEWAYS = {}; // none of the gateways still asked needs it

/**
 * An IPFS id (without any path) in its newer lower-case form: a "baf…" id is returned as it is, an older
 * "Qm…" id is converted to its "bafy…" equivalent. Returns null when the text is neither.
 */
export function subdomainCid(cid) {
  if (/^baf[a-z2-7]{20,60}$/.test(cid)) return cid;
  if (!/^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(cid)) return null;
  const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = 0n;
  for (const ch of cid) n = n * 58n + BigInt(B58.indexOf(ch));
  const hash = [];
  for (; n > 0n; n >>= 8n) hash.unshift(Number(n & 255n));
  if (hash.length !== 34) return null;
  const bytes = [0x01, 0x70, ...hash]; // CID version 1, dag-pb, then the same hash
  const B32 = "abcdefghijklmnopqrstuvwxyz234567";
  let out = "b";
  let bits = 0;
  let acc = 0;
  for (const byte of bytes) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(acc >> (bits - 5)) & 31];
      bits -= 5;
    }
    acc &= (1 << bits) - 1;
  }
  if (bits) out += B32[(acc << (5 - bits)) & 31];
  return out;
}

/**
 * The address of an IPFS file on one gateway. `gateway` is a base written like the entries of IPFS_GATEWAYS
 * ("https://host/ipfs/"); `cidPath` is "<id>" or "<id>/folder/file.png", with or without a ?query.
 * The path is escaped with encodePath. For a host listed in SUBDOMAIN_GATEWAYS the subdomain form
 * https://<id>.ipfs.<host>/<path> is returned instead.
 */
export function ipfsUrl(gateway, cidPath) {
  const host = gateway.replace(/^https:\/\//, "").replace(/\/ipfs\/$/, "");
  const slash = cidPath.indexOf("/");
  const cid = slash < 0 ? cidPath : cidPath.slice(0, slash);
  const rest = slash < 0 ? "" : cidPath.slice(slash + 1);
  const sub = SUBDOMAIN_GATEWAYS[host] ? subdomainCid(cid) : null;
  return sub ? `https://${sub}.ipfs.${host}/${encodePath(rest)}` : gateway + encodePath(cidPath);
}

// "bafy….ipfs.dweb.link" reads better as "dweb.link" in status lines and errors
export const gatewayName = (host) => host.replace(/^[a-z0-9]+\.ipfs\./, "");

/** The host site's own IPFS gateway (config.ipfs.gateway) as a full address with a trailing slash, or "".
 *  A path on the site itself ("/ipfs/") is completed with the page's own origin. */
export const ownGateway = () => {
  let g = String(config.ipfs.gateway || "").trim();
  if (!g) return "";
  try {
    if (typeof location !== "undefined") g = new URL(g, location.href).href;
  } catch {}
  return g.replace(/\/*$/, "/");
};
/** How long a gateway waits before it is asked: the public ones give our own gateway its head start. */
export const gatewayHeadStart = (url) => {
  const own = ownGateway();
  return own && !String(url).startsWith(own) ? Number(config.ipfs.headStart) || 0 : 0;
};

/**
 * The addresses a pointer's file can be read from, in the order to try them. `ptr` is a parsed pointer:
 * { kind: 'ipfs', cid } gives one address per gateway (the host site's own first, and only that one when
 * config.ipfs.only is set); { kind: 'arweave', id } gives its arweave.net address; { kind: 'http', url }
 * gives [url]. When the pointer was written as a link to one gateway (ptr.also), that link goes first, unless
 * it names a retired gateway. Returns [] for any other kind (on-chain, data link, unknown).
 */
export function gatewayUrls(ptr) {
  const own = ownGateway();
  const urls =
    ptr.kind === "ipfs"
      ? [...(own ? [own] : []), ...(own && config.ipfs.only ? [] : IPFS_GATEWAYS)].map((g) => ipfsUrl(g, ptr.cid))
      : ptr.kind === "arweave"
        ? ["https://arweave.net/" + encodePath(ptr.id)]
        : null;
  // ptr.also: the web address the pointer was written as, tried alongside the public gateways
  let also = ptr.also;
  try {
    if (also && RETIRED_GATEWAYS.test(new URL(also).hostname)) also = ""; // written as a link to a retired gateway
  } catch {}
  if (urls && own && config.ipfs.only && ptr.kind === "ipfs") return urls;
  if (urls) return also ? [also, ...urls.filter((url) => url !== also)] : urls;
  if (ptr.kind === "http") return [ptr.url];
  return [];
}

// What took their place for people is inbrowser.link: it fetches the file inside the browser itself. That only
// works in a tab or a frame (not for a page's own request, and not as a picture address), so it is offered
// in "Open it on" and "Or show it here from", first in line, and nowhere else.
export function viewUrls(ptr) {
  const urls = gatewayUrls(ptr).filter((url) => !sameOrigin(url)); // never opened as a page of this site: fit.ts says why
  if ("ipfs" !== ptr.kind) return urls;
  const cidPath = String(ptr.cid || "");
  const slash = cidPath.search(/[/?#]/);
  const sub = subdomainCid(slash < 0 ? cidPath : cidPath.slice(0, slash));
  if (!sub) return urls;
  const rest = slash < 0 ? "" : cidPath.slice(slash).replace(/^\//, "");
  return [`https://${sub}.ipfs.inbrowser.link/${encodePath(rest)}`, ...urls];
}

/* Some minting tools upload the raw body of a web form instead of the file itself, so what comes back is
     "multipart/form-data": a boundary line, a few header lines, then the real file, then the boundary again.
     This pulls the real file back out. Returns null when the bytes aren't such a wrapper. */
export function unwrapMultipart(bytes) {
  if (!bytes || bytes.length < 40 || bytes[0] !== 0x2d || bytes[1] !== 0x2d) return null; // must start with "--"
  const text = new TextDecoder("latin1").decode(bytes); // one character per byte, so positions line up
  const first = text.match(/^--([^\r\n]{1,200})\r?\n/);
  if (!first || !/^content-disposition:/im.test(text.slice(0, 600))) return null;
  const marker = "--" + first[1];
  const parts = [];
  let at = 0;
  while (at >= 0 && at < text.length) {
    const headStart = text.indexOf("\n", at) + 1; // the line after the boundary
    if (!headStart || text.startsWith("--", at + marker.length)) break; // "--boundary--" closes the form
    const blank = text.slice(headStart).search(/\r?\n\r?\n/);
    if (blank < 0) break;
    const head = text.slice(headStart, headStart + blank);
    const bodyStart = headStart + blank + text.slice(headStart + blank).match(/^\r?\n\r?\n/)[0].length;
    let next = text.indexOf("\n" + marker, bodyStart);
    const bodyEnd = next < 0 ? text.length : text[next - 1] === "\r" ? next - 1 : next;
    parts.push({
      type: ((head.match(/^content-type:\s*([^\r\n;]+)/im) || [])[1] || "").trim().toLowerCase(),
      filename: (head.match(/filename="([^"]*)"/i) || [])[1] || "",
      bytes: bytes.slice(bodyStart, bodyEnd),
    });
    at = next < 0 ? -1 : next + 1;
  }
  const real = parts.filter((p) => p.bytes.length);
  if (!real.length) return null;
  // The form can carry small fields beside the file (a part holding just "application/json", say).
  // The file is the part the form marks as one, otherwise the biggest part.
  const file = real.find((p) => p.filename) || real.reduce((a, b) => (b.bytes.length > a.bytes.length ? b : a));
  if (!file.type) {
    // a small field that is nothing but a file type describes the file
    const label = real
      .filter((p) => p !== file && p.bytes.length < 100)
      .map((p) => new TextDecoder().decode(p.bytes).trim().toLowerCase())
      .find((t) => /^[\w.+-]+\/[\w.+-]+$/.test(t));
    if (label) file.type = label;
  }
  return file;
}

/* Turn the gateways' answers into plain words for the note under a file that failed. `err` is the list
     offchainToBytes builds, e.g. "ipfs.filebase.io: HTTP 504; dweb.link: HTTP 429; ipfs.io: Load failed".
     A gateway that searched and came back empty says something about the file; one that was blocked,
     rate-limited or cut off says something about the connection. Returns "" when there is nothing to sort. */
export function explainGatewayErrors(err, isIpfs) {
  const missing = [];
  const ownOnly = [];
  const slow = [];
  const busy = [];
  const blocked = [];
  const other = [];
  const wrong = []; // answered, but not with the file
  for (const part of String(err || "").split("; ")) {
    const m = part.match(/^([a-z0-9-]+(?:\.[a-z0-9-]+)+): (.+)$/i);
    if (!m) continue;
    // Pinata's public gateway only serves files pinned with Pinata, so its 404 says nothing about the rest of IPFS
    if (m[1] === "gateway.pinata.cloud" && m[2] === "HTTP 404") ownOnly.push(m[1]);
    else if (/^HTTP (404|410|504)$/.test(m[2])) missing.push(m[1]);
    else if (m[2] === "timed out") slow.push(m[1]);
    else if (m[2] === "HTTP 429") busy.push(m[1]);
    else if (/^HTTP \d+$/.test(m[2])) other.push(`${m[1]}, ${m[2]}`);
    else if (/^sent /.test(m[2])) wrong.push(m[1]);
    else blocked.push(m[1]);
  }
  const say = (list, one, many) => `${list.length} ${list.length === 1 ? one : many} (${list.join(", ")}).`;
  const lines = [];
  if (missing.length)
    lines.push(
      say(
        missing,
        "gateway searched for the file and didn't find it",
        "gateways searched for the file and didn't find it",
      ),
    );
  if (slow.length) lines.push(say(slow, "gateway didn't answer in time", "gateways didn't answer in time"));
  if (busy.length)
    lines.push(
      say(
        busy,
        "gateway is limiting how often this connection may ask",
        "gateways are limiting how often this connection may ask",
      ),
    );
  if (blocked.length)
    lines.push(
      say(
        blocked,
        "gateway couldn't be reached from this connection, often because of a verification screen",
        "gateways couldn't be reached from this connection, often because of a verification screen",
      ),
    );
  if (other.length) lines.push(say(other, "gateway refused the request", "gateways refused the request"));
  if (wrong.length)
    lines.push(
      say(
        wrong,
        "gateway answered with something that isn't the file (a web page or an error message)",
        "gateways answered with something that isn't the file (a web page or an error message)",
      ),
    );
  if (ownOnly.length) lines.push("gateway.pinata.cloud doesn't have it, but it only serves files pinned with Pinata.");
  if (!lines.length) return "";
  const unanswered = slow.length + busy.length + blocked.length + wrong.length;
  let verdict;
  if (missing.length && !unanswered)
    verdict = isIpfs
      ? "Every gateway that answered couldn't find the file, so it has most likely been unpinned from IPFS, or is held by a single node that is offline. It will only come back if someone who has it hosts it again."
      : "The server answered and doesn't have the file, so it has most likely been removed.";
  else if (busy.length)
    verdict =
      "A gateway that is limiting this connection may well have the file. Wait a minute for the limit to clear, then try again; the buttons below open the file on each gateway directly.";
  else if (missing.length)
    verdict = `${missing.length === 1 ? "One gateway" : "Some gateways"} came up empty, but ${unanswered === 1 ? "another" : unanswered + " others"} never gave a real answer, so the file may still be available. The buttons below open it on each gateway directly.`;
  else if (slow.length)
    verdict =
      "No gateway said the file is missing, so it may simply be slow to find. A slow or patchy connection can cause this too. Try again in a minute.";
  else
    verdict =
      "No gateway gave a real answer, so this says nothing about the file itself. Try again on another network, or with any VPN or private relay turned off.";
  return lines.join(" ") + " " + verdict;
}

/* What one gateway's answer means, in a few words, for the live list shown while a file is being fetched. */
export function describeGatewayAnswer(what) {
  if (/^HTTP (404|410)$/.test(what)) return "doesn't have it";
  if (what === "HTTP 504") return "searched and didn't find it in time";
  if (what === "HTTP 429") return "busy, asked us to slow down";
  if (/^HTTP \d+$/.test(what)) return "refused the request (" + what + ")";
  if (what === "timed out") return "no answer in time";
  if (/^sent /.test(what)) return what;
  if (what === "download broke off") return what;
  return "couldn't be reached";
}

// One gateway, one attempt. Resolves with the response as soon as its headers arrive. Rejects with an
// Error whose .again says whether another try could help: a dropped connection, a timeout or a busy
// server, yes; a definite "not found", no.
// One more source, for the page's own fetch only. Most NFT metadata files (and many small pictures) have an
// id starting "bafkrei": the whole file is a single block. The IPFS project's "trustless" gateway hands out
// such a block as-is, is built for requests made by web pages, and has no verification screen. It isn't
// offered as a link or a frame, because in a tab it downloads the block instead of showing it.
export const RAW_BLOCK_GATEWAYS = ["https://trustless-gateway.link/ipfs/"];

/**
 * The addresses the page's own fetch should ask for a pointer: everything gatewayUrls(ptr) returns and, for an
 * IPFS pointer, one more source that only works for a fetch. For a single-block file (id starting "bafkrei")
 * that is the raw block from each of RAW_BLOCK_GATEWAYS; otherwise it is a "?format=car&dag-scope=entity"
 * address, which gatewayFetch answers by building the file from its blocks. Nothing is added when
 * config.ipfs.only limits requests to the host site's own gateway. Use viewUrls for links and frames.
 */
export function fetchUrls(ptr) {
  const urls = gatewayUrls(ptr);
  if ("ipfs" !== ptr.kind || (config.ipfs.only && ownGateway())) return urls;
  // a single-block file is asked for as that block; anything else is put together from its blocks
  if (/^bafkrei[a-z2-7]{20,60}$/.test(ptr.cid || ""))
    RAW_BLOCK_GATEWAYS.forEach((g) => urls.push(g + ptr.cid + "?format=raw"));
  else if (subdomainCid(String(ptr.cid || "").split(/[/?#]/)[0]))
    urls.push(CAR_GATEWAY + "/ipfs/" + encodePath(String(ptr.cid).split(/[?#]/)[0]) + "?format=car&dag-scope=entity");
  return urls;
}

/* ---- IPFS files, put together from their blocks ----
     A large IPFS file is stored as many blocks: a small "root" block listing the pieces, then the pieces. The
     ordinary gateways did the putting-together and handed over the finished file; with most of those retired
     for web pages, this does it here. The blocks are asked of a "trustless" gateway (one request for the whole
     set, as a CAR archive; single blocks after that only if any are missing), each block is checked against the
     hash in its own id, and the pieces are joined in order. A path inside a folder ("<id>/12.png") is followed
     through the folder's blocks, including the split-up folders big collections use. */
export const CAR_GATEWAY = "https://trustless-gateway.link";

// Gateways asked for single raw blocks ("<base>/ipfs/<id>?format=raw"), in this order, when the CAR archive
// lacks a block. Base addresses with no trailing slash.
export const BLOCK_GATEWAYS = ["https://trustless-gateway.link", "https://ipfs.aleph.cloud"];

/**
 * Turn a Response with a failure status into the Error the gateway race expects. The message is
 * "HTTP <status>"; .again is true for 408, 429 and 5xx (another try could help); .unhurried is the same
 * (a real pause is needed first); .retryAfter is the Retry-After header as a number of seconds, or 0.
 * The Error is returned, not thrown.
 */
export function gatewayRefusal(res) {
  const refused: any = new Error("HTTP " + res.status);
  refused.again = 408 === res.status || 429 === res.status || res.status >= 500;
  refused.unhurried = refused.again;
  refused.retryAfter = Number(res.headers.get("retry-after")) || 0;
  return refused;
}

/**
 * An Error with the given message and .again set to false: a failure that asking again will not change
 * (an unreadable id, a block that doesn't match its hash, a folder where a file was expected).
 */
export const finalError = (text) => Object.assign(new Error(text), { again: false });

// The id itself, without any path inside a folder: "bafy…/1.png" -> "bafy…"
export const ipfsRoot = (ptr) => (ptr && "ipfs" === ptr.kind ? String(ptr.cid || "").split(/[/?#]/)[0] : "");

// The address of the in-browser viewer (inbrowser.link) for an IPFS pointer, or "" when there is none.
export function viewerUrl(ptr) {
  const first = ptr && "ipfs" === ptr.kind ? viewUrls(ptr)[0] || "" : "";
  return /\.ipfs\.inbrowser\.link\//.test(first) ? first : "";
}

/* Some NFTs keep their metadata on an ordinary web server that doesn't let other pages read it
     (no CORS headers). The JSON is out of reach then, but a browser will still display an image
     from that server, so show the picture on its own. Servers with a known image address go here. */
export const KNOWN_HOSTS = {
  "nft.ssv2.io": { label: "SaucerSwap liquidity position", image: (url) => url.replace(/\/+$/, "") + ".svg" },
};

/**
 * Whether a media entry from NFT metadata can be shown straight from a gateway address in an <img>, <video>
 * or <audio>. `m` is { type, role }: true when `type` is an image/, video/ or audio/ type, or when there is
 * no type and `role` is "image".
 */
export const embeddable = (m) => /^(image|video|audio)\//i.test(m.type || "") || (!m.type && m.role === "image");

/** Is `url` (absolute, or relative to the page) on the page's own origin? false outside a page. */
export function sameOrigin(url) {
  try {
    return typeof location !== "undefined" && new URL(url, location.href).origin === location.origin;
  } catch {
    return false;
  }
}
