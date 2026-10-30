// @ts-nocheck — vendored inscription core (HCS-1/HCS-6), source: SLIME new-tools shared/core
// What an NFT serial points at (its 100-byte metadata field). ctx is the same as in hcs1.ts.
import { stopIfPaused } from './hcs1';

/** The pointer stored in a serial: hcs://1/<metadata topic> for a fixed piece, hcs://6/<registry> for an updatable one. */
export const pointerFor = ({ metaTopic, registryTopic }) => (registryTopic ? `hcs://6/${registryTopic}` : `hcs://1/${metaTopic}`);

/**
 * HIP-657: repoint one serial's metadata to `pointer` (e.g. "hcs://1/0.0.x" or "ipfs://…"). The collection must have a
 * metadata key, held by whoever ctx.submit signs as. Throws if the pointer is over 100 bytes.
 */
export async function updateSerialMetadata(ctx, tokenId, serial, pointer) {
  stopIfPaused(ctx);
  const S = ctx.sdk;
  const bytes = new TextEncoder().encode(pointer);
  if (bytes.length > 100) throw new Error('NFT metadata pointer exceeds 100 bytes.');
  await ctx.submit(new S.TokenUpdateNftsTransaction().setTokenId(S.TokenId.fromString(tokenId)).setSerialNumbers([Number(serial)]).setMetadata(bytes).setMaxTransactionFee(new S.Hbar(5)));
}
