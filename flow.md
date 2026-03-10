# Domain Resolution Flow — Hedera Creator Kit

How HashPack (or any wallet/app) resolves a domain with a **single API call**. All the HCS querying, decoding, and NFT ownership lookup happens on our backend — the caller just gets clean JSON back.

---

## The One Call HashPack Needs to Make

```
GET https://api.slime.tools/api/domains/resolve?name={name}&tld={tld}
```

### Example

```
GET https://api.slime.tools/api/domains/resolve?name=hefty&tld=slime
```

### Response

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

> `owner` is pulled **live from the HTS NFT ledger** — not from the registration record. Secondary market transfers are reflected instantly with no extra steps.

### Not Registered / Expired

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

## How It Works Under the Hood

HashPack doesn't need to know any of this — it's all handled server-side.

```
HashPack calls GET /api/domains/resolve?name=hefty&tld=slime
       ↓
Backend queries HCS topic for the TLD
       ↓
Decodes all messages, filters by name + tld
       ↓
Selects the message with the highest sequence number  ← Latest-Sequence-Wins
       ↓
Checks expires_at — expired = not registered
       ↓
Fetches current NFT holder live from the Hedera Mirror Node
       ↓
Returns clean JSON to HashPack
```

---

## Key Properties

- **One GET request** — no API key, no auth, no SDK required
- **NFT-authoritative ownership** — the HTS ledger is always the final word; transfers on any marketplace resolve automatically
- **Admin-correctable** — failed mints or phantom records can be overwritten; latest-sequence-wins handles it transparently
- **Expiry enforced** — domains past their `expires_at` are treated as unregistered
- **No centralized database** — HCS is the registration ledger, HTS is the ownership ledger

