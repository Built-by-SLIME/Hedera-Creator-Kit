/**
 * Domain Registration Tool
 * Register .hbar domains via HNS (Hedera Name Service) API + TransferTransaction + WalletConnect
 */
import WalletConnectService from '../services/WalletConnectService'
import {
  TransferTransaction,
  TokenAssociateTransaction,
  AccountId,
  Hbar,
  Client,
  TransactionId,
} from '@hashgraph/sdk'

const HNS_API_BASE = 'https://api.prod.hashgraph.name'
const HNS_NFT_TOKEN_ID = '0.0.1234197'  // .hbar domain NFT token
const HNS_FEE_ACCOUNT = '0.0.1233811'   // HNS fee collection account
const MIRROR_NODE_URL = 'https://mainnet-public.mirrornode.hedera.com'

type DomainStep = 'form' | 'success'

export class DomainTool {
  private static domainInput = ''
  private static years = 1
  private static priceTinybar: number | null = null
  private static isChecking = false
  private static isAvailable: boolean | null = null
  private static step: DomainStep = 'form'
  private static loading = false
  private static error: string | null = null
  private static statusMessage = ''
  private static txId: string | null = null
  private static registeredDomain: string | null = null
  private static showConfirmModal = false

  // ─── RENDER ────────────────────────────────────────────────

  static render(): string {
    return `<div class="terminal-window">${this.renderChrome()}${this.renderContent()}${this.renderStatusBar()}</div>${this.showConfirmModal ? this.renderConfirmModal() : ''}`
  }

  private static renderConfirmModal(): string {
    const priceHbar = this.priceTinybar ? (this.priceTinybar / 1e8).toFixed(2) : '?'
    return `
      <div class="burn-confirm-overlay" id="domain-confirm-overlay">
        <div class="burn-confirm-card" style="border-color:rgba(107,255,158,0.4);box-shadow:0 0 60px rgba(107,255,158,0.15),0 0 120px rgba(107,255,158,0.05)">
          <div class="burn-confirm-icon">◆</div>
          <div class="burn-confirm-title" style="color:#6bff9e">Register ${this.escapeHtml(this.domainInput)}.hbar?</div>
          <div class="burn-confirm-details">${this.years} year${this.years > 1 ? 's' : ''} — ${priceHbar} ℏ</div>
          <div class="burn-confirm-warning" style="color:rgba(107,255,158,0.7)">⚠ This will send <strong>${priceHbar} HBAR</strong> to the HNS fee account.</div>
          <hr class="burn-confirm-divider" style="border-color:rgba(107,255,158,0.2)" />
          <div class="burn-confirm-buttons">
            <button class="terminal-button secondary" id="domain-confirm-cancel">Cancel</button>
            <button class="terminal-button" id="domain-confirm-ok" style="background:rgba(107,255,158,0.15);border-color:rgba(107,255,158,0.5);color:#6bff9e">REGISTER</button>
          </div>
        </div>
      </div>`
  }

