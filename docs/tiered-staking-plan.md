# Tiered Staking — Implementation Plan

> Final design for NFT-serial-based tiered rewards.  
> Goal: let creators define multiple reward tiers inside one staking program, where each tier applies to either a serial range or a list of specific serials. Unmatched serials fall back to the program’s global `reward_rate_per_day`.

---

## 1. Current staking system (baseline)

### Tables

| Table | Purpose |
|-------|---------|
| `staking_programs` | One program per creator / stake asset / reward asset. Single global `reward_rate_per_day` and `min_stake_amount`. |
| `staking_participants` | Accounts registered for a program. |
| `staking_distributions` | Audit log of each drip (account, amount, units held, tx_id). |
| `staking_nft_period_credits` | Tracks NFT serials already rewarded in the current frequency window to prevent double-payment. |

### Current reward formula

```ts
wholeReward = unitsHeld * rewardRatePerDay * frequencyDays
rewardRaw   = Math.floor(wholeReward * 10^rewardDecimals)
```

- **NFT programs:** `unitsHeld` = count of *new* serials not already credited in the current window.
- **FT programs:** `unitsHeld` = `rawBalance / 10^stakeDecimals`.
- Drip uses `TransferTransaction` with `addApprovedTokenTransfer`, drawing from the creator’s treasury allowance.

---

## 2. What tiered staking looks like

A creator defines tiers inside a program. Each tier maps a set of serials to its own reward rate.

### Example

| Tier | Serials | Reward / day |
|------|---------|--------------|
| Founder’s Edition | specific: `1, 20, 420` | 100 |
| Legendary | range: `1 – 150` | 50 |
| Epic | range: `151 – 1000` | 20 |
| Everything else | fallback | 10 |

At drip time:

1. Fetch the participant’s held serials.
2. Filter out serials already credited in the current period (`staking_nft_period_credits`).
3. For each remaining serial, find the **first matching tier** (array order matters).
4. Sum: `tierRate * frequencyDays` for matched serials, or `globalRate * frequencyDays` for unmatched serials.
5. Pay the total in one approved token transfer.
6. Record each rewarded serial in `staking_nft_period_credits` (unchanged).

### Scope

- **NFT programs only.** FT/HTS programs keep the existing flat-rate UI.
- **New programs only** for adding tiers to a previously flat program. Once a flat program has participants or distributions, it cannot be converted to tiered.
- Existing flat-rate programs continue working unchanged.

---

## 3. Data model

### `tier_config` JSONB column on `staking_programs`

```sql
ALTER TABLE staking_programs ADD COLUMN tier_config JSONB DEFAULT NULL;
```

Example payload:

```json
[
  {
    "name": "Founder's Edition",
    "type": "specific",
    "serials": [1, 20, 420],
    "reward_rate_per_day": 100
  },
  {
    "name": "Legendary",
    "type": "range",
    "range": { "start": 1, "end": 150 },
    "reward_rate_per_day": 50
  },
  {
    "name": "Epic",
    "type": "range",
    "range": { "start": 151, "end": 1000 },
    "reward_rate_per_day": 20
  }
]
```

### Audit column

```sql
ALTER TABLE staking_distributions ADD COLUMN tier_breakdown JSONB DEFAULT NULL;
```

Stores per-drip summary such as:

```json
{
  "Founder's Edition": { "count": 2, "rate": 100, "reward": 200 },
  "Legendary":         { "count": 3, "rate": 50,  "reward": 150 }
}
```

### Why JSONB

- One column, minimal schema change.
- Naturally supports both `range` and `specific` tiers.
- Keeps the existing `reward_rate_per_day` column as the fallback/default rate.
- No migration required for existing programs (`NULL` = use flat rate).

A normalized table can be introduced later if tiers become a first-class analytics feature.

---

## 4. Handling `reward_rate_per_day`

Keep the existing column as the **default/fallback rate**.

| Program | `tier_config` | Reward logic |
|---------|---------------|--------------|
| Existing FT or NFT | `NULL` / `[]` | Use global `reward_rate_per_day` exactly as today. |
| New flat-rate NFT/FT | `NULL` / `[]` | Use global `reward_rate_per_day`. |
| New tiered NFT | non-empty array | Bucket serials by tier; unmatched serials earn the global rate. |

If a creator wants unmatched serials to earn nothing, they simply set the global rate to `0`.

---

## 5. Backend changes

### a. Schema migration (`backend/api-server/db.ts`)

```sql
ALTER TABLE staking_programs
  ADD COLUMN IF NOT EXISTS tier_config JSONB DEFAULT NULL;

ALTER TABLE staking_distributions
  ADD COLUMN IF NOT EXISTS tier_breakdown JSONB DEFAULT NULL;
```

