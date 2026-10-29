---
outline: deep
---

# TLD Administration

TLDs are configured in the `domain_tlds` Postgres table - no redeploy needed
to add, retire, or reactivate a TLD. All admin endpoints require the
`DOMAIN_ADMIN_KEY` in the request body.

## Listing configured TLDs

```bash
curl -X GET https://<api-host>/api/domains/admin/tlds \
  -H 'Content-Type: application/json' \
  -d '{"adminKey": "<DOMAIN_ADMIN_KEY>"}'
```

```json
{
  "success": true,
  "tlds": [
    { "tld": "hedera", "topicId": "0.0.98xxxxx", "active": true, "createdAt": "..." },
    { "tld": "slime",  "topicId": "0.0.98yyyyy", "active": true, "createdAt": "..." }
  ]
}
```

## Adding a TLD

```bash
curl -X POST https://<api-host>/api/domains/admin/tlds \
  -H 'Content-Type: application/json' \
  -d '{"adminKey": "<DOMAIN_ADMIN_KEY>", "tld": "pandas"}'
```

If `topicId` is omitted, an HCS topic with the operator's submit key is
created automatically and stored on the row. If the TLD already exists it is
re-activated and its topic id updated (only when a new one is supplied).

The topic id resolution order for a TLD is:

1. `domain_tlds.hcs_topic_id` (DB)
2. `DOMAIN_TOPIC_ID_<TLD>` env var (fallback)

## Enabling / disabling

```bash
curl -X POST https://<api-host>/api/domains/admin/tlds/pandas/disable \
  -H 'Content-Type: application/json' \
  -d '{"adminKey": "<DOMAIN_ADMIN_KEY>"}'
```

Disabled TLDs reject registration, renewal, resolution, and listing requests
("tld must be one of: ..."), but their HCS topics and DB rows are untouched -
re-enabling is instant.

## One-time topic initialization

`POST /api/domains/init-topics` (admin key in body) walks every configured TLD
and creates any missing HCS topic, persisting created topic ids into
`domain_tlds`. Safe to re-run: existing topic ids are kept.

## Config propagation

The backend caches TLD config for 60 seconds and invalidates that cache on
every admin change, so enable/disable/add takes effect immediately.
