/**
 * Token Viewer Component
 * View detailed token information via Mirror Node API
 */

interface TokenData {
  name: string
  symbol: string
  tokenId: string
  type: 'FUNGIBLE_COMMON' | 'NON_FUNGIBLE_UNIQUE'
  totalSupply: string
  maxSupply: string
  decimals: number
  treasuryAccountId: string
  adminKey: boolean
  freezeKey: boolean
  wipeKey: boolean
  kycKey: boolean
  supplyKey: boolean
  pauseKey: boolean
  metadataKey: boolean
}

interface TokenHolder {
  accountId: string
  balance: string
  percentage: string
}

export class TokenViewer {
  private static tokenData: TokenData | null = null
  private static holders: TokenHolder[] = []
  private static totalHolders: number = 0
  private static loading: boolean = false
  private static error: string | null = null
  private static mirrorNodeUrl: string = 'https://mainnet.hedera.validationcloud.io/v1/amIlRBQJ2H_JqUtx4ZhMrGGJ8u27_JZ3E-mMobLOJXA'

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
        <div class="token-viewer-layout">
          <div class="token-viewer-left">
            ${this.renderInputForm()}
          </div>
          <div class="token-viewer-right">
            ${this.renderResults()}
          </div>
        </div>
      </div>
    `
  }

  private static renderInputForm(): string {
    return `
      <div class="token-input-section">
        <h3 class="section-title">Token Viewer</h3>

        <div class="back-link" id="token-viewer-back-link">
          <span class="back-arrow">←</span>
          <span>Back</span>
        </div>

        <div class="input-group">
          <label for="token-id-input">Token ID</label>
          <input
            type="text"
            id="token-id-input"
            class="token-input"
            placeholder="0.0.123456"
            autocomplete="off"
          />
        </div>
        <button id="fetch-token-btn" class="terminal-button">
          <span>FETCH TOKEN DATA</span>
        </button>
      </div>
    `
  }

  private static renderResults(): string {
    if (this.loading) {
      return `<div class="loading-state">
        <div class="spinner"></div>
        <p>Fetching token data...</p>
      </div>`
    }

    if (this.error) {
      return `<div class="error-state">
        <p class="error-message">⚠ ${this.error}</p>
      </div>`
    }

    if (!this.tokenData) {
      return `<div class="empty-state">
        <p>Enter a token ID to view details</p>
      </div>`
    }

    return `
      ${this.renderQuickView()}
      ${this.renderHoldersTable()}
    `
  }

  private static renderQuickView(): string {
    if (!this.tokenData) return ''

    return `
      <div class="quick-view-section">
        <h3 class="section-title">Token Information</h3>
        <div class="info-grid">
          <div class="info-item">
            <span class="info-label">Token Name:</span>
            <span class="info-value">${this.tokenData.name}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Token Symbol:</span>
            <span class="info-value">${this.tokenData.symbol}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Token ID:</span>
            <span class="info-value">${this.tokenData.tokenId}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Treasury Account:</span>
            <span class="info-value">${this.tokenData.treasuryAccountId}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Token Type:</span>
            <span class="info-value">${this.tokenData.type === 'FUNGIBLE_COMMON' ? 'Fungible' : 'NFT'}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Total Supply:</span>
            <span class="info-value">${this.formatSupply(this.tokenData.totalSupply)}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Max Supply:</span>
            <span class="info-value">${this.tokenData.maxSupply === '0' ? 'Unlimited' : this.formatSupply(this.tokenData.maxSupply)}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Holders:</span>
            <span class="info-value">${this.totalHolders}</span>
          </div>
        </div>

