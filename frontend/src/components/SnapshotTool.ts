/**
 * Snapshot Tool Component
 * Capture holder accounts based on various filters
 */
import { MIRROR_NODE_URL } from '../config'

interface SnapshotHolder {
  accountId: string
  balance: string
  serialNumbers?: string[]
}

interface SnapshotFilters {
  tokenId: string
  minBalance?: string
  serialFrom?: string
  serialTo?: string
  snapshotDate?: string
  excludeTreasury?: boolean
}

export class SnapshotTool {
  private static holders: SnapshotHolder[] = []
  private static filters: SnapshotFilters = { tokenId: '' }
  private static loading: boolean = false
  private static error: string | null = null
  private static treasuryAccount: string | null = null
  private static mirrorNodeUrl: string = MIRROR_NODE_URL

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
        <div class="window-title">hedera-creator-kit</div>
      </div>
    `
  }

  private static renderContent(): string {
    return `
      <div class="terminal-content">
        <div class="snapshot-layout">
          <div class="snapshot-left">
            ${this.renderFilterForm()}
          </div>
          <div class="snapshot-right">
            ${this.renderResults()}
          </div>
        </div>
      </div>
    `
  }

  private static renderFilterForm(): string {
    return `
      <div class="snapshot-filter-section">
        <h3 class="section-title">Snapshot Tool</h3>

        <div class="back-link" id="snapshot-back-link">
          <span class="back-arrow">←</span>
          <span>Back</span>
        </div>

        <div class="input-group">
          <label for="snapshot-token-id">Token ID <span style="color: #ff6b6b;">*</span></label>
          <input
            type="text"
            id="snapshot-token-id"
            class="token-input"
            placeholder="0.0.123456"
            autocomplete="off"
          />
        </div>

        <div class="filter-divider"></div>
        <h4 class="filter-subtitle">Filter by Amount Held</h4>

        <div class="input-group">
          <label for="min-balance">Balance (minimum)</label>
          <input
            type="text"
            id="min-balance"
            class="token-input"
            placeholder="BALANCE"
            autocomplete="off"
          />
        </div>

        <div class="filter-divider"></div>
        <h4 class="filter-subtitle">Serial Range (NFTs Only)</h4>

        <div class="input-row">
          <div class="input-group">
            <label for="serial-from">From</label>
            <input
              type="text"
              id="serial-from"
              class="token-input"
              placeholder="1"
              autocomplete="off"
            />
          </div>
          <div class="input-group">
            <label for="serial-to">To</label>
            <input
              type="text"
              id="serial-to"
              class="token-input"
              placeholder="1000"
              autocomplete="off"
            />
          </div>
        </div>

        <div class="filter-divider"></div>
        <h4 class="filter-subtitle">Filter by Date</h4>

        <div class="input-group">
          <label for="snapshot-date">Snapshot Date (Optional)</label>
          <input
            type="date"
            id="snapshot-date"
            class="token-input"
            autocomplete="off"
          />
        </div>

        <div class="filter-divider"></div>
        <h4 class="filter-subtitle">Additional Options</h4>

        <div class="toggle-group">
          <label class="toggle-label">
            <span>Exclude Treasury Account</span>
            <label class="toggle-switch">
              <input type="checkbox" id="exclude-treasury" />
              <span class="toggle-slider"></span>
            </label>
          </label>
        </div>

