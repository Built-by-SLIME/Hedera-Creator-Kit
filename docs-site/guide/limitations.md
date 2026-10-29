---
outline: deep
---

# Known Limitations

## Mirror Node latency

- New transactions can take up to ~15 seconds to be visible on the Mirror
  Node. Payment verification retries 404s up to 5 times (3 s apart) to absorb
  this.
- HCS topic scans are Mirror Node reads; large topics get slower over time.

## Caching

- HCS topic messages and TLD config are cached for **60 seconds**. Expiry
  filtering happens at read time, so an expired domain can never appear active
  from cache - but a registration made by *someone else* may take up to 60 s
  to show up in your availability checks (our own writes invalidate
  immediately).
- The HBAR price is cached for 5 minutes; on CoinGecko errors a stale price is
  used rather than failing.

## Names

- Standard names: lowercase `[a-z0-9-]`, can't start or end with a hyphen.
- Premium names: any non-ASCII Unicode (including emoji), no whitespace.
- Names are matched case-insensitively against HCS, but the frontend now
  forces lowercase input as you type.

## Concurrency

- The same-name registration lock is **in-memory and per-server-instance**. It
  fully protects a single deployment; a multi-instance deployment should rely
  on the DB `UNIQUE (name, tld)` constraint (second writer gets a 500 from the
  constraint violation rather than a friendly 409).

## Ownership edge cases

- If the domain NFT is **burned**, the name stays registered until expiry and
  the HCS owner remains the resolution fallback. An admin registration can
  re-register the name for the treasury.
- If the NFT is transferred, resolution follows the new holder automatically -
  there is deliberately **no transfer endpoint** (`410 Gone`).

## Renewals of never-registered names

Renew returns `404` if the name has no HCS record at all, and `403` if the
requester isn't the current owner.
