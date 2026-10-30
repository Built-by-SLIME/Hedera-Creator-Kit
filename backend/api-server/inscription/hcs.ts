// @ts-nocheck — vendored inscription core (HCS-1/HCS-6), source: SLIME new-tools shared/core
// Hedera Consensus Service files: chunk reassembly (HCS-1) and inlining of hcs:// references.
import { bytesToB64 } from "./bytes.js";

/* An HTML piece can keep its scripts, styles, images and media in other HCS topics and refer to them as
     hcs://1/0.0.x, in a src, data-src, href or poster attribute or in a CSS url(). A browser can't load
     those addresses, so each topic is fetched here and its content written into the page itself.
     loadTopic(topicId) resolves to { bytes, mime } or null. References made from inside the piece's own
     JavaScript, and references inside the loaded files themselves, are left as they are.
     Returns { html, total, loaded }. */
export async function inlineHcsRefs(html, loadTopic) {
  const attr = /\b(data-src|src|href|poster)(\s*=\s*)(["'])hcs:\/\/\d+\/(\d+\.\d+\.\d+)\3/gi;
  const css = /url\(\s*(["']?)hcs:\/\/\d+\/(\d+\.\d+\.\d+)\1\s*\)/gi;
  const topics = [
    ...new Set([...html.matchAll(attr)].map((m) => m[4]).concat([...html.matchAll(css)].map((m) => m[2]))),
  ];
  const parts = new Map();
  for (const topic of topics.slice(0, 60)) {
    let part = null;
    try {
      part = await loadTopic(topic);
    } catch {}
    if (part && part.bytes)
      parts.set(topic, { b64: bytesToB64(part.bytes), mime: part.mime || "application/octet-stream" });
  }
  const tagAt = (offset) =>
    ((html.slice(Math.max(0, offset - 2000), offset).match(/<([a-zA-Z][\w-]*)\b[^<]*$/) || [])[1] || "").toLowerCase();
  let out = html.replace(attr, (whole, name, eq, quote, topic, offset) => {
    const part = parts.get(topic);
    if (!part) return whole;
    const tag = tagAt(offset);
    // a browser only runs a script, or applies a stylesheet, that says it is one
    const mime = tag === "script" ? "text/javascript" : tag === "link" ? "text/css" : part.mime;
    const real = name.toLowerCase() === "data-src" ? (tag === "link" ? "href" : "src") : name;
    return `${real}${eq}${quote}data:${mime};base64,${part.b64}${quote}`;
  });
  out = out.replace(css, (whole, quote, topic) => {
    const part = parts.get(topic);
    return part ? `url(${quote}data:${part.mime};base64,${part.b64}${quote})` : whole;
  });
  return { html: out, total: topics.length, loaded: parts.size };
}

/* ---- HCS ---- */
/* reads for reassembly take the whole topic; this is only a guard against a runaway topic (HCS-1 chunks are ~1 KB each) */
export const TOPIC_MAX = 50000;

/**
 * Is `o` an HCS-1 chunk number: a whole number (or a string of digits) from 0 to twice TOPIC_MAX? A message
 * claiming to be chunk 2,000,000,000 is not a chunk: counting the gap up to it would stall the page.
 */
export function isChunkNo(o) {
  const n = typeof o === "number" ? o : typeof o === "string" && /^\d{1,7}$/.test(o) ? Number(o) : NaN;
  return Number.isInteger(n) && n >= 0 && n < 2 * TOPIC_MAX;
}

/* Chunk text -> bytes. HCS-1 says: base64 of the (compressed) file, split across the chunks, with a
     "data:<mime>;base64," prefix on the first. Real topics stray from that, so this accepts the common
     variations and says which one it met:
       - the same chunk written twice (a retried upload)
       - a prefix with extra parts ("data:text/html;charset=utf-8;base64,")
       - spaces, line breaks or URL-safe characters in the base64, or missing padding
       - every chunk base64-encoded on its own, each with its own padding or prefix
       - a data link that isn't base64 at all ("data:image/svg+xml,<svg…")
       - plain text chunks with no base64 anywhere
     Returns { bytes, mime, notes[], plain } or { error }. */
export function chunksToBytes(chunks) {
  const notes = [];
  const seen = new Set();
  const list = [];
  let repeats = 0;
  for (const c of chunks) {
    const o = Number(c.o);
    if (seen.has(o)) {
      repeats++;
      continue;
    }
    seen.add(o);
    list.push(c);
  }
  if (repeats) notes.push(`${repeats} repeated chunk${repeats === 1 ? "" : "s"} ignored`);
  const PREFIX = /^data:([^,]{0,200}),/;
  const toBytes = (s) => {
    const bin = atob(s);
    const a = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a;
  };
  const tidy = (s) => s.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = (s) => {
    s = s.replace(/=+$/, "");
    return s + ["", "", "==", "="][s.length % 4];
  };
  const asText = (s) => new TextEncoder().encode(s);
  let text = list.map((c) => c.c).join("");
  let mime = null;
  let base64 = true;
  const head = text.match(PREFIX);
  if (head) {
    const parts = head[1].split(";").map((p) => p.trim());
    mime = parts[0] || null;
    base64 = parts.some((p) => p.toLowerCase() === "base64");
    text = text.slice(head[0].length);
  }
  if (!base64) {
    notes.push("stored as plain text in a data link, not base64");
    let plainText = text;
    try {
      plainText = decodeURIComponent(text);
    } catch (e) {}
    return { bytes: asText(plainText), mime, notes, plain: true };
  }
  // 1. the standard shape: one base64 string across all the chunks
  try {
    const s = tidy(text);
    const bytes = toBytes(pad(s));
    if (s !== text) notes.push("spaces or URL-safe characters in the base64 were accepted");
    return { bytes, mime, notes };
  } catch (e) {}
  // 2. every chunk encoded on its own
  try {
    const pieces = list.map((c) => {
      let s = c.c;
      const h = s.match(PREFIX);
      if (h) {
        mime = mime || h[1].split(";")[0].trim() || null;
        s = s.slice(h[0].length);
      }
      return toBytes(pad(tidy(s)));
    });
    const bytes = new Uint8Array(pieces.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of pieces) {
      bytes.set(p, at);
      at += p.length;
    }
    notes.push("each chunk was base64-encoded on its own");
    return { bytes, mime, notes };
  } catch (e) {}
  // 3. a few stray characters in otherwise good base64
  const body = tidy(text).replace(/=/g, "");
  const kept = body.replace(/[^A-Za-z0-9+/]/g, "");
  const stray = body.length - kept.length;
  if (kept.length && stray / body.length < 0.02) {
    try {
      const bytes = toBytes(pad(kept));
      notes.push(`${stray} stray character${stray === 1 ? "" : "s"} removed from the base64`);
      return { bytes, mime, notes };
    } catch (e) {}
  }
  // 4. not base64 at all: the chunks hold the file's text as it is
  if (stray / Math.max(1, body.length) >= 0.02) {
    notes.push("the chunks hold plain text, not base64");
    return { bytes: asText(list.map((c) => c.c).join("")), mime: null, notes, plain: true };
  }
  const bad = list.find((c) => /[^A-Za-z0-9+/=_\-\s]/.test(c.c.replace(PREFIX, "")));
  return {
    error: bad
      ? `chunk o=${bad.o} holds characters that aren't base64 (${JSON.stringify((bad.c.replace(PREFIX, "").match(/[^A-Za-z0-9+/=_\-\s]+/) || [""])[0].slice(0, 12))})`
      : "the base64 is cut short or damaged",
  };
}