        <h4 class="subsection-title">Token Keys</h4>
        <div class="keys-grid">
          ${this.renderKeyBadge('Admin Key', this.tokenData.adminKey)}
          ${this.renderKeyBadge('Freeze Key', this.tokenData.freezeKey)}
          ${this.renderKeyBadge('Wipe Key', this.tokenData.wipeKey)}
          ${this.renderKeyBadge('KYC Key', this.tokenData.kycKey)}
          ${this.renderKeyBadge('Supply Key', this.tokenData.supplyKey)}
          ${this.renderKeyBadge('Pause Key', this.tokenData.pauseKey)}
          ${this.renderKeyBadge('Metadata Key', this.tokenData.metadataKey)}
        </div>
      </div>
    `
  }

  private static renderKeyBadge(label: string, hasKey: boolean): string {
    const status = hasKey ? 'yes' : 'no'
    const icon = hasKey ? '✓' : '✗'
    return `
      <div class="key-badge ${status}">
        <span class="key-label">${label}</span>
        <span class="key-status">${icon} ${status.toUpperCase()}</span>
      </div>
    `
  }

  private static renderHoldersTable(): string {
    if (this.holders.length === 0) return ''

    return `
      <div class="holders-section">
        <h3 class="section-title">Top 50 Holders</h3>
        <div class="holders-table-wrapper">
          <table class="holders-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Account ID</th>
                <th>Balance</th>
                <th>% of Supply</th>
              </tr>
            </thead>
            <tbody>
              ${this.holders.slice(0, 50).map((holder, index) => `
                <tr>
                  <td>${index + 1}</td>
                  <td class="account-id">${holder.accountId}</td>
                  <td class="balance">${this.formatSupply(holder.balance)}</td>
                  <td class="percentage">${holder.percentage}%</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `
  }

  private static formatSupply(supply: string): string {
    if (!this.tokenData) return supply

    const decimals = this.tokenData.decimals
    if (decimals === 0) {
      // NFTs or tokens without decimals - just format the number
      const num = parseInt(supply)
      return num.toLocaleString()
    } else {
      // Fungible tokens with decimals - divide by 10^decimals
      const num = parseInt(supply)
      const actualSupply = num / Math.pow(10, decimals)
      return actualSupply.toLocaleString(undefined, { maximumFractionDigits: decimals })
    }
  }

  static init(): void {
    this.attachEventListeners()
  }

  private static attachEventListeners(): void {
    const fetchBtn = document.getElementById('fetch-token-btn')
    const backLink = document.getElementById('token-viewer-back-link')
    const input = document.getElementById('token-id-input') as HTMLInputElement

    fetchBtn?.addEventListener('click', () => this.fetchTokenData())
    backLink?.addEventListener('click', () => this.goBack())

    input?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.fetchTokenData()
      }
    })
  }

  private static async fetchTokenData(): Promise<void> {
    const input = document.getElementById('token-id-input') as HTMLInputElement
    const tokenId = input?.value.trim()

    if (!tokenId) {
      this.error = 'Please enter a token ID'
      this.refresh()
      return
    }

    this.loading = true
    this.error = null
    this.refresh()

    try {
      // Fetch token info
      const tokenResponse = await fetch(`${this.mirrorNodeUrl}/api/v1/tokens/${tokenId}`)
      if (!tokenResponse.ok) throw new Error('Token not found')

      const tokenInfo = await tokenResponse.json()

      // Parse token data first
      this.tokenData = {
        name: tokenInfo.name,
        symbol: tokenInfo.symbol,
        tokenId: tokenInfo.token_id,
        type: tokenInfo.type,
        totalSupply: tokenInfo.total_supply,
        maxSupply: tokenInfo.max_supply || '0',
        decimals: parseInt(tokenInfo.decimals || '0'),
        treasuryAccountId: tokenInfo.treasury_account_id,
        adminKey: !!tokenInfo.admin_key,
        freezeKey: !!tokenInfo.freeze_key,
        wipeKey: !!tokenInfo.wipe_key,
        kycKey: !!tokenInfo.kyc_key,
        supplyKey: !!tokenInfo.supply_key,
        pauseKey: !!tokenInfo.pause_key,
        metadataKey: !!tokenInfo.metadata_key
      }

      // Fetch ALL token balances with pagination
      let allBalances: any[] = []
      let nextLink: string | null = `${this.mirrorNodeUrl}/api/v1/tokens/${tokenId}/balances?limit=100`

      while (nextLink) {
        const response: Response = await fetch(nextLink)
        if (!response.ok) throw new Error('Failed to fetch holders')

        const data: any = await response.json()
        allBalances = allBalances.concat(data.balances)

        // Check if there's a next page
        nextLink = data.links?.next ? `${this.mirrorNodeUrl}${data.links.next}` : null
      }

      // Parse holders, filter out zero balances, sort by balance
      const totalSupply = parseInt(tokenInfo.total_supply)
      const allHolders = allBalances
        .filter((b: any) => parseInt(b.balance) > 0)
        .map((b: any) => ({
          accountId: b.account,
          balance: b.balance,
          percentage: ((parseInt(b.balance) / totalSupply) * 100).toFixed(2)
        }))
        .sort((a: TokenHolder, b: TokenHolder) => parseInt(b.balance) - parseInt(a.balance))

      // Store total holder count and top 50 for display
      this.totalHolders = allHolders.length
      this.holders = allHolders.slice(0, 50)

      this.loading = false
      this.refresh()
    } catch (err) {
      this.loading = false
      this.error = err instanceof Error ? err.message : 'Failed to fetch token data'
      this.refresh()
    }
  }

  private static goBack(): void {
    // Reload the page to return to fresh homepage
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