  private static renderChrome(): string {
    return `<div class="window-chrome"><div class="window-controls"><div class="window-dot close"></div><div class="window-dot minimize"></div><div class="window-dot maximize"></div></div><div class="window-title">hedera-creator-kit — domain registration</div></div>`
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
      return `<div class="art-gen-section"><h3 class="section-title">◆ Registering Domain...</h3><div class="loading-state"><div class="spinner"></div><p>${this.statusMessage || 'Processing...'}</p></div></div>`
    }
    return this.step === 'form' ? this.renderForm() : this.renderSuccessPanel()
  }

  private static renderRightPanel(): string {
    if (this.loading) {
      return `<div class="loading-state"><div class="spinner"></div><p>${this.statusMessage || 'Processing...'}</p></div>`
    }
    if (this.error) {
      return `<div class="cc-right-content"><div class="error-state"><p class="error-message">⚠ ${this.error}</p><button class="terminal-button" id="domain-dismiss-error" style="margin-top:1rem">DISMISS</button></div></div>`
    }
    return this.step === 'form' ? this.renderPreview() : this.renderSuccessDetails()
  }

  // ─── FORM ──────────────────────────────────────────────────

  private static renderForm(): string {
    const domainClean = this.domainInput.toLowerCase().replace(/[^a-z0-9-]/g, '')
    const canSearch = domainClean.length >= 1
    const canRegister = this.isAvailable === true && this.priceTinybar !== null
    const priceHbar = this.priceTinybar ? (this.priceTinybar / 1e8).toFixed(2) : null

    return `
      <div class="art-gen-section">
        <h3 class="section-title">◆ Domain Registration</h3>
        <div class="back-link" id="domain-back"><span class="back-arrow">←</span><span>Back</span></div>

        <div style="margin:0.75rem 0;padding:0.6rem 0.8rem;background:rgba(107,255,158,0.06);border:1px solid rgba(107,255,158,0.2);border-radius:6px">
          <p style="font-size:0.78rem;color:#6bff9e;margin:0 0 0.35rem">◆ <strong>HNS Domains</strong> — Register a .hbar domain name via Hedera Name Service. Domains are NFTs that resolve to your Hedera account.</p>
          <p style="font-size:0.78rem;color:var(--terminal-text);opacity:0.6;margin:0">Pricing: ≤5 chars $25/yr • 6+ chars $10/yr (paid in HBAR)</p>
        </div>

        <div class="filter-divider"></div>

        <div class="input-group">
          <label for="domain-name">Domain Name *</label>
          <div class="input-row" style="gap:0.5rem;align-items:center">
            <input type="text" id="domain-name" class="token-input" placeholder="yourname" value="${this.escapeHtml(this.domainInput)}" style="flex:1" />
            <span style="font-size:0.95rem;color:var(--terminal-text);opacity:0.7;white-space:nowrap">.hbar</span>
          </div>
          ${domainClean && domainClean !== this.domainInput ? `<p style="font-size:0.75rem;color:var(--terminal-text);opacity:0.5;margin:0.25rem 0 0">Will register: ${domainClean}.hbar</p>` : ''}
        </div>

        <div class="input-group">
          <label for="domain-years">Registration Period</label>
          <select id="domain-years" class="token-input" style="width:auto;min-width:160px">
            ${[1, 3, 5, 10].map(y => `<option value="${y}" ${this.years === y ? 'selected' : ''}>${y} year${y > 1 ? 's' : ''}</option>`).join('')}
          </select>
        </div>

        <div class="filter-divider"></div>
        <button class="terminal-button" id="domain-check">${this.isChecking ? 'Checking...' : '🔍 CHECK AVAILABILITY'}</button>

        ${this.isAvailable === true && priceHbar ? `
          <div style="margin-top:0.75rem;padding:0.5rem 0.7rem;background:rgba(107,255,158,0.08);border:1px solid rgba(107,255,158,0.25);border-radius:6px">
            <p style="font-size:0.82rem;color:#6bff9e;margin:0">✓ <strong>${domainClean}.hbar</strong> is available!</p>
            <p style="font-size:0.78rem;color:var(--terminal-text);opacity:0.7;margin:0.25rem 0 0">${this.years} year${this.years > 1 ? 's' : ''} — <strong>${priceHbar} ℏ</strong></p>
          </div>
        ` : ''}
        ${this.isAvailable === false ? `
          <div style="margin-top:0.75rem;padding:0.5rem 0.7rem;background:rgba(255,107,107,0.08);border:1px solid rgba(255,107,107,0.25);border-radius:6px">
            <p style="font-size:0.82rem;color:#ff6b6b;margin:0">✗ <strong>${domainClean}.hbar</strong> is already taken.</p>
          </div>
        ` : ''}

        ${canRegister ? `
          <div class="filter-divider"></div>
          <button class="terminal-button" id="domain-register" style="background:rgba(107,255,158,0.15);border-color:rgba(107,255,158,0.5);color:#6bff9e">◆ REGISTER ${domainClean.toUpperCase()}.HBAR — ${priceHbar} ℏ</button>
        ` : ''}
      </div>`
  }

  // ─── PREVIEW (right panel) ─────────────────────────────────

  private static renderPreview(): string {
    if (this.isAvailable === null && !this.isChecking) {
      return `<div class="cc-right-content"><h4 class="section-title" style="font-size:0.95rem">Domain Preview</h4><p style="font-size:0.82rem;color:var(--terminal-text);opacity:0.5">Enter a domain name and check availability to see details.</p></div>`
    }
    if (this.isChecking) {
      return `<div class="cc-right-content"><h4 class="section-title" style="font-size:0.95rem">Domain Preview</h4><div class="loading-state"><div class="spinner"></div><p>Checking availability...</p></div></div>`
    }
    const domainClean = this.domainInput.toLowerCase().replace(/[^a-z0-9-]/g, '')
    const priceHbar = this.priceTinybar ? (this.priceTinybar / 1e8).toFixed(2) : '—'
    return `
      <div class="cc-right-content">
        <h4 class="section-title" style="font-size:0.95rem">Domain Preview</h4>
        <div class="preview-info">
          <div class="info-row"><span>Domain</span><span class="status-value">${domainClean}.hbar</span></div>
          <div class="info-row"><span>Status</span><span class="status-value" style="color:${this.isAvailable ? '#6bff9e' : '#ff6b6b'}">${this.isAvailable ? '✓ Available' : '✗ Taken'}</span></div>
          <div class="info-row"><span>Period</span><span class="status-value">${this.years} year${this.years > 1 ? 's' : ''}</span></div>
          <div class="info-row"><span>Cost</span><span class="status-value">${priceHbar} ℏ</span></div>
          <div class="info-row"><span>Service</span><span class="status-value">HNS (Hedera Name Service)</span></div>
          <div class="info-row"><span>NFT Token</span><span class="status-value">${HNS_NFT_TOKEN_ID}</span></div>
        </div>
        ${this.isAvailable ? `
          <div style="margin-top:0.75rem;padding:0.5rem 0.7rem;background:rgba(107,255,158,0.06);border:1px solid rgba(107,255,158,0.15);border-radius:6px">
            <p style="font-size:0.75rem;color:var(--terminal-text);opacity:0.6;margin:0">After registration, the domain NFT will appear in your wallet. You can then use <strong>${domainClean}.hbar</strong> in place of your account ID.</p>
          </div>
        ` : ''}
      </div>`
  }

  // ─── SUCCESS ───────────────────────────────────────────────

  private static renderSuccessPanel(): string {
    return `
      <div class="art-gen-section">
        <h3 class="section-title">◆ Domain Registered ✓</h3>
        <div class="back-link" id="domain-back"><span class="back-arrow">←</span><span>Back to Home</span></div>
        <div class="preview-info">
          <div class="info-row"><span>Domain</span><span class="status-value" style="color:#6bff9e">${this.registeredDomain || '—'}</span></div>
          <div class="info-row"><span>Period</span><span class="status-value">${this.years} year${this.years > 1 ? 's' : ''}</span></div>
          <div class="info-row"><span>Cost</span><span class="status-value">${this.priceTinybar ? (this.priceTinybar / 1e8).toFixed(2) : '—'} ℏ</span></div>
        </div>
        <button class="terminal-button" id="domain-new" style="margin-top:1rem">REGISTER ANOTHER DOMAIN</button>
      </div>`
  }

  private static renderSuccessDetails(): string {
    const network = WalletConnectService.getState().network?.toLowerCase() || 'mainnet'
    return `
      <div class="cc-right-content">
        <h4 class="section-title" style="font-size:0.95rem">◆ Registration Successful!</h4>
        <div class="result-block">
          <label>Domain</label>
          <code class="cid-value" style="font-size:1.1rem;color:#6bff9e">${this.registeredDomain}</code>
        </div>
        ${this.txId ? `
          <div class="result-block" style="margin-top:0.75rem">
            <label>Transaction</label>
            <code class="cid-value" style="font-size:0.8rem">${this.txId}</code>
            <a class="cid-link" href="https://hashscan.io/${network}/transaction/${this.txId}" target="_blank" rel="noopener" style="font-size:0.78rem">View on HashScan →</a>
          </div>
        ` : ''}
        <div class="result-block" style="margin-top:0.75rem">
          <label>NFT Token</label>
          <a class="cid-link" href="https://hashscan.io/${network}/token/${HNS_NFT_TOKEN_ID}" target="_blank" rel="noopener">${HNS_NFT_TOKEN_ID}</a>
        </div>
        <div style="margin-top:0.75rem;padding:0.5rem 0.7rem;background:rgba(107,255,158,0.06);border:1px solid rgba(107,255,158,0.15);border-radius:6px">
          <p style="font-size:0.75rem;color:var(--terminal-text);opacity:0.6;margin:0">The domain NFT should appear in your wallet shortly. You can use it in place of your account ID across the Hedera ecosystem.</p>
        </div>
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

  private static resetForm(): void {
    this.domainInput = ''
    this.years = 1
    this.priceTinybar = null
    this.isChecking = false
    this.isAvailable = null
    this.step = 'form'
    this.loading = false
    this.error = null
    this.statusMessage = ''
    this.txId = null
    this.registeredDomain = null
    this.showConfirmModal = false
  }

  /** Get HNS price in USD based on domain length and years */
  private static getUsdPrice(domain: string, years: number): number {
    const length = domain.split('.')[0].length
    switch (years) {
      case 3: return length <= 5 ? 60 : 15
      case 5: return length <= 5 ? 75 : 20
      case 10: return length <= 5 ? 100 : 40
      default: return length <= 5 ? 25 : 10  // 1 year
    }
  }

  // ─── INIT ──────────────────────────────────────────────────

  static init(): void {
    // Back button
    document.getElementById('domain-back')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('navigate-to-tool', { detail: { toolId: 'home' } }))
    })

    // Domain name input
    const nameInput = document.getElementById('domain-name') as HTMLInputElement
    nameInput?.addEventListener('input', () => {
      this.domainInput = nameInput.value
      // Reset availability when input changes
      this.isAvailable = null
      this.priceTinybar = null
    })
    nameInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.checkAvailability() })

    // Years selector
    const yearsSelect = document.getElementById('domain-years') as HTMLSelectElement
    yearsSelect?.addEventListener('change', () => {
      this.years = parseInt(yearsSelect.value) || 1
      // Reset price when years change
      this.priceTinybar = null
      this.isAvailable = null
    })

    // Check availability button
    document.getElementById('domain-check')?.addEventListener('click', () => this.checkAvailability())

    // Register button
    document.getElementById('domain-register')?.addEventListener('click', () => this.startRegistration())

    // Confirm modal buttons
    document.getElementById('domain-confirm-cancel')?.addEventListener('click', () => {
      this.showConfirmModal = false
      this.refresh()
    })
    document.getElementById('domain-confirm-ok')?.addEventListener('click', () => {
      this.showConfirmModal = false
      this.executeRegistration()
    })

    // Dismiss error
    document.getElementById('domain-dismiss-error')?.addEventListener('click', () => { this.error = null; this.refresh() })

    // New registration button (from success screen)
    document.getElementById('domain-new')?.addEventListener('click', () => { this.resetForm(); this.refresh() })
  }

  // ─── AVAILABILITY CHECK ────────────────────────────────────

  private static async checkAvailability(): Promise<void> {
    const domainClean = this.domainInput.toLowerCase().replace(/[^a-z0-9-]/g, '')
    if (!domainClean) {
      this.error = 'Please enter a domain name'
      this.refresh()
      return
    }

    this.isChecking = true
    this.isAvailable = null
    this.priceTinybar = null
    this.error = null
    this.refresh()

    try {
      // Step 1: Check availability via HNS API
      const availRes = await fetch(`${HNS_API_BASE}/api/v2/slds/${domainClean}.hbar/availability`)

      if (availRes.ok) {
        const availData = await availRes.json()
        this.isAvailable = availData.message === 'AVAIL'
      } else if (availRes.status === 403) {
        // 403 means domain is taken
        this.isAvailable = false
      } else {
        throw new Error(`Availability check failed (HTTP ${availRes.status})`)
      }

      // Step 2: Get price if available
      if (this.isAvailable) {
        // Get current HBAR price in USD
        const priceRes = await fetch(`${HNS_API_BASE}/api/v2/usd-hbar-price`)
        const priceData = await priceRes.json()
        const hbarPriceUsd = priceData.price  // e.g. 0.1016

        // Calculate USD cost based on domain length and years
        const usdCost = this.getUsdPrice(domainClean, this.years)

        // Convert to tinybars: (usdCost / hbarPriceUsd) * 1e8
        const hbarAmount = usdCost / hbarPriceUsd
        this.priceTinybar = Math.ceil(hbarAmount * 1e8)
      }

      this.isChecking = false
      this.refresh()
    } catch (err: any) {
      console.error('Availability check error:', err)
      this.isChecking = false
      this.error = err.message || 'Failed to check availability'
      this.refresh()
    }
  }

  // ─── REGISTRATION ──────────────────────────────────────────

  private static startRegistration(): void {
    const ws = WalletConnectService.getState()
    if (!ws.connected || !ws.accountId) {
      this.error = 'Please connect your wallet first.'
      this.refresh()
      return
    }
    if (!this.isAvailable || !this.priceTinybar) {
      this.error = 'Please check domain availability first.'
      this.refresh()
      return
    }
    // Show confirmation modal
    this.showConfirmModal = true
    this.refresh()
  }

  private static async executeRegistration(): Promise<void> {
    if (!this.isAvailable || !this.priceTinybar) return

    const ws = WalletConnectService.getState()
    if (!ws.connected || !ws.accountId) return

    const domainClean = this.domainInput.toLowerCase().replace(/[^a-z0-9-]/g, '')
    if (!domainClean) return

    this.loading = true
    this.error = null
    this.statusMessage = 'Checking token association...'
    this.refresh()

    try {
      const accountId = ws.accountId
      const signer = WalletConnectService.getSigner(accountId)
      const acctId = AccountId.fromString(accountId)
      const client = Client.forMainnet()

      // Step 1: Ensure user has associated the HNS NFT token
      const assocRes = await fetch(`${MIRROR_NODE_URL}/api/v1/accounts/${accountId}/tokens?token.id=${HNS_NFT_TOKEN_ID}`)
      const assocData = await assocRes.json()
      const isAssociated = assocData.tokens && assocData.tokens.length > 0

      if (!isAssociated) {
        this.statusMessage = 'Associating HNS domain token — approve in wallet...'
        this.refresh()

        const assocTx = new TokenAssociateTransaction()
          .setAccountId(acctId)
          .setTokenIds([HNS_NFT_TOKEN_ID])
        assocTx.setTransactionId(TransactionId.generate(acctId))
        assocTx.freezeWith(client)
        await assocTx.executeWithSigner(signer)

        // Wait for association to propagate
        await new Promise(r => setTimeout(r, 3000))
      }

      // Step 2: Initialize purchase via HNS API
      this.statusMessage = 'Initializing purchase...'
      this.refresh()

      const fullDomain = `${domainClean}.hbar`
      const initRes = await fetch(`${HNS_API_BASE}/api/v2/slds/initialize-purchase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          params: {
            cart: [{ sld: fullDomain, years: this.years }],
            accountId: accountId
          }
        })
      })

      if (!initRes.ok) {
        const errBody = await initRes.text()
        throw new Error(`Purchase initialization failed: ${errBody}`)
      }

      const initData = await initRes.json()
      const costTinybars = initData.cost
      const memo = initData.memo

      if (!costTinybars || !memo) {
        throw new Error('Invalid response from HNS API — missing cost or memo')
      }

      // Step 3: Send HBAR payment to HNS fee account
      this.statusMessage = 'Sending payment — approve in wallet...'
      this.refresh()

      const payTx = new TransferTransaction()
        .addHbarTransfer(acctId, Hbar.fromTinybars(-costTinybars))
        .addHbarTransfer(AccountId.fromString(HNS_FEE_ACCOUNT), Hbar.fromTinybars(costTinybars))
        .setTransactionMemo(JSON.stringify(memo))

      payTx.setTransactionId(TransactionId.generate(acctId))
      payTx.freezeWith(client)

      const txResponse = await payTx.executeWithSigner(signer)

      this.statusMessage = 'Confirming payment...'
      this.refresh()

      const txId = txResponse?.transactionId?.toString() || null
      this.txId = txId

      // Wait for payment to confirm on network
      await new Promise(r => setTimeout(r, 5000))

      // Step 4: Finalize purchase via HNS API
      this.statusMessage = 'Finalizing domain registration...'
      this.refresh()

      const purchaseRes = await fetch(`${HNS_API_BASE}/api/v2/slds/${fullDomain}/purchase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          params: {
            domain: fullDomain,
            accountId: accountId,
            transactionId: txId,
            years: this.years
          }
        })
      })

      if (!purchaseRes.ok) {
        const errBody = await purchaseRes.text()
        throw new Error(`Purchase finalization failed: ${errBody}. Your payment tx: ${txId}`)
      }

      this.registeredDomain = fullDomain

      // Wait for NFT minting to propagate
      await new Promise(r => setTimeout(r, 3000))

      this.step = 'success'
      this.loading = false
      this.statusMessage = `Domain registered — ${fullDomain}`
      this.refresh()
    } catch (err: any) {
      console.error('Registration error:', err)
      this.loading = false
      this.error = err.message || 'Registration failed'
      this.statusMessage = ''
      this.refresh()
    }
  }
}