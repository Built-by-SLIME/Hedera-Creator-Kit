# Hedera Creator Kit — Changelog

All notable changes to this project are documented here.

---

## [Unreleased]

### Fixed — Domain Registration (SLIME dApp + Backend)

#### 🐛 BUG FIX: Domain registrations fail silently after HBAR payment — NFTs never minted (CRITICAL)
**Date:** 2026-03-26
**Files changed:**
- `/Users/davidconklin/SLIME Website/slime-website/src/components/DomainsPage.tsx` — 4 surgical changes (outside toolkit repo — SLIME dApp)
- `backend/api-server/routes/domains.ts` — **no change required** (already returns `nftTokenId`)

**Symptom:** Users paid HBAR successfully (confirmed on Hashscan) but received no domain NFT, no HCS record was written, and no DB row was created. The registration appeared to complete from the user's perspective but nothing was recorded on-chain.

**Root cause (two compounding bugs):**

1. **Missing token association (T2 — primary cause):** Hedera requires a wallet to be explicitly associated with a token collection before it can receive NFTs from that collection. The SLIME website never checked or performed this association step. When the backend attempted to transfer the minted NFT to the buyer, the transfer failed with `TOKEN_NOT_ASSOCIATED_TO_ACCOUNT`. The backend exits on NFT transfer failure (`routes/domains.ts` lines 572–575), so no HCS message was ever written and no DB record was ever created.

2. **Unstable transaction ID (T3 — contributing cause):** The payment `TransferTransaction` was passed directly to `signer.call()` without first calling `freezeWithSigner()`. The transaction ID was read from the call *response* rather than from the transaction object itself, which is unreliable across different wallet implementations. This could cause payment verification to fail even when the payment succeeded.

**Forensic evidence:**
- Account `0.0.2151958` (Sam): associated with token `0.0.10356088` (balance 0), holds 0 NFTs — payment went through, registration never completed.
- NFT serials 17, 18, 19, 21 are stuck in operator wallet `0.0.9348822` — all `futuritygalaxies.hedera`, 4 failed mint-and-transfer attempts from prior registrations for the same name.
- `bacon.slime` (self-registration, same wallet as backend operator = self-association automatic) worked perfectly, confirming the backend pipeline is correct.

**Changes made to `DomainsPage.tsx`:**

| # | Change | Lines affected |
|---|--------|----------------|
| 1 | Added `TokenAssociateTransaction, TokenId` to `@hashgraph/sdk` import | Line 2 |
| 2 | Added `nftTokenId: string \| null` field to `CheckResult` interface | Interface block |
| 3 | Captured `nftTokenId` from `/api/domains/check` response into state | `setCheckResult()` call |
| 4 | Rewrote `handleRegister` to: (a) query Mirror Node for token association, (b) send `TokenAssociateTransaction` if not associated, (c) freeze payment tx before `signer.call()`, (d) read `txId` from frozen tx object | `handleRegister` function |

**Revert instructions (if needed):**
- Line 2: remove `TokenAssociateTransaction, TokenId,` from the import
- `CheckResult` interface: remove `nftTokenId: string | null`
- `setCheckResult()` block: remove `nftTokenId: data.nftTokenId ?? null,`
- `handleRegister`: restore the original version — remove the `// [FIX T2]` block entirely, change `await payTx.freezeWithSigner(signer)` back to nothing (delete that line), change `const txId = payTx.transactionId?.toString() ?? ''` + `await signer.call(payTx)` back to `const response = await signer.call(payTx)` + `const txId = response.transactionId?.toString() ?? ''`

**Remaining manual action required:**
- Serials 17, 18, 19, 21 — burn manually from operator wallet `0.0.9348822` (non-urgent)
- Sam (`0.0.2151958`) needs to re-register `sam.hedera` — the name is still available (no HCS record was ever written for it)

---

### Fixed — Swap Tool (Tool #10)

