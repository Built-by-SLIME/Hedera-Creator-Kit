---
outline: deep
---

# Pricing

## Standard names

Lowercase letters, numbers, and hyphens (`[a-z0-9-]`).

| Length | Price per year |
|---|---|
| 1 character | $100 |
| 2 characters | $50 |
| 3+ characters | $10 |

## Premium names

Names containing non-ASCII characters (including emoji) are **2.5×** standard.

| Length | Price per year |
|---|---|
| 1 character | $250 |
| 2 characters | $150 |
| 3+ characters | $50 |

Premium names must be single "words" - whitespace is rejected.

## Terms

Registrations and renewals are sold in fixed terms: **1, 3, 5, or 10 years**.

## Payment currency

Prices are quoted in USD and converted to HBAR at the current rate
(CoinGecko, cached 5 minutes). The user always pays **HBAR** from their wallet.

## Network fee

A flat **0.5 ℏ** network fee is added to every registration and renewal. It is
sent to the operator account and reimburses the on-chain costs of minting the
domain NFT, transferring it, and submitting the HCS message.

So the wallet transaction a user signs is always:

```
domain price (HBAR)  →  fee account
0.5 ℏ                →  operator account
```

::: warning No service fee
The toolkit charges **only** the quoted domain price plus the 0.5 ℏ network
fee. There are no additional platform or service fees.
:::
