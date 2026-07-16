# Tiered Staking — Research & Implementation Plan

> Captured from recent staking-tool research.  
> Goal: allow a creator to define multiple reward tiers inside a single staking program (e.g. serials 1–1000 earn X/day, serials 1001–5000 earn Y/day, etc.).

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

### Existing serial handling

- Mirror Node query: `/api/v1/accounts/{accountId}/nfts?token.id={tokenId}` (paginated).
- `staking_nft_period_credits` stores `(program_id, nft_serial, period_start, credited_at)`.
- A serial is skipped if it was credited within `frequencyDays * 24 - 4` hours.

### Frontend

- Program creation form: stake asset type, stake/reward token IDs, treasury, one global rate, one global minimum, frequency, optional supply cap.
- Edit mode currently allows editing: `name`, `description`, `reward_rate_per_day`, `frequency`, `min_stake_amount`.
- No tier / serial-range UI exists today.

---

## 2. What tiered staking looks like

A creator defines tiers inside a program. Each tier maps a set of serials to its own reward rate (and optionally its own minimum holdings).

Example:

| Tier | Serial range | Reward / day |
|------|--------------|--------------|
| Legendary | 1 – 100 | 50 |
| Epic | 101 – 1,000 | 20 |
| Common | 1,001 – 10,000 | 5 |

At drip time, the backend:

1. Fetches the participant’s held serials.
2. Buckets each serial into the matching tier.
3. Sums: `countInTier * tierRate * frequencyDays` across all tiers.
4. Pays the total in one approved token transfer.
5. Records each rewarded serial in `staking_nft_period_credits` (unchanged logic).

---

## 3. Data-model options

### Option A: `tier_config JSONB` column on `staking_programs`

```json
[
  { "name": "Legendary", "serial_start": 1,    "serial_end": 100,  "reward_rate_per_day": 50 },
  { "name": "Epic",      "serial_start": 101,  "serial_end": 1000, "reward_rate_per_day": 20 },
  { "name": "Common",    "serial_start": 1001, "serial_end": 10000, "reward_rate_per_day": 5 }
]
```

- **Pros:** Simple, no new table, fast to implement.
- **Cons:** Harder to query across tiers, less flexible for future features.
- **Best for:** First version / small static tier lists.

### Option B: New `staking_program_tiers` table

```sql
CREATE TABLE staking_program_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID REFERENCES staking_programs(id) ON DELETE CASCADE,
  name VARCHAR(255),
  serial_start BIGINT NOT NULL,
  serial_end BIGINT NOT NULL,
  reward_rate_per_day NUMERIC NOT NULL,
  min_stake_amount BIGINT DEFAULT 0,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (program_id, serial_start, serial_end)
);
```

- **Pros:** Normalized, queryable, supports per-tier minimums and future expansion (metadata traits, weights, etc.).
- **Cons:** More tables, more CRUD endpoints, slightly more UI work.
- **Best for:** Long-term feature richness.

**Recommendation:** Start with **Option A** (`tier_config JSONB`) for speed. Migrate to Option B later if tiers become a first-class feature.

---

## 4. Backend changes

### `staking_programs` table

Add:

```sql
ALTER TABLE staking_programs ADD COLUMN tier_config JSONB DEFAULT NULL;
```

Migration for existing programs: auto-generate one default tier spanning a very large serial range (`0` to `999999999`) using the existing `reward_rate_per_day`, so behavior is unchanged.

### Reward calculation

Replace the single-rate formula with tiered summation:

```ts
let wholeReward = 0;
for (const tier of program.tier_config ?? [defaultTier]) {
  const countInTier = serialsHeld.filter(
    s => s >= tier.serial_start && s <= tier.serial_end
  ).length;
  wholeReward += countInTier * tier.reward_rate_per_day * frequencyDays;
}
const rewardRaw = Math.floor(wholeReward * 10 ** rewardDecimals);
```

For FT programs, tiers don’t apply by serial — keep the global rate or introduce a separate FT-tier concept later.

