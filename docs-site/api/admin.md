---
outline: deep
---

# Admin Endpoints

All admin endpoints require `DOMAIN_ADMIN_KEY` in the JSON body:

```json
{ "adminKey": "<DOMAIN_ADMIN_KEY>", ... }
```

Unauthorized requests return `401`.

## `POST /api/domains/init-topics`

One-time (idempotent) setup — creates an HCS topic with the operator submit
key for every configured TLD that doesn't have one, and stores the created
topic ids in the `domain_tlds` table.

**Response** `200` — `{ success, topics: { hedera: "0.0.…", ... }, instructions }`

## `GET /api/domains/admin/tlds`

Lists every row in `domain_tlds` (active and disabled).

**Response** `200` — `{ success, tlds: [{ tld, topicId, active, createdAt }] }`

## `POST /api/domains/admin/tlds`

Adds a TLD or re-activates an existing one.

**Body**

| Field | Required | Notes |
|---|---|---|
| `adminKey` | ✓ | |
| `tld` | ✓ | Lowercase `[a-z0-9-]` |
| `topicId` | | Existing HCS topic to use. If omitted, one is created automatically. |

**Response** `200` — `{ success, tld, topicId }`

**Errors** — `400` invalid TLD format · `500` topic creation failure

## `POST /api/domains/admin/tlds/:tld/enable`
## `POST /api/domains/admin/tlds/:tld/disable`

Toggles whether a TLD accepts registrations/resolutions. Instant — the backend
config cache is invalidated on change.

**Response** `200` — `{ success, tld, active }` · `404` unknown TLD

## `POST /api/domains/admin/purge-registrations`

::: danger
Deletes **all rows** from `domain_registrations`. HCS topics, domain NFTs, and
other tables are untouched. Intended as a one-time re-sync utility — HCS
remains the source of truth and will repopulate the cache.
:::

**Response** `200` — `{ success, deleted: <n> }`
