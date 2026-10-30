/**
 * Allowance Manager Component
 * View everything that can be taken from the connected wallet (HBAR, fungible
 * tokens, NFT serials) and revoke allowances — network fees only, wallet-signed.
 */

import {
  AccountAllowanceApproveTransaction,
  AccountAllowanceDeleteTransaction,
  AccountId,
  Hbar,
  NftId,
  TokenId,
  Transaction,
  TransactionId,
} from '@hashgraph/sdk'
import { getHederaClient, hashscanAccountUrl, KNOWN_SPENDERS, MIRROR_NODE_URL } from '../config'
import WalletConnectService from '../services/WalletConnectService'

interface SpenderInfo {
  id: string
  kind: 'contract' | 'account'
  known: (typeof KNOWN_SPENDERS)[string] | null
}

interface HbarAllowanceRow {
  spender: string
  amountTinybars: string
  grantedAt: string | null
}

interface TokenAllowanceRow {
  spender: string
  tokenId: string
  amountRaw: string
  grantedAt: string | null
}

interface NftApprovalRow {
  spender: string
  tokenId: string
  approvedForAll: boolean
  serials: number[]
}

interface TokenMeta {
  symbol: string
  name: string
  decimals: number
}

type Tab = 'all' | 'hbar' | 'tokens' | 'nfts'
type Risk = 'high' | 'access' | 'elevated' | 'stale' | 'info'

const MAX_ALLOWANCE = BigInt('9223372036854775807')

export class AllowanceTool {
  private static hbarRows: HbarAllowanceRow[] = []
  private static tokenRows: TokenAllowanceRow[] = []
  private static nftRows: NftApprovalRow[] = []
  private static spenderCache: Map<string, SpenderInfo> = new Map()
  private static tokenCache: Map<string, TokenMeta> = new Map()

  private static loadedAccount: string | null = null
  private static loading = false
  private static scanning = false
  private static cancelScan = false
  private static scanCount = 0
  private static error: string | null = null
  private static statusMessage: string | null = null

  private static activeTab: Tab = 'all'
  private static riskOnly = false
  private static search = ''
  private static expandedSerials: Set<string> = new Set()
  private static revoking = false

  static render(): string {
    return `
      <div class="terminal-window">
        ${this.renderChrome()}
        ${this.renderContent()}
        ${this.renderStatusBar()}
      </div>
    `
  }

  private static renderChrome(): string {
    return `
      <div class="window-chrome">
        <div class="window-controls">
          <div class="window-dot close"></div>
          <div class="window-dot minimize"></div>
          <div class="window-dot maximize"></div>
        </div>
        <div class="window-title">slime-tools</div>
      </div>
    `
  }

  private static renderContent(): string {
    return `
      <div class="terminal-content">
        <div class="alv-layout">
          <div class="alv-left">
            ${this.renderControls()}
          </div>
          <div class="alv-right">
            ${this.renderResults()}
          </div>
        </div>
      </div>
    `
  }

  private static renderControls(): string {
    const accountId = WalletConnectService.getState().accountId
    const spenders = this.uniqueSpenders()
    const unlimitedTokens = this.tokenRows.filter(r => this.isUnlimited(r.amountRaw)).length
    const allNfts = this.nftRows.filter(r => r.approvedForAll).length
    const highRisk = this.spenderCards().reduce((n, c) => n + c.rows.filter(r => r.risk === 'high').length, 0)
    return `
      <div class="token-input-section">
        <h3 class="section-title">Allowance Manager</h3>

        <div class="back-link" id="alv-back-link">
          <span class="back-arrow">←</span>
          <span>Back</span>
        </div>

        <p class="alv-intro">
          Everything listed here is a spender that <strong>can take</strong> HBAR,
          tokens, or NFTs from this wallet. Revoking only ever costs the Hedera
          network fee (~$0.01) — no service fees.
        </p>

        <div class="info-grid alv-summary">
          <div class="info-item">
            <span class="info-label">Wallet:</span>
            <span class="info-value">${accountId ?? 'Not connected'}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Spenders:</span>
            <span class="info-value">${spenders.length}</span>
          </div>
          <div class="info-item">
            <span class="info-label">HBAR Allowances:</span>
            <span class="info-value">${this.hbarRows.length}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Unlimited Token Allowances:</span>
            <span class="info-value">${unlimitedTokens}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Approved-For-All NFTs:</span>
            <span class="info-value">${allNfts}</span>
          </div>
          <div class="info-item">
            <span class="info-label">High Risk Items:</span>
            <span class="info-value">${highRisk > 0 ? `⚠ ${highRisk}` : '0'}</span>
          </div>
        </div>

        <div class="alv-tabs">
          ${(['all', 'hbar', 'tokens', 'nfts'] as Tab[]).map(tab => `
            <button class="alv-tab ${this.activeTab === tab ? 'active' : ''}" data-tab="${tab}">
              ${tab.toUpperCase()}
            </button>
          `).join('')}
        </div>

        <div class="alv-filters">
          <label class="alv-check">
            <input type="checkbox" id="alv-risk-only" ${this.riskOnly ? 'checked' : ''} />
            Risk items only
          </label>
          <input
            type="text"
            id="alv-search"
            class="token-input alv-search"
            placeholder="Search spender or token..."
            value="${this.escapeHtml(this.search)}"
            autocomplete="off"
          />
        </div>

        <button id="alv-rescan-btn" class="terminal-button" ${this.loading || this.revoking ? 'disabled' : ''}>
          <span>${this.loading ? 'LOADING...' : 'RESCAN ALLOWANCES'}</span>
        </button>

        ${this.renderScanProgress()}
      </div>
    `
  }