### b. Validation helper (`staking.ts`)

`validateTierConfig(tiers, stakeTokenType)`:

- Reject tiers for FT programs.
- Each tier must have:
  - `name` (string, optional)
  - `reward_rate_per_day` (number ≥ 0)
  - Either `type: "range"` with integer `start ≤ end`, or `type: "specific"` with an array of unique non-negative integers.

### c. Create endpoint (`POST /api/staking-programs`)

- Accept optional `tier_config`.
- Validate and store as JSONB.

### d. Update endpoint (`PUT /api/staking-programs/:id`)

- Accept optional `tier_config`.
- If the program currently has no tiers, allow adding tiers **only if** it has zero participants and zero distributions.
- If the program already has tiers, allow editing them freely.
- This protects existing flat-rate participants from unexpected reward-rule changes.

### e. `processDrip` — core change

For NFT programs with a non-empty `tier_config`:

```ts
const { wholeReward, breakdown } = calcTieredReward(
  newSerials,
  prog.tier_config,
  Number(prog.reward_rate_per_day),
  days,
);
const rewardRaw = Math.floor(wholeReward * 10 ** rewardDecimals);
```

For FT programs or NFT programs without tiers, keep the existing `calcReward` path.

Store `breakdown` in `staking_distributions.tier_breakdown`.

### f. External API (`staking-external.ts`)

- Include `tier_config` in program responses.
- Update `externalGetPosition` and `externalGetEligibility` to estimate rewards using `calcTieredReward` for NFT programs.
- Include `tier_breakdown` in distribution responses.

---

## 6. Overlap policy

**First match wins, by array order.**

- A serial may match a specific-serial tier and also a range tier.
- The first tier in the array that contains the serial determines its rate.
- The frontend lets creators reorder tiers.

This makes it easy to put rare/specific serials above broad ranges.

---

## 7. Frontend changes (`frontend/src/components/StakingTool.ts`)

### a. Creation form

Add a **“Enable tiered rewards by serial”** toggle, visible only when **Stake Asset Type = NFT**.

When enabled:

- Global rate field is relabeled to **“Default Daily Reward Rate”**.
- Tier builder appears below it.
- Each tier row shows:
  - Name input (optional).
  - Type selector: **Range** or **Specific Serials**.
  - Range mode: start/end inputs.
  - Specific mode: textarea for comma-separated serials (e.g. `1, 20, 420`).
  - Daily rate input.
  - Remove / move-up / move-down buttons.
- **“Add Tier”** button appends a new tier.

Validation before submit:

- At least one tier if tiered mode is on.
- Each range has valid `start ≤ end` integers.
- Each specific tier has at least one valid serial.
- Each tier rate is ≥ 0.

### b. Allowance step

Summary shows:

- Default rate.
- Number of configured tiers.

### c. Program list cards

For tiered NFT programs:

- Show default rate and tier count.
- Expand a small tier summary (name/rate for each tier).

For flat programs, keep the existing `Rate: X/day` line.

### d. Edit card

- For tiered programs: show the tier editor inline, allowing add/remove/reorder/edit of tiers.
- For flat programs: keep the current simple edit UI (no tier editor).
- Flat programs with participants/distributions cannot be converted to tiered from the UI (backend enforces this).

---

## 8. Migration / backfill strategy

**No migration required.**

1. Add `tier_config` and `tier_breakdown` columns idempotently.
2. Existing programs keep `tier_config = NULL` and use the global rate.
3. `processDrip` checks:
   - If `tier_config` is null/empty → flat-rate logic.
   - If `tier_config` is non-empty → tiered logic.
4. Existing distribution history remains valid.

---

## 9. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Existing programs break | Keep global rate as fallback; only use tiers when `tier_config` is non-empty. |
| FT programs accidentally tiered | Validation rejects `tier_config` for `stake_token_type === 'FT'`. |
| Overlap ambiguity | First-match-wins policy; UI lets creators reorder tiers. |
| Unmatched serials earn too much/too little | Global rate acts as default; creator can set it to `0` if desired. |
| Malformed `tier_config` | Strict validation on create/update; defensive normalization in drip logic. |
| Live tier edits affect next drip | Soft-staking means changes are forward-looking only; existing distributions are immutable. |
| External API consumers | `tier_config` included in program/position/eligibility responses. |
| Double-payment | `staking_nft_period_credits` still works per serial, independent of tier math. |

---

## 10. Implementation order

1. Add `tier_config` and `tier_breakdown` columns.
2. Create `validateTierConfig`, `findTierForSerial`, and `calcTieredReward` helpers.
3. Update `processDrip` with tier-aware calculation.
4. Update create/update endpoints.
5. Update external API responses.
6. Build frontend tier builder and display.
7. Test with a new test program before offering to creators.
