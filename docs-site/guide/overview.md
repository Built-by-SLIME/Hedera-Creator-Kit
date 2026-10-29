---
outline: deep
---

# Overview

The **SLIME Domain Registry** is a proprietary naming service built on Hedera.
Because Hedera has no native name service (like ENS on Ethereum), the toolkit
implements its own registry using a combination of:

- **Hedera Consensus Service (HCS)** - one topic per TLD, acting as the
  append-only source of truth for registrations and renewals.
- **Hedera Token Service (HTS)** - every registration mints a domain NFT that
  *is* the ownership record. Whoever holds the NFT owns the name.
- **The Hedera Mirror Node** - used to read HCS topics, verify HBAR payments,
  and look up live NFT holders.
- **Postgres** - a write-through cache of registrations for fast lookups.
  Never the source of truth.

## Why not just a database?

Everything authoritative lives on-chain:

- Registrations and renewals are **HCS messages** signed by the operator.
- Ownership is the **NFT itself** - sell the NFT on a secondary market and the
  new holder automatically resolves as the owner. No manual transfer step.
- Anyone can audit the full history of a name by reading its TLD topic.

The database exists only so the app doesn't re-scan a whole HCS topic on every
page load.

## Key properties

| Property | Value |
|---|---|
| Source of truth | HCS topic per TLD (latest sequence number wins) |
| Ownership record | Domain NFT (live holder overrides HCS owner) |
| TLD config | `domain_tlds` Postgres table (env-var fallback) |
| Payment | HBAR, verified on the Mirror Node |
| Registration terms | 1, 3, 5, or 10 years |
| Name format | Lowercase `[a-z0-9-]`, or premium Unicode/emoji |

## Where it lives

- **Frontend:** tool #13 in the Creator Kit app (`DomainTool`)
- **Backend:** `backend/api-server/routes/domains.ts`

## Next steps

- [Architecture](./architecture) - how the pieces fit together
- [Registration flow](./registration) - what happens when someone registers a name
- [Wallet Integration Spec](./integrator) - everything a wallet/explorer needs to resolve names
- [API Reference](/api/rest) - endpoint-by-endpoint reference