        <div class="button-group">
          <button id="take-snapshot-btn" class="terminal-button">
            <span>TAKE SNAPSHOT</span>
          </button>
          <button id="clear-filters-btn" class="terminal-button secondary">
            <span>CLEAR FILTERS</span>
          </button>
        </div>
      </div>
    `
  }

  private static renderResults(): string {
    if (this.loading) {
      return `
        <div class="loading-state">
          <div class="spinner"></div>
          <p>Taking snapshot...</p>
        </div>
      `
    }

    if (this.error) {
      return `
        <div class="error-state">
          <p class="error-message">⚠ ${this.error}</p>
        </div>
      `
    }

    if (this.holders.length === 0) {
      return `
        <div class="empty-state">
          <p>Enter a Token ID and configure filters to take a snapshot</p>
          <p class="hint">Results will appear here</p>
        </div>
      `
    }

    const hasSerials = this.holders.some(h => h.serialNumbers && h.serialNumbers.length > 0)

    return `
      <div class="snapshot-results-section">
        <div class="results-header">
          <h3 class="section-title">Snapshot Results</h3>
          <div class="results-actions">
            <span class="results-count">${this.holders.length} accounts found</span>
            <button id="copy-all-btn" class="terminal-button small">
              <span>COPY ALL ACCOUNTS</span>
            </button>
            <button id="export-csv-btn" class="terminal-button small">
              <span>EXPORT CSV</span>
            </button>
          </div>
        </div>

