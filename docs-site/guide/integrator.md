---
outline: deep
---

# Wallet Integration Spec

This page is the complete specification a wallet or explorer needs to resolve
SLIME domain names. Everything here is deterministic and verifiable against
the public Mirror Node - no API keys, no private infrastructure.

There are two supported integration paths:

| Path | When to use |
|---|---|
| **A. Server API** | Quickest integration - one HTTP call per lookup. |
| **B. Direct Mirror Node** | Fully trustless - read the HCS topics yourself. Use this if you don't want to depend on our server. |

Both paths return the same answer by construction.

## The data model

A domain registration is two on-chain artifacts:

1. An **HCS message** in the TLD's topic recording the registration/renewal
   history (owner, expiry, NFT serial).
2. A **domain NFT** serial that is the live ownership record.

**Ownership = whoever currently holds the NFT serial.** The HCS `owner` field
is history, not authority - it's only a fallback if the NFT lookup fails.

## Path A - Server API (one call)

```
GET <api-host>/api/domains/resolve/{name}/{tld}
```

(See the [API reference](/api/rest) for the exact response schema; `owner` is
the live NFT holder when resolvable, HCS owner otherwise.)

The server response is cached for at most 60 seconds; our own writes
(register/renew) invalidate immediately.

## Path B - Direct Mirror Node resolution

### Step 1 - Enumerate TLDs and topics

```
GET <api-host>/api/domains/tlds
```

```json
{
  "success": true,
  "tlds": [
    { "tld": "buds",   "topicId": "0.0.98xxxxx" },
    { "tld": "gib",    "topicId": "0.0.98yyyyy" },
    { "tld": "hedera", "topicId": "0.0.98zzzzz" }
  ]
}
```

`topicId` is the HCS topic for that TLD. This list changes rarely; cache it
(we recommend 5–15 minutes).

### Step 2 - Read the topic

```
GET https://mainnet-public.mirrornode.hedera.com/api/v1/topics/{topicId}/messages?limit=100&order=asc
```

Follow `links.next` until exhausted (the public mirror paginates at 100).

Each `message` field is **base64-encoded JSON**. Decode, parse, and skip any
malformed message silently.

### Step 3 - HCS message schema

| Field | Present on | Meaning |
|---|---|---|
| `action` | all | `register` · `admin-register` · `renew` |
| `name` | all | Domain label (e.g. `alice`) |
| `tld` | all | TLD (e.g. `hedera`) |
| `owner` | register, admin-register | Registrant account (`0.0.X`) |
| `new_owner` | (legacy transfers) | Treated as owner when present |
| `years` | all | Term purchased (1, 3, 5, or 10) |
| `expires_at` | all | ISO-8601 expiry of this record |
| `prev_expires_at` | renew | Expiry before this renewal |
| `payment_tx` | all | Mirror-node tx id that funded it |
| `nft_token_id` | register/renew (when minted) | Domain NFT collection |
| `nft_serial` | register/renew (when minted) | The ownership NFT serial |

### Step 4 - Resolve (deterministic algorithm)

```
records = all decoded messages where lower(name) == lower(queryName)
          and lower(tld) == lower(queryTld)

if records is empty:
    return NOT_REGISTERED

latest = record with the highest consensus sequence_number

if latest.expires_at is missing or latest.expires_at <= now:
    return EXPIRED        // treated exactly like NOT_REGISTERED for availability;
                          // for display you may distinguish "registered to X until Y"

owner = latest.new_owner ?? latest.owner

if latest.nft_serial exists:
    holder = GET /api/v1/tokens/{nft_token_id}/nfts/{nft_serial} → account_id
    if holder exists:
        owner = holder    // NFT holder ALWAYS wins

return { owner, expiresAt: latest.expires_at, nftSerial, nftTokenId }
```

Matching is **case-insensitive** on both name and TLD (registrations are
lowercase anyway; this just makes lookups forgiving).

### Step 5 - The NFT holder override

```
GET https://mainnet-public.mirrornode.hedera.com/api/v1/tokens/{nftTokenId}/nfts/{serial}
→ { "account_id": "0.0.123456", ... }
```

