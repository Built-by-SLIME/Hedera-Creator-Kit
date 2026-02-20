/**
 * Burn Tool Component
 * Permanently burn tokens/NFTs on Hedera via TokenBurnTransaction + WalletConnect signing
 */
import WalletConnectService from '../services/WalletConnectService'
import { MIRROR_NODE_URL, getHederaClient } from '../config'
import {
  TokenBurnTransaction,
  TokenId,
  AccountId,
  TransactionId,
  PrivateKey,
} from '@hashgraph/sdk'

type BurnStep = 'form' | 'success'

interface BurnTokenInfo {
  tokenId: string
  name: string
  symbol: string
  type: string
  decimals: number
  totalSupply: string
  treasuryAccountId: string
  supplyKey: string | null
}

interface OwnedSerial {
  serial: number
  selected: boolean
}

export class BurnTool {
  private static tokenIdInput = ''
  private static tokenValidated = false
  private static tokenInfo: BurnTokenInfo | null = null
  private static tokenError: string | null = null
  private static ownedSerials: OwnedSerial[] = []
  private static isFetchingSerials = false
  private static burnAmount = ''
  private static step: BurnStep = 'form'
  private static loading = false
  private static error: string | null = null
  private static statusMessage = ''
  private static txIds: string[] = []
  private static burnedCount: number = 0
  private static showConfirmModal = false
  private static supplyKeyInput = ''
  private static supplyKeyRevealed = false
  private static supplyKeyError: string | null = null

  // ─── RENDER ────────────────────────────────────────────────

  static render(): string {
    return `<div class="terminal-window">${this.renderChrome()}${this.renderContent()}${this.renderStatusBar()}</div>${this.showConfirmModal ? this.renderConfirmModal() : ''}`
  }

  private static renderConfirmModal(): string {
    const isNFT = this.tokenInfo?.type === 'NON_FUNGIBLE_UNIQUE'
    const selectedSerials = this.ownedSerials.filter(s => s.selected)
    const title = isNFT
      ? `PERMANENTLY BURN ${selectedSerials.length} NFT(s)?`
      : `PERMANENTLY BURN ${this.burnAmount} ${this.tokenInfo?.symbol || ''}?`
    const details = isNFT
      ? `Serials: ${selectedSerials.map(s => '#' + s.serial).join(', ')}`
      : `Amount: ${this.burnAmount} ${this.tokenInfo?.symbol || ''}`
    return `
      <div class="burn-confirm-overlay" id="burn-confirm-overlay">
        <div class="burn-confirm-card">
          <div class="burn-confirm-icon">🔥</div>
          <div class="burn-confirm-title">${title}</div>
          <div class="burn-confirm-details">${details}</div>
          <div class="burn-confirm-warning">⚠ This action <strong>CANNOT</strong> be undone.</div>
          <hr class="burn-confirm-divider" />
          <div class="burn-confirm-buttons">
            <button class="terminal-button secondary" id="burn-confirm-cancel">Cancel</button>
            <button class="terminal-button burn-confirm-ok" id="burn-confirm-ok">BURN</button>
          </div>
        </div>
      </div>`
  }

  private static renderChrome(): string {
    return `<div class="window-chrome"><div class="window-controls"><div class="window-dot close"></div><div class="window-dot minimize"></div><div class="window-dot maximize"></div></div><div class="window-title">hedera-creator-kit — burn tool</div></div>`
  }

  private static renderStatusBar(): string {
    const ws = WalletConnectService.getState()
    const walletInfo = ws.connected ? `⬡ ${ws.accountId} | ${ws.hbarBalance || '0'} ℏ` : 'Not Connected'
    return `
      <div class="status-bar">
        <div class="status-left"><span class="status-item">${walletInfo}</span></div>
        <div class="status-center"><span class="status-item">${this.statusMessage || 'Built by SLIME'}</span></div>
        <div class="status-right">
          <span class="status-item">HEDERA CREATOR KIT v1.0</span>
          <span class="status-item">MAINNET</span>
        </div>
      </div>`
  }

  private static renderContent(): string {
    return `<div class="terminal-content"><div class="art-gen-layout"><div class="art-gen-left">${this.renderLeftPanel()}</div><div class="art-gen-right">${this.renderRightPanel()}</div></div></div>`
  }

