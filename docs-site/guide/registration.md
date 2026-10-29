---
outline: deep
---

# Registration Flow

End-to-end sequence for registering `name.tld`:

```
User            Frontend (DomainTool)        api-server           Hedera / Mirror Node
 │                      │                        │                       │
 │── type name, TLD ──▶ │                        │                       │
 │                      │── GET /check ────────▶ │                       │
 │                      │                        │── read HCS topic ───▶ │
 │◀── availability, ─── │◀── available?, price ──│◀── messages ──────────│
 │    price USD/HBAR    │                        │                       │
 │── sign TransferTx ─▶ │                        │                       │
 │    (wallet)          │── POST /register ────▶ │                       │
 │                      │                        │── verify payment ───▶ │
 │                      │                        │── mint domain NFT ───▶│
 │                      │                        │── HCS submit ────────▶│
 │                      │                        │── INSERT DB row       │
 │◀── success ──────────│◀── domain + NFT serial │                       │
```

## Step 1 - Availability check

`GET /api/domains/check?name=alice&tld=hedera&years=1`

The backend scans the TLD's HCS topic and returns:

- `available` - true if no non-expired HCS record exists for the name
- `priceUsd` / `priceHbar` - computed from the [pricing table](./pricing)
- `feeAccount`, `operatorAccount`, `networkFeeHbar` - where the payment goes
- `nftTokenId` - the domain NFT collection

## Step 2 - Wallet-signed payment

The frontend builds a single `TransferTransaction` (signed by the user's
wallet) containing:

1. **Domain price** in HBAR → `feeAccount`
2. **0.5 ℏ network fee** → the operator account (reimburses mint/transfer/HCS
   costs)
3. **Memo:** `domain:name.tld:Xyr` (e.g. `domain:alice.hedera:1yr`)

## Step 3 - Server-side verification

On `POST /api/domains/register` the backend:

1. Validates name format (lowercase `[a-z0-9-]`, or premium Unicode) and TLD.
2. Claims the in-memory registration lock for `tld:name` (returns **409** if a
   registration for that name is already in progress).
3. Re-checks availability against HCS (the source of truth, not the DB).
4. Rejects replayed payments - `payment_tx_id` must be unused.
5. Verifies the payment on the Mirror Node:
   - transaction must be `SUCCESS` and **less than 15 minutes old**
   - retries up to 5× on 404 (indexing lag)
   - amount within **5% tolerance** of the quoted price, plus the 0.5 ℏ fee leg
6. Mints the domain NFT and transfers it to the registrant.
7. Submits the HCS registration message.
8. Inserts the row into Postgres and returns the registration record.

If NFT minting fails, the whole registration aborts - no HCS message, no DB
row, and the user keeps their payment.

::: tip Admin registrations
When the connected wallet is the treasury (`DOMAIN_ADMIN_ACCOUNT`),
registration skips payment verification and uses a generated
`admin-<account>-<timestamp>` reference. This exists so the team can register
names for the treasury itself (e.g. after an NFT burn frees a name).
:::

## Expiry

`expires_at` is `now + years`. The name resolves as "registered" until that
timestamp passes, after which anyone can register it again.