#### 🐛 BUG FIX: MAX_ALLOWANCES_EXCEEDED — 63 NFT approvals in a single transaction (CRITICAL)
**Date:** 2026-03-16
**Files changed:**
- `frontend/src/components/SwapTool.ts` — allowance mode toggle + batching logic
- `backend/api-server/routes/swap.ts` — `getFallbackFees` helper + NFT branch in `/prepare` + `serialNumbers` support in `/submit`
- `/Users/davidconklin/SLIME Website/slime-website/src/components/SwapPage.tsx` — NFT swap flow rewritten (outside toolkit repo — SLIME dApp)

**Symptom:** Admin attempting to grant allowances for 63 NFT serials received `MAX_ALLOWANCES_EXCEEDED`. The program was saved to the database with no valid allowance behind it, making every user swap attempt fail silently.

**Root cause:** `AccountAllowanceApproveTransaction` is hard-capped at **20 allowance operations** per transaction by Hedera protocol. The old code looped `approveTokenNftAllowance()` once per serial in a single transaction — 63 serials = 63 operations = instant on-chain rejection.

**Revert instructions (if needed):**
- `SwapTool.ts`: remove `allowanceMode` state, restore single `approveTokenNftAllowance` loop in `handleGrantAllowance`, remove toggle buttons from `renderAllowanceStep`, remove toggle listeners from `init`
- `swap.ts`: restore the `if (program.swap_type !== 'fungible') { return 400 }` guard at the top of `prepareSwap`, remove `getFallbackFees` function, remove NFT branch, revert `submitSwap` to accept only `amount` (remove `serialNumbers` branch)
- `SwapPage.tsx`: restore `NftId` import, replace the 3-step NFT flow with the original `approveTokenNftAllowance` loop + direct `/api/swap-execute` POST

---

#### ✨ FEATURE: Admin UI — All Serials / Specific Serials toggle
**File:** `frontend/src/components/SwapTool.ts`

Added `allowanceMode: 'all' | 'specific'` state (default `'all'`). The allowance step for NFT programs now shows a two-button toggle:

