// @ts-nocheck — Node ctx adapter for the vendored inscription core.
// The core's write/read functions take a `ctx` describing how to sign and where to read
// (see hcs1.ts). This builds one from a Hedera SDK client: the backend operator signs
// every transaction, so the operator key is the submit key on created topics.
import * as sdk from '@hashgraph/sdk';
import { mirrorJson } from './mirror.js';
import { decompress as fzstdDecompressSync } from './vendor/fzstd.js';
import { compressZstd, decompress } from './compress.js';

export const MAINNET_MIRROR = 'https://mainnet-public.mirrornode.hedera.com';
export const TESTNET_MIRROR = 'https://testnet.mirrornode.hedera.com';

/**
 * Build the ctx the inscription core expects.
 *
 *   client      a Client with the operator already set (operator pays + signs)
 *   operatorKey the operator's private key — becomes the submit key of new topics
 *   mirrorBase  mirror node REST base for read-back verification
 */
export function makeInscribeContext(client, operatorKey, mirrorBase = MAINNET_MIRROR) {
  return {
    sdk,
    /** Sign with the operator and send; resolves to the transaction receipt. */
    async submit(tx) {
      const resp = await tx.execute(client);
      return resp.getReceipt(client);
    },
    /** The public key allowed to write to topics this tool creates. */
    submitKey() {
      return operatorKey.publicKey;
    },
    mirror() {
      return mirrorBase;
    },
    /**
     * zstd-decompress for the core's synchronous read-back verification (verifyTopic).
     * The vendored fzstd decoder is pure JS and synchronous, so this works on any
     * Node version — unlike node:zlib's zstd, which needs Node 22.15+/23.8+.
     */
    decompress(bytes) {
      return fzstdDecompressSync(bytes);
    },
    get: mirrorJson,
    concurrency: 8,
  };
}

export { compressZstd, decompress };