  private static renderLeftPanel(): string {
    if (this.loading) {
      return `<div class="art-gen-section"><h3 class="section-title">◆ Burning...</h3><div class="loading-state"><div class="spinner"></div><p>${this.statusMessage || 'Processing...'}</p></div></div>`
    }
    return this.step === 'form' ? this.renderForm() : this.renderSuccessPanel()
  }

  private static renderRightPanel(): string {
    if (this.loading) {
      return `<div class="loading-state"><div class="spinner"></div><p>${this.statusMessage || 'Processing...'}</p></div>`
    }
    if (this.error) {
      return `<div class="cc-right-content"><div class="error-state"><p class="error-message">⚠ ${this.error}</p><button class="terminal-button" id="burn-dismiss-error" style="margin-top:1rem">DISMISS</button></div></div>`
    }
    return this.step === 'form' ? this.renderPreview() : this.renderSuccessDetails()
  }

  // ─── FORM ──────────────────────────────────────────────────

  private static renderForm(): string {
    const isNFT = this.tokenInfo?.type === 'NON_FUNGIBLE_UNIQUE'
    const isFungible = this.tokenValidated && !isNFT
    const selectedCount = this.ownedSerials.filter(s => s.selected).length
    const nftCanBurn = isNFT && selectedCount > 0
    const fungibleCanBurn = isFungible && !!this.burnAmount.trim()

    return `
      <div class="art-gen-section">
        <h3 class="section-title">◆ Burn Tool</h3>
        <div class="back-link" id="burn-back"><span class="back-arrow">←</span><span>Back</span></div>

        <div style="margin:0.75rem 0;padding:0.6rem 0.8rem;background:rgba(255,80,80,0.08);border:1px solid rgba(255,80,80,0.25);border-radius:6px">
          <p style="font-size:0.78rem;color:#ff6b6b;margin:0 0 0.35rem">🔥 <strong>Permanent Action</strong> — Burning is irreversible. Burned assets are permanently removed from the total supply and cannot be recovered.</p>
          <p style="font-size:0.78rem;color:#ff6b6b;margin:0">🔑 <strong>Supply Key Required</strong> — Your wallet must hold the token's Supply Key. Burns are deducted from the token treasury.</p>
        </div>

        <div class="filter-divider"></div>

        <div class="input-group">
          <label for="burn-token-id">Token ID *</label>
          <div class="input-row" style="gap:0.5rem">
            <input type="text" id="burn-token-id" class="token-input" placeholder="0.0.xxxxx" value="${this.escapeHtml(this.tokenIdInput)}" style="flex:1" />
            <button class="terminal-button" id="burn-validate" style="white-space:nowrap">VALIDATE</button>
          </div>
          ${this.tokenError ? `<p style="font-size:0.78rem;color:#ff6b6b;margin:0.35rem 0 0">${this.tokenError}</p>` : ''}
          ${this.tokenValidated && this.tokenInfo ? `<p style="font-size:0.78rem;color:#6bff9e;margin:0.35rem 0 0">✓ ${this.tokenInfo.name} (${this.tokenInfo.symbol}) — ${isNFT ? 'NFT Collection' : 'Fungible Token'}</p>` : ''}
        </div>

        ${this.tokenValidated ? `
          <div class="input-group" style="margin-top:0.75rem">
            <label>Supply Private Key <span class="cc-field-hint">from collection creation</span></label>
            <div style="display:flex;gap:0.5rem;align-items:flex-start">
              <input type="${this.supplyKeyRevealed ? 'text' : 'password'}" class="token-input" id="burn-supply-key" placeholder="Paste your supply private key..." value="${this.escapeHtml(this.supplyKeyInput)}" style="flex:1;font-family:monospace;font-size:0.85rem" />
              <button class="terminal-button small" id="burn-toggle-supply-key" style="padding:0.4rem 0.6rem">${this.supplyKeyRevealed ? 'HIDE' : 'SHOW'}</button>
            </div>
            ${this.supplyKeyError ? `<p style="color:#ff6b6b;font-size:0.8rem;margin:0.25rem 0 0">${this.supplyKeyError}</p>` : ''}
            <p style="color:var(--terminal-text-dim);font-size:0.75rem;margin:0.25rem 0 0">This is the private key shown when you created the collection. Required for burning.</p>
          </div>
        ` : ''}

        ${this.tokenValidated && isNFT ? this.renderNFTSelector() : ''}
        ${this.tokenValidated && isFungible ? this.renderFungibleInput() : ''}

        ${nftCanBurn ? `
          <div class="filter-divider"></div>
          <button class="terminal-button" id="burn-execute-btn" style="background:rgba(255,80,80,0.15);border-color:rgba(255,80,80,0.5);color:#ff6b6b">🔥 BURN ${selectedCount} NFT${selectedCount !== 1 ? 's' : ''}</button>
        ` : ''}
        ${isFungible ? `
          <div class="filter-divider" id="burn-btn-divider" style="${fungibleCanBurn ? '' : 'display:none'}"></div>
          <button class="terminal-button" id="burn-execute-btn" style="background:rgba(255,80,80,0.15);border-color:rgba(255,80,80,0.5);color:#ff6b6b;${fungibleCanBurn ? '' : 'display:none'}">🔥 BURN ${this.burnAmount} ${this.tokenInfo?.symbol || ''}</button>
        ` : ''}
      </div>`
  }

