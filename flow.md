# Hedera Domain Resolution — HashPack Integration

Resolve any `.hedera`, `.slime`, `.gib`, `.tigers`, or `.buds` domain with a single GET request. No API key, no SDK, no auth required.

---

## The API Call

```
GET https://api.slime.tools/api/domains/resolve?name={name}&tld={tld}
```

### Registered Domain

```json
{
  "registered": true,
  "name": "hefty",
  "tld": "slime",
  "domain": "hefty.slime",
  "owner": "0.0.9463056",
  "expires_at": "2027-03-10T00:00:00.000Z",
  "nft_token_id": "0.0.10356088",
  "nft_serial": 6
}
```

> `owner` is resolved live from the HTS NFT ledger — secondary market transfers are reflected instantly.

### Not Registered or Expired

```json
{
  "registered": false,
  "error": "hefty.slime is not registered or has expired"
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
GET /api/domains/resolve?name=hefty&tld=slime
       ↓
Query HCS topic for the TLD via Hedera Mirror Node
       ↓
Decode messages → filter by name + tld → latest sequence number wins
       ↓
Check expires_at — past = not registered
       ↓
Fetch live NFT holder from HTS Mirror Node
       ↓
Return clean JSON
```

- **HCS** (Hedera Consensus Service) — registration ledger, stores domain records
- **HTS** (Hedera Token Service) — ownership ledger, whoever holds the NFT is the owner
- **Latest-sequence-wins** — allows admin to correct failed records; newest HCS message is always authoritative

