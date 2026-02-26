# Hedera Creator Kit — Changelog

All notable changes to this project are documented here.

---

## [Unreleased]

### Fixed — Airdrop Tool (Tool #9)

#### 🐛 BUG FIX: Fungible token batch size too large — TOKEN_TRANSFER_LIST_SIZE_LIMIT_EXCEEDED (CRITICAL)
**File:** `frontend/src/components/AirdropTool.ts` ~line 629
**Symptom:** First batch of a multi-batch fungible airdrop silently failed on-chain with `TOKEN_TRANSFER_LIST_SIZE_LIMIT_EXCEEDED`. App incorrectly reported all recipients as sent.
**Root Cause:** Hedera limits CryptoTransfer to max 10 fungible token balance adjustments. The SDK aggregates repeated `addTokenTransfer()` calls for the same (token, account) pair into a single entry — so 10 recipients produces 1 aggregated sender debit + 10 recipient credits = 11 adjustments, exceeding the limit.
**Confirmed via:** Hedera docs ("max 10 token fungible balance adjustments across all tokenTransferList's") and SDK source (`AbstractTokenTransferTransaction._addTokenTransfer` linear scan + `amount.add(value)` merge).
**Fix:** Reduced fungible `BATCH_SIZE` from `10` to `9` (1 sender + 9 recipients = 10 adjustments, exactly at the protocol limit). NFT batch remains at 10 (uses separate `nftTransfers` list with its own 10-transfer limit).
```typescript
// Before:
const BATCH_SIZE = 10

// After:
const BATCH_SIZE = tokenType === 'NFT' ? 10 : 9
```

---

#### 🐛 BUG FIX: Failed transactions reported as success — no on-chain receipt verification (CRITICAL)
**File:** `frontend/src/components/AirdropTool.ts` ~line 672
**Symptom:** A batch that failed on-chain (e.g. `TOKEN_TRANSFER_LIST_SIZE_LIMIT_EXCEEDED`) was still marked as "✓ Sent" for all recipients. The success screen showed "13 of 13 sent" when only 3 actually received tokens.
**Root Cause:** `executeWithSigner()` resolves when HashPack returns a signed response — before consensus. On-chain failures are only known at consensus time. The code marked all recipients as success immediately after the wallet approved, without waiting for or checking the on-chain result.
**Fix:** Added `txResponse.getReceipt(getHederaClient())` call after `executeWithSigner()`. `getReceipt()` waits for consensus and throws if status is not `SUCCESS`, which triggers the existing catch block to mark the batch as failed.
```typescript
// After executeWithSigner():
const receipt = await txResponse.getReceipt(getHederaClient())
if (receipt.status.toString() !== 'SUCCESS') {
  throw new Error(`Transaction failed on-chain: ${receipt.status}`)
}
// Only reaches here if confirmed successful on-chain
batch.forEach(r => { r.status = 'success'; this.successCount++ })
```

---

#### 🐛 BUG FIX: NFT batch logic groups by recipient count instead of serial count
**File:** `frontend/src/components/AirdropTool.ts` ~line 629
**Symptom:** Multi-serial NFT airdrops (e.g. 5 recipients × 3 serials each) would silently exceed Hedera's 10-NFT-transfer limit per transaction, causing `TOKEN_TRANSFER_LIST_SIZE_LIMIT_EXCEEDED` failures.
**Root Cause:** Batch loop used `BATCH_SIZE = 10` counted recipients, not serials. Each unique serial is 1 NFT ownership change (confirmed via SDK source — no aggregation for `_nftTransfers`). The limit is 10 total serials per transaction regardless of recipient count.
**Confirmed via:** Hedera docs ("max 10 NFT ownership changes across all tokenTransferList's") and SDK source (`AbstractTokenTransferTransaction._addNftTransfer` — deduplicates only by serial number, each serial is its own entry).
**Fix:** Replaced fixed-count loop with cumulative serial counter. Recipients are added to the current batch until adding the next would push total serials over 10, then a new batch starts. Added pre-flight guard that rejects any single recipient assigned more than 10 serials (which can never fit in one transaction).
```typescript
// NFT batch building — groups by serial count, not recipient count
for (const recipient of pendingRecipients) {
  const serialCount = (recipient.serialNumbers || []).length
  if (serialCount > 10) { alert(...); return }
  const last = batches[batches.length - 1]
  const lastCount = last ? last.reduce((n, r) => n + (r.serialNumbers?.length || 0), 0) : 0
  if (!last || lastCount + serialCount > 10) {
    batches.push([recipient])
  } else {
    last.push(recipient)
  }
}
```

---

### Fixed — Add Liquidity (Tool #6)