  private static renderNFTSelector(): string {
    if (this.isFetchingSerials) {
      return `<div class="filter-divider"></div><div style="padding:1rem 0;text-align:center"><div class="spinner"></div><p style="font-size:0.82rem;color:var(--terminal-text);opacity:0.6;margin:0.5rem 0 0">Fetching NFTs from treasury...</p></div>`
    }
    if (this.ownedSerials.length === 0) {
      return `<div class="filter-divider"></div><p style="font-size:0.82rem;color:#ff6b6b;margin:0.75rem 0">No NFTs found in the treasury account (${this.tokenInfo?.treasuryAccountId || '—'}) for this token.</p>`
    }
    const selectedCount = this.ownedSerials.filter(s => s.selected).length
    const allSelected = selectedCount === this.ownedSerials.length
    return `
      <div class="filter-divider"></div>
      <div class="input-group">
        <label>Select NFTs to Burn <span style="color:var(--terminal-text);opacity:0.6">(${selectedCount} of ${this.ownedSerials.length} selected)</span></label>
        <div style="margin-bottom:0.5rem">
          <button class="terminal-button small" id="burn-toggle-all" style="font-size:0.75rem">${allSelected ? 'DESELECT ALL' : 'SELECT ALL'}</button>
        </div>
        <div style="max-height:240px;overflow-y:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:0.35rem;padding:0.25rem">
          ${this.ownedSerials.map((s, i) => `
            <label style="display:flex;align-items:center;gap:0.3rem;padding:0.3rem 0.5rem;background:${s.selected ? 'rgba(255,80,80,0.15)' : 'rgba(255,255,255,0.03)'};border:1px solid ${s.selected ? 'rgba(255,80,80,0.4)' : 'rgba(255,255,255,0.08)'};border-radius:4px;cursor:pointer;font-size:0.78rem;color:var(--terminal-text)">
              <input type="checkbox" class="burn-serial-cb" data-index="${i}" ${s.selected ? 'checked' : ''} style="margin:0" />
              #${s.serial}
            </label>
          `).join('')}
        </div>
      </div>`
  }

  private static renderFungibleInput(): string {
    const decimals = this.tokenInfo?.decimals || 0
    return `
      <div class="filter-divider"></div>
      <div class="input-group">
        <label for="burn-amount">Amount to Burn * <span style="color:var(--terminal-text);opacity:0.6">(${decimals} decimals)</span></label>
        <input type="text" id="burn-amount" class="token-input" placeholder="e.g. 1000" value="${this.escapeHtml(this.burnAmount)}" />
        <p style="font-size:0.75rem;color:var(--terminal-text);opacity:0.5;margin:0.25rem 0 0">Total Supply: ${this.tokenInfo?.totalSupply || '0'} • Treasury: ${this.tokenInfo?.treasuryAccountId || '—'}</p>
      </div>`
  }

  // ─── PREVIEW (right panel) ─────────────────────────────────

