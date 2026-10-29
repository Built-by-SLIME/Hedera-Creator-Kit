---
outline: deep
---

# Architecture

## The three layers

```
┌─────────────────────────────────────────────────────┐
│  Client (DomainTool in the Creator Kit frontend)    │
└──────────────────────┬──────────────────────────────┘
                       │ REST
┌──────────────────────▼──────────────────────────────┐
│  api-server (Express)                               │
│  ├─ reads/writes Postgres (domain_registrations,    │
│  │  domain_tlds)                                    │
│  ├─ submits HCS messages (operator key)             │
│  ├─ mints/transfers domain NFTs (supply key)        │
│  └─ verifies payments via Mirror Node               │
└───────┬──────────────────────┬──────────────────────┘
        │                      │
┌───────▼────────┐   ┌─────────▼──────────┐   ┌───────────────┐
│  HCS topics    │   │  HTS domain NFT    │   │  Postgres     │
│  (one per TLD) │   │  collection        │   │  (cache)      │
│  SOURCE OF     │   │  OWNERSHIP RECORD  │   │  write-through│
│  TRUTH         │   │                    │   │               │
└────────────────┘   └────────────────────┘   └───────────────┘
```

## HCS topics — the source of truth

Each active TLD has its own HCS topic, created with the operator's submit key
so only the operator can write. Every registration and renewal appends a JSON
message:

```json
{
  "action": "register",           // register | admin-register | renew
  "name": "alice",
  "tld": "hedera",
  "owner": "0.0.123456",
  "years": 1,
  "expires_at": "2027-10-29T12:00:00.000Z",
  "payment_tx": "0.0.123456-1730000000-000000000",
  "nft_token_id": "0.0.10354981",
  "nft_serial": 42
}
```

Renewal messages add `prev_expires_at`.

**Resolution rule: latest sequence number wins.** To resolve a name, read every
message in the TLD topic, keep the ones for that `name`/`tld`, and take the one
with the highest consensus sequence number. If its `expires_at` is in the past,
the name is treated as unregistered.

## Domain NFT — the ownership record

Registration mints a new serial on a single HTS NFT collection (HIP-412
metadata) and transfers it from the treasury to the registrant.

This makes the **live NFT holder** the owner. If the NFT is sold on SentX or
any secondary market, resolution automatically follows the NFT — the HCS
`owner` field is only a fallback when the Mirror Node can't be reached.

## Postgres — a write-through cache

`domain_registrations` mirrors each HCS write for fast reads, guarded by:

- `UNIQUE (payment_tx_id)` — a payment transaction can never fund two names.
- `UNIQUE (name, tld)` — enforced at the DB level as a second line of defense
  behind the HCS availability check.

The `domain_tlds` table holds TLD configuration (`tld`, `hcs_topic_id`,
`active`) so TLDs can be added or retired **without redeploying**. On first
boot the table is seeded from the legacy `DOMAIN_TOPIC_ID_<TLD>` environment
variables; if the DB is unreachable, the env list is used as a fallback.

## Caching behavior

| Cache | TTL | Invalidated by |
|---|---|---|
| HCS topic messages (per topic) | 60 s | register/renew HCS submit |
| TLD config | 60 s | admin TLD changes |
| HBAR→USD price (CoinGecko) | 5 min | stale value reused on error |

Expiry filtering is applied **at read time**, so a cached message can never
make an expired domain look active.

## Concurrency safety

- A short-lived in-memory lock (`tld:name`, ~90 s) ensures two simultaneous
  registrations of the same name can't both pass the availability check.
- Payment replay is blocked by the `payment_tx_id` unique constraint.
- The DB `UNIQUE (name, tld)` constraint backstops both.