#### 🐛 BUG FIX: Token allowance not confirmed before contract call — "Safe token transfer failed!" (CRITICAL)
**File:** `frontend/src/components/AddLiquidity.ts` ~line 1028 & ~line 1048
**Symptom:** HTS/HTS pool liquidity addition failed with "Safe token transfer failed!" in HashPack. Mirror Node showed Token A allowance confirmed on-chain, but Token B allowance (`CRYPTOAPPROVEALLOWANCE`) never appeared — it was never submitted.
**Root Cause:** `executeWithSigner()` resolves when the user approves in the wallet (WalletConnect layer), not when the transaction reaches consensus. The 2-second `setTimeout` was insufficient — Token B's allowance approval would fire before Token A was fully confirmed, and the contract call could proceed before either allowance was valid on-chain.
**Confirmed via:** Mirror Node query of all transactions from tester account in a narrow time window showed only 1 `CRYPTOAPPROVEALLOWANCE` (Token A), with Token B's never appearing.
**Fix:** Replaced both `setTimeout` sleeps with `getReceipt(client)` calls, which block until consensus and throw on non-SUCCESS status:
```typescript
// Before:
await approveTxA.executeWithSigner(signer);
await new Promise(r => setTimeout(r, 2000));
// ...
await approveTxB.executeWithSigner(signer);
await new Promise(r => setTimeout(r, 2000));

// After:
const approveResponseA = await approveTxA.executeWithSigner(signer);
await approveResponseA.getReceipt(client);
// ...
const approveResponseB = await approveTxB.executeWithSigner(signer);
await approveResponseB.getReceipt(client);
```

---



#### 🐛 BUG FIX: Mirror Node transaction ID format (CRITICAL)
**File:** `frontend/src/components/AddLiquidity.ts` ~line 1072
**Symptom:** All Mirror Node transaction verification calls returned 404, causing "Transaction could not be confirmed" error even when the transaction succeeded on-chain.
**Root Cause:** The regex `replace(/\./g, '-')` was replacing ALL dots in the transaction ID, including the dots in the account ID portion (`0.0.`). This produced `0-0-10022142-1771871096-841965788` instead of the correct `0.0.10022142-1771871096-841965788`.
**Fix:** Changed regex to only replace the final dot (before nanoseconds):
```typescript
// Before (WRONG):
const mirrorTxId = this.txId.replace('@', '-').replace(/\./g, '-');

// After (CORRECT):
const mirrorTxId = this.txId.replace('@', '-').replace(/\.(\d+)$/, '-$1');
```

---

#### 🐛 BUG FIX: Gas limit for existing pool liquidity additions too low
**File:** `frontend/src/components/AddLiquidity.ts` ~line 992 & ~line 1021
**Symptom:** Contract revert errors when adding liquidity to existing pools.
**Root Cause:** Gas limit for existing pools was set to 400,000. SaucerSwap V1 documentation explicitly recommends 3,200,000 gas for liquidity operations.
**Fix:** Increased existing pool gas limit from 400,000 → 3,200,000 (matching SaucerSwap docs).
```typescript
// Before:
gasLimit = isNewPool ? 5_000_000 : 400_000;

// After:
gasLimit = isNewPool ? 5_000_000 : 3_200_000;
```

---

#### 🐛 BUG FIX: No guard for zero pool creation fee on new pools
**File:** `frontend/src/components/AddLiquidity.ts` ~line 979
**Symptom:** If the Mirror Node exchange rate fetch failed silently, the pool creation fee would default to 0 tinybar. The contract call would then be sent without the required ~$50 HBAR creation fee, guaranteeing a contract revert with no clear user feedback.
**Fix:** Added explicit pre-flight check before the contract call:
```typescript
if (isNewPool && this.poolCreationFeeTinybar === 0) {
  throw new Error('Could not calculate pool creation fee. Please refresh and try again.');
}
```

---

## Investigation Notes

### Session: Add Liquidity Contract Revert Debug
**Date:** 2026-02-23
**Symptoms reported:**
- "Transaction could not be confirmed. Check HashScan for status: 0.0.10022142@1771871096.841965788"
- Mirror Node polling returning 404 on every attempt (8 attempts × 3s = 24s timeout)
- Console URL showed: `transactions/0-0-10022142-1771871096-841965788` (wrong format)

**Console log analysis:**
- Pool creation fee calculated correctly: $50 USD = 525.85 HBAR = 52,585,451,358 tinybar ✓
- Payable amount: 625.85 HBAR (100 HBAR liquidity + 525.85 HBAR fee) ✓
- Token A EVM address: `0x00000000000000000000000000000000009d15b3` ✓
- Recipient EVM address: `0x000000000000000000000000000000000098ecfe` ✓
- Parameters order matches SaucerSwap V1 `addLiquidityETHNewPool` signature ✓
- 404 on SaucerSwap `/tokens/0.0.10294707` — token has no price data yet (non-fatal, handled correctly) ✓