  private static renderPreview(): string {
    if (!this.tokenValidated || !this.tokenInfo) {
      return `<div class="cc-right-content"><h4 class="section-title" style="font-size:0.95rem">Burn Preview</h4><p style="font-size:0.82rem;color:var(--terminal-text);opacity:0.5">Enter a Token ID and click VALIDATE to begin.</p></div>`
    }
    const isNFT = this.tokenInfo.type === 'NON_FUNGIBLE_UNIQUE'
    const selectedSerials = this.ownedSerials.filter(s => s.selected)
    return `
      <div class="cc-right-content">
        <h4 class="section-title" style="font-size:0.95rem">Burn Preview</h4>
        <div class="preview-info">
          <div class="info-row"><span>Token ID</span><span class="status-value">${this.tokenInfo.tokenId}</span></div>
          <div class="info-row"><span>Name</span><span class="status-value">${this.tokenInfo.name}</span></div>
          <div class="info-row"><span>Symbol</span><span class="status-value">${this.tokenInfo.symbol}</span></div>
          <div class="info-row"><span>Type</span><span class="status-value">${isNFT ? 'NFT Collection' : 'Fungible Token'}</span></div>
          <div class="info-row"><span>Total Supply</span><span class="status-value">${this.tokenInfo.totalSupply}</span></div>
          <div class="info-row"><span>Treasury</span><span class="status-value">${this.tokenInfo.treasuryAccountId}</span></div>
        </div>
        ${isNFT && selectedSerials.length > 0 ? `
          <div class="result-block" style="margin-top:0.75rem">
            <label style="color:#ff6b6b">🔥 Serials to Burn (${selectedSerials.length})</label>
            <p style="font-size:0.82rem;color:var(--terminal-text);margin:0.25rem 0 0;word-break:break-all">${selectedSerials.map(s => '#' + s.serial).join(', ')}</p>
          </div>
        ` : ''}
        ${!isNFT && this.burnAmount ? `
          <div class="result-block" style="margin-top:0.75rem">
            <label style="color:#ff6b6b">🔥 Amount to Burn</label>
            <p style="font-size:1.1rem;color:#ff6b6b;margin:0.25rem 0 0;font-weight:bold">${this.burnAmount} ${this.tokenInfo.symbol}</p>
          </div>
        ` : ''}
        ${(isNFT && selectedSerials.length > 0) || (!isNFT && this.burnAmount) ? `
          <div style="margin-top:0.75rem;padding:0.5rem 0.7rem;background:rgba(255,80,80,0.08);border:1px solid rgba(255,80,80,0.2);border-radius:6px">
            <p style="font-size:0.75rem;color:#ff6b6b;margin:0">⚠ This action is <strong>permanent</strong> and <strong>irreversible</strong>. Burned assets cannot be recovered.</p>
          </div>
        ` : ''}
      </div>`
  }

  // ─── SUCCESS ───────────────────────────────────────────────

  private static renderSuccessPanel(): string {
    const isNFT = this.tokenInfo?.type === 'NON_FUNGIBLE_UNIQUE'
    return `
      <div class="art-gen-section">
        <h3 class="section-title">◆ Burn Complete ✓</h3>
        <div class="back-link" id="burn-back"><span class="back-arrow">←</span><span>Back to Home</span></div>
        <div class="preview-info">
          <div class="info-row"><span>Token ID</span><span class="status-value">${this.tokenInfo?.tokenId || '—'}</span></div>
          <div class="info-row"><span>Name</span><span class="status-value">${this.tokenInfo?.name || '—'}</span></div>
          <div class="info-row"><span>Burned</span><span class="status-value" style="color:#ff6b6b">${this.burnedCount} ${isNFT ? 'NFT(s)' : (this.tokenInfo?.symbol || 'tokens')}</span></div>
        </div>
        <button class="terminal-button" id="burn-new" style="margin-top:1rem">BURN MORE TOKENS</button>
      </div>`
  }

