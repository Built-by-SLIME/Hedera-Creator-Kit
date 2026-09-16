# Staking Drip Incident — 2026-09-15 — Diagnosis & Resolution Plan

> Created 2026-09-15. Everything in this document was verified against on-chain data
> (mirror node) and the production database (public read endpoints). No code changes
> have been made yet.

---

## 1. What happened (summary)

Three separate issues surfaced around the 2026-09-15 drip run:

1. **SLIME drip "dusted"** — 18 holders received 0.0000007 SLIME per NFT instead of 70 SLIME per NFT, and ~79 of ~97 participants were skipped entirely.
2. **$LENNY Season 4 double-drip** — 4 wallets were paid twice.
3. **$STASH "missing"** — NOT an incident. The STASH PASS program is weekly (Fridays); the user's wallet (0.0.10022142) was paid 49 STASH on 2026-09-11 as scheduled (verified on-chain). Next due 2026-09-18 05:12 UTC. The monthly ℏBUDS program next pays 2026-09-30.

---

## 2. Root causes

### 2a. The dust bug (SLIME)

`fetchTokenDecimals()` in `backend/api-server/routes/staking.ts` (line ~239):

```ts
const res = await fetch(`${MIRROR_NODE_URL}/api/v1/tokens/${tokenId}`);
if (!res.ok) return 0;   // ← silent fallback: ANY mirror-node error becomes "0 decimals"
```

$SLIME (0.0.10294707) has **8 decimals**. During the SLIME run (~05:19 UTC) this single
fetch failed (transient mirror-node error / rate-limit after ~100+ burst requests from
the earlier LENNY + Degen runs). The code used decimals=0:

- Sent: `70 × 10⁰ = 70 raw` = **0.0000007 SLIME** (should be `70 × 10⁸ = 7,000,000,000 raw`)
- DB recorded "70" (same wrong divisor both sides) → records look correct, chain got dust.

**Evidence:**
- Today 05:20 UTC, tx `0.0.9348822@1789449618.053264041` → on-chain `+70 raw` to 0.0.10620651 ✗
- Sept 8 run, tx `0.0.9348822@1788845102.500824055` → on-chain `+7,000,000,000 raw` ✓ (correct)
- Sept 14 registration drip → `+7,000,000,000 raw` ✓ (correct — bug is intermittent, not persistent)
- LENNY run 05:13 UTC (6 dec) and Degen run 05:17 UTC (8 dec) today: both correct → failure window was specific to the SLIME run.

**Scope:** 18 holders dusted; treasury loss negligible (~0.000035 SLIME total actually moved).
~79 participants skipped because failed holdings fetches are also treated as "0 holdings → skip."
Program clock advanced to 2026-09-15 05:12 UTC anyway.

### 2b. The LENNY double-drip

