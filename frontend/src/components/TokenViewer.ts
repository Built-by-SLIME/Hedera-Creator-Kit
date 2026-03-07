/**
 * Token Viewer Component
 * View detailed token information via Mirror Node API
 */
import { MIRROR_NODE_URL } from '../config'

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

interface EvmTokenData {
  name: string
  symbol: string
  contractId: string
  evmAddress: string
  tokenStandard: string
  totalSupply: string
  decimals: number
  ownerAddress: string | null
}

export class TokenViewer {
  private static tokenData: TokenData | null = null
  private static evmTokenData: EvmTokenData | null = null
  private static tokenMode: 'hts' | 'evm' | null = null
  private static holders: TokenHolder[] = []
  private static totalHolders: number = 0
  private static loading: boolean = false
  private static error: string | null = null
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
          <label for="token-id-input">Token ID or EVM Address</label>
          <input
            type="text"
            id="token-id-input"
            class="token-input"
            placeholder="0.0.123456 or 0x..."
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

    if (this.tokenMode === 'evm' && this.evmTokenData) {
      return this.renderEvmQuickView()
    }

    if (!this.tokenData) {
      return `<div class="empty-state">
        <p>Enter a token ID or EVM address to view details</p>
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

  private static renderEvmQuickView(): string {
    if (!this.evmTokenData) return ''
    const d = this.evmTokenData

    const supply = BigInt(d.totalSupply || '0')
    const formattedSupply = d.decimals > 0
      ? (Number(supply) / Math.pow(10, d.decimals)).toLocaleString(undefined, { maximumFractionDigits: d.decimals })
      : Number(supply).toLocaleString()

    const hashscanUrl = `https://hashscan.io/mainnet/contract/${d.contractId}`

    return `
      <div class="quick-view-section">
        <h3 class="section-title">Token Information</h3>
        <div class="evm-badge-row">
          <span class="evm-standard-badge">${d.tokenStandard}</span>
          <span class="evm-chain-badge">EVM</span>
        </div>
        <div class="info-grid">
          <div class="info-item">
            <span class="info-label">Token Name:</span>
            <span class="info-value">${d.name || '—'}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Token Symbol:</span>
            <span class="info-value">${d.symbol || '—'}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Contract ID:</span>
            <span class="info-value">${d.contractId}</span>
          </div>
          <div class="info-item evm-address-item">
            <span class="info-label">EVM Address:</span>
            <span class="info-value evm-address-value">${d.evmAddress}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Token Standard:</span>
            <span class="info-value">${d.tokenStandard}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Total Supply:</span>
            <span class="info-value">${formattedSupply}</span>
          </div>
          ${d.ownerAddress ? `
          <div class="info-item evm-address-item">
            <span class="info-label">Owner:</span>
            <span class="info-value evm-address-value">${d.ownerAddress}</span>
          </div>` : ''}
        </div>
        <div class="evm-note">
          <span>⚡ EVM smart contract — HTS key management does not apply to this token</span>
        </div>
        <div class="evm-actions">
          <a href="${hashscanUrl}" target="_blank" rel="noopener noreferrer" class="terminal-button-link">
            VIEW ON HASHSCAN ↗
          </a>
        </div>
      </div>
    `
  }

  private static formatSupply(supply: string): string {
    const decimals = this.tokenData?.decimals ?? 0
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
      this.error = 'Please enter a token ID or EVM address'
      this.refresh()
      return
    }

    this.loading = true
    this.error = null
    this.tokenData = null
    this.evmTokenData = null
    this.tokenMode = null
    this.holders = []
    this.totalHolders = 0
    this.refresh()

    const isEvmAddress = /^0x[0-9a-fA-F]{40}$/.test(tokenId)

