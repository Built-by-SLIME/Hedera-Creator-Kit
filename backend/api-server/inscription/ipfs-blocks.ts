// @ts-nocheck — vendored inscription core (HCS-1/HCS-6), source: SLIME new-tools shared/core
// Rebuilding an IPFS file from its raw blocks (CAR / dag-pb / UnixFS), each block checked against its hash.
import { BLOCK_GATEWAYS, CAR_GATEWAY, finalError, gatewayRefusal, subdomainCid } from "./ipfs-gateways.js";

/* ---- folder pointers ---- */
// When a pointer names an IPFS folder, a gateway answers with a web page listing the folder.
// Returns the file names in that listing, or null when the bytes aren't such a page.
export function folderNames(bytes) {
  if (!bytes || bytes.length < 60) return null;
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 3000));
  if (!/<title>[^<]*\/ip[fn]s\/|Index of\s+\/ip[fn]s\//i.test(head)) return null;
  const html = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const names = new Set();
  for (const m of html.matchAll(/href="([^"]+)"/gi)) {
    const href = m[1].replace(/&amp;/g, "&");
    const named = href.match(/[?&]filename=([^&#]+)/);
    let name = "";
    if (named) name = named[1];
    else {
      const path = href.split(/[?#]/)[0];
      const inFolder = path.match(/\/ip[fn]s\/[^/]+\/(.+)$/);
      if (inFolder) name = inFolder[1].replace(/\/+$/, "").split("/").pop();
      else if (!/^([a-z][a-z0-9+.-]*:|\/\/|#|\/ip[fn]s\/)/i.test(path))
        name = path.replace(/\/+$/, "").split("/").pop();
    }
    try {
      name = decodeURIComponent(name);
    } catch {}
    if (name && name !== ".." && name !== ".") names.add(name);
  }
  return [...names];
}

// Which file in a folder belongs to this serial: "76.json", "76", "metadata.json", then a single file
// whose name carries the number ("UTU #0076.json"), then the folder's only JSON file. "" when unsure.
export function pickFromFolder(names, serial) {
  const s = String(serial);
  for (const exact of [s + ".json", s, "metadata.json"]) if (names.includes(exact)) return exact;
  const number = new RegExp("(^|\\D)0*" + s + "(\\D|$)");
  const numbered = names.filter(
    (n) => (/\.json$/i.test(n) || !/\.[a-z0-9]{2,5}$/i.test(n)) && number.test(n.replace(/\.json$/i, "")),
  );
  if (numbered.length === 1) return numbered[0];
  const jsons = names.filter((n) => /\.json$/i.test(n));
  return jsons.length === 1 ? jsons[0] : "";
}

// The largest file, in bytes, that ipfsFromBlocks will put together (300 MB); a bigger one is refused.
export const BLOCK_FILE_LIMIT = 300 * 1024 * 1024;

// The 32 characters of lower-case base32 (RFC 4648) in value order, as used in IPFS ids that start with "b".
export const B32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

/**
 * Decode lower-case base32 text without padding into a Uint8Array. For an IPFS id, pass the text after its
 * leading "b". Throws Error("unreadable id") on any character outside B32_ALPHABET.
 */
export function b32ToBytes(text) {
  const out = [];
  let bits = 0;
  let acc = 0;
  for (const ch of text) {
    const v = B32_ALPHABET.indexOf(ch);
    if (v < 0) throw new Error("unreadable id");
    acc = (acc << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((acc >> (bits - 8)) & 255);
      bits -= 8;
      acc &= (1 << bits) - 1;
    }
  }
  return new Uint8Array(out);
}

/**
 * Encode bytes as lower-case base32 text without padding. The opposite of b32ToBytes.
 */
export function bytesToB32(bytes) {
  let out = "";
  let bits = 0;
  let acc = 0;
  for (const byte of bytes) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(acc >> (bits - 5)) & 31];
      bits -= 5;
    }
    acc &= (1 << bits) - 1;
  }
  if (bits) out += B32_ALPHABET[(acc << (5 - bits)) & 31];
  return out;
}

// A number as protobuf and CAR files write it. Returns [value, next position].
export function readVarint(buf, pos) {
  let value = 0;
  let scale = 1;
  for (let n = 0; n < 8; n++) {
    if (pos >= buf.length) throw new Error("cut short");
    const b = buf[pos++];
    value += (b & 127) * scale;
    if (!(b & 128)) return [value, pos];
    scale *= 128;
  }
  throw new Error("number too long");
}

// An id as it sits inside a block or a CAR file -> { codec, mh (the hash part), next position }
export function cidAt(buf, pos) {
  if (0x12 === buf[pos] && 0x20 === buf[pos + 1]) return { codec: 0x70, mh: buf.slice(pos, pos + 34), pos: pos + 34 }; // old-style id
  let version, codec, len;
  [version, pos] = readVarint(buf, pos);
  if (1 !== version) throw new Error("unknown id version");
  [codec, pos] = readVarint(buf, pos);
  const start = pos;
  [, pos] = readVarint(buf, pos);
  [len, pos] = readVarint(buf, pos);
  if (pos + len > buf.length) throw new Error("cut short");
  return { codec, mh: buf.slice(start, pos + len), pos: pos + len };
}

/**
 * The hash part of an id (the `mh` bytes cidAt returns) as a lower-case hex string, used as the key in the
 * Map of blocks carBlocks returns.
 */
export const mhKey = (mh) => Array.from(mh, (b: any) => b.toString(16).padStart(2, "0")).join("");

/**
 * Write an id back out as text in the newer form ("b" followed by base32, version 1).
 * `cid` is { codec, mh } as returned by cidAt. Returns the string a gateway accepts after /ipfs/.
 */
export function cidText(cid) {
  const codec = [];
  for (let c = cid.codec; ; c = Math.floor(c / 128)) {
    codec.push(c < 128 ? c : (c % 128) | 128);
    if (c < 128) break;
  }
  return "b" + bytesToB32(Uint8Array.from([1, ...codec, ...cid.mh]));
}

// Protobuf, as far as IPFS uses it: a list of [field number, value], value a number or bytes.
export function pbFields(buf) {
  const out = [];
  let pos = 0;
  while (pos < buf.length) {
    let key, value, len;
    [key, pos] = readVarint(buf, pos);
    const wire = key % 8;
    if (0 === wire) {
      [value, pos] = readVarint(buf, pos);
      out.push([Math.floor(key / 8), value]);
    } else if (2 === wire) {
      [len, pos] = readVarint(buf, pos);
      if (pos + len > buf.length) throw new Error("cut short");
      out.push([Math.floor(key / 8), buf.subarray(pos, pos + len)]);
      pos += len;
    } else throw new Error("not a file block");
  }
  return out;
}

// A dag-pb block -> { links: [{ cid, name }], type (1 folder, 2 file, 5 split-up folder), inline (bytes held in the block itself) }
export function pbNode(bytes) {
  const links = [];
  let data = null;
  for (const [field, value] of pbFields(bytes)) {
    if (!(value instanceof Uint8Array)) continue;
    if (2 === field) {
      const link: any = { name: "" };
      for (const [f, v] of pbFields(value)) {
        if (1 === f && v instanceof Uint8Array) link.cid = cidAt(v, 0);
        else if (2 === f && v instanceof Uint8Array) link.name = new TextDecoder().decode(v);
      }
      link.cid && links.push(link);
    } else if (1 === field) data = value;
  }
  let type = -1;
  let inline = null;
  if (data)
    for (const [f, v] of pbFields(data)) {
      if (1 === f && !(v instanceof Uint8Array)) type = v;
      else if (2 === f && v instanceof Uint8Array) inline = v;
    }
  return { links, type, inline };
}

// A CAR archive -> Map of hash -> { cid, bytes }
export function carBlocks(buf) {
  let [len, pos] = readVarint(buf, 0);
  if (len > 4096 || pos + len > buf.length) throw new Error("not a block archive");
  pos += len;
  const blocks = new Map();
  while (pos < buf.length) {
    [len, pos] = readVarint(buf, pos);
    const end = pos + len;
    if (end > buf.length) break; // the download was cut short: the missing blocks are asked for one by one
    const cid = cidAt(buf, pos);
    blocks.set(mhKey(cid.mh), { cid, bytes: buf.subarray(cid.pos, end) });
    pos = end;
  }
  return blocks;
}

// cidPath: "<id>" or "<id>/folder/file.png". Returns the file's bytes.
export async function ipfsFromBlocks(cidPath, signal) {
  const cut = cidPath.search(/[?#]/);
  const parts = (cut < 0 ? cidPath : cidPath.slice(0, cut)).split("/").filter(Boolean);
  const rootText = subdomainCid(parts[0] || "");
  if (!rootText) throw finalError("unreadable id");
  const root = cidAt(b32ToBytes(rootText.slice(1)), 0);
  const path = parts.slice(1).map((seg) => {
    try {
      return decodeURIComponent(seg);
    } catch {
      return seg;
    }
  });
  const opts: RequestInit = { signal, mode: "cors", credentials: "omit", referrerPolicy: "no-referrer" };
  let blocks = new Map();
  let carError = null;
  try {
    const res = await fetch(
      `${CAR_GATEWAY}/ipfs/${rootText}${path.map((seg) => "/" + encodeURIComponent(seg)).join("")}?format=car&dag-scope=entity`,
      opts,
    );
    if (!res.ok) throw gatewayRefusal(res);
    blocks = carBlocks(new Uint8Array(await res.arrayBuffer()));
  } catch (err) {
    if (signal && signal.aborted) throw err;
    carError = err;
  }
  const checked = new Set();
  const matches = async (mh, bytes) => {
    if (0x12 !== mh[0] || !(globalThis.crypto && crypto.subtle)) return true; // only SHA-256 ids can be checked here
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    return digest.every((b, i) => b === mh[i + 2]);
  };
  const block = async (cid) => {
    if (0 === cid.mh[0]) return cid.mh.subarray(2); // a tiny piece written into the id itself
    const key = mhKey(cid.mh);
    const held = blocks.get(key);
    if (held) {
      if (!checked.has(key)) {
        if (!(await matches(cid.mh, held.bytes))) throw finalError("a block didn't match its id");
        checked.add(key);
      }
      return held.bytes;
    }
    let last = carError;
    for (const base of BLOCK_GATEWAYS) {
      try {
        const res = await fetch(`${base}/ipfs/${cidText(cid)}?format=raw`, opts);
        if (!res.ok) throw gatewayRefusal(res);
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (!(await matches(cid.mh, bytes))) throw finalError("a block didn't match its id");
        blocks.set(key, { cid, bytes });
        checked.add(key);
        return bytes;
      } catch (err) {
        if (signal && signal.aborted) throw err;
        last = last || err;
      }
    }
    throw last || new Error("a block couldn't be fetched");
  };
  // the path, one folder at a time
  let at = root;
  for (const seg of path) {
    if (0x70 !== at.codec) throw finalError("the path runs through something that isn't a folder");
    const find = async (cid, depth) => {
      const node = pbNode(await block(cid));
      if (1 === node.type) return (node.links.find((l) => l.name === seg) || {}).cid || null;
      if (5 !== node.type || depth > 8) return null;
      // a split-up folder: entries are named "<2 characters><file name>", sub-folders of the split just "<2 characters>"
      const hit = node.links.find((l) => l.name.length > 2 && l.name.slice(2) === seg);
      if (hit) return hit.cid;
      for (const l of node.links)
        if (2 === l.name.length && blocks.has(mhKey(l.cid.mh))) {
          const deeper = await find(l.cid, depth + 1);
          if (deeper) return deeper;
        }
      return null;
    };
    at = await find(at, 0);
    if (!at) throw carError || finalError("no such file in that folder");
  }
  // the file itself
  let total = 0;
  const gather = async (cid, depth) => {
    const bytes = await block(cid);
    if (0x70 !== cid.codec) return [bytes];
    const node = pbNode(bytes);
    if (1 === node.type || 5 === node.type) throw finalError("it is a folder, not a file");
    if (!node.links.length) return [node.inline || new Uint8Array(0)];
    if (depth > 12) throw finalError("the file is nested too deeply");
    const pieces = new Array(node.links.length);
    let next = 0;
    const worker = async () => {
      while (next < node.links.length) {
        const i = next++;
        pieces[i] = await gather(node.links[i].cid, depth + 1);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    return pieces.flat();
  };
  const pieces = await gather(at, 0);
  for (const p of pieces) total += p.length;
  if (total > BLOCK_FILE_LIMIT) throw finalError("the file is too large to put together in a page");
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of pieces) (out.set(p, pos), (pos += p.length));
  return out;
}