  private static renderSuccessDetails(): string {
    const network = WalletConnectService.getState().network?.toLowerCase() || 'mainnet'
    const isNFT = this.tokenInfo?.type === 'NON_FUNGIBLE_UNIQUE'
    return `
      <div class="cc-right-content">
        <h4 class="section-title" style="font-size:0.95rem">🔥 Burn Successful!</h4>
        <div class="result-block">
          <label>Token</label>
          <a class="cid-link" href="https://hashscan.io/${network}/token/${this.tokenInfo?.tokenId}" target="_blank" rel="noopener">${this.tokenInfo?.tokenId}</a>
        </div>
        <div class="result-block" style="margin-top:0.75rem">
          <label>Burned</label>
          <code class="cid-value" style="font-size:1.1rem;color:#ff6b6b">${this.burnedCount} ${isNFT ? 'NFT(s)' : (this.tokenInfo?.symbol || 'tokens')}</code>
        </div>
        ${this.txIds.map((txId, i) => `
          <div class="result-block" style="margin-top:0.75rem">
            <label>Transaction${this.txIds.length > 1 ? ' ' + (i + 1) : ''}</label>
            <code class="cid-value" style="font-size:0.8rem">${txId}</code>
            <a class="cid-link" href="https://hashscan.io/${network}/transaction/${txId}" target="_blank" rel="noopener" style="font-size:0.78rem">View on HashScan →</a>
          </div>
        `).join('')}
      </div>`
  }

  // ─── HELPERS ───────────────────────────────────────────────

  private static escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  private static refresh(): void {
    const leftPanel = document.querySelector('.art-gen-left')
    const scrollTop = leftPanel?.scrollTop ?? 0
    const app = document.querySelector<HTMLDivElement>('#app')!
    app.innerHTML = this.render()
    this.init()
    const newLeftPanel = document.querySelector('.art-gen-left')
    if (newLeftPanel) newLeftPanel.scrollTop = scrollTop
  }

  static resetForm(): void {
    this.tokenIdInput = ''
    this.tokenValidated = false
    this.tokenInfo = null
    this.tokenError = null
    this.ownedSerials = []
    this.isFetchingSerials = false
    this.burnAmount = ''
    this.step = 'form'
    this.loading = false
    this.error = null
    this.statusMessage = ''
    this.txIds = []
    this.burnedCount = 0
    this.showConfirmModal = false
    this.supplyKeyInput = ''
    this.supplyKeyRevealed = false
    this.supplyKeyError = null
  }

  // ─── INIT ──────────────────────────────────────────────────

