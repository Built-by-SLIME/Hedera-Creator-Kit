---
outline: deep
---

# Renewals

## Who can renew

Only the **current owner** according to HCS may renew. The backend resolves
the latest HCS record for the name and compares its owner (`new_owner ??
owner`) against `ownerAccountId` in the request.

## Grace behavior

Recently-expired domains can still be renewed. The new expiry is computed by
extending from **whichever is later: the current expiry or now**:

```
newExpiry = max(now, currentExpiry) + years
```

This means renewing late never costs you time you already paid for.

## Fee structure

Identical to registration: the [pricing table](./pricing) amount in HBAR plus
the flat 0.5 ℏ network fee, paid as a wallet-signed transfer with memo
`domain:name.tld:Xyr`.

## What happens on renew

1. Payment is verified on the Mirror Node (same rules as registration:
   SUCCESS, < 15 min old, ≥ 95% of quoted amount).
2. A `renew` HCS message is submitted with `prev_expires_at` and the new
   `expires_at` — the full renewal history stays auditable on-chain.
3. The Postgres cache row is updated.

## Frontend flow

In the Domain Tool, switch to the **↺ RENEW** tab, enter the name + TLD, and
run the check. The tool shows the current expiry and the renewal price before
asking the wallet to sign the payment.
