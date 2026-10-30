// @ts-nocheck — vendored inscription core (HCS-1/HCS-6), source: SLIME new-tools shared/core
// HCS-6: an updatable ("dynamic") piece. Its NFT points at a registry topic (hcs://6/<registry>) instead of at the
// metadata; each "register" message on the registry names an HCS-1 metadata topic, and the latest one is the piece's
// current metadata. Every version stays on-chain. ctx is the same as in hcs1.ts.
import { submitMessage, stopIfPaused, MAX_MSG } from './hcs1';

/** How long viewers may cache the registry, in seconds (part of the memo). */
export const HCS6_TTL = 86400;
/** The memo of a registry topic: "hcs-6:1:86400" (non-indexed registry, TTL). */
export const registryMemo = (ttl = HCS6_TTL) => `hcs-6:1:${ttl}`;
/** The text of a register message making metaTopic the current metadata; memo is a free-text version note. */
export const registerMessage = (metaTopic, memo) => JSON.stringify({ p: 'hcs-6', op: 'register', t_id: metaTopic, m: memo || '' });

/** Create a registry topic (memo registryMemo(), submit key ctx.submitKey(), no admin key) and return its id as a string. */
export async function createRegistry(ctx) {
  stopIfPaused(ctx);
  const S = ctx.sdk;
  const tx = new S.TopicCreateTransaction().setTopicMemo(registryMemo()).setSubmitKey(ctx.submitKey()).setMaxTransactionFee(new S.Hbar(5));
  const rcpt = await ctx.submit(tx);
  return rcpt.topicId.toString();
}

/** The longest version note HCS-2 allows in a register message's "m", in characters. */
export const MAX_NOTE = 500;
/**
 * What is wrong with a version note, or '' when nothing is: more than MAX_NOTE characters, or long enough (in bytes) that the
 * register message would not fit one HCS message. The library would then split it into parts, and HCS-6 viewers read only
 * whole messages, so the piece would stop following its registry. Checked before anything is paid for.
 */
export function noteProblem(memo) {
  const m = String(memo || '');
  if (m.length > MAX_NOTE) return `The version note is ${m.length} characters; HCS-6 allows at most ${MAX_NOTE}.`;
  const bytes = new TextEncoder().encode(registerMessage('0.0.9999999999', m)).length;   // with the longest topic id there can be
  if (bytes > MAX_MSG) return `The version note is too long to fit one Hedera message (${bytes} bytes with the rest of the register message, at most ${MAX_MSG}). Shorten it.`;
  return '';
}

/** Post a register message to registryTopic, making metaTopic the current metadata of the NFT that points at the registry. Refuses a note noteProblem() objects to. */
export async function registerEntry(ctx, registryTopic, metaTopic, memo) {
  stopIfPaused(ctx);
  const problem = noteProblem(memo); if (problem) throw new Error(problem);
  await submitMessage(ctx, registryTopic, registerMessage(metaTopic, memo));
}
