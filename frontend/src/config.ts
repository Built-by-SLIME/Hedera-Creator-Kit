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
// Hedera SDK helpers
// ---------------------------------------------------------------------------

/** Pre-configured mainnet client for transaction freezing (no operator keys needed) */
export function getHederaClient(): Client {
  return Client.forMainnet()
}
