/**
 * Centralized configuration for all frontend tools.
 *
 * Environment variables (set in Railway or local .env):
 *   VITE_API_BASE_URL             — Backend API server URL (default: http://localhost:3001)
 *   VITE_MIRROR_NODE_URL          — Hedera Mirror Node URL (default: https://mainnet-public.mirrornode.hedera.com)
 *   VITE_WALLETCONNECT_PROJECT_ID — WalletConnect Cloud project ID
 *   VITE_SAUCERSWAP_API_KEY       — SaucerSwap REST API key (required for Add Liquidity tool)
 */

import { Client } from '@hashgraph/sdk'

// ---------------------------------------------------------------------------
// Environment-driven settings (override via VITE_* env vars)
// ---------------------------------------------------------------------------

/** Backend API base URL — tools that call the Express API server */
export const API_BASE_URL: string =
  (import.meta as any).env?.VITE_API_BASE_URL || 'http://localhost:3001'

/** Hedera Mirror Node URL — all on-chain queries (balances, tokens, NFTs) */
export const MIRROR_NODE_URL: string =
  (import.meta as any).env?.VITE_MIRROR_NODE_URL || 'https://mainnet-public.mirrornode.hedera.com'

/** WalletConnect Cloud project ID */
export const WALLETCONNECT_PROJECT_ID: string =
  (import.meta as any).env?.VITE_WALLETCONNECT_PROJECT_ID || 'demo-project-id'

/** SaucerSwap REST API key (used for pool validation and price fetching) */
export const SAUCERSWAP_API_KEY: string =
  (import.meta as any).env?.VITE_SAUCERSWAP_API_KEY || ''

/** Backend minter/operator account ID — receives HBAR fee transfers for minting and swaps */
export const BACKEND_MINTER_ACCOUNT: string =
  (import.meta as any).env?.VITE_BACKEND_MINTER_ACCOUNT || ''

/** SaucerSwap REST API base URL */
export const SAUCERSWAP_API_URL = 'https://api.saucerswap.finance'

// ---------------------------------------------------------------------------
// Hedera network constants (mainnet)
// ---------------------------------------------------------------------------

/** Token-gate NFT — users must hold SLIME to access tools */
export const SLIME_TOKEN_ID = '0.0.9474754'

/** SaucerSwap V1 router contract */
export const SAUCER_V1_ROUTER = '0.0.3045981'

/** Wrapped HBAR token on SaucerSwap */
export const WHBAR_TOKEN_ID = '0.0.1456986'

/** Supported TLDs for the HCS domain registry */
export const DOMAIN_SUPPORTED_TLDS = ['hedera', 'slime', 'gib', 'tigers', 'buds'] as const
export type DomainTld = typeof DOMAIN_SUPPORTED_TLDS[number]

/** Treasury wallet — when connected, unlocks free admin domain registration */
export const DOMAIN_ADMIN_ACCOUNT = '0.0.9463056'

// ---------------------------------------------------------------------------
// Spender label registry — curated known spenders for the Allowance Manager
// ---------------------------------------------------------------------------

export interface KnownSpender {
  name: string
  category: 'toolkit' | 'marketplace' | 'dex' | 'wallet' | 'other'
  url?: string
  note?: string
}

const spenderRegistry: Record<string, KnownSpender> = {
  [SAUCER_V1_ROUTER]: {
    name: 'SaucerSwap V1 Router',
    category: 'dex',
    url: 'https://saucerswap.finance',
    note: 'SaucerSwap V1 (AMM) router — current version per official deployment docs',
  },
  '0.0.6755814': {
    name: 'SaucerSwap Router (Fee Variant)',
    category: 'dex',
    url: 'https://saucerswap.finance',
    note: 'SaucerSwap V1 fee-enabled router variant',
  },
  '0.0.3949434': {
    name: 'SaucerSwap V2 SwapRouter',
    category: 'dex',
    url: 'https://saucerswap.finance',
    note: 'SaucerSwap V2 (concentrated liquidity) swap router',
  },
  '0.0.4053945': {
    name: 'SaucerSwap V2 Position Manager',
    category: 'dex',
    url: 'https://saucerswap.finance',
    note: 'Manages SaucerSwap V2 LP positions (position NFTs)',
  },
  '0.0.1461860': {
    name: 'SaucerSwap V1 Router (Deprecated)',
    category: 'dex',
    url: 'https://saucerswap.finance',
    note: 'Superseded by the V1 RouterV3 — safe to revoke',
  },
  '0.0.3949448': {
    name: 'SaucerSwap V2 Position Manager (Deprecated)',
    category: 'dex',
    url: 'https://saucerswap.finance',
    note: 'Superseded by the V2 manager — safe to revoke if no open V2 positions',
  },
  '0.0.1064038': {
    name: 'SentX Treasury',
    category: 'marketplace',
    url: 'https://sentx.io',
    note: 'SentX treasury — issuer of the $SENTX token (0.0.2672057) and their oldest account (since July 2022). Runs the buyback-and-burn. If this appears as a spender it likely dates from SentX early marketplace era (pre-2025).',
  },
  '0.0.10479056': {
    name: 'SentX Marketplace',
    category: 'marketplace',
    url: 'https://sentx.io',
    note: 'SentX operator account (2-of-3 multisig, in use since May 2026 — marketplaces rotate operator keys for security, so this address is newer than the company itself). NFT listings create per-serial or approved-for-all allowances; offers create HBAR allowances. Cancelled listings usually delete them — stale approvals can linger. Approvals granted before May 2026 may point to an older SentX operator account.',
  },
}

// Toolkit operator account — only labelled when configured so creators
// recognize why it appears in their allowance list.
if (BACKEND_MINTER_ACCOUNT) {
  spenderRegistry[BACKEND_MINTER_ACCOUNT] = {
    name: 'SLIME Tools',
    category: 'toolkit',
    note: 'The SLIME Tools operator. Token allowances fund staking reward drips; NFT allowances power swap programs (new NFTs sent to migrating holders). It only ever sends out — revoking stops those programs for your projects.',
  }
}

export const KNOWN_SPENDERS: Record<string, KnownSpender> = spenderRegistry

/** HashScan account page (verification status & trust score live there) */
export function hashscanAccountUrl(accountId: string): string {
  return `https://hashscan.io/mainnet/account/${accountId}`
}

// ---------------------------------------------------------------------------
// Hedera SDK helpers
// ---------------------------------------------------------------------------

/** Pre-configured mainnet client for transaction freezing (no operator keys needed) */
export function getHederaClient(): Client {
  return Client.forMainnet()
}
