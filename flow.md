# Hedera Domain Resolution — HashPack Integration

All endpoints are public GET requests. No API key, no SDK, no auth required.

**Base URL:** `https://api.slime.tools`

---

## Endpoint 1 — Resolve a Single Domain

```
GET /api/domains/resolve/{name}/{tld}
```

Use this when a user types or pastes a domain and you need to look it up.

**Example:**
```
GET https://api.slime.tools/api/domains/resolve/hefty/slime
```

**Response — registered:**
```json
{
  "success": true,
  "domain": "hefty.slime",
  "owner": "0.0.9463056",
  "expiresAt": "2027-03-10T01:06:00.398Z",
  "nftTokenId": "0.0.10356088",
  "nftSerial": 6,
  "hcsTopicId": "0.0.10354663",
  "hcsSequenceNumber": 2
}
```

> `owner` is resolved live from the HTS NFT ledger — secondary market transfers are reflected instantly.

**Response — not registered or expired:**
```json
{
  "success": false,
  "error": "hefty.slime is not registered or has expired"
}
```

---

## Endpoint 2 — List All Domains Owned by an Account

```
GET /api/domains/owned/{accountId}
```

Use this when a wallet connects — returns every active domain they own across all TLDs in one call.
Ownership is verified live against the NFT ledger, so secondary market purchases are included automatically.

**Example:**
```
GET https://api.slime.tools/api/domains/owned/0.0.9463056
```

**Response:**
```json
{
  "success": true,
  "accountId": "0.0.9463056",
  "count": 1,
  "domains": [
    {
      "domain": "hefty.slime",
      "name": "hefty",
      "tld": "slime",
      "owner": "0.0.9463056",
      "expiresAt": "2027-03-10T01:06:00.398Z",
      "nftTokenId": "0.0.10356088",
      "nftSerial": 6,
      "hcsSequenceNumber": 2
    }
  ]
}
```

---

## Endpoint 3 — List All Active Domains for a TLD

```
GET /api/domains/list/{tld}
```

Use this for browsing or discovery — returns every active domain registered under a given TLD.

**Example:**
```
GET https://api.slime.tools/api/domains/list/slime
```

**Response:**
```json
{
  "success": true,
  "tld": "slime",
  "count": 1,
  "domains": [
    {
      "domain": "hefty.slime",
      "name": "hefty",
      "tld": "slime",
      "owner": "0.0.9463056",
      "expiresAt": "2027-03-10T01:06:00.398Z",
      "nftTokenId": "0.0.10356088",
      "nftSerial": 6,
      "hcsSequenceNumber": 2
    }
  ]
}
```

---

## Supported TLDs

| TLD | HCS Topic ID |
|-----|-------------|
| `.hedera` | `0.0.10354662` |
| `.slime` | `0.0.10354663` |
| `.gib` | `0.0.10354664` |
| `.tigers` | `0.0.10357103` |
| `.buds` | `0.0.10357104` |

---

## Under the Hood

```
Incoming GET request
       ↓
Query HCS topic(s) via Hedera Mirror Node
       ↓
Decode messages → group by domain → latest sequence number wins
       ↓
Filter expired domains
       ↓
Verify ownership live against HTS NFT ledger (Endpoints 1 & 2)
       ↓
Return clean JSON
```

- **HCS** (Hedera Consensus Service) — registration ledger, stores domain name, expiry, and NFT serial
- **HTS** (Hedera Token Service) — ownership ledger, whoever holds the NFT is the authoritative owner
- **Latest-sequence-wins** — allows admin to correct failed records; newest HCS message always takes precedence
- **NFT Collection:** `0.0.10356088`

