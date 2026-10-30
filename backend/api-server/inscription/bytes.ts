// @ts-nocheck — vendored inscription core (HCS-1/HCS-6), source: SLIME new-tools shared/core
// Bytes, base64 and text helpers.

/**
 * Make any value safe to write into HTML text or a quoted attribute: & < > " and ' become entities.
 * The value is turned into a string first. Returns the escaped string.
 */
export const escapeHtml = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );

/* ---- bytes ---- */
/**
 * Decode a standard base64 string into a Uint8Array.
 * Throws (as atob does) when the text is not valid base64; no spaces or URL-safe characters are accepted.
 */
export function b64ToBytes(b64) {
  const bin = atob(b64);
  const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
}

/**
 * Decode a base64 string into text, read as UTF-8 (bytes that are not valid UTF-8 become the replacement character).
 * Never throws: returns "" when the base64 cannot be decoded.
 */
export function b64ToStr(b64) {
  try {
    return new TextDecoder("utf-8", {
      fatal: false,
    }).decode(b64ToBytes(b64));
  } catch {
    try {
      return atob(b64);
    } catch {
      return "";
    }
  }
}

/**
 * Whether a string looks like readable text and not binary data: true when more than 85% of its
 * characters are tabs, line breaks, printable ASCII or non-ASCII characters. False for an empty string.
 */
export function isPrintable(s) {
  if (!s) return false;
  let p = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127) || c > 127) p++;
  }
  return p / s.length > 0.85;
}

// A data link carries the file inside the address itself: data:image/svg+xml;base64,PHN2Zy…
// Returns { bytes, mime }, or null when it can't be decoded.
export function dataToBytes(uri) {
  const m = /^data:([^,;]*)((?:;[^,;]*)*),([\s\S]*)$/i.exec(String(uri).trim());
  if (!m) return null;
  const mime = (m[1] || "text/plain").toLowerCase();
  try {
    if (/;base64/i.test(m[2])) return { bytes: b64ToBytes(m[3].replace(/\s+/g, "")), mime };
    let text = m[3];
    try {
      text = decodeURIComponent(text);
    } catch {} // not escaped, e.g. raw SVG with a % in it
    return { bytes: new TextEncoder().encode(text), mime };
  } catch {
    return null;
  }
}

/* ---- on-chain parts of an HTML piece (HCS-3) ---- */
/**
 * Encode a Uint8Array as a standard base64 string. Works in 32 KB slices, so large files are fine.
 */
export function bytesToB64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/* ---- for writing (ĦashPress) ---- */
/** SHA-256 of some bytes as 64 lowercase hex characters. */
export async function sha256hex(bytes) {
  const h = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A promise that resolves after ms milliseconds. */
export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
