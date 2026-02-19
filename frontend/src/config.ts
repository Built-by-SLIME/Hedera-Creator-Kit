/**
 * Centralized configuration for all frontend tools.
 * 
 * Environment variables (set in Railway or local .env):
 *   VITE_API_BASE_URL        — Backend API server URL (default: http://localhost:3001)
 *   VITE_MIRROR_NODE_URL     — Hedera Mirror Node URL (default: https://mainnet-public.mirrornode.hedera.com)
 *   VITE_WALLETCONNECT_PROJECT_ID — WalletConnect Cloud project ID
 */

// Backend API base URL — used by tools that call the Express API server
// In production (Railway), set VITE_API_BASE_URL to the backend service URL
export const API_BASE_URL: string =
  (import.meta as any).env?.VITE_API_BASE_URL || 'http://localhost:3001'

// Hedera Mirror Node URL — used by all tools for on-chain queries
// In production, set VITE_MIRROR_NODE_URL to your preferred provider (e.g. ValidationCloud)
export const MIRROR_NODE_URL: string =
  (import.meta as any).env?.VITE_MIRROR_NODE_URL || 'https://mainnet-public.mirrornode.hedera.com'

// WalletConnect Project ID
export const WALLETCONNECT_PROJECT_ID: string =
  (import.meta as any).env?.VITE_WALLETCONNECT_PROJECT_ID || 'demo-project-id'