- **ALL SERIALS (recommended):** Calls `approveTokenNftAllowanceAllSerials(tokenId, owner, operator)` — a single allowance operation regardless of collection size. Grants the operator permission to distribute any serial the treasury holds, revocable at any time.
- **SPECIFIC SERIALS:** Shows the serial input and "USE WALLET NFTs" button. Serials are batched into groups of 20 (Hedera's hard limit per tx) and submitted sequentially — one wallet signature per batch. A warning is displayed upfront: *"20-operation limit — one signature per batch."*

**Key SDK call:**
```typescript
// All mode — 1 operation, any collection size
new AccountAllowanceApproveTransaction()
  .approveTokenNftAllowanceAllSerials(TokenId.fromString(toTokenId), acctId, operatorId)

// Specific mode — batched, max 20 per tx
for (const serial of batch) {
  approveTx.approveTokenNftAllowance(new NftId(TokenId.fromString(toTokenId), serial), acctId, operatorId)
}
// 2500ms pause between batches to avoid nonce collisions
```

---

#### ✨ FEATURE: User-pays model — dynamic royalty fallback fee reimbursement
**Files:** `backend/api-server/routes/swap.ts`, `SwapPage.tsx`

**Problem:** The operator wallet was paying Hedera's auto-assessed royalty fallback fees on every NFT swap. These fees are charged by the protocol when an NFT changes hands with no fungible value exchanged. The operator had no way to recover this cost.

**Solution — Prepare/Submit pattern with inline HBAR reimbursement:**

The NFT swap flow is now:
1. **User grants allowance** — `approveTokenNftAllowanceAllSerials` for their `from` token (covers all serials, one signature)
2. **Backend prepares** — `POST /api/swap-programs/:id/prepare` with `{ userAccountId, serialNumbers[] }`
3. **User signs** — their signature authorises only the HBAR debit from their account; the approved NFT transfers need no additional user signature
4. **Backend submits** — `POST /api/swap-programs/:id/submit` with signed bytes; backend countersigns (authorising the approved NFT transfers as spender) and submits

**`getFallbackFees(tokenId)` helper — dynamic Mirror Node query:**
```typescript
GET /api/v1/tokens/{tokenId}  →  custom_fees.royalty_fees[].fallback_fee
```
- Returns `{ collector: string, tinybars: bigint }[]` — one entry per royalty tier
- Only HBAR-denominated fallbacks are returned (`denominator_token_id === null`)
- Token-denominated fallbacks (rare) are logged as warnings and skipped
- Network returns `[]` if no royalty fees exist — no HBAR legs added to tx

**Prepared `TransferTransaction` structure (per swap):**
```
For each serial:
  addApprovedNftTransfer(fromToken#serial, user → treasury)   // user's fromToken goes to treasury
  addApprovedNftTransfer(toToken#serial,   treasury → user)   // treasury's toToken goes to user

HBAR legs:
  addHbarTransfer(userAcct,     -(networkFee + all fallbackFees × nftCount))
  addHbarTransfer(operatorAcct, +(networkFee + all fallbackFees × nftCount))

setTransactionId(TransactionId.generate(operatorAcct))  // operator is payer
setNodeAccountIds([new AccountId(3)])                    // pin node so both signers sign same bytes
```
The operator nets zero — all fees it is charged by Hedera protocol are reimbursed inline in the same atomic transaction.

**Fee response to frontend:**
```json
{
  "fees": {
    "networkFee": "0.2 ℏ",
    "fallbackFees": [{ "collector": "0.0.xxxxx", "tinybars": "100000000" }],
    "total": "1.2 ℏ",
    "totalTinybars": "120000000"
  }
}
```
The UI displays the fee total in the step 3 wallet prompt so the user knows exactly what they are signing before the wallet opens.

**`submitSwap` — NFT vs fungible DB insert:**
```typescript
// NFT: stores serial numbers
INSERT INTO swap_transactions (swap_program_id, user_account_id, serial_numbers, tx_id, status)

// Fungible: stores amount (unchanged)
INSERT INTO swap_transactions (swap_program_id, user_account_id, amount, tx_id, status)
```

---

### Added — Staking Tool (Tool #12)

#### ✨ FEATURE: Soft-staking reward distribution system — non-custodial, allowance-based
**Date:** 2026-03-13
**Files changed:**
- `backend/api-server/db.ts` — 3 new tables
- `backend/api-server/routes/staking.ts` — new file (full backend logic)
- `backend/api-server/server.ts` — 12 new routes registered
- `frontend/src/components/StakingTool.ts` — new file (full frontend UI)
- `frontend/src/main.ts` — StakingTool registered and resetState() wired
- `frontend/src/components/Terminal.ts` — Tool #12 status changed from `coming-soon` → `active`
- `backend/api-server/tsconfig.json` — `rootDir` fixed from `"."` → `".."` (see note below)

**What it does:**
Creators can configure a staking program where community members earn reward tokens simply by holding a stake token (NFT or FT) in their own wallet. No locking, no escrow — purely proof-of-holding via live Mirror Node snapshots.

**Architecture — Allowance-Based Non-Custodial Distribution:**
- Creator grants a fungible token allowance on their treasury account to the platform operator (`0.0.9463056`) via `AccountAllowanceApproveTransaction` (signed in wallet via WalletConnect).
- Backend distributes rewards using `TransferTransaction` + `addApprovedTokenTransfer` (`isApproval = true`) — the operator spends the allowance on behalf of the treasury without ever holding the creator's private key.
- `TokenAirdropTransaction` (HIP-904) is explicitly **not used** — standard `TransferTransaction` only, per project requirement.

**Database schema — 3 new tables in `db.ts`:**
```sql
-- staking_programs (extended from prior schema)
ALTER TABLE staking_programs ADD COLUMN stake_token_type VARCHAR(3) NOT NULL DEFAULT 'NFT'; -- 'NFT' | 'FT'
ALTER TABLE staking_programs ADD COLUMN allowance_granted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE staking_programs ADD COLUMN last_distributed_at TIMESTAMPTZ;

-- staking_participants (new)
CREATE TABLE staking_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID REFERENCES staking_programs(id) ON DELETE CASCADE,
  account_id VARCHAR NOT NULL,
  registered_at TIMESTAMPTZ DEFAULT now(),
  last_distributed_at TIMESTAMPTZ,
  UNIQUE(program_id, account_id)
);

-- staking_distributions (new — audit log, never deleted)
CREATE TABLE staking_distributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID REFERENCES staking_programs(id) ON DELETE SET NULL,
  account_id VARCHAR NOT NULL,
  amount NUMERIC NOT NULL,
  units_held NUMERIC NOT NULL,
  tx_id VARCHAR,
  distributed_at TIMESTAMPTZ DEFAULT now()
);
```

**Supported frequencies:**
| Label | Internal value |
|-------|---------------|
| Daily | `1d` |
| Weekly | `7d` |
| Monthly | `30d` |
| Quarterly | `90d` |
| Semi-Annual | `180d` |
| Annual | `365d` |

**Reward formula:**
- NFT staking: `serialCount × rewardRatePerDay × frequencyDays`
- FT staking: `(tokenBalance / 10^decimals) × rewardRatePerDay × frequencyDays`

Holdings are read at drip time via Mirror Node:
- NFT count: `GET /api/v1/tokens/{stakeTokenId}/nfts?account.id={accountId}`
- FT balance: `GET /api/v1/accounts/{accountId}/tokens?token.id={stakeTokenId}`

**Custom fee handling (HTS protocol level — no code changes needed):**
- Fixed fees on the reward token: treasury is automatically exempt (Hedera protocol rule). Stakers receive the full intended amount.
- Fractional fees on the reward token: charged to the receiver — stakers receive slightly less. The UI detects this and shows a warning to the creator at setup time by querying `GET /api/v1/tokens/{rewardTokenId}` → `custom_fees.fractional_fees`.
- Royalty/fallback fees on the staked NFT: completely irrelevant — NFTs never move.

**Backend API routes (all registered in `server.ts`):**
```
POST   /api/staking-programs                        — create program
GET    /api/staking-programs?createdBy=0.0.x        — list creator's programs
GET    /api/staking-programs/public                  — list all active programs (public)
PUT    /api/staking-programs/:id/status              — pause / resume
PUT    /api/staking-programs/:id/allowance           — mark allowance as granted
DELETE /api/staking-programs/:id                     — delete program
POST   /api/staking-programs/:id/register            — participant self-registers
GET    /api/staking-programs/:id/participants        — list participants
GET    /api/staking-programs/:id/distributions       — list distribution history
POST   /api/staking-programs/:id/drip               — trigger single program drip (admin)
POST   /api/staking-programs/run-all-drips           — trigger all due drips (cron target)
```

**Drip scheduling:**
`processDrips` is a backend function; it is not on an internal cron. To schedule drips, point an external scheduler (Railway Cron, GitHub Actions, etc.) at:
```
POST /api/staking-programs/run-all-drips
Authorization: Bearer {DRIP_SECRET}
```
Set `DRIP_SECRET` as an environment variable in Railway.

**Association enforcement:**
Before a participant's first drip, the backend verifies they have associated the reward token via Mirror Node. If not associated, the drip is skipped for that account (prevents `TOKEN_NOT_ASSOCIATED_TO_ACCOUNT` failures on-chain).

---

#### 🔧 FIX: `backend/api-server/tsconfig.json` — `rootDir` corrected
**Root cause:** `rootDir` was set to `"."` (only `api-server/`), but routes inside `api-server` import files from `../../5-art-generator/` (a sibling directory). TypeScript raised `TS6059` errors: *"File is not under rootDir"*.
**Fix:** Changed `rootDir` from `"."` → `".."` (the `backend/` parent), so TypeScript's source root covers both `api-server/` and `5-art-generator/`.
**Impact:** Zero. Dev mode uses `ts-node --transpile-only` (no tsconfig compilation). Production build uses `backend/tsconfig.json` (unchanged). Railway deployment uses `npm run build` → `backend/tsconfig.json`. The `api-server/tsconfig.json` is only used for type-checking.

---

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
