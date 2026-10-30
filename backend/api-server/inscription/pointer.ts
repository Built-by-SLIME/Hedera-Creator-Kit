// @ts-nocheck — vendored inscription core (HCS-1/HCS-6), source: SLIME new-tools shared/core
// Reading NFT metadata pointers: hcs://, ipfs://, ar://, https:// and bare topic ids or CIDs.

/* ---- pointers ---- */
/* ---- pointers that are more than they look ---- */
// Regular-expression source (a string, with no anchors) matching one IPFS id, old style ("Qm…") or new
// ("baf…"). Build with it: new RegExp("^/ipfs/(" + CID_PATTERN + ")").
export const CID_PATTERN = "(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|baf[a-z2-7]{20,})";

// A web address that is really a link to one particular IPFS or Arweave gateway, such as
// https://ipfs.io/ipfs/<id>/1.png or https://<id>.ipfs.dweb.link/1.png. Returns the pointer it stands
// for, so the file can be asked of every gateway and not just the one named; null for any other address.
export function gatewayLink(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const path = u.pathname.replace(/\/+$/, "");
  let m = path.match(new RegExp("^/ipfs/(" + CID_PATTERN + ")(/.*)?$"));
  if (m) return { kind: "ipfs", cid: m[1] + (m[2] || "") + u.search };
  m = u.hostname.match(new RegExp("^(" + CID_PATTERN + ")\\.ipfs\\."));
  if (m) return { kind: "ipfs", cid: m[1] + path + u.search };
  if (/(^|\.)arweave\.net$/i.test(u.hostname)) {
    m = path.match(/^\/([A-Za-z0-9_-]{43})(\/.*)?$/);
    if (m) return { kind: "arweave", id: m[1] + (m[2] || "") + u.search };
  }
  return null;
}

// Long addresses (data links above all) are cut down for display.
export const shortUri = (uri) =>
  uri.length > 140 ? uri.slice(0, 90) + "… (" + uri.length.toLocaleString() + " characters)" : uri;

// Metadata kept in a folder sometimes names its files relative to that folder ("76.png").
// Returns the pointer such a name stands for, or null when it isn't a relative file name.
export function relativePointer(folderPtr, uri) {
  if (!folderPtr || folderPtr.kind !== "ipfs") return null;
  const base = folderPtr.cid.split("?")[0];
  if (!base.includes("/") || !/^(\.\/)?[^:?\s/][^:?\s]*\.[A-Za-z0-9]{2,5}$/.test(uri)) return null;
  return { kind: "ipfs", cid: base.slice(0, base.lastIndexOf("/") + 1) + uri.replace(/^\.\//, ""), raw: uri };
}

// Finds the first hcs://, ipfs://, ar://, http:// or https:// address inside a longer piece of text; the
// match stops at a space, comma, semicolon, quote or angle bracket.
export const POINTER_INSIDE = /(?:hcs|ipfs|ar|https?):\/\/[^\s,;"'<>]+/i;

/**
 * Read a metadata pointer, as written in an NFT's metadata field or inside its JSON, and say what it is.
 * Always returns an object with `kind` and `raw` (the trimmed text). By kind:
 * { kind: 'hrl', std, topic } for "hcs://1/0.0.123" or a bare topic id (`std` is the HCS standard number as
 * text, "1" when not given); { kind: 'ipfs', cid } for "ipfs://…" or a bare id (`cid` keeps any path and
 * query after the id); { kind: 'arweave', id } for "ar://…"; { kind: 'http', url }; { kind: 'data' } for a
 * data link; { kind: 'empty' }; { kind: 'unknown' }. A web link to an IPFS or Arweave gateway comes back as
 * ipfs or arweave with `also` set to the link as written. An address found inside other text comes back as
 * its own kind with `extracted` set to that address.
 */
export function parsePointer(str) {
  const s = String(str || "").trim();
  if (!s)
    return {
      kind: "empty",
      raw: s,
    };
  if (/^data:/i.test(s)) return { kind: "data", raw: s }; // the file is inside the address itself
  let m = s.match(/^hcs:\/\/(\d+)\/(\d+\.\d+\.\d+)/i);
  if (m)
    return {
      kind: "hrl",
      std: m[1],
      topic: m[2],
      raw: s,
    };
  m = s.match(/^hcs:\/\/(\d+\.\d+\.\d+)/i);
  if (m)
    return {
      kind: "hrl",
      std: "1",
      topic: m[1],
      raw: s,
    };
  if (/^ipfs:\/\//i.test(s))
    return {
      kind: "ipfs",
      cid: s.replace(/^ipfs:\/\//i, "").replace(/^ipfs\//i, ""),
      raw: s,
    };
  if (/^ar:\/\//i.test(s))
    return {
      kind: "arweave",
      id: s.replace(/^ar:\/\//i, ""),
      raw: s,
    };
  if (/^https?:\/\//i.test(s)) {
    // a link to one IPFS or Arweave gateway is asked of every gateway; the address as written goes first
    const viaGateway = gatewayLink(s);
    if (viaGateway) return { ...viaGateway, raw: s, also: s };
  }
  if (/^https?:\/\//i.test(s))
    return {
      kind: "http",
      url: s,
      raw: s,
    };
  if (/^\d+\.\d+\.\d+$/.test(s))
    return {
      kind: "hrl",
      std: "1",
      topic: s,
      raw: s,
    };
  if (/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|baf[0-9a-z]{20,})/.test(s))
    return {
      kind: "ipfs",
      cid: s,
      raw: s,
    };
  // Some collections wrap the address in extra text, e.g. "76,ipfs://bafy…/metadata.json" (a serial
  // number, then the pointer). If a recognisable address is in there somewhere, follow that.
  const inner = s.match(POINTER_INSIDE);
  if (inner && inner[0] !== s) {
    const found = parsePointer(inner[0]);
    if (found.kind !== "unknown") return { ...found, raw: s, extracted: inner[0] };
  }
  return {
    kind: "unknown",
    raw: s,
  };
}