    try {
      if (isEvmAddress) {
        await this.fetchEvmTokenData(tokenId)
      } else {
        // Try HTS first; fall back to EVM contract lookup if not found
        const tokenResponse = await fetch(`${this.mirrorNodeUrl}/api/v1/tokens/${tokenId}`)
        if (!tokenResponse.ok) {
          await this.fetchEvmTokenData(tokenId)
        } else {
          await this.processHtsResponse(tokenResponse, tokenId)
        }
      }
    } catch (err) {
      this.loading = false
      this.error = err instanceof Error ? err.message : 'Failed to fetch token data'
      this.refresh()
    }
  }

  private static async processHtsResponse(tokenResponse: Response, tokenId: string): Promise<void> {
    const tokenInfo = await tokenResponse.json()

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
    this.tokenMode = 'hts'

    // Fetch ALL token balances with pagination
    let allBalances: any[] = []
    let nextLink: string | null = `${this.mirrorNodeUrl}/api/v1/tokens/${tokenId}/balances?limit=100`

    while (nextLink) {
      const response: Response = await fetch(nextLink)
      if (!response.ok) throw new Error('Failed to fetch holders')
      const data: any = await response.json()
      allBalances = allBalances.concat(data.balances)
      nextLink = data.links?.next ? `${this.mirrorNodeUrl}${data.links.next}` : null
    }

    const totalSupply = parseInt(tokenInfo.total_supply)
    const allHolders = allBalances
      .filter((b: any) => parseInt(b.balance) > 0)
      .map((b: any) => ({
        accountId: b.account,
        balance: b.balance,
        percentage: ((parseInt(b.balance) / totalSupply) * 100).toFixed(2)
      }))
      .sort((a: TokenHolder, b: TokenHolder) => parseInt(b.balance) - parseInt(a.balance))

    this.totalHolders = allHolders.length
    this.holders = allHolders.slice(0, 50)
    this.loading = false
    this.refresh()
  }

  private static async fetchEvmTokenData(idOrAddress: string): Promise<void> {
    const contractRes = await fetch(`${this.mirrorNodeUrl}/api/v1/contracts/${idOrAddress}`)
    if (!contractRes.ok) {
      throw new Error('Not found. This address is not an HTS token or EVM smart contract on Hedera Mainnet.')
    }

    const contractInfo = await contractRes.json()
    const contractId: string = contractInfo.contract_id
    const evmAddress: string = contractInfo.evm_address.startsWith('0x')
      ? contractInfo.evm_address
      : '0x' + contractInfo.evm_address

    // Helper: POST eth_call to Mirror Node
    const ethCall = async (data: string): Promise<string> => {
      try {
        const res = await fetch(`${this.mirrorNodeUrl}/api/v1/contracts/call`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ block: 'latest', data, to: evmAddress, estimate: false })
        })
        if (!res.ok) return ''
        const json = await res.json()
        return json.result || ''
      } catch {
        return ''
      }
    }

    // Detect token standard via supportsInterface
    let tokenStandard = 'EVM Contract'
    let decimals = 0

    // supportsInterface(0x80ac58cd) — ERC-721
    const erc721Check = await ethCall(
      '0x01ffc9a780ac58cd00000000000000000000000000000000000000000000000000000000'
    )
    if (erc721Check && this.decodeUint256(erc721Check) === '1') {
      tokenStandard = 'ERC-721'
    } else {
      // decimals() — ERC-20 indicator
      const decimalsHex = await ethCall('0x313ce567')
      if (decimalsHex && decimalsHex.length >= 10) {
        const dec = Number(this.decodeUint256(decimalsHex))
        if (!isNaN(dec) && dec >= 0 && dec <= 30) {
          tokenStandard = 'ERC-20'
          decimals = dec
        }
      }
    }

    // Fetch name, symbol, totalSupply, owner in parallel
    const [nameHex, symbolHex, supplyHex, ownerHex] = await Promise.all([
      ethCall('0x06fdde03'), // name()
      ethCall('0x95d89b41'), // symbol()
      ethCall('0x18160ddd'), // totalSupply()
      ethCall('0x8da5cb5b'), // owner() — Ownable pattern
    ])

    const name = this.decodeABIString(nameHex)
    const symbol = this.decodeABIString(symbolHex)
    const totalSupply = supplyHex ? this.decodeUint256(supplyHex) : '0'
    const ownerAddress = ownerHex && ownerHex.length >= 66 ? this.decodeAddress(ownerHex) : null

    this.evmTokenData = { name, symbol, contractId, evmAddress, tokenStandard, totalSupply, decimals, ownerAddress }
    this.tokenMode = 'evm'
    this.loading = false
    this.refresh()
  }

  // ---------- ABI decode helpers ----------

  private static decodeABIString(hex: string): string {
    try {
      const clean = hex.startsWith('0x') ? hex.slice(2) : hex
      if (clean.length < 128) return ''
      const length = parseInt(clean.slice(64, 128), 16)
      if (length === 0) return ''
      const stringHex = clean.slice(128, 128 + length * 2)
      const bytes = new Uint8Array(stringHex.match(/.{2}/g)!.map(b => parseInt(b, 16)))
      return new TextDecoder().decode(bytes)
    } catch {
      return ''
    }
  }

  private static decodeUint256(hex: string): string {
    try {
      const clean = hex.startsWith('0x') ? hex.slice(2) : hex
      if (!clean) return '0'
      return BigInt('0x' + clean).toString()
    } catch {
      return '0'
    }
  }

  private static decodeAddress(hex: string): string {
    try {
      const clean = hex.startsWith('0x') ? hex.slice(2) : hex
      return '0x' + clean.slice(-40)
    } catch {
      return ''
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