If this call fails (network error, serial burned), **fall back to the HCS
`owner`** - never fail the resolution just because the NFT lookup did.

### Worked example

Topic `0.0.98zzzzz` (.hedera) contains, in order:

```json
{"action":"register","name":"alice","tld":"hedera","owner":"0.0.1001","years":1,"expires_at":"2026-06-01T00:00:00Z","payment_tx":"0.0.1001-1717000000-000000000","nft_token_id":"0.0.10354981","nft_serial":42}
{"action":"renew","name":"alice","tld":"hedera","owner":"0.0.1001","years":1,"prev_expires_at":"2026-06-01T00:00:00Z","expires_at":"2027-06-01T00:00:00Z","payment_tx":"0.0.1001-1749000000-000000000","nft_token_id":"0.0.10354981","nft_serial":42}
```

- Highest sequence = the `renew` → `expires_at = 2027-06-01`.
- NFT serial 42 holder lookup → `0.0.2002` (alice sold it).
- **Resolved owner: `0.0.2002`**, not `0.0.1001`.

## Expiry semantics

- A name is **active** iff its latest HCS record has `expires_at` in the
  future.
- Expired names behave exactly like never-registered: anyone can register
  them, and resolution returns not-found.
- Renewals stack: `newExpiry = max(now, currentExpiry) + years`, so renewing
  late never loses paid time.

## Edge cases you must handle

| Case | Behavior |
|---|---|
| Malformed HCS message | Skip silently |
| Name with no messages | Not registered |
| Latest record expired | Not registered (or display as expired-to-owner) |
| NFT burned / holder lookup fails | Fall back to HCS `owner` |
| Unknown or disabled TLD | Not registered (see `GET /api/domains/tlds` for the active set) |
| Topic id null in the tlds list | TLD is configured but its topic hasn't been initialized - treat as not registered |

## Caching guidance

- The public mirror node is rate-limited; don't poll per keystroke.
- Topic messages only change on register/renew - **cache aggressively**
  (minutes, not seconds) and apply the expiry check at read time. A cached
  message can never make an expired domain look active because expiry is a
  property of the message itself.
- Our server caches topic scans for 60 s and invalidates on its own writes;
  if you use Path A you inherit that freshness.

## Reference implementation (TypeScript)

```ts
const MIRROR = 'https://mainnet-public.mirrornode.hedera.com'

async function resolveName(name: string, tld: string, topicId: string) {
  // 1. Read all topic messages (paginated)
  const messages: any[] = []
  let url: string | null = `${MIRROR}/api/v1/topics/${topicId}/messages?limit=100&order=asc`
  while (url) {
    const res = await fetch(url)
    const data = await res.json()
    messages.push(...(data.messages ?? []))
    url = data.links?.next ? (data.links.next.startsWith('http') ? data.links.next : MIRROR + data.links.next) : null
  }

  // 2. Filter to this name, latest sequence wins
  const records = messages
    .map(m => ({ ...JSON.parse(atob(m.message)), seq: m.sequence_number }))
    .filter(r => r.name?.toLowerCase() === name.toLowerCase() && r.tld?.toLowerCase() === tld.toLowerCase())
  if (!records.length) return null
  const latest = records.reduce((a, b) => (b.seq > a.seq ? b : a))
  if (!latest.expires_at || new Date(latest.expires_at) <= new Date()) return null

  // 3. NFT holder override
  let owner = latest.new_owner ?? latest.owner
  if (latest.nft_serial != null) {
    try {
      const nft = await fetch(`${MIRROR}/api/v1/tokens/${latest.nft_token_id}/nfts/${latest.nft_serial}`).then(r => r.json())
      if (nft.account_id) owner = nft.account_id
    } catch { /* fall back to HCS owner */ }
  }
  return { owner, expiresAt: latest.expires_at, nftTokenId: latest.nft_token_id, nftSerial: latest.nft_serial }
}
```

## Questions / changes

The registry is operated by SLIME (Built by SLIME). TLD additions, message
schema changes, and new endpoints are announced via the
[TLD administration](./tld-admin) channel - the `GET /api/domains/tlds`
endpoint is the runtime source of truth for which names resolve.
