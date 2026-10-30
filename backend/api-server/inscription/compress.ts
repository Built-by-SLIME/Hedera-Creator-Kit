// @ts-nocheck — backend adaptation of shared/core/compress.ts
// zstd via @mongodb-js/zstd, gzip/deflate via node:zlib. The browser build used
// DecompressionStream + a vendored fzstd; topic bytes on Hedera are identical either way.
import { inflateSync } from 'node:zlib';

// @mongodb-js/zstd is a NATIVE module. It is required lazily, inside the
// functions, so a missing/mismatched prebuilt binary can never crash server
// boot — worst case, inscription endpoints fail with a clear error while the
// rest of the API (minting, domains, staking, viewers) stays up.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const zstdLib = () => require('@mongodb-js/zstd');

/** Not needed on the server: the zstd library is imported, not fetched. */
export const loadZstd = () => Promise.resolve();

// An HCS-1 topic memo reads "<sha-256 of the original file>:<compression>:<encoding>", e.g. "…:brotli:base64".
export function memoAlgo(memo) {
  const parts = String(memo || '').split(':');
  return /^[0-9a-f]{64}$/i.test(parts[0]) ? (parts[1] || '').toLowerCase() : '';
}

/**
 * Decompress an inscribed file. `fmt` is a compression name from a topic memo
 * ("zstd", "gzip", "deflate", "deflate-raw", "brotli", "" = none).
 * Brotli on Node < 24 has no built-in decoder and is not supported here: those
 * rare topics fail with a clear error rather than silent corruption.
 */
export async function decompress(bytes, fmt) {
  switch (String(fmt || '').toLowerCase()) {
    case '':
    case 'none':
      return bytes;
    case 'zstd':
      return new Uint8Array(await zstdLib().decompress(bytes));
    case 'gzip':
      return new Uint8Array(inflateSync(bytes));
    case 'deflate':
      return new Uint8Array(inflateSync(bytes));
    case 'deflate-raw':
      return new Uint8Array(inflateSync(bytes, { finishFlush: 2 /* Z_SYNC_FLUSH */ }));
    default:
      throw new Error(`Unsupported compression: ${fmt}`);
  }
}

/**
 * zstd-compress a file for inscription. The browser tool used level 19; matched
 * here so compressed sizes (and therefore chunk counts and fee estimates) agree.
 */
export async function compressZstd(bytes, level = 19) {
  return new Uint8Array(await zstdLib().compress(bytes, level));
}