  static init(): void {
    // Back button
    document.getElementById('burn-back')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('navigate-to-tool', { detail: { toolId: 'home' } }))
    })

    // Token ID input
    const tokenInput = document.getElementById('burn-token-id') as HTMLInputElement
    tokenInput?.addEventListener('input', () => { this.tokenIdInput = tokenInput.value })
    tokenInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.validateToken() })

    // Validate button
    document.getElementById('burn-validate')?.addEventListener('click', () => this.validateToken())

    // Supply key input
    const supplyKeyInput = document.getElementById('burn-supply-key') as HTMLInputElement
    supplyKeyInput?.addEventListener('input', () => {
      this.supplyKeyInput = supplyKeyInput.value
      this.supplyKeyError = null
    })

    // Supply key toggle
    document.getElementById('burn-toggle-supply-key')?.addEventListener('click', () => {
      this.supplyKeyRevealed = !this.supplyKeyRevealed
      this.refresh()
    })

    // Serial checkboxes (NFT)
    document.querySelectorAll('.burn-serial-cb').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const idx = parseInt((e.target as HTMLInputElement).dataset.index || '0')
        if (this.ownedSerials[idx]) {
          this.ownedSerials[idx].selected = (e.target as HTMLInputElement).checked
          this.refresh()
        }
      })
    })

    // Select All toggle
    document.getElementById('burn-toggle-all')?.addEventListener('click', () => {
      const allSelected = this.ownedSerials.every(s => s.selected)
      this.ownedSerials.forEach(s => s.selected = !allSelected)
      this.refresh()
    })

    // Burn amount input (Fungible) — update preview + button without full refresh to keep focus
    const amountInput = document.getElementById('burn-amount') as HTMLInputElement
    amountInput?.addEventListener('input', () => {
      this.burnAmount = amountInput.value
      const rightPanel = document.querySelector('.art-gen-right')
      if (rightPanel) rightPanel.innerHTML = this.renderRightPanel()
      const hasAmount = !!this.burnAmount.trim()
      const btn = document.getElementById('burn-execute-btn')
      const divider = document.getElementById('burn-btn-divider')
      if (btn) {
        btn.textContent = `🔥 BURN ${this.burnAmount} ${this.tokenInfo?.symbol || ''}`
        btn.style.display = hasAmount ? '' : 'none'
      }
      if (divider) divider.style.display = hasAmount ? '' : 'none'
    })

    // Burn execute button
    document.getElementById('burn-execute-btn')?.addEventListener('click', () => { this.executeBurn() })

    // Confirm modal buttons
    document.getElementById('burn-confirm-cancel')?.addEventListener('click', () => {
      this.showConfirmModal = false
      this.refresh()
    })
    document.getElementById('burn-confirm-ok')?.addEventListener('click', () => {
      this.showConfirmModal = false
      this.proceedWithBurn()
    })

    // Dismiss error
    document.getElementById('burn-dismiss-error')?.addEventListener('click', () => { this.error = null; this.refresh() })

    // New burn button (from success screen)
    document.getElementById('burn-new')?.addEventListener('click', () => { this.resetForm(); this.refresh() })
  }

  // ─── TOKEN VALIDATION ──────────────────────────────────────

  private static async validateToken(): Promise<void> {
    const tokenId = this.tokenIdInput.trim()
    if (!tokenId) {
      this.tokenError = 'Please enter a Token ID'
      this.refresh()
      return
    }

    this.loading = true
    this.tokenError = null
    this.tokenValidated = false
    this.tokenInfo = null
    this.ownedSerials = []
    this.statusMessage = 'Validating token...'
    this.refresh()

    try {
      const res = await fetch(`${MIRROR_NODE_URL}/api/v1/tokens/${tokenId}`)
      if (!res.ok) throw new Error(`Token ${tokenId} not found on Hedera`)
      const data = await res.json()

      if (!data.supply_key) {
        throw new Error('This token has no Supply Key — tokens cannot be burned without a Supply Key.')
      }

      const ws = WalletConnectService.getState()
      if (!ws.connected || !ws.accountId) {
        throw new Error('Please connect your wallet first.')
      }

      const supplyKey = data.supply_key?.key

      this.tokenInfo = {
        tokenId: data.token_id,
        name: data.name || 'Unnamed',
        symbol: data.symbol || '',
        type: data.type || 'FUNGIBLE_COMMON',
        decimals: parseInt(data.decimals || '0'),
        totalSupply: data.total_supply || '0',
        treasuryAccountId: data.treasury_account_id || '—',
        supplyKey: supplyKey || null,
      }
      this.tokenValidated = true
      this.tokenError = null
      this.loading = false
      this.statusMessage = ''

      // If NFT, fetch serials from treasury
      if (data.type === 'NON_FUNGIBLE_UNIQUE') {
        this.isFetchingSerials = true
        this.refresh()
        await this.fetchTreasuryNFTs(tokenId, data.treasury_account_id)
        this.isFetchingSerials = false
      }

      this.refresh()
    } catch (err: any) {
      this.tokenError = err.message || 'Failed to validate token'
      this.tokenValidated = false
      this.tokenInfo = null
      this.loading = false
      this.statusMessage = ''
      this.refresh()
    }
  }

  // ─── FETCH TREASURY NFTs ──────────────────────────────────

  private static async fetchTreasuryNFTs(tokenId: string, treasuryId: string): Promise<void> {
    const serials: number[] = []
    let url: string | null = `${MIRROR_NODE_URL}/api/v1/accounts/${treasuryId}/nfts?token.id=${tokenId}&limit=100`

    while (url) {
      const res: Response = await fetch(url)
      if (!res.ok) break
      const data: any = await res.json()
      if (data.nfts) {
        data.nfts.forEach((nft: any) => serials.push(nft.serial_number))
      }
      url = data.links?.next ? `${MIRROR_NODE_URL}${data.links.next}` : null
    }

    this.ownedSerials = serials.sort((a, b) => a - b).map(serial => ({ serial, selected: false }))
  }

  // ─── EXECUTE BURN ──────────────────────────────────────────

  private static async executeBurn(): Promise<void> {
    if (!this.tokenValidated || !this.tokenInfo) return

    const ws = WalletConnectService.getState()
    if (!ws.connected || !ws.accountId) {
      alert('Please connect your wallet first.')
      return
    }

    const isNFT = this.tokenInfo.type === 'NON_FUNGIBLE_UNIQUE'
    const selectedSerials = this.ownedSerials.filter(s => s.selected).map(s => s.serial)

    if (isNFT && selectedSerials.length === 0) {
      alert('Please select at least one NFT serial to burn.')
      return
    }
    if (!isNFT && !this.burnAmount.trim()) {
      alert('Please enter an amount to burn.')
      return
    }

    // Show custom confirmation modal instead of browser confirm()
    this.showConfirmModal = true
    this.refresh()
    return
  }

  private static async proceedWithBurn(): Promise<void> {
    if (!this.tokenValidated || !this.tokenInfo) return
    const ws = WalletConnectService.getState()
    if (!ws.connected || !ws.accountId) return
    const isNFT = this.tokenInfo.type === 'NON_FUNGIBLE_UNIQUE'
    const selectedSerials = this.ownedSerials.filter(s => s.selected).map(s => s.serial)

    // Validate supply key
    if (!this.supplyKeyInput.trim()) {
      this.error = 'Supply private key is required'
      this.loading = false
      this.refresh()
      return
    }

    let supplyPrivateKey: PrivateKey
    try {
      supplyPrivateKey = PrivateKey.fromString(this.supplyKeyInput.trim())
    } catch (err) {
      this.error = 'Invalid supply key format'
      this.loading = false
      this.refresh()
      return
    }

    this.loading = true
    this.error = null
    this.txIds = []
    this.burnedCount = 0
    this.statusMessage = 'Preparing burn transaction...'
    this.refresh()

    try {
      const accountId = ws.accountId
      const signer = WalletConnectService.getSigner(accountId)
      const acctId = AccountId.fromString(accountId)
      const tid = TokenId.fromString(this.tokenInfo.tokenId)

      if (isNFT) {
        // Burn NFTs in batches of 10
        const BATCH_SIZE = 10
        for (let i = 0; i < selectedSerials.length; i += BATCH_SIZE) {
          const batch = selectedSerials.slice(i, i + BATCH_SIZE)
          const batchNum = Math.floor(i / BATCH_SIZE) + 1
          const totalBatches = Math.ceil(selectedSerials.length / BATCH_SIZE)

          this.statusMessage = `Burning batch ${batchNum}/${totalBatches} (${batch.length} NFTs)...`
          this.refresh()

          const tx = new TokenBurnTransaction()
            .setTokenId(tid)
            .setSerials(batch)
            .setTransactionId(TransactionId.generate(acctId))

          const frozenTx = await tx.freezeWith(getHederaClient())
          const signedTx = await frozenTx.sign(supplyPrivateKey)
          const txResponse = await signedTx.executeWithSigner(signer)

          const txId = txResponse?.transactionId?.toString() || `batch-${batchNum}`
          this.txIds.push(txId)
          this.burnedCount += batch.length
        }
      } else {
        // Burn fungible tokens
        const amount = parseFloat(this.burnAmount)
        if (isNaN(amount) || amount <= 0) throw new Error('Invalid burn amount')

        const decimals = this.tokenInfo.decimals
        const rawAmount = Math.round(amount * Math.pow(10, decimals))

        this.statusMessage = 'Burning tokens...'
        this.refresh()

        const tx = new TokenBurnTransaction()
          .setTokenId(tid)
          .setAmount(rawAmount)
          .setTransactionId(TransactionId.generate(acctId))

        const frozenTx = await tx.freezeWith(getHederaClient())
        const signedTx = await frozenTx.sign(supplyPrivateKey)
        const txResponse = await signedTx.executeWithSigner(signer)

        const txId = txResponse?.transactionId?.toString() || 'burn-tx'
        this.txIds.push(txId)
        this.burnedCount = amount
      }

      this.step = 'success'
      this.loading = false
      this.statusMessage = `Burn complete — ${this.burnedCount} ${isNFT ? 'NFT(s)' : this.tokenInfo.symbol} burned`
      this.refresh()
    } catch (err: any) {
      console.error('Burn error:', err)
      this.loading = false
      this.error = err.message || 'Burn failed'
      this.statusMessage = ''
      this.refresh()
    }
  }
}
