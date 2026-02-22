/**
 * Centralized configuration for all frontend tools.
 *
 * Environment variables (set in Railway or local .env):
 *   VITE_API_BASE_URL             — Backend API server URL (default: http://localhost:3001)
 *   VITE_MIRROR_NODE_URL          — Hedera Mirror Node URL (default: https://mainnet-public.mirrornode.hedera.com)
 *   VITE_WALLETCONNECT_PROJECT_ID — WalletConnect Cloud project ID
 *   VITE_SAUCERSWAP_API_KEY       — SaucerSwap REST API key
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

/** SaucerSwap REST API key */
export const SAUCERSWAP_API_KEY: string =
  (import.meta as any).env?.VITE_SAUCERSWAP_API_KEY || ''

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

/** HNS (Hedera Name Service) REST API */
export const HNS_API_BASE = 'https://api.prod.hashgraph.name'

/** HNS .hbar domain NFT token */
export const HNS_NFT_TOKEN_ID = '0.0.1234197'

/** HNS fee collection account */
export const HNS_FEE_ACCOUNT = '0.0.1233811'

/** Backend minter account (for HBAR allowance approvals) */
export const BACKEND_MINTER_ACCOUNT = (import.meta as any).env?.VITE_BACKEND_MINTER_ACCOUNT || '0.0.1234567' // TODO: Replace with actual backend account

// ---------------------------------------------------------------------------
// Hedera SDK helpers
// ---------------------------------------------------------------------------

/** Pre-configured mainnet client for transaction freezing (no operator keys needed) */
export function getHederaClient(): Client {
  return Client.forMainnet()
}