### API endpoints

| Endpoint | Change |
|----------|--------|
| `POST /api/staking-programs` | Accept `tier_config` array. Validate ranges don’t overlap and rates are positive. |
| `PUT /api/staking-programs/:id` | Allow editing `tier_config` (or add `PUT /api/staking-programs/:id/tiers`). |
| `GET /api/staking-programs/:id/allowance` | No change. |
| `POST /api/staking-programs/:id/register` | Optional: validate participant qualifies for at least one tier. |
| `processDrip` | Bucket serials into tiers before calculating reward. |

### `staking_nft_period_credits`

No schema change needed. This table’s only job is to prevent a serial from being rewarded twice in the same period. Tiered reward calculation happens **before** the credit check and remains compatible.

### Audit / distribution history

`staking_distributions` currently stores aggregate `units_held` and `amount`. To show “X from Tier 1, Y from Tier 2” historically, either:

- Add a JSONB `tier_breakdown` column to `staking_distributions`, or
- Create `staking_distribution_tiers(program_id, distribution_id, tier_name, serials_count, amount)`.

This is optional for the first version but recommended for transparency.

---

## 5. Frontend changes

### Program creation form

Add a **Tier Builder** section:

- “Add tier” button.
- Per tier: name, serial start, serial end, daily reward rate.
- Validation:
  - Ranges cannot overlap.
  - Rates must be positive numbers.
  - At least one tier required.

### Program edit card

Allow editing tiers the same way other editable fields are edited (inline edit mode → save → `PUT`).

### Program display

Show tier summary on the card, e.g.:

```
Tiers:
• Legendary (serials 1–100): 50 / day
• Epic (serials 101–1,000): 20 / day
• Common (serials 1,001–10,000): 5 / day
```

### Registration / drip history

- Registration stays the same.
- Drip history can show total earned per tier if audit table is added.

---

## 6. Design decisions to make

| Decision | Options | Notes |
|----------|---------|-------|
| **Tier basis** | Serial ranges vs. metadata traits | Serial ranges are fast and use existing mirror-node data. Metadata traits require IPFS fetches and parsing. |
| **Range overlap** | Strict non-overlap vs. priority order | Non-overlap is simplest. If overlapping, define “first match wins” or “highest rate wins.” |
| **Per-tier minimums** | Global minimum only vs. per-tier minimums | Global minimum keeps the first version simple. |
| **Editing live tiers** | Editable vs. locked after creation | Soft-staking means edits can take effect next drip without affecting past distributions. |
| **Existing programs** | Backfill one default tier vs. leave null | Backfill guarantees existing programs continue working. |
| **FT programs** | Support tiers later vs. now | FT tiers are usually balance thresholds, not serial ranges. Can be a Phase 2. |

---

## 7. Recommended minimal implementation path

1. **Schema:** Add `tier_config JSONB` to `staking_programs`.
2. **Migration:** Auto-generate a single default tier for every existing program using its current `reward_rate_per_day`.
3. **Validation:** Create a helper that checks `tier_config` for overlapping ranges, positive rates, and required fields.
4. **`processDrip`:** Update NFT reward calculation to bucket serials by tiers and sum tier rewards.
5. **API:** Accept/save `tier_config` on create and update.
6. **Frontend:** Add tier builder to creation form and edit card.
7. **Audit (optional):** Add `tier_breakdown` JSONB to `staking_distributions`.

This keeps the change localized, reuses the existing serial-credit system, and does not require a new table.

---

## 8. Open questions

1. Should tiers be allowed for **FT** programs too (e.g. balance thresholds), or only NFT serial ranges?
2. Should tiers support **metadata-based rules** in the future, and if so, how is metadata fetched/cached?
3. Should the UI show participants a preview of their estimated reward by tier before they register?
4. Should distributions record per-tier breakdowns from day one?
5. How should the system handle serials that fall outside all defined tiers — ignore them or fall back to a default rate?
