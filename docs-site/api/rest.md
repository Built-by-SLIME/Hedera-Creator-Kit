---
outline: deep
---

# Public Endpoints

Base URL: `https://<api-host>` (the Creator Kit api-server)

All responses are JSON with a `success` boolean; failures include `error`.

## `GET /api/domains/check`

Availability + pricing preview.

**Query params**

| Param | Required | Notes |
|---|---|---|
| `name` | ✓ | Domain name (lowercase for standard) |
| `tld` | ✓ | Must be an active TLD |
| `years` | | 1, 3, 5, or 10 (default 1) |

**Response** `200`

```json
{
  "success": true,
  "available": true,
  "name": "alice",
  "tld": "hedera",
  "years": 1,
  "owner": null,
  "expiresAt": null,
  "priceUsd": 10,
  "priceHbar": 68.1234,
  "hbarPriceUsd": 0.1468,
  "feeAccount": "0.0.xxxx",
  "operatorAccount": "0.0.yyyy",
  "networkFeeHbar": 0.5,
  "nftTokenId": "0.0.10354981"
}
```

**Errors** - `400` invalid name/tld/years · `500` pricing feed failure

## `POST /api/domains/register`

Registers a domain after verifying HBAR payment.

**Body**

| Field | Required | Notes |
|---|---|---|
| `name` | ✓ | |
| `tld` | ✓ | Active TLD |
| `years` | ✓ | 1, 3, 5, or 10 |
| `ownerAccountId` | ✓ | Registrant - also receives the NFT |
| `paymentTxId` | ✓* | Wallet-signed transfer tx id (`0.0.X-seconds-nanos`) |

\* Skipped when `ownerAccountId` is the treasury admin account.

**Response** `200` - registration record, HCS topic/sequence, NFT token id + serial.

**Errors** - `400` validation/payment failure · `409` already registered,
payment replay, or registration in progress · `500` NFT minting failure

## `POST /api/domains/renew`

Renews an existing (or recently expired) domain.

**Body** - same as register; `ownerAccountId` must be the current owner.

**Response** `200` - `newExpiresAt`, HCS topic/sequence.

**Errors** - `403` not the owner · `404` never registered · `409` payment
replay · `400` payment failure

## `GET /api/domains/resolve/:name/:tld`

Resolves a name to its current owner (live NFT holder when available).

**Response** `200`

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

**Errors** - `400` unknown/inactive TLD · `404` not registered or expired

## `GET /api/domains/list/:tld`

All active (non-expired) domains in a TLD.

**Response** `200` - `{ success, tld, count, domains: [{ domain, name, tld, owner, expiresAt, nftTokenId, nftSerial, hcsSequenceNumber }] }`

## `GET /api/domains/owned/:accountId`

All active domains whose NFT the account currently holds (across all active
TLDs). Reflects secondary market transfers automatically.

**Response** `200` - `{ success, accountId, count, domains: [...] }`

## `GET /api/domains/tlds`

Active TLDs with their HCS topic ids (integrators use `topicId` to resolve
names directly against the Mirror Node - see the
[Wallet Integration Spec](/guide/integrator)):

```json
{
  "success": true,
  "tlds": [
    { "tld": "buds", "topicId": "0.0.98xxxxx" },
    { "tld": "gib", "topicId": "0.0.98yyyyy" },
    { "tld": "hedera", "topicId": "0.0.98zzzzz" }
  ]
}
```