        <div class="results-table-container">
          <table class="results-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Account ID</th>
                <th>Balance</th>
                ${hasSerials ? '<th>Serial Numbers</th>' : ''}
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${this.holders.map((holder, index) => `
                <tr>
                  <td>${index + 1}</td>
                  <td class="account-id">${holder.accountId}</td>
                  <td>${holder.balance}</td>
                  ${hasSerials ? `<td class="serials">${holder.serialNumbers ? holder.serialNumbers.slice(0, 5).join(', ') + (holder.serialNumbers.length > 5 ? '...' : '') : '-'}</td>` : ''}
                  <td>
                    <button class="copy-btn" data-account="${holder.accountId}">
                      COPY
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `
  }

  static init(): void {
    this.attachEventListeners()
  }

  private static attachEventListeners(): void {
    const takeSnapshotBtn = document.getElementById('take-snapshot-btn')
    const clearFiltersBtn = document.getElementById('clear-filters-btn')
    const backLink = document.getElementById('snapshot-back-link')
    const copyAllBtn = document.getElementById('copy-all-btn')
    const exportCsvBtn = document.getElementById('export-csv-btn')

    takeSnapshotBtn?.addEventListener('click', () => this.takeSnapshot())
    clearFiltersBtn?.addEventListener('click', () => this.clearFilters())
    backLink?.addEventListener('click', () => this.goBack())
    copyAllBtn?.addEventListener('click', () => this.copyAllAccounts())
    exportCsvBtn?.addEventListener('click', () => this.exportToCSV())

    // Copy individual account buttons
    document.querySelectorAll('.copy-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const accountId = (e.target as HTMLElement).getAttribute('data-account')
        if (accountId) this.copyToClipboard(accountId)
      })
    })
  }

  private static async takeSnapshot(): Promise<void> {
    const tokenIdInput = document.getElementById('snapshot-token-id') as HTMLInputElement
    const tokenId = tokenIdInput?.value.trim()

    if (!tokenId) {
      this.error = 'Please enter a Token ID'
      this.refresh()
      return
    }

    // Get filter values
    const minBalance = (document.getElementById('min-balance') as HTMLInputElement)?.value
    const serialFrom = (document.getElementById('serial-from') as HTMLInputElement)?.value
    const serialTo = (document.getElementById('serial-to') as HTMLInputElement)?.value
    const snapshotDate = (document.getElementById('snapshot-date') as HTMLInputElement)?.value
    const excludeTreasury = (document.getElementById('exclude-treasury') as HTMLInputElement)?.checked

    this.filters = {
      tokenId,
      minBalance: minBalance || undefined,
      serialFrom: serialFrom || undefined,
      serialTo: serialTo || undefined,
      snapshotDate: snapshotDate || undefined,
      excludeTreasury: excludeTreasury || false
    }

    this.loading = true
    this.error = null
    this.refresh()

    try {
      // First, check if it's an NFT or Fungible Token
      const tokenInfoUrl = `${this.mirrorNodeUrl}/api/v1/tokens/${tokenId}`
      const tokenInfoResponse = await fetch(tokenInfoUrl)

      if (!tokenInfoResponse.ok) {
        throw new Error(`Token not found: ${tokenId}`)
      }

      const tokenInfo = await tokenInfoResponse.json()
      const isNFT = tokenInfo.type === 'NON_FUNGIBLE_UNIQUE'

      // Store treasury account
      this.treasuryAccount = tokenInfo.treasury_account_id

      if (isNFT) {
        await this.fetchNFTHolders(tokenId)
      } else {
        const decimals = parseInt(tokenInfo.decimals) || 0
        await this.fetchFungibleHolders(tokenId, decimals)
      }

      this.loading = false
      this.refresh()
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to fetch snapshot'
      this.loading = false
      this.refresh()
    }
  }

  private static async fetchNFTHolders(tokenId: string): Promise<void> {
    // When a date filter is set, mirror node providers don't reliably support the timestamp
    // parameter on the /nfts endpoint. Use /balances?timestamp=X instead — it supports
    // historical queries consistently but returns counts only (no serial numbers).
    if (this.filters.snapshotDate) {
      const ts = Math.floor(new Date(this.filters.snapshotDate).getTime() / 1000)
      let nextLink = `${this.mirrorNodeUrl}/api/v1/tokens/${tokenId}/balances?limit=100&timestamp=${ts}`
      const holders: SnapshotHolder[] = []

      while (nextLink) {
        const response = await fetch(nextLink)
        if (!response.ok) throw new Error('Failed to fetch historical NFT balances')
        const data = await response.json()

        for (const entry of data.balances) {
          if (entry.balance === 0) continue
          if (this.filters.excludeTreasury && entry.account === this.treasuryAccount) continue
          if (this.filters.minBalance && entry.balance < parseInt(this.filters.minBalance)) continue
          holders.push({ accountId: entry.account, balance: entry.balance.toString() })
        }

        nextLink = data.links?.next ? `${this.mirrorNodeUrl}${data.links.next}` : null as any
      }

      this.holders = holders.sort((a, b) => parseInt(b.balance) - parseInt(a.balance))
      return
    }

    // No date filter — use /nfts for full data including serial numbers
    const holders = new Map<string, { balance: number; serials: number[] }>()
    let nextLink = `${this.mirrorNodeUrl}/api/v1/tokens/${tokenId}/nfts?limit=100`

    while (nextLink) {
      const response = await fetch(nextLink)
      if (!response.ok) throw new Error('Failed to fetch NFT data')
      const data = await response.json()

      for (const nft of data.nfts) {
        const accountId = nft.account_id
        const serial = parseInt(nft.serial_number)

        if (this.filters.excludeTreasury && accountId === this.treasuryAccount) continue
        if (this.filters.serialFrom && serial < parseInt(this.filters.serialFrom)) continue
        if (this.filters.serialTo && serial > parseInt(this.filters.serialTo)) continue

        if (!holders.has(accountId)) holders.set(accountId, { balance: 0, serials: [] })
        const holder = holders.get(accountId)!
        holder.balance++
        holder.serials.push(serial)
      }

      nextLink = data.links?.next ? `${this.mirrorNodeUrl}${data.links.next}` : null as any
    }

    this.holders = Array.from(holders.entries())
      .map(([accountId, data]) => ({
        accountId,
        balance: data.balance.toString(),
        serialNumbers: data.serials.sort((a, b) => a - b).map(s => s.toString())
      }))
      .filter(holder => {
        if (this.filters.minBalance && parseInt(holder.balance) < parseInt(this.filters.minBalance)) return false
        return true
      })
      .sort((a, b) => parseInt(b.balance) - parseInt(a.balance))
  }

  private static async fetchFungibleHolders(tokenId: string, decimals: number): Promise<void> {
    const holders: SnapshotHolder[] = []
    const tsParam = this.filters.snapshotDate
      ? `&timestamp=${Math.floor(new Date(this.filters.snapshotDate).getTime() / 1000)}`
      : ''
    let nextLink = `${this.mirrorNodeUrl}/api/v1/tokens/${tokenId}/balances?limit=100${tsParam}`

    // Mirror Node returns balances in smallest units (e.g. 8-decimal token: 100 tokens = 10000000000).
    // Users enter human-readable amounts, so convert the filter value to smallest units for comparison.
    const divisor = Math.pow(10, decimals)
    const minSmallest = this.filters.minBalance ? parseFloat(this.filters.minBalance) * divisor : null

    while (nextLink) {
      const response = await fetch(nextLink)
      if (!response.ok) {
        throw new Error('Failed to fetch token balances')
      }

      const data = await response.json()

      for (const balance of data.balances) {
        const accountId = balance.account
        const amount = parseInt(balance.balance)

        // Exclude treasury if filter is enabled
        if (this.filters.excludeTreasury && accountId === this.treasuryAccount) continue

        // Apply minimum balance filter
        if (minSmallest !== null && amount < minSmallest) continue

        holders.push({
          accountId,
          balance: decimals > 0 ? (amount / divisor).toString() : amount.toString()
        })
      }

      nextLink = data.links?.next ? `${this.mirrorNodeUrl}${data.links.next}` : null as any
    }

    this.holders = holders.sort((a, b) => parseFloat(b.balance) - parseFloat(a.balance))
  }

  private static clearFilters(): void {
    (document.getElementById('snapshot-token-id') as HTMLInputElement).value = ''
    ;(document.getElementById('min-balance') as HTMLInputElement).value = ''
    ;(document.getElementById('serial-from') as HTMLInputElement).value = ''
    ;(document.getElementById('serial-to') as HTMLInputElement).value = ''
    ;(document.getElementById('snapshot-date') as HTMLInputElement).value = ''
    ;(document.getElementById('exclude-treasury') as HTMLInputElement).checked = false

    this.holders = []
    this.treasuryAccount = null
    this.error = null
    this.refresh()
  }

  private static copyToClipboard(text: string): void {
    navigator.clipboard.writeText(text).then(() => {
      console.log('✓ Copied to clipboard')
    }).catch(err => {
      console.error('Failed to copy:', err)
    })
  }

  private static copyAllAccounts(): void {
    const accounts = this.holders.map(h => h.accountId).join('\n')
    this.copyToClipboard(accounts)
  }

  private static exportToCSV(): void {
    const hasSerials = this.holders.some(h => h.serialNumbers && h.serialNumbers.length > 0)

    let csv = hasSerials
      ? 'Account ID,Balance,Serial Numbers\n'
      : 'Account ID,Balance\n'

    this.holders.forEach(holder => {
      const serials = holder.serialNumbers ? `"${holder.serialNumbers.join(',')}"` : ''
      csv += hasSerials
        ? `${holder.accountId},${holder.balance},${serials}\n`
        : `${holder.accountId},${holder.balance}\n`
    })

    const blob = new Blob([csv], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `snapshot_${this.filters.tokenId}_${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    window.URL.revokeObjectURL(url)
  }

  private static goBack(): void {
    window.location.reload()
  }

  private static refresh(): void {
    const app = document.querySelector<HTMLDivElement>('#app')!
    app.innerHTML = this.render()
    this.init()
  }

  private static renderStatusBar(): string {
    return `
      <div class="status-bar">
        <div class="status-left">
          <span class="status-item">Not Connected</span>
        </div>
        <div class="status-center">
          <span class="status-item">Built by SLIME</span>
        </div>
        <div class="status-right">
          <span class="status-item">HEDERA CREATOR KIT v1.0</span>
          <span class="status-item">MAINNET</span>
        </div>
      </div>
    `
  }
}

