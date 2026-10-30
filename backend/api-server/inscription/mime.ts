// @ts-nocheck — vendored inscription core (HCS-1/HCS-6), source: SLIME new-tools shared/core
// Working out what kind of file a run of bytes is.
import { isPrintable } from "./bytes";

/**
 * Work out a file's type from its first bytes. `b` is a Uint8Array. Returns a type such as "image/png",
 * "video/mp4", "image/svg+xml", "text/html", "application/json" or "text/plain" (every type listed in
 * extFor), or null when there are fewer than 4 bytes or they are neither a known file format nor readable
 * text. JSON and HTML are judged by their first character only, so the content is not checked.
 */
export function sniffMime(b) {
  if (!b || b.length < 4) return null;
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "application/pdf";
  if (b[0] === 0x89 && b[1] === 0x50) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return "image/webp";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[8] === 0x57 && b[9] === 0x41) return "audio/wav";
  if (b[0] === 0x42 && b[1] === 0x4d) return "image/bmp";
  if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const brand = new TextDecoder("latin1").decode(b.slice(8, 12)).trim().toLowerCase();
    if (brand.startsWith("qt")) return "video/quicktime";
    if (brand.startsWith("m4a") || brand.startsWith("m4b")) return "audio/mp4";
    if (brand.startsWith("avif")) return "image/avif";
    return "video/mp4";
  }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "video/webm";
  if (b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) return "video/ogg";
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return "audio/mpeg";
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return "audio/mpeg";
  if (b[0] === 0x67 && b[1] === 0x6c && b[2] === 0x54 && b[3] === 0x46) return "model/gltf-binary";
  const head = new TextDecoder("utf-8", {
    fatal: false,
  })
    .decode(b.slice(0, 300))
    .trim();
  if (/^<\?xml/i.test(head) && /<svg/i.test(head)) return "image/svg+xml";
  if (/^<svg/i.test(head)) return "image/svg+xml";
  if (/^<(!doctype html|html)/i.test(head)) return "text/html";
  if (b[0] === 0x3c) return "text/html";
  if (b[0] === 0x7b || b[0] === 0x5b) return "application/json";
  if (isPrintable(head)) return "text/plain";
  return null;
}

/**
 * The file name ending for a type sniffMime can return, with its dot: "image/png" gives ".png".
 * Returns ".bin" for any other type, or none.
 */
export function extFor(m) {
  return (
    {
      "application/pdf": ".pdf",
      "image/png": ".png",
      "image/jpeg": ".jpg",
      "image/gif": ".gif",
      "image/webp": ".webp",
      "image/avif": ".avif",
      "image/bmp": ".bmp",
      "image/svg+xml": ".svg",
      "video/mp4": ".mp4",
      "video/quicktime": ".mov",
      "video/webm": ".webm",
      "video/ogg": ".ogv",
      "audio/mp4": ".m4a",
      "audio/mpeg": ".mp3",
      "audio/wav": ".wav",
      "model/gltf-binary": ".glb",
      "text/html": ".html",
      "application/json": ".json",
      "text/plain": ".txt",
    }[m] || ".bin"
  );
}
