// @ts-nocheck — vendored inscription core (HCS-1/HCS-6), source: SLIME new-tools shared/core
// Live prices from Hedera: the mirror node's fee estimate (POST /api/v1/network/fees). It takes an unsigned
// transaction in Hedera's own binary format (a protobuf `Transaction`) and returns what the network would charge for
// it, base fee and extras itemised, in tinycents (1 USD = 10^10 tinycents). ĦashPress prices a sample of each kind of
// transaction it sends and turns the answers into the same fee table shared/core/fees.ts holds, so every estimate is
// worked out the same way, from live figures when the mirror node gives them and from the table when it does not.
//
// ctx, as in hcs1.ts, plus:
//   ctx.freeze(tx)       the transaction frozen for some payer, as bytes (tx.toBytes() of a frozen transaction)
//   ctx.post(url, bytes) optional: POST the bytes, return the parsed JSON (defaults to fetch); throw on an error status
import { HEDERA_FEES_USD } from './fees.js';

/** Tinycents per US dollar. */
export const TINYCENTS = 1e10;

// read a protobuf varint at `at`: [value, next position]
function varint(bytes, at) {
  let v = 0, shift = 0, b;
  do { b = bytes[at++]; v += (b & 0x7f) * 2 ** shift; shift += 7; } while (b & 0x80 && at < bytes.length);
  return [v, at];
}

/**
 * The first transaction of a frozen transaction's bytes. The Hedera libraries' toBytes() gives a TransactionList (one
 * copy per node the transaction may be sent to, field 1); the fee estimate wants one Transaction. Bytes that are
 * already a single Transaction are returned as they are.
 */
export function firstTransaction(bytes) {
  if (bytes[0] !== 0x0a) return bytes;                 // not field 1 (length-delimited): already a Transaction
  const [len, start] = varint(bytes, 1);
  return bytes.subarray(start, start + len);
}

/** POST bytes as protobuf and return the parsed JSON; throws Error('fee estimate <status>') on an error status. */
async function postProtobuf(url, bytes) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/protobuf', accept: 'application/json' }, body: bytes });
  if (!r.ok) throw new Error('fee estimate ' + r.status);
  return r.json();
}

/**
 * What Hedera says `tx` would cost, in USD: {usd, estimate} where estimate is the mirror node's answer (node, network
 * and service parts with their extras). Priced in the default INTRINSIC mode, from the transaction itself, as the
 * network sees it unsigned; one signature is included in every base fee, so that is what a single-signature transaction
 * pays. Throws when the mirror node cannot answer or the answer makes no sense.
 */
export async function estimateFeeUsd(ctx, tx) {
  const bytes = firstTransaction(ctx.freeze(tx));
  const j = await (ctx.post || postProtobuf)(`${ctx.mirror()}/api/v1/network/fees`, bytes);
  const usd = Number(j && j.total) / TINYCENTS;
  if (!isFinite(usd) || usd < 0) throw new Error('the fee estimate had no usable total');
  return { usd, estimate: j };
}

/**
 * Example transactions of every kind whose price depends on what is in it, built the way ĦashPress builds the real ones:
 * a file's topic, a 100-byte and a full 1,024-byte message, a collection (four keys, a fee schedule key, no royalty),
 * a one-serial mint, and a hand-over setting two keys. `key` is any public key (it is never used to sign), `payer` any
 * account id. Prices of transfers, repoints and royalty changes do not depend on their content and stay in the table.
 */
export function feeSamples(S, { key, payer }) {
  const topic = S.TopicId.fromString('0.0.1001'), token = S.TokenId.fromString('0.0.1002'), acct = S.AccountId.fromString(payer);
  return {
    topic: new S.TopicCreateTransaction().setTopicMemo('0'.repeat(64) + ':zstd:base64').setSubmitKey(key).setMaxTransactionFee(new S.Hbar(5)),
    msgSmall: new S.TopicMessageSubmitTransaction().setTopicId(topic).setMessage('x'.repeat(100)).setMaxTransactionFee(new S.Hbar(1)),
    msgFull: new S.TopicMessageSubmitTransaction().setTopicId(topic).setMessage('x'.repeat(1024)).setMaxTransactionFee(new S.Hbar(1)),
    collection: new S.TokenCreateTransaction().setTokenName('Price check').setTokenSymbol('PRICE').setTokenType(S.TokenType.NonFungibleUnique)
      .setSupplyType(S.TokenSupplyType.Infinite).setTreasuryAccountId(acct).setAdminKey(key).setSupplyKey(key).setMetadataKey(key).setFeeScheduleKey(key)
      .setMaxTransactionFee(new S.Hbar(200)),
    mint: new S.TokenMintTransaction().setTokenId(token).setMetadata([new TextEncoder().encode('hcs://6/0.0.1234567')]).setMaxTransactionFee(new S.Hbar(20)),
    handOver: new S.TokenUpdateTransaction().setTokenId(token).setSupplyKey(key).setMetadataKey(key).setMaxTransactionFee(new S.Hbar(5)),
  };
}

/**
 * Price the samples (in parallel) and turn the answers into fee-table figures: topic, msg, msgByte, tokenCreate, mint
 * and tokenUpdate, worked back through the same base-plus-extras rules fees.ts applies, so the table's formulas give
 * exactly the live prices. `table` supplies the rules' other figures (key, customFeesExtra). Throws if any sample cannot
 * be priced, or if the answers are not plausible (a price that is negative, or messages that get cheaper with size).
 */
export async function liveFeeTable(ctx, samples, table = HEDERA_FEES_USD) {
  const names = Object.keys(samples);
  const usd = Object.fromEntries(await Promise.all(names.map(async (n) => [n, (await estimateFeeUsd(ctx, samples[n])).usd])));
  const out = {
    topic: usd.topic,
    msg: usd.msgSmall,
    msgIncludedBytes: 100,
    msgByte: (usd.msgFull - usd.msgSmall) / (1024 - 100),
    tokenCreate: usd.collection - table.customFeesExtra - 3 * table.key,   // the sample has four keys and a fee schedule key
    mint: usd.mint,
    tokenUpdate: usd.handOver - table.key,                                 // the sample sets two keys
  };
  for (const [k, v] of Object.entries(out)) if (!isFinite(v) || v < 0) throw new Error(`the mirror node's price for ${k} does not make sense (${v})`);
  return { fees: out, prices: usd };
}