  private static renderScanProgress(): string {
    if (!this.scanning) return ''
    return `
      <div class="alv-scan-box">
        <div class="alv-scan-label">
          <span class="token-gate-spinner">⟳</span>
          Scanning NFT holdings for per-serial approvals... ${this.scanCount.toLocaleString()} checked
        </div>
        <button id="alv-cancel-scan" class="terminal-button-secondary">CANCEL</button>
      </div>
    `
  }

  private static renderResults(): string {
    if (this.loading) {
      return `<div class="loading-state">
        <div class="spinner"></div>
        <p>Loading allowances...</p>
      </div>`
    }

    // Never hide data behind an error — if anything loaded, show it with a banner.
    const banner = this.error
      ? `<div class="alv-warning-banner">⚠ ${this.escapeHtml(this.error)}</div>`
      : ''

    if (!this.loadedAccount) {
      return `${banner}<div class="empty-state">
        <p>Connect a wallet to inspect its allowances.</p>
      </div>`
    }

    const cards = this.spenderCards()
    if (cards.length === 0) {
      if (this.error) return banner
      const filtered = this.hasAnyData() && (this.activeTab !== 'all' || this.riskOnly || this.search.trim())
      return `<div class="empty-state">
        <p>${filtered
          ? 'No allowances match the current filters.'
          : '✓ Nothing can be taken from this wallet — no allowances found.'}</p>
      </div>`
    }

    return banner + cards.map(card => this.renderSpenderCard(card)).join('')
  }

  // -------------------------------------------------------------------------
  // Data assembly
  // -------------------------------------------------------------------------

  private static uniqueSpenders(): string[] {
    const set = new Set<string>()
    this.hbarRows.forEach(r => set.add(r.spender))
    this.tokenRows.forEach(r => set.add(r.spender))
    this.nftRows.forEach(r => set.add(r.spender))
    return [...set]
  }

  private static hasAnyData(): boolean {
    return this.hbarRows.length > 0 || this.tokenRows.length > 0 || this.nftRows.length > 0
  }

