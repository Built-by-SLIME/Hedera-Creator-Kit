// @ts-nocheck — vendored inscription core (HCS-1/HCS-6), source: SLIME new-tools shared/core
// What Hedera charges, in US dollars, and how ĦashPress estimates its transactions from it.
//
// Hedera prices every transaction in USD and takes the HBAR equivalent at its own exchange rate (the mirror node's
// /api/v1/network/exchangerate), so estimates are made in USD and converted with that same rate. Since HIP-1261
// ("simple fees") a fee is a BASE FEE PLUS EXTRAS: each extra (keys, message bytes, custom fees...) has an included
// count covered by the base fee, and units above it cost extra. The functions below apply the extras that matter here.
//
// THESE FIGURES ARE COPIED BY HAND from Hedera's published fees and must be kept up to date here:
//   https://docs.hedera.com/networks/fees                  base fees and the price of each extra
//   https://docs.hedera.com/learn/core-concepts/fee-model   which extras apply, and how many are included
// (last checked: see FEES_CHECKED). Hedera can change them at any time. A site can also override any of them without
// rebuilding, in config/hashpress.config.js:   window.HASHPRESS_CONFIG = { feesUsd: { msgByte: 0.00000068 } }

/** The date the figures below were last compared with Hedera's fee pages. */
export const FEES_CHECKED = '2026-10-13';

/** Hedera's fees, in USD, for what ĦashPress sends. Base fees first, then the extras it can incur. */
export const HEDERA_FEES_USD = Object.freeze({
  // base fees
  topic: 0.01,                 // ConsensusCreateTopic: one per inscribed file (and per HCS-6 registry); one key included
  msg: 0.0008,                 // ConsensusSubmitMessage: covers the first msgIncludedBytes of the message
  tokenCreate: 1.0,            // TokenCreate: a new collection; one key included
  mint: 0.02,                  // TokenMint, one NFT
  tokenUpdate: 0.001,          // TokenUpdate: handing minting control to a wallet; one key included
  nftUpdate: 0.001,            // TokenUpdateNfts, one serial (repointing it)
  feeSchedule: 0.001,          // TokenFeeScheduleUpdate: changing the royalty
  transfer: 0.001,             // moving NFTs of a collection without custom fees (one transaction carries up to SEND_BATCH)
  transferCustomFees: 0.002,   // the same for a collection with custom fees (a royalty)
  hbarTransfer: 0.0001,        // CryptoTransfer of HBAR only: returning what is left of a session's HBAR
  autoCreate: 0.05,            // the account Hedera creates on the first transfer to a new address, charged to the sender
  // extras
  msgIncludedBytes: 100,       // message bytes covered by `msg`
  msgByte: 0.00000068,         // each message byte beyond those (a full 1 KB chunk: about $0.0014 in all)
  key: 0.01,                   // each key set beyond the first, when creating or updating a topic or token
  customFeesExtra: 1.0,        // TokenCreateWithCustomFee: added to TokenCreate when the collection has custom fees OR a
                               // fee schedule key. ĦashPress always sets a fee schedule key (so the royalty can be changed
                               // later in step 5), so every collection it creates pays this, with or without a royalty
  // A wallet receiving an NFT of a token it has not associated, into an automatic association slot, is associated by
  // that transfer, and the sender pays for it: measured on testnet on 27 October 2026, the first NFT sent to such a
  // wallet cost $0.051 against $0.001 for a transfer alone. Counted once per send (a send moves one token).
  autoAssociate: 0.05,
});

/**
 * The fee table to estimate with: HEDERA_FEES_USD, then `live` figures from the mirror node's fee estimate (see
 * fee-estimate.ts) laid over it, then a site's own `overrides` over those. Each is an object like HEDERA_FEES_USD (any
 * subset); names it does not know and values that are not numbers of 0 or more are ignored.
 */
export function feesWith(overrides, live?) {
  const out = { ...HEDERA_FEES_USD };
  for (const layer of [live, overrides]) for (const [k, v] of Object.entries(layer || {})) if (k in out && typeof v === 'number' && isFinite(v) && v >= 0) out[k] = v;
  return out;
}

/** UTF-8 length of a message (a string or bytes). */
const byteLength = (m) => (typeof m === 'string' ? new TextEncoder().encode(m).length : m.length);

/**
 * What topic messages cost. `messages` is either the messages themselves (strings or bytes), or a count, in which
 * case each is taken as a full 1,024-byte chunk (the most a message can be). `bytes` may be given instead of the
 * messages when only their total size is known.
 */
export function messagesUsd(fees, messages, bytes?) {
  const n = typeof messages === 'number' ? messages : messages.length;
  const total = bytes != null ? bytes : typeof messages === 'number' ? n * 1024 : messages.reduce((a, m) => a + byteLength(m), 0);
  return n * fees.msg + Math.max(0, total - n * fees.msgIncludedBytes) * fees.msgByte;
}

/** The keys ĦashPress sets on a new collection: admin, supply and fee schedule, and metadata unless switched off. */
export const collectionKeys = (tokenOpts) => 3 + (tokenOpts && tokenOpts.metadataKey === false ? 0 : 1);

/**
 * What creating a collection costs, the way ĦashPress creates it: the base fee, plus the custom-fees extra (it always
 * has a fee schedule key, royalty or not), plus a key fee for each key beyond the first.
 */
export function collectionCreateUsd(fees, tokenOpts) {
  return fees.tokenCreate + fees.customFeesExtra + Math.max(0, collectionKeys(tokenOpts) - 1) * fees.key;
}

/** What one NFT transfer transaction costs: more when the collection carries a royalty (custom fees). null royalty = not known (assume it does). */
export function nftTransferUsd(fees, hasRoyalty) {
  return hasRoyalty === false ? fees.transfer : fees.transferCustomFees;
}

/** What handing minting control to a wallet costs: one token update setting the supply key, and the metadata key too unless switched off. */
export function handOverUsd(fees, tokenOpts) {
  const keys = 1 + (tokenOpts && tokenOpts.metadataKey === false ? 0 : 1);
  return fees.tokenUpdate + Math.max(0, keys - 1) * fees.key;
}

/** How many serials one transfer transaction carries when a whole collection is sent to a wallet. */
export const SEND_BATCH = 8;

/**
 * What step 5 costs after minting: handing minting control to the wallet (handOver), sending `serials` NFTs to it in
 * transactions of SEND_BATCH (send), returning the leftover HBAR (ret, only for a session key) and the association
 * (assoc, charged to the sender: see autoAssociate). tokenOpts are the collection's options; hasRoyalty null = unknown.
 */
export function afterMintUsd(fees, { serials = 1, handOver = true, returnHbar = true, tokenOpts = null, hasRoyalty = null } = {}) {
  const parts = {
    handOver: handOver ? handOverUsd(fees, tokenOpts) : 0,
    send: Math.ceil(serials / SEND_BATCH) * nftTransferUsd(fees, hasRoyalty),
    ret: returnHbar ? fees.hbarTransfer : 0,
    assoc: fees.autoAssociate,
  };
  return { ...parts, total: parts.handOver + parts.send + parts.ret + parts.assoc };
}

/** Whether a collection made with these options carries a royalty (null when the options are not known yet). */
export const hasRoyalty = (tokenOpts) => (tokenOpts ? Number(tokenOpts.royaltyPct) > 0 : null);
