# Hedera Creator Kit — Changelog

All notable changes to this project are documented here.

---

## [Unreleased]

### Fixed — Add Liquidity (Tool #6)

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