  private static spenderCards(): SpenderCard[] {
    const map = new Map<string, SpenderCard>()

    const ensure = (spender: string): SpenderCard => {
      let card = map.get(spender)
      if (!card) {
        card = { spender, rows: [] }
        map.set(spender, card)
      }
      return card
    }

    for (const row of this.hbarRows) {
      if (this.activeTab !== 'all' && this.activeTab !== 'hbar') continue
      if (this.isUnlimited(row.amountTinybars)) continue // unlimited HBAR rows are rendered as one line
      ensure(row.spender).rows.push({
        kind: 'hbar',
        key: `hbar|${row.spender}`,
        asset: 'HBAR',
        detail: `${this.formatHbar(row.amountTinybars)} ℏ`,
        grantedAt: row.grantedAt,
        risk: 'high',
      })
    }

    // An unlimited HBAR allowance grants the whole HBAR balance — always high risk.
    for (const spender of this.uniqueSpenders()) {
      const unlimitedHbar = this.hbarRows.filter(r => r.spender === spender && this.isUnlimited(r.amountTinybars))
      if (unlimitedHbar.length > 0 && (this.activeTab === 'all' || this.activeTab === 'hbar')) {
        ensure(spender).rows.push({
          kind: 'hbar',
          key: `hbar-unlim|${spender}`,
          asset: 'HBAR',
          detail: 'UNLIMITED — entire HBAR balance',
          grantedAt: unlimitedHbar[0].grantedAt,
          risk: 'high',
        })
      }
    }

    for (const row of this.tokenRows) {
      if (this.activeTab !== 'all' && this.activeTab !== 'tokens') continue
      const meta = this.tokenCache.get(row.tokenId)
      const symbol = meta?.symbol ?? row.tokenId
      const unlimited = this.isUnlimited(row.amountRaw)
      const amount = unlimited
        ? 'UNLIMITED — entire balance'
        : `${this.formatTokenAmount(row.amountRaw, meta?.decimals ?? 0)} ${symbol}`
      ensure(row.spender).rows.push({
        kind: 'token',
        key: `token|${row.tokenId}|${row.spender}`,
        asset: `${symbol}${meta && meta.name ? ` · ${meta.name}` : ''} (${row.tokenId})`,
        detail: amount,
        grantedAt: row.grantedAt,
        risk: unlimited ? 'high' : 'elevated',
      })
    }

    for (const row of this.nftRows) {
      if (this.activeTab !== 'all' && this.activeTab !== 'nfts') continue
      const meta = this.tokenCache.get(row.tokenId)
      const name = meta?.name ?? row.tokenId
      ensure(row.spender).rows.push({
        kind: 'nft',
        key: `nft|${row.tokenId}|${row.spender}`,
        asset: `${name}${meta && meta.name ? ` (${row.tokenId})` : ''}`,
        detail: row.approvedForAll
          ? 'ANY SERIAL — entire collection'
          : `${row.serials.length} serial${row.serials.length === 1 ? '' : 's'}`,
        grantedAt: null,
        risk: row.approvedForAll ? 'high' : 'elevated',
        serials: row.approvedForAll ? [] : [...row.serials].sort((a, b) => a - b),
        tokenId: row.tokenId,
      })
    }

    const cards = [...map.values()]

    // Risk reflects exposure class + whether we can vouch for the spender:
    //   stale  — known but superseded → actionable, not dangerous
    //   high   — full access held by an UNKNOWN spender → the only red
    //   access — full access held by a known spender → amber, be aware
    //   info   — known spender, limited exposure → green
    //   elevated — unknown spender, limited exposure → amber caution
    for (const card of cards) {
      const known = KNOWN_SPENDERS[card.spender] ?? null
      for (const row of card.rows) {
        const fullAccess = row.risk === 'high'
        if (known?.stale) {
          row.risk = 'stale'
        } else if (known) {
          row.risk = fullAccess ? 'access' : 'info'
        } else if (!fullAccess) {
          row.risk = 'elevated'
        }
      }
    }

    let filtered = cards
    if (this.riskOnly) {
      filtered = filtered
        .map(c => ({ ...c, rows: c.rows.filter(r => r.risk !== 'info') }))
        .filter(c => c.rows.length > 0)
    }

    const q = this.search.trim().toLowerCase()
    if (q) {
      filtered = filtered
        .map(c => {
          const spenderText = `${c.spender} ${KNOWN_SPENDERS[c.spender]?.name ?? ''}`.toLowerCase()
          const matching = c.rows.filter(r => {
            const meta2 = this.tokenCache.get(r.tokenId ?? '')
            return r.asset.toLowerCase().includes(q)
              || (meta2 && `${meta2.symbol} ${meta2.name}`.toLowerCase().includes(q))
              || spenderText.includes(q)
          })
          return { ...c, rows: matching }
        })
        .filter(c => c.rows.length > 0)
    }

    return filtered.sort((a, b) => this.cardSortWeight(b) - this.cardSortWeight(a))
  }

  private static cardSortWeight(card: SpenderCard): number {
    const max = (rs: CardRow[]): number => rs.reduce((n, r) => Math.max(n, this.riskWeight(r.risk)), 0)
    return max(card.rows)
  }

  private static riskWeight(risk: Risk): number {
    return risk === 'high' ? 4 : risk === 'stale' ? 3 : risk === 'access' ? 2 : risk === 'elevated' ? 1 : 0
  }