- Season 4 program created 2026-09-14 13:51 UTC → `last_distributed_at = NULL` → always "due".
- **04:56 UTC**: weekly cron (user's) fired `run-all-drips`. Only LENNY S4 was due (all other
  programs' clocks are normalized to 05:12 UTC → not due until 05:12). Paid 4 accounts, then the
  run **died mid-way ~05:00** (restart/crash — see Railway logs). Clock never written.
- **05:12 UTC**: the long-standing daily cron fired `run-all-drips`. LENNY still due → paid all 20
  accounts again; then Degen Ape, SLIME (dusted), HBAR Prime.
- FT programs have **no per-account dedup** (serial credits are NFT-only), so nothing stopped the
  re-payment of the 4 already-paid accounts.

**The 4 double-paid wallets:**

| Wallet | Extra drip (04:56 UTC) | Legit drip (05:13 UTC) | Extra amount |
|---|---|---|---|
| `0.0.731547` | 64,072.03 | 64,343.85 | ~64,072 LENNY |
| `0.0.9206155` | 24,178.72 | 24,281.30 | ~24,179 LENNY |
| `0.0.7893913` | 24,551.18 | 24,655.34 | ~24,551 LENNY |
| `0.0.9296432` | 3,530.97 | 3,545.95 | ~3,531 LENNY |

Total extra ≈ **116,333 LENNY** from the Season 4 treasury allowance. No clawback mechanism
exists on-chain — recovery is a social matter with those holders (or write it off).

### 2c. Auth weaknesses (drips do NOT require server access)

- `POST /api/staking-programs/run-all-drips` — protected by `DRIP_SECRET` **only if the env var
  is set**. If unset → open to the entire internet. **Verify in Railway variables ASAP.**
- `POST /api/staking-programs/:id/drip` — "protection" = the caller types the owner's account ID
  in the request body (`createdBy`). No signature. Account IDs are public via
  `GET /api/staking-programs` (no auth).
- `POST /api/staking-programs/:id/register` — open by design; fires an immediate drip.
  NFT programs are protected by serial credits; **FT programs can be farmed by re-registering**
  (no dedup) until Fix 3 lands.

### 2d. Two schedulers

Historical data shows a **daily 05:12 UTC** trigger has run for months (all programs).
The user's **weekly Tuesday 04:56 UTC** cron also exists. It was always a harmless no-op
(nothing is due 16 min before 05:12) — until a brand-new NULL-clock program (LENNY S4) existed.

---

## 3. Timing rules (why a makeup run TODAY is safe)

- The system never stores actual send time. On completion it writes
  `last_distributed_at = today 05:12 UTC` and `credited_at = today 05:12 UTC` — regardless of
  the real clock time.
- NFT serial re-eligibility: `credited_at` older than `frequency×24h − 4h` (7d → 164h).
- A makeup run on **2026-09-15 (any time before midnight UTC)** stamps everything
  `Sept 15 05:12` → next drip Sept 22 05:12 exactly on schedule.
- A makeup run on Sept 16+ stamps `Sept 16 05:12` → cadence permanently shifts to Wednesdays
  (no drip is skipped, but the day moves). **Do the makeup today.**

---

## 4. Prevention fixes

> **Status 2026-09-16:** Fixes 1+2 deployed 2026-09-15 (commit `11d5d5f`) and proven in
> production (makeup run paid 97/97 at correct decimals; next-morning cron re-ran SLIME
> with 0 payments — credits held). Fixes 3+4+5 implemented 2026-09-16, pending deploy.
> SLIME cleanup done: `0.0.TEST999` + `0.0.10045916` removed from participants;
> SLIME clock set to 2026-09-15 05:12 UTC.

- **Fix 1 — Never guess decimals. (DEPLOYED)** `fetchTokenDecimals` must throw (after 2–3 retries) instead
  of returning 0; abort the whole run before any transfer if decimals can't be confirmed.
  Note: 0 is a LEGIT value (STASH, HPRIME) — distinguish "fetch failed" from "decimals = 0".
  Belt-and-suspenders: store `reward_token_decimals` on the program at creation; abort the run
  if the live fetch disagrees.
- **Fix 2 — Never treat failed holdings fetches as 0. (DEPLOYED)** `fetchNftSerials`/`fetchFtBalance` throw
  on error → participant counts as FAILED (visible), and the program clock only advances when a
  run completes with zero failures (failed runs stay "due" → next daily cron retries the unpaid).
- **Fix 3 — FT per-account dedup. (IMPLEMENTED)** New table `staking_ft_period_credits`
  (program_id, account_id, credited_at), same 164h-style window as NFT serial credits. Makes
  every program idempotent; closes the re-registration farming hole; makes partial-failure
  retries safe. Clock rule extended to all programs: advance only when `failed === 0`.
- **Fix 4 — DB-level run lock. (IMPLEMENTED)** `pg_try_advisory_lock` per program via a dedicated
  pool client wrapping `processDrip`; second overlapping run exits immediately (covers cron vs
  manual trigger races and multi-replica). Lock auto-releases on crash (connection death).
- **Fix 5 — Auth, fail closed. (IMPLEMENTED)** `runAllDrips` / `triggerDrip` /
  `reset-distribution-clock` refuse to run if `DRIP_SECRET` is unset (verified set on Railway);
  `triggerDrip` now requires the Bearer secret (createdBy-in-body was not auth).
  NOTE: manual triggers now need `-H "Authorization: Bearer $DRIP_SECRET"`.
- **Fix 6 (optional, not done) — Alerting.** Loud log/warning when a run pays materially fewer
  participants than the previous week.

Safety rationale: every fix either *refuses to send* when data is untrustworthy, or *checks a
receipt* before sending. None of them change amounts, schedule math, or the 05:12 normalization.

---

## 5. Makeup run procedure — SLIME program `8345ebe8-978a-493d-8fbd-86ebcb4c7266`

**Must happen on 2026-09-15 (before midnight UTC) to preserve the Tuesday cadence.**

1. Deploy **at minimum Fix 1** (decimals hard-fail). Running the makeup on unfixed code risks
   dusting everyone again.
2. DB cleanup (SLIME program only):
   - Delete today's serial credits:
     `DELETE FROM staking_nft_period_credits WHERE program_id = '8345ebe8-978a-493d-8fbd-86ebcb4c7266' AND credited_at >= '2026-09-15';`
   - Delete the 18 dust distribution rows (they falsely record "70"):
     `DELETE FROM staking_distributions WHERE program_id = '8345ebe8-978a-493d-8fbd-86ebcb4c7266' AND distributed_at >= '2026-09-15';`
     (tx IDs remain on-chain for audit)
   - Restore the previous clock so the program is due now with cadence intact:
     `UPDATE staking_programs SET last_distributed_at = '2026-09-08T05:12:00Z' WHERE id = '8345ebe8-978a-493d-8fbd-86ebcb4c7266';`
3. Trigger the SLIME drip manually:
   `POST /api/staking-programs/8345ebe8-978a-493d-8fbd-86ebcb4c7266/drip`
   body: `{ "createdBy": "0.0.9463056" }` (post-Fix-5: with the Bearer secret instead).
4. **Verify before declaring done:** spot-check 2–3 new txs on the mirror node —
   must show `7,000,000,000 raw` per 70 SLIME — and confirm the run log shows
   `rewardDecimals=8`, ~97 distributed.
5. Clock self-heals to Sept 15 05:12 → next drip Sept 22 05:12 UTC as normal.
6. The 18 dusted wallets keep the dust (overpayment 0.000035 SLIME total — negligible).

---

## 6. Scheduler hygiene

Keep exactly ONE trigger: the daily 05:12 UTC cron. Delete/disable the weekly Tuesday 04:56 one.
With Fixes 3+4 a second trigger would be harmless, but one trigger removes the confusion class.

---

## 7. Open items / what to check in Railway

- [ ] Confirm `DRIP_SECRET` is set in the API service variables (else run-all-drips is public).
- [ ] Logs around 2026-09-15 04:56–05:00 UTC: why did run #1 die after 4 payments?
- [ ] Logs ~05:19 UTC: confirm `[processDrip] reward_token=0.0.10294707 rewardDecimals=0`.
- [ ] Confirm which schedulers exist (Railway cron + any external service like cron-job.org).