**Root cause confirmed:** Mirror Node transaction ID format bug (Bug #1 above). All 404 errors trace back to this single regex mistake.

**Status after fixes:** Partially resolved — Mirror Node fix confirmed working. Contract now reached but reverted. See next session.

---

### Session 2: CONTRACT_REVERT_EXECUTED / Safe Multiple Associations
**Date:** 2026-02-23
**Symptoms reported:**
- Wallet (HashPack) shows: "Safe multiple associations failed!"
- App shows: "Transaction failed on-chain: CONTRACT_REVERT_EXECUTED"
- Mirror Node now returning results correctly (previous fix confirmed working)
- Still seeing 3× 404s before result (normal — Mirror Node indexing delay ~9s)

**Mirror Node transaction record fetched:**
```
Parent: CONTRACT_REVERT_EXECUTED — CONTRACTCALL to 0.0.3045981
Child:  INSUFFICIENT_GAS — TOKENASSOCIATE (nonce=1)
```

**Root cause confirmed:** Gas exhaustion. The child TOKENASSOCIATE transaction (LP token association via HTS precompile) is failing with `INSUFFICIENT_GAS`. The `addLiquidityETHNewPool` path deploys a new pair contract AND makes multiple HTS precompile calls (token associations, transfers, LP mint), consuming more than 5,000,000 gas before reaching the LP token association step.

**Fix applied:** Increased new pool gas limit from 5,000,000 → 15,000,000 (Hedera mainnet maximum).

**Status:** Deployed to Railway. Pending re-test.

---

### Session 3: HTS/HTS new pool — INSUFFICIENT_PAYER_BALANCE + DAppSigner crash
**Date:** 2026-02-23
**Symptoms reported:**
- App error: `"Error executing transaction or query: {"txError":{"message":{"_code":10}},"queryError":{"name":"Error","message":"(BUG) Query.fromBytes() not implemented for type getByKey"}}`
- HashPack wallet also surfaced a payer balance warning
- Stack trace: `DAppSigner._tryExecuteQueryRequest → DAppSigner.call → AddLiquidity.executeLiquidity`

**Root cause confirmed:**
- `_code: 10` = `INSUFFICIENT_PAYER_BALANCE` (Hedera proto ResponseCode enum)
- HTS/HTS new pool creation sends `poolCreationFeeTinybar` (~526 HBAR) as the payable amount
- The test wallet did not have 526+ HBAR available
- When the Hedera network rejects the transaction for insufficient balance, the WalletConnect `DAppSigner` attempts to fall back to a query to determine the result, hitting an unimplemented code path (`Query.fromBytes()` for `getByKey`), producing the confusing BUG message that completely obscured the real cause

**Fixes applied (`frontend/src/components/AddLiquidity.ts`):**

1. **Pre-flight HBAR balance check** (before contract call)
   - Fetches account balance from Mirror Node after calculating `payableTinybar`
   - If `balance < payableTinybar + 5 HBAR buffer`, throws a clear error immediately before any wallet prompt
   - Error message includes actual vs required HBAR and the specific pool creation fee amount

2. **DAppSigner error decoder** (in catch block)
   - Detects `"Error executing transaction or query:"` pattern in error message
   - Parses JSON payload and maps `_code: 10` → human-readable "Insufficient HBAR balance" message with the fee amount
   - Falls back to original message if JSON parsing fails (safe no-op)

**Status:** Deployed to Railway. Pending re-test with sufficient HBAR balance.

---

### Session 4: ADD LIQUIDITY button does nothing on existing HTS/HTS pools
**Date:** 2026-02-23
**Symptom:** Button renders correctly but clicking it does nothing — no wallet prompt, no error, no spinner. Reproduced on PACK/SAUCE pool (existing).

**Root cause:** `executeLiquidity()` has a guard at the top:
```typescript
if (!this.tokenValidated || !this.tokenInfo || !this.tokenBInfo) return;
```
`this.tokenBInfo` is only ever populated by:
- `confirmHbarSelection()` — when user picks HBAR as token B for a new pool
- `validateTokenB()` — when user enters a token B ID for a new HTS/HTS pool

When the user picks an **existing pool** from the pool list, the click handler only set `this.selectedPool` and transitioned to `liquidity-form`. `this.tokenBInfo` stayed `null`, so the guard silently returned on every click.

**Fix applied (`init()` pool selection click handler):**
```typescript
const tokenBPool = pool.tokenA.id === this.tokenInfo?.tokenId ? pool.tokenB : pool.tokenA;
this.tokenBInfo = {
  tokenId: tokenBPool.id,
  name: tokenBPool.symbol,
  symbol: tokenBPool.symbol,
  decimals: tokenBPool.decimals,
  hasCustomFees: false,
};
this.tokenBValidated = true;
```
Also handles HBAR pairs correctly: when `tokenBPool.id === WHBAR_TOKEN_ID`, the `isHbarPair` check in `executeLiquidity` still evaluates to `true`.

**Status:** Deployed to Railway. Pending re-test.