  private static renderSpenderCard(card: SpenderCard): string {
    const info = this.spenderCache.get(card.spender)
    const known = info?.known ?? KNOWN_SPENDERS[card.spender] ?? null
    const isContract = info?.kind === 'contract'
    const kindChip = info
      ? (isContract ? `<span class="alv-chip alv-chip-contract">SMART CONTRACT</span>` : `<span class="alv-chip alv-chip-wallet">WALLET</span>`)
      : `<span class="alv-chip alv-chip-unknown">UNKNOWN</span>`
    const catChip = known ? `<span class="alv-chip alv-chip-cat">${known.category.toUpperCase()}</span>` : ''
    const displayName = known?.name ?? (isContract ? 'Unlabeled smart contract' : 'Unknown wallet')
    const note = known?.note ?? (known ? '' :
      isContract
        ? 'An unlabeled smart contract can move the approved assets at any time. Verify it on HashScan before leaving this allowance active.'
        : 'An unknown wallet (not a smart contract) holds this allowance. Only leave it active if you know exactly who controls it.')

    return `
      <div class="alv-spender-card">
        <div class="alv-spender-header">
          <div class="alv-spender-title-row">
            <span class="alv-spender-name">${this.escapeHtml(displayName)}</span>
            ${kindChip}
            ${catChip}
          </div>
          <div class="alv-spender-id">
            <span>${card.spender}</span>
            <a href="${hashscanAccountUrl(card.spender)}" target="_blank" rel="noopener noreferrer" class="alv-hashscan-link">HASHSCAN ↗</a>
          </div>
          <div class="alv-spender-note">${this.escapeHtml(note)}</div>
        </div>
        <div class="alv-rows">
          ${card.rows.map(row => this.renderRow(row, card.spender)).join('')}
        </div>
        <div class="alv-spender-footer">
          <button class="terminal-button alv-revoke-all" data-revoke-spender="${card.spender}" ${this.revoking || this.scanning ? 'disabled' : ''}>
            REVOKE ALL FOR THIS SPENDER
          </button>
        </div>
      </div>
    `
  }

  private static renderRow(row: CardRow, spender: string): string {
    const riskChip = row.risk === 'high'
      ? `<span class="alv-risk alv-risk-high">HIGH RISK</span>`
      : row.risk === 'access'
        ? `<span class="alv-risk alv-risk-access">FULL ACCESS</span>`
        : row.risk === 'stale'
          ? `<span class="alv-risk alv-risk-stale">STALE — SAFE TO REVOKE</span>`
          : row.risk === 'elevated'
            ? `<span class="alv-risk alv-risk-elevated">CAUTION</span>`
            : `<span class="alv-risk alv-risk-info">KNOWN</span>`

    const serialKey = row.tokenId ? `${row.tokenId}|${spender}` : ''
    const expanded = serialKey && this.expandedSerials.has(serialKey)

    return `
      <div class="alv-row">
        <div class="alv-row-main">
          <span class="alv-asset">${this.escapeHtml(row.asset)}</span>
          <span class="alv-access">${this.escapeHtml(row.detail)}</span>
          ${riskChip}
        </div>
        <div class="alv-row-side">
          ${row.grantedAt ? `<span class="alv-granted">${this.formatDate(row.grantedAt)}</span>` : ''}
          ${row.serials && row.serials.length > 0 ? `
            <button class="alv-serial-toggle" data-serial-toggle="${serialKey}">
              ${expanded ? 'HIDE SERIALS' : `SHOW ${row.serials.length} SERIAL${row.serials.length === 1 ? '' : 'S'}`}
            </button>
          ` : ''}
          <button class="terminal-button-secondary alv-revoke" data-revoke-key="${row.key}" ${this.revoking || this.scanning ? 'disabled' : ''}>
            REVOKE
          </button>
        </div>
        ${expanded && row.serials ? `
          <div class="alv-serials">${row.serials.map(s => `<span class="alv-serial">#${s}</span>`).join('')}</div>
        ` : ''}
      </div>
    `
  }

  private static renderStatusBar(): string {
    const state = WalletConnectService.getState()
    return `
      <div class="status-bar">
        <div class="status-left">
          <span class="status-item">${state.accountId ?? 'Not Connected'}</span>
        </div>
        <div class="status-center">
          <span class="status-item">${this.statusMessage ?? 'Built by SLIME'}</span>
        </div>
        <div class="status-right">
          <span class="status-item">SLIME TOOLS v1.2</span>
          <span class="status-item">MAINNET</span>
        </div>
      </div>
    `
  }

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------

