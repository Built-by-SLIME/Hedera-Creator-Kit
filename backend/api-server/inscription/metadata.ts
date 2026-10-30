// @ts-nocheck — vendored inscription core (HCS-1/HCS-6), source: SLIME new-tools shared/core
// NFT metadata (HIP-412) helpers.
import { b64ToBytes, dataToBytes } from "./bytes.js";
import { sniffMime } from "./mime.js";
import { parsePointer } from "./pointer.js";

// Some collections store a picture not as the picture file but as a small JSON file with the picture
// written inside it as a data link: {"photo":"data:image/png;base64,iVBOR…"}. That isn't a standard, so no
// viewer shows it. Given the bytes of a fetched media file, returns { bytes, mime, key } for the file held
// inside, or null when the file isn't such a wrapper. Also accepts a file that is nothing but a data link,
// and a value that is bare base64 of a recognisable picture, video or sound.
export function unwrapJsonData(bytes) {
  if (!bytes || bytes.length < 40) return null;
  const first = bytes[0];
  if (first !== 0x7b && first !== 0x5b && first !== 0x22 && first !== 0x64 && first > 0x20 && first !== 0xef)
    return null; // { [ " d, or leading space
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim();
  } catch {
    return null;
  }
  const open = (value, key) => {
    if (typeof value !== "string" || value.length < text.length * 0.8) return null; // the file must be mostly this one value
    const v = value.trim();
    if (/^data:/i.test(v)) {
      const held = dataToBytes(v);
      return held && held.bytes.length ? { bytes: held.bytes, mime: sniffMime(held.bytes) || held.mime, key } : null;
    }
    if (!/^[A-Za-z0-9+/_=\s-]+$/.test(v)) return null;
    try {
      const raw = b64ToBytes(v.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/"));
      const mime = sniffMime(raw) || "";
      return /^(image|video|audio)\//.test(mime) ? { bytes: raw, mime, key } : null;
    } catch {
      return null;
    }
  };
  if (/^data:/i.test(text)) return open(text, "");
  if (!/^[{\["]/.test(text)) return null;
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const walk = (node, key, depth) => {
    if (typeof node === "string") return open(node, key);
    if (!node || typeof node !== "object" || depth > 3) return null;
    for (const [k, v] of Object.entries(node)) {
      const found = walk(v, Array.isArray(node) ? key : k, depth + 1);
      if (found) return found;
    }
    return null;
  };
  return walk(json, "", 0);
}

/* Show an image straight from a gateway. Every gateway is asked at once with a plain <img>, which
     needs no permission from the gateway (fetch does) and waits for as long as the gateway takes.
     Resolves with the first address that displays, or null when none does within `ms`. */
/* Some minting tools write metadata that isn't quite the standard shape. This puts the common slips right,
     on a copy, so the rest of the resolver can read it as usual (the raw metadata shown is left untouched):
       - a value wrapped in a schema-style object: "image": {"type":"string","description":"https://…"}
       - attributes, properties or files written as a JSON string instead of a list or object */
export function tidyMetadata(json) {
  if (!json || typeof json !== "object" || Array.isArray(json)) return json;
  const out = Object.assign({}, json);
  const unwrap = (v) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return v;
    const keys = Object.keys(v);
    if (keys.length > 3 || typeof v.type !== "string") return v;
    const inner = "value" in v ? v.value : "description" in v ? v.description : undefined;
    return inner !== undefined && typeof inner !== "object" ? inner : v;
  };
  const parse = (v) => {
    if (typeof v !== "string" || !/^\s*[\[{]/.test(v)) return v;
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  };
  Object.keys(out).forEach((k) => (out[k] = unwrap(out[k])));
  ["attributes", "properties", "files", "localization"].forEach((k) => {
    if (k in out) out[k] = parse(out[k]);
  });
  if (out.properties && typeof out.properties === "object" && !Array.isArray(out.properties)) {
    out.properties = Object.assign({}, out.properties);
    Object.keys(out.properties).forEach((k) => (out.properties[k] = parse(unwrap(out.properties[k]))));
  }
  if (Array.isArray(out.files))
    out.files = out.files.map((f) =>
      f && typeof f === "object" ? Object.assign({}, f, { uri: unwrap(f.uri), type: unwrap(f.type) }) : f,
    );
  return out;
}

/**
 * Find a gateway address that a plain <img> can display. Every address in `urls` is tried at the same moment,
 * which needs no permission from the gateway (fetch does). Returns a promise of the first address whose
 * picture loads, or null when all of them fail, the list is empty, or none has loaded within `ms`
 * milliseconds. The other loads are cancelled once there is an answer. Needs a page (it uses Image).
 * `signal` (an AbortSignal, optional) calls the search off: every load still going is cancelled and the
 * promise gives null.
 */
export function findDisplayable(urls, ms, signal?) {
  return new Promise((done) => {
    const probes = [];
    let left = urls.length;
    let over = false;
    const finish = (url) => {
      if (over) return;
      over = true;
      clearTimeout(timer);
      probes.forEach((img, k) => {
        img.onload = img.onerror = null;
        if (urls[k] !== url) img.removeAttribute("src");
      });
      done(url);
    };
    const timer = setTimeout(() => finish(null), ms);
    if (signal) {
      if (signal.aborted) return finish(null);
      signal.addEventListener("abort", () => finish(null), { once: true });
    }
    if (!left) finish(null);
    urls.forEach((url) => {
      const img = new Image();
      probes.push(img);
      img.onload = () => finish(url);
      img.onerror = () => {
        if (--left === 0) finish(null);
      };
      img.src = url;
    });
  });
}

/* fetch() can be refused (CORS, content blockers) where a plain <img>/<video> load is not, so show the file straight from a gateway */
// interim: put up as a preview while the file itself is still being fetched; whatever the fetch
// produces replaces it, so nothing is recorded and a dead end just goes back to "Loading…".
/* A collection's icon when no registry has one: the picture of its first NFT. Returns the addresses an
     <img> can try: gateway addresses for an off-chain picture, or, for an on-chain one, a small copy of
     it as a data link (so it can be remembered between visits). Reads quietly; the popup is not involved. */
// Which of the files a metadata record lists are stored on Hedera: "all", "some" or "none".
export function filesOnHedera(json) {
  const uris = new Set();
  const add = (u) => void ("string" === typeof u && u.trim() && uris.add(u.trim()));
  add(json.image || json.image_uri);
  add(json.animation_url);
  Array.isArray(json.files) && json.files.forEach((f) => f && add(f.uri));
  let on = 0;
  uris.forEach((u) => "hrl" === parsePointer(u).kind && on++);
  return !on ? "none" : on === uris.size ? "all" : "some";
}
