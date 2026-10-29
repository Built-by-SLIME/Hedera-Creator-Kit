---
outline: deep
---

# Resolution & Listing

## Resolving a name

`GET /api/domains/resolve/:name/:tld`

1. Read every message in the TLD's HCS topic.
2. Keep records for this `name`/`tld`, latest sequence number wins.
3. If the latest record is expired (or has no `expires_at`), the name
   resolves as **404 - not registered or expired**.
4. Otherwise, if the record has an NFT serial, look up the **live holder** of
   that serial on the Mirror Node. The holder is the owner - so secondary
   market sales resolve automatically with no transfer step.

Response:

```json
{
  "success": true,
  "domain": "alice.hedera",
  "owner": "0.0.123456",
  "expiresAt": "2027-10-29T12:00:00.000Z",
  "nftTokenId": "0.0.10354981",
  "nftSerial": 42,
  "hcsTopicId": "0.0.98xxxxx",
  "hcsSequenceNumber": 17
}
```

If the Mirror Node NFT lookup fails, the HCS `owner` field is used as a
fallback.

## Listing a TLD

`GET /api/domains/list/:tld` returns all **active** (non-expired) domains in a
TLD, sorted by name, with owner, expiry, and NFT info.

## Listing by owner

`GET /api/domains/owned/:accountId` works the other direction: it asks the
Mirror Node which domain-NFT serials the account currently holds, then scans
all active TLD topics for records matching those serials. Only non-expired
domains are returned.

::: warning Case sensitivity
HCS matching is case-insensitive (both name and TLD are lowercased before
comparison), but standard names are validated as lowercase at registration
time. Always query with lowercase.
:::

## Listing active TLDs

`GET /api/domains/tlds` returns the currently active TLDs **with their HCS
topic ids**. The frontend uses this to populate its TLD selector without a
redeploy; wallets and explorers use it to resolve names directly against the
Mirror Node (see the [Wallet Integration Spec](/guide/integrator)). On error
the frontend falls back to the hardcoded config list.