  static init(): void {
    this.attachEventListeners()

    const accountId = WalletConnectService.getState().accountId
    if (accountId && accountId !== this.loadedAccount && !this.loading && !this.revoking) {
      void this.loadFor(accountId)
    }
  }

  private static attachEventListeners(): void {
    document.getElementById('alv-back-link')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('navigate-to-tool', { detail: { toolId: 'home' } }))
    })

    document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.activeTab = (btn.dataset.tab as Tab) ?? 'all'
        this.refresh()
      })
    })

    document.getElementById('alv-risk-only')?.addEventListener('change', (e) => {
      this.riskOnly = (e.target as HTMLInputElement).checked
      this.refresh()
    })

    const searchInput = document.getElementById('alv-search') as HTMLInputElement | null
    searchInput?.addEventListener('input', () => {
      this.search = searchInput.value
      const right = document.querySelector('.alv-right')
      if (right) {
        right.innerHTML = this.renderResults()
        this.attachRowListeners()
      }
    })

    document.getElementById('alv-rescan-btn')?.addEventListener('click', () => {
      const accountId = WalletConnectService.getState().accountId
      if (accountId) void this.loadFor(accountId)
    })

    document.getElementById('alv-cancel-scan')?.addEventListener('click', () => {
      this.cancelScan = true
    })

    this.attachRowListeners()
  }

  private static attachRowListeners(): void {
    document.querySelectorAll<HTMLButtonElement>('[data-serial-toggle]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.serialToggle ?? ''
        if (this.expandedSerials.has(key)) this.expandedSerials.delete(key)
        else this.expandedSerials.add(key)
        this.refresh()
      })
    })

    document.querySelectorAll<HTMLButtonElement>('[data-revoke-key]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.revokeKey
        if (key) void this.revokeByKey(key)
      })
    })

    document.querySelectorAll<HTMLButtonElement>('[data-revoke-spender]').forEach(btn => {
      btn.addEventListener('click', () => {
        const spender = btn.dataset.revokeSpender
        if (spender) void this.revokeForSpender(spender)
      })
    })
  }

  private static async loadFor(accountId: string): Promise<void> {
    if (this.loading) return
    this.loading = true
    this.error = null
    this.statusMessage = null
    this.loadedAccount = accountId
    this.hbarRows = []
    this.tokenRows = []
    this.nftRows = []
    this.expandedSerials.clear()
    this.spenderCache.clear()
    this.tokenCache.clear()
    this.refresh()

    try {
      await Promise.all([
        this.fetchAllowances(accountId, 'hbar'),
        this.fetchAllowances(accountId, 'tokens'),
        this.fetchAllowances(accountId, 'nfts'),
      ])

      const tokenIds = new Set<string>()
      this.tokenRows.forEach(r => tokenIds.add(r.tokenId))
      this.nftRows.forEach(r => tokenIds.add(r.tokenId))
      await Promise.all([
        this.enrichTokens([...tokenIds]),
        this.classifySpenders(this.uniqueSpenders()),
      ])

      this.loading = false
      this.refresh()

      await this.scanNftHoldings(accountId)
    } catch (err) {
      this.loading = false
      this.error = err instanceof Error ? err.message : 'Failed to load allowances'
      this.refresh()
    }
  }

  private static async fetchAllowances(accountId: string, kind: 'hbar' | 'tokens' | 'nfts'): Promise<void> {
    let next: string | null = `${MIRROR_NODE_URL}/api/v1/accounts/${accountId}/allowances/${kind}?limit=100`

    while (next) {
      const res: any = await fetch(next)
      // Mirror returns 404 (instead of an empty list) when the account has no
      // allowances of this type — that is a normal, healthy state.
      if (res.status === 404) return
      if (!res.ok) throw new Error(`Mirror node returned ${res.status} for ${kind} allowances`)
      const data: any = await res.json()

      for (const a of data.allowances ?? []) {
        const grantedAt = a.timestamp?.from ?? null
        if (kind === 'hbar') {
          this.hbarRows.push({ spender: a.spender, amountTinybars: String(a.amount), grantedAt })
        } else if (kind === 'tokens') {
          this.tokenRows.push({ spender: a.spender, tokenId: a.token_id, amountRaw: String(a.amount), grantedAt })
        } else {
          const existing = this.nftRows.find(r => r.tokenId === a.token_id && r.spender === a.spender)
          if (a.approved_for_all === true) {
            if (existing) existing.approvedForAll = true
            else this.nftRows.push({ spender: a.spender, tokenId: a.token_id, approvedForAll: true, serials: [] })
          } else if (a.serial_number != null) {
            if (existing) existing.serials.push(a.serial_number)
            else this.nftRows.push({ spender: a.spender, tokenId: a.token_id, approvedForAll: false, serials: [a.serial_number] })
          }
        }
      }

      next = data.links?.next ? `${MIRROR_NODE_URL}${data.links.next}` : null
    }
  }

  private static async enrichTokens(tokenIds: string[]): Promise<void> {
    await this.pool(tokenIds, 4, async (tokenId) => {
      if (this.tokenCache.has(tokenId)) return
      try {
        const res = await fetch(`${MIRROR_NODE_URL}/api/v1/tokens/${tokenId}`)
        if (!res.ok) throw new Error()
        const data = await res.json()
        this.tokenCache.set(tokenId, {
          symbol: data.symbol ?? tokenId,
          name: data.name ?? '',
          decimals: parseInt(data.decimals ?? '0', 10),
        })
      } catch {
        this.tokenCache.set(tokenId, { symbol: tokenId, name: '', decimals: 0 })
      }
    })
  }

  private static async classifySpenders(spenders: string[]): Promise<void> {
    await this.pool(spenders, 4, async (spender) => {
      if (this.spenderCache.has(spender)) return
      const known = KNOWN_SPENDERS[spender] ?? null
      let kind: 'contract' | 'account' = 'account'
      try {
        const res = await fetch(`${MIRROR_NODE_URL}/api/v1/contracts/${spender}`)
        kind = res.ok ? 'contract' : 'account'
      } catch {
        kind = 'account'
      }
      this.spenderCache.set(spender, { id: spender, kind, known })
    })
  }

  private static async scanNftHoldings(accountId: string): Promise<void> {
    this.scanning = true
    this.cancelScan = false
    this.scanCount = 0
    this.refresh()

    const found = new Map<string, number[]>()

    try {
      let next: string | null = `${MIRROR_NODE_URL}/api/v1/accounts/${accountId}/nfts?limit=100`
      while (next && !this.cancelScan) {
        const res = await fetch(next)
        if (!res.ok) throw new Error(`Mirror node returned ${res.status} while scanning NFTs`)
        const data: any = await res.json()

        for (const nft of data.nfts ?? []) {
          this.scanCount++
          if (nft.spender) {
            const key = `${nft.token_id}|${nft.spender}`
            const list = found.get(key) ?? []
            list.push(nft.serial_number)
            found.set(key, list)
          }
        }

        const label = document.querySelector('.alv-scan-label')
        if (label) {
          label.innerHTML = `<span class="token-gate-spinner">⟳</span> Scanning NFT holdings for per-serial approvals... ${this.scanCount.toLocaleString()} checked`
        }

        next = data.links?.next ? `${MIRROR_NODE_URL}${data.links.next}` : null
      }
    } catch (err) {
      this.scanning = false
      this.error = err instanceof Error ? err.message : 'Failed to scan NFT holdings'
      this.refresh()
      return
    }

    if (this.cancelScan) {
      this.scanning = false
      this.refresh()
      return
    }

    // Merge per-serial spenders; serials already covered by approved-for-all are moot.
    const newTokenIds = new Set<string>()
    const newSpenders = new Set<string>()
    for (const [key, serials] of found) {
      const [tokenId, spender] = key.split('|')
      const row = this.nftRows.find(r => r.tokenId === tokenId && r.spender === spender)
      if (row) {
        if (row.approvedForAll) continue
        row.serials = [...new Set([...row.serials, ...serials])]
      } else {
        this.nftRows.push({ spender, tokenId, approvedForAll: false, serials })
        newTokenIds.add(tokenId)
        newSpenders.add(spender)
      }
    }

    await Promise.all([
      this.enrichTokens([...newTokenIds]),
      this.classifySpenders([...newSpenders]),
    ])

    this.scanning = false
    this.statusMessage = `Scan complete — ${this.scanCount.toLocaleString()} NFTs checked`
    this.refresh()
  }

  // -------------------------------------------------------------------------
  // Revocation
  // -------------------------------------------------------------------------

  private static async revokeByKey(key: string): Promise<void> {
    const [kind, a, b] = key.split('|')
    if (kind === 'hbar') {
      await this.revokeRows([{ spender: a, build: (tx) => tx.approveHbarAllowance(this.ownerAccount(), a, Hbar.fromTinybars(0)) }])
    } else if (kind === 'hbar-unlim') {
      await this.revokeRows([{ spender: a, build: (tx) => tx.approveHbarAllowance(this.ownerAccount(), a, Hbar.fromTinybars(0)) }])
    } else if (kind === 'token') {
      const tokenId = a
      const spender = b
      await this.revokeRows([{
        spender,
        build: (tx) => tx.approveTokenAllowance(TokenId.fromString(tokenId), this.ownerAccount(), AccountId.fromString(spender), 0),
      }])
    } else if (kind === 'nft') {
      const tokenId = a
      const spender = b
      const row = this.nftRows.find(r => r.tokenId === tokenId && r.spender === spender)
      if (!row) return
      if (row.approvedForAll) {
        await this.revokeRows([{
          spender,
          build: (tx) => tx.deleteTokenNftAllowanceAllSerials(TokenId.fromString(tokenId), this.ownerAccount(), AccountId.fromString(spender)),
        }])
      } else {
        await this.revokeSerials(tokenId, spender, row.serials)
      }
    }
  }

  private static async revokeForSpender(spender: string): Promise<void> {
    const approveDeletes: RevokeEntry[] = []
    const serialsByToken = new Map<string, number[]>()

    if (this.hbarRows.some(r => r.spender === spender)) {
      approveDeletes.push({
        spender,
        build: (tx) => tx.approveHbarAllowance(this.ownerAccount(), spender, Hbar.fromTinybars(0)),
      })
    }

    for (const row of this.tokenRows.filter(r => r.spender === spender)) {
      approveDeletes.push({
        spender,
        build: (tx) => tx.approveTokenAllowance(TokenId.fromString(row.tokenId), this.ownerAccount(), AccountId.fromString(spender), 0),
      })
    }

    for (const row of this.nftRows.filter(r => r.spender === spender)) {
      if (row.approvedForAll) {
        approveDeletes.push({
          spender,
          build: (tx) => tx.deleteTokenNftAllowanceAllSerials(TokenId.fromString(row.tokenId), this.ownerAccount(), AccountId.fromString(spender)),
        })
      } else if (row.serials.length > 0) {
        serialsByToken.set(row.tokenId, row.serials)
      }
    }

    if (approveDeletes.length > 0) {
      await this.revokeRows(approveDeletes)
    }
    for (const [tokenId, serials] of serialsByToken) {
      await this.revokeSerials(tokenId, spender, serials)
    }
  }

  private static async revokeRows(entries: RevokeEntry[]): Promise<void> {
    if (entries.length === 0) return
    const accountId = this.requireAccount()
    if (!accountId) return

    this.revoking = true
    this.error = null
    this.statusMessage = 'Waiting for wallet approval...'
    this.refresh()

    try {
      const tx = new AccountAllowanceApproveTransaction()
      for (const entry of entries) entry.build(tx)
      await this.signAndExecute(tx, accountId)

      const spenders = new Set(entries.map(e => e.spender))
      this.hbarRows = this.hbarRows.filter(r => !spenders.has(r.spender))
      this.tokenRows = this.tokenRows.filter(r => !spenders.has(r.spender))
      const removedNftKeys = new Set(
        this.nftRows.filter(r => spenders.has(r.spender)).map(r => `${r.tokenId}|${r.spender}`)
      )
      this.nftRows = this.nftRows.filter(r => !spenders.has(r.spender))
      for (const key of removedNftKeys) this.expandedSerials.delete(key)

      this.statusMessage = entries.length > 1
        ? `Revoked ${entries.length} allowances — network fee only`
        : 'Allowance revoked — network fee only'
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Revocation failed'
      this.statusMessage = null
    } finally {
      this.revoking = false
      this.refresh()
    }
  }

  private static async revokeSerials(tokenId: string, spender: string, serials: number[]): Promise<void> {
    if (serials.length === 0) return
    const accountId = this.requireAccount()
    if (!accountId) return

    this.revoking = true
    this.error = null
    this.statusMessage = 'Waiting for wallet approval...'
    this.refresh()

    try {
      const tx = new AccountAllowanceDeleteTransaction()
      for (const serial of serials) {
        tx.deleteAllTokenNftAllowances(NftId.fromString(`${tokenId}/${serial}`), this.ownerAccount())
      }
      await this.signAndExecute(tx, accountId)

      const row = this.nftRows.find(r => r.tokenId === tokenId && r.spender === spender)
      if (row) {
        row.serials = row.serials.filter(s => !serials.includes(s))
        if (row.serials.length === 0 && !row.approvedForAll) {
          this.nftRows = this.nftRows.filter(r => r !== row)
          this.expandedSerials.delete(`${tokenId}|${spender}`)
        }
      }

      this.statusMessage = `Revoked ${serials.length} serial approval${serials.length === 1 ? '' : 's'} — network fee only`
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Revocation failed'
      this.statusMessage = null
    } finally {
      this.revoking = false
      this.refresh()
    }
  }

  private static async signAndExecute(tx: Transaction, accountId: string): Promise<void> {
    const signer = WalletConnectService.getSigner(accountId)
    tx.setTransactionId(TransactionId.generate(AccountId.fromString(accountId)))
    tx.freezeWith(getHederaClient())
    const response = await tx.executeWithSigner(signer)
    if (response && typeof (response as any).getReceiptWithSigner === 'function') {
      await (response as any).getReceiptWithSigner(signer)
    }
  }

  private static ownerAccount(): AccountId {
    const accountId = this.requireAccount()
    return AccountId.fromString(accountId!)
  }

  private static requireAccount(): string | null {
    const accountId = WalletConnectService.getState().accountId
    if (!accountId) this.error = 'Wallet not connected'
    return accountId
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private static async pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
    let index = 0
    const worker = async (): Promise<void> => {
      while (index < items.length) {
        const item = items[index++]
        if (item !== undefined) await fn(item)
      }
    }
    await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker))
  }

  private static isUnlimited(amountRaw: string): boolean {
    try {
      return BigInt(amountRaw) >= MAX_ALLOWANCE
    } catch {
      return false
    }
  }

  private static formatHbar(amountTinybars: string): string {
    try {
      const whole = BigInt(amountTinybars) / BigInt(100_000_000)
      const frac = BigInt(amountTinybars) % BigInt(100_000_000)
      if (frac === BigInt(0)) return whole.toLocaleString()
      const fracStr = frac.toString().padStart(8, '0').slice(0, 4).replace(/0+$/, '')
      return `${whole.toLocaleString()}.${fracStr}`
    } catch {
      return amountTinybars
    }
  }

  private static formatTokenAmount(amountRaw: string, decimals: number): string {
    try {
      const raw = BigInt(amountRaw)
      if (decimals === 0) return raw.toLocaleString()
      const divisor = BigInt(10 ** decimals)
      const whole = raw / divisor
      const frac = raw % divisor
      if (frac === BigInt(0)) return whole.toLocaleString()
      const fracStr = frac.toString().padStart(decimals, '0').slice(0, 6).replace(/0+$/, '')
      return `${whole.toLocaleString()}.${fracStr}`
    } catch {
      return amountRaw
    }
  }

  private static formatDate(timestamp: string): string {
    const secs = Number(timestamp.split('.')[0])
    if (isNaN(secs)) return ''
    return new Date(secs * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  }

  private static escapeHtml(text: string): string {
    const div = document.createElement('div')
    div.textContent = text
    return div.innerHTML
  }

  private static refresh(): void {
    const app = document.querySelector<HTMLDivElement>('#app')!
    app.innerHTML = this.render()
    this.init()
  }

  static resetState(): void {
    this.hbarRows = []
    this.tokenRows = []
    this.nftRows = []
    this.spenderCache.clear()
    this.tokenCache.clear()
    this.loadedAccount = null
    this.loading = false
    this.scanning = false
    this.cancelScan = true
    this.scanCount = 0
    this.error = null
    this.statusMessage = null
    this.activeTab = 'all'
    this.riskOnly = false
    this.search = ''
    this.expandedSerials.clear()
    this.revoking = false
  }
}

interface CardRow {
  kind: 'hbar' | 'token' | 'nft'
  key: string
  asset: string
  detail: string
  grantedAt: string | null
  risk: Risk
  serials?: number[]
  tokenId?: string
}

interface SpenderCard {
  spender: string
  rows: CardRow[]
}

interface RevokeEntry {
  spender: string
  build: (tx: AccountAllowanceApproveTransaction) => AccountAllowanceApproveTransaction
}
