/**
 * WalletConnect Service
 * Manages wallet connection state and interactions
 */

import {
  HederaSessionEvent,
  HederaJsonRpcMethod,
  DAppConnector,
  HederaChainId,
} from '@hashgraph/hedera-wallet-connect'
import { LedgerId, AccountId } from '@hashgraph/sdk'
import { MIRROR_NODE_URL, WALLETCONNECT_PROJECT_ID } from '../config'

export interface WalletState {
  connected: boolean
  accountId: string | null
  network: string
  hbarBalance: string | null
  hasSlime: boolean | null  // null = not checked yet, true/false = checked
}

class WalletConnectService {
  private static instance: WalletConnectService
  private dAppConnector: DAppConnector | null = null
  private static readonly SLIME_TOKEN_ID = '0.0.9474754'

  private walletState: WalletState = {
    connected: false,
    accountId: null,
    network: 'MAINNET',
    hbarBalance: null,
    hasSlime: null
  }
  private listeners: Set<(state: WalletState) => void> = new Set()

  private constructor() {}

  static getInstance(): WalletConnectService {
    if (!WalletConnectService.instance) {
      WalletConnectService.instance = new WalletConnectService()
    }
    return WalletConnectService.instance
  }

  async init(): Promise<void> {
    if (this.dAppConnector) {
      console.log('DAppConnector already initialized')
      return
    }

    console.log('Initializing WalletConnect DAppConnector...')

    const metadata = {
      name: 'Hedera Creator Kit',
      description: 'NFT & Token Creation Toolkit for Hedera',
      url: window.location.origin,
      icons: ['https://avatars.githubusercontent.com/u/31002956'],
    }

    const projectId = WALLETCONNECT_PROJECT_ID
    console.log('Using WalletConnect Project ID:', projectId)

    this.dAppConnector = new DAppConnector(
      metadata,
      LedgerId.MAINNET,
      projectId,
      Object.values(HederaJsonRpcMethod),
      [HederaSessionEvent.ChainChanged, HederaSessionEvent.AccountsChanged],
      [HederaChainId.Mainnet, HederaChainId.Testnet],
    )

    console.log('Calling dAppConnector.init()...')
    await this.dAppConnector.init({ logger: 'error' })
    console.log('DAppConnector initialized successfully')

    // Listen for session events
    if (typeof (this.dAppConnector as any).onSessionEvent === 'function') {
      (this.dAppConnector as any).onSessionEvent((event: any) => {
        console.log('Session event:', event)
        this.updateWalletState()
      })
    }

    // Check for existing sessions
    this.updateWalletState()
  }

  async connect(): Promise<void> {
    console.log('WalletConnectService.connect() called')

    if (!this.dAppConnector) {
      console.log('Initializing DAppConnector...')
      await this.init()
    }

    try {
      console.log('Opening WalletConnect modal...')
      await this.dAppConnector!.openModal()
      console.log('Modal opened successfully')
      this.updateWalletState()
    } catch (error) {
      console.error('Failed to connect wallet:', error)
      throw error
    }
  }

  async disconnect(): Promise<void> {
    if (this.dAppConnector) {
      await this.dAppConnector.disconnectAll()
      this.walletState = {
        connected: false,
        accountId: null,
        network: 'MAINNET',
        hbarBalance: null,
        hasSlime: null
      }
      this.notifyListeners()
    }
  }

  private updateWalletState(): void {
    if (!this.dAppConnector) return

    const sessions = this.dAppConnector.walletConnectClient?.session.getAll()
    
    if (sessions && sessions.length > 0) {
      const session = sessions[0]
      const namespaces = session.namespaces
      
      // Get account from hedera namespace
      const hederaNamespace = namespaces['hedera']
      if (hederaNamespace && hederaNamespace.accounts.length > 0) {
        // Format: "hedera:testnet:0.0.123456"
        const accountString = hederaNamespace.accounts[0]
        const accountId = accountString.split(':')[2]
        
        this.walletState = {
          connected: true,
          accountId,
          network: accountString.split(':')[1].toUpperCase(),
          hbarBalance: this.walletState.hbarBalance,
          hasSlime: this.walletState.hasSlime
        }
      }
    } else {
      this.walletState = {
        connected: false,
        accountId: null,
        network: 'MAINNET',
        hbarBalance: null,
        hasSlime: null
      }
    }

    this.notifyListeners()

    // If connected, fetch balance and check SLIME
    if (this.walletState.connected && this.walletState.accountId) {
      this.fetchAccountInfo(this.walletState.accountId)
    }
  }

  private async fetchAccountInfo(accountId: string): Promise<void> {
    try {
      // Fetch HBAR balance
      const balanceRes = await fetch(`${MIRROR_NODE_URL}/api/v1/balances?account.id=${accountId}`)
      if (balanceRes.ok) {
        const balanceData = await balanceRes.json()
        if (balanceData.balances && balanceData.balances.length > 0) {
          const tinybar = parseInt(balanceData.balances[0].balance)
          const hbar = (tinybar / 100_000_000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          this.walletState.hbarBalance = hbar
        }
      }

      // Check for SLIME NFT
      const nftRes = await fetch(`${MIRROR_NODE_URL}/api/v1/tokens/${WalletConnectService.SLIME_TOKEN_ID}/balances?account.id=${accountId}`)
      if (nftRes.ok) {
        const nftData = await nftRes.json()
        const hasSlime = nftData.balances && nftData.balances.length > 0 && parseInt(nftData.balances[0].balance) > 0
        this.walletState.hasSlime = hasSlime
      } else {
        this.walletState.hasSlime = false
      }

      this.notifyListeners()
    } catch (err) {
      console.error('Failed to fetch account info:', err)
      this.walletState.hasSlime = false
      this.notifyListeners()
    }
  }

  getState(): WalletState {
    return { ...this.walletState }
  }

  subscribe(listener: (state: WalletState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => listener(this.getState()))
  }

  getSigner(accountId: string) {
    if (!this.dAppConnector) {
      throw new Error('Wallet not connected')
    }
    return (this.dAppConnector as any).getSigner(AccountId.fromString(accountId))
  }
}

export default WalletConnectService.getInstance()

