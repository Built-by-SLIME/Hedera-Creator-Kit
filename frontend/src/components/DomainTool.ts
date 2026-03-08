/**
 * Domain Registration Tool
 * Registers .hedera / .slime / .gib domains via the HCS-backed proprietary registry.
 * No third-party dependencies — fully on-chain via Hedera Consensus Service.
 */
import WalletConnectService from '../services/WalletConnectService'
import { API_BASE_URL, DOMAIN_SUPPORTED_TLDS, DomainTld, DOMAIN_ADMIN_ACCOUNT, getHederaClient } from '../config'
import { TransferTransaction, AccountId, Hbar, TransactionId } from '@hashgraph/sdk'

// ─── Types ──────────────────────────────────────────────────────────────────

type DomainStep = 'form' | 'success'

interface CheckResult {
  available: boolean
  name: string
  tld: DomainTld
  years: number
  owner: string | null
  expiresAt: string | null
  priceUsd: number | null
  priceHbar: number | null
  hbarPriceUsd: number | null
  feeAccount: string | null
}

// ─── DomainTool ─────────────────────────────────────────────────────────────

export class DomainTool {
  private static domainInput    = ''
  private static selectedTld: DomainTld = 'hedera'
  private static years: 1|3|5|10       = 1
  private static checkResult: CheckResult | null = null
  private static isChecking     = false
  private static step: DomainStep = 'form'
  private static loading        = false
  private static error: string | null = null
  private static statusMessage  = ''
  private static txId: string | null  = null
  private static registeredDomain: string | null = null
  private static showConfirmModal = false

  // ─── RENDER ────────────────────────────────────────────────

  static render(): string {
    return `<div class="terminal-window">${this.renderChrome()}${this.renderContent()}${this.renderStatusBar()}</div>${this.showConfirmModal ? this.renderConfirmModal() : ''}`
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
        <div class="status-right"><span class="status-item">HEDERA CREATOR KIT v1.0</span><span class="status-item">MAINNET</span></div>
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
    const r = this.checkResult
    const canRegister = r?.available === true
    const priceHbar  = r?.priceHbar?.toFixed(4) ?? null
    const priceUsd   = r?.priceUsd ?? null

    return `
      <div class="art-gen-section">
        <h3 class="section-title">◆ Domain Registration</h3>
        <div class="back-link" id="domain-back"><span class="back-arrow">←</span><span>Back</span></div>

        <div style="margin:0.75rem 0;padding:0.6rem 0.8rem;background:rgba(107,255,158,0.06);border:1px solid rgba(107,255,158,0.2);border-radius:6px">
          <p style="font-size:0.78rem;color:#6bff9e;margin:0 0 0.25rem">◆ <strong>HCS Domain Registry</strong> — Proprietary on-chain registry. Fully decentralized, no third-party dependency.</p>
          <p style="font-size:0.78rem;color:var(--terminal-text);opacity:0.6;margin:0">TLDs: .hedera / .slime / .gib &nbsp;|&nbsp; Pricing: 1 char $100 • 2 chars $50 • 3+ chars $10/yr (standard)</p>
        </div>

        <div class="filter-divider"></div>

        <div class="input-group">
          <label for="domain-name">Domain Name *</label>
          <div class="input-row" style="gap:0.5rem;align-items:center">
            <input type="text" id="domain-name" class="token-input" placeholder="yourname" value="${this.escapeHtml(this.domainInput)}" style="flex:1" />
            <select id="domain-tld" class="token-input" style="width:auto;min-width:100px">
              ${DOMAIN_SUPPORTED_TLDS.map(t => `<option value="${t}" ${this.selectedTld === t ? 'selected' : ''}>.${t}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="input-group">
          <label for="domain-years">Registration Period</label>
          <select id="domain-years" class="token-input" style="width:auto;min-width:160px">
            ${([1, 3, 5, 10] as const).map(y => `<option value="${y}" ${this.years === y ? 'selected' : ''}>${y} year${y > 1 ? 's' : ''}</option>`).join('')}
          </select>
        </div>

        <div class="filter-divider"></div>
        <button class="terminal-button" id="domain-check" ${this.isChecking ? 'disabled' : ''}>${this.isChecking ? 'Checking...' : '🔍 CHECK AVAILABILITY'}</button>

        ${r?.available === true && priceHbar ? `
          <div style="margin-top:0.75rem;padding:0.5rem 0.7rem;background:rgba(107,255,158,0.08);border:1px solid rgba(107,255,158,0.25);border-radius:6px">
            <p style="font-size:0.82rem;color:#6bff9e;margin:0">✓ <strong>${this.escapeHtml(r.name)}.${r.tld}</strong> is available!</p>
            <p style="font-size:0.78rem;color:var(--terminal-text);opacity:0.7;margin:0.25rem 0 0">${r.years} year${r.years > 1 ? 's' : ''} — <strong>$${priceUsd} USD (~${priceHbar} ℏ)</strong></p>
          </div>` : ''}
        ${r?.available === false ? `
          <div style="margin-top:0.75rem;padding:0.5rem 0.7rem;background:rgba(255,107,107,0.08);border:1px solid rgba(255,107,107,0.25);border-radius:6px">
            <p style="font-size:0.82rem;color:#ff6b6b;margin:0">✗ <strong>${this.escapeHtml(r!.name)}.${r!.tld}</strong> is already taken.</p>
            ${r!.owner ? `<p style="font-size:0.75rem;color:var(--terminal-text);opacity:0.55;margin:0.2rem 0 0">Owner: ${r!.owner} &nbsp;|&nbsp; Expires: ${r!.expiresAt ? new Date(r!.expiresAt).toLocaleDateString() : '—'}</p>` : ''}
          </div>` : ''}

        ${canRegister ? `
          <div class="filter-divider"></div>
          <button class="terminal-button" id="domain-register" style="background:rgba(107,255,158,0.15);border-color:rgba(107,255,158,0.5);color:#6bff9e">◆ REGISTER ${this.escapeHtml(r!.name).toUpperCase()}.${r!.tld.toUpperCase()} — ${priceHbar} ℏ</button>
        ` : ''}
        ${this.isAdmin() ? this.renderAdminPanel() : ''}
      </div>`
  }

  private static isAdmin(): boolean {
    const ws = WalletConnectService.getState()
    return ws.connected && ws.accountId === DOMAIN_ADMIN_ACCOUNT
  }

  private static renderAdminPanel(): string {
    const r = this.checkResult
    const canRegister = r?.available === true
    return `
      <div style="margin-top:1.25rem;padding:0.75rem 0.9rem;background:rgba(107,255,158,0.05);border:1px solid rgba(107,255,158,0.3);border-radius:8px">
        <p style="font-size:0.78rem;color:#6bff9e;margin:0 0 0.5rem">🔑 <strong>Admin Registration</strong> — Treasury wallet detected. Register for free.</p>
        <div class="filter-divider"></div>
        ${canRegister ? `
          <button class="terminal-button" id="domain-admin-register" style="background:rgba(107,255,158,0.2);border-color:#6bff9e;color:#6bff9e;width:100%">
            ◆ ADMIN REGISTER ${this.escapeHtml(r!.name).toUpperCase()}.${r!.tld.toUpperCase()} — FREE
          </button>` : `
          <p style="font-size:0.78rem;color:var(--terminal-text);opacity:0.5;margin:0">Check availability above first, then register for free.</p>`}
      </div>`
  }

  // ─── CONFIRM MODAL ─────────────────────────────────────────

  private static renderConfirmModal(): string {
    const r = this.checkResult!
    return `
      <div class="burn-confirm-overlay" id="domain-confirm-overlay">
        <div class="burn-confirm-card" style="border-color:rgba(107,255,158,0.4);box-shadow:0 0 60px rgba(107,255,158,0.15)">
          <div class="burn-confirm-icon">◆</div>
          <div class="burn-confirm-title" style="color:#6bff9e">Register ${this.escapeHtml(r.name)}.${r.tld}?</div>
          <div class="burn-confirm-details">${r.years} year${r.years > 1 ? 's' : ''} — $${r.priceUsd} USD (~${r.priceHbar?.toFixed(4)} ℏ)</div>
          <div class="burn-confirm-warning" style="color:rgba(107,255,158,0.7)">⚠ This will send <strong>~${r.priceHbar?.toFixed(4)} HBAR</strong> to the registry fee account. The backend will verify payment and publish your registration to the HCS topic.</div>
          <hr class="burn-confirm-divider" style="border-color:rgba(107,255,158,0.2)" />
          <div class="burn-confirm-buttons">
            <button class="terminal-button secondary" id="domain-confirm-cancel">Cancel</button>
            <button class="terminal-button" id="domain-confirm-ok" style="background:rgba(107,255,158,0.15);border-color:rgba(107,255,158,0.5);color:#6bff9e">CONFIRM & PAY</button>
          </div>
        </div>
      </div>`
  }

  // ─── PREVIEW (right panel) ─────────────────────────────────

  private static renderPreview(): string {
    if (!this.checkResult && !this.isChecking) {
      return `<div class="cc-right-content"><h4 class="section-title" style="font-size:0.95rem">Domain Preview</h4><p style="font-size:0.82rem;color:var(--terminal-text);opacity:0.5">Enter a domain name and check availability to see details.</p></div>`
    }
    if (this.isChecking) {
      return `<div class="cc-right-content"><h4 class="section-title" style="font-size:0.95rem">Domain Preview</h4><div class="loading-state"><div class="spinner"></div><p>Checking availability...</p></div></div>`
    }
    const r = this.checkResult!
    return `
      <div class="cc-right-content">
        <h4 class="section-title" style="font-size:0.95rem">Domain Preview</h4>
        <div class="preview-info">
          <div class="info-row"><span>Domain</span><span class="status-value">${this.escapeHtml(r.name)}.${r.tld}</span></div>
          <div class="info-row"><span>Status</span><span class="status-value" style="color:${r.available ? '#6bff9e' : '#ff6b6b'}">${r.available ? '✓ Available' : '✗ Taken'}</span></div>
          <div class="info-row"><span>Period</span><span class="status-value">${r.years} year${r.years > 1 ? 's' : ''}</span></div>
          ${r.available ? `<div class="info-row"><span>Cost (USD)</span><span class="status-value">$${r.priceUsd}</span></div>
          <div class="info-row"><span>Cost (HBAR)</span><span class="status-value">~${r.priceHbar?.toFixed(4)} ℏ</span></div>
          <div class="info-row"><span>HBAR Rate</span><span class="status-value">$${r.hbarPriceUsd?.toFixed(4)}</span></div>` : ''}
          <div class="info-row"><span>Registry</span><span class="status-value">HCS On-chain</span></div>
          <div class="info-row"><span>Fee Account</span><span class="status-value" style="font-size:0.78rem">${r.feeAccount || '—'}</span></div>
        </div>
        ${r.available ? `<div style="margin-top:0.75rem;padding:0.5rem 0.7rem;background:rgba(107,255,158,0.06);border:1px solid rgba(107,255,158,0.15);border-radius:6px"><p style="font-size:0.75rem;color:var(--terminal-text);opacity:0.6;margin:0">Registration is recorded on-chain via Hedera Consensus Service. After registering, use <strong>${this.escapeHtml(r.name)}.${r.tld}</strong> as your address.</p></div>` : ''}
      </div>`
  }

  // ─── SUCCESS ───────────────────────────────────────────────

  private static renderSuccessPanel(): string {
    const r = this.checkResult
    return `
      <div class="art-gen-section">
        <h3 class="section-title">◆ Domain Registered ✓</h3>
        <div class="back-link" id="domain-back"><span class="back-arrow">←</span><span>Back to Home</span></div>
        <div class="preview-info">
          <div class="info-row"><span>Domain</span><span class="status-value" style="color:#6bff9e">${this.registeredDomain || '—'}</span></div>
          <div class="info-row"><span>Period</span><span class="status-value">${r?.years ?? this.years} year${(r?.years ?? this.years) > 1 ? 's' : ''}</span></div>
          <div class="info-row"><span>Cost</span><span class="status-value">$${r?.priceUsd ?? '—'} (~${r?.priceHbar?.toFixed(4) ?? '—'} ℏ)</span></div>
        </div>
        <button class="terminal-button" id="domain-new" style="margin-top:1rem">REGISTER ANOTHER DOMAIN</button>
      </div>`
  }

  private static renderSuccessDetails(): string {
    return `
      <div class="cc-right-content">
        <h4 class="section-title" style="font-size:0.95rem">◆ Registration Successful!</h4>
        <div class="result-block">
          <label>Domain</label>
          <code class="cid-value" style="font-size:1.1rem;color:#6bff9e">${this.registeredDomain}</code>
        </div>
        ${this.txId ? `
          <div class="result-block" style="margin-top:0.75rem">
            <label>Payment Transaction</label>
            <code class="cid-value" style="font-size:0.78rem">${this.txId}</code>
            <a class="cid-link" href="https://hashscan.io/mainnet/transaction/${this.txId}" target="_blank" rel="noopener" style="font-size:0.78rem">View on HashScan →</a>
          </div>
        ` : ''}
        <div style="margin-top:0.75rem;padding:0.5rem 0.7rem;background:rgba(107,255,158,0.06);border:1px solid rgba(107,255,158,0.15);border-radius:6px">
          <p style="font-size:0.75rem;color:var(--terminal-text);opacity:0.6;margin:0">Your domain is now registered on-chain via HCS. Use <strong>${this.registeredDomain}</strong> anywhere Hedera Creator Kit domains are supported.</p>
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

  static resetForm(): void {
    this.domainInput      = ''
    this.selectedTld      = 'hedera'
    this.years            = 1
    this.checkResult      = null
    this.isChecking       = false
    this.step             = 'form'
    this.loading          = false
    this.error            = null
    this.statusMessage    = ''
    this.txId             = null
    this.registeredDomain = null
    this.showConfirmModal = false
  }


  // ─── INIT ──────────────────────────────────────────────────

  static init(): void {
    document.getElementById('domain-back')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('navigate-to-tool', { detail: { toolId: 'home' } }))
    })

    const nameInput = document.getElementById('domain-name') as HTMLInputElement
    nameInput?.addEventListener('input', () => {
      this.domainInput = nameInput.value
      this.checkResult = null
    })
    nameInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.checkAvailability() })

    const tldSelect = document.getElementById('domain-tld') as HTMLSelectElement
    tldSelect?.addEventListener('change', () => {
      this.selectedTld = tldSelect.value as typeof DOMAIN_SUPPORTED_TLDS[number]
      this.checkResult = null
    })

    const yearsSelect = document.getElementById('domain-years') as HTMLSelectElement
    yearsSelect?.addEventListener('change', () => {
      this.years = parseInt(yearsSelect.value) as 1|3|5|10
      this.checkResult = null
    })

    document.getElementById('domain-check')?.addEventListener('click', () => this.checkAvailability())
    document.getElementById('domain-register')?.addEventListener('click', () => this.startRegistration())
    document.getElementById('domain-admin-register')?.addEventListener('click', () => this.executeAdminRegistration())
    document.getElementById('domain-confirm-cancel')?.addEventListener('click', () => { this.showConfirmModal = false; this.refresh() })
    document.getElementById('domain-confirm-ok')?.addEventListener('click', () => { this.showConfirmModal = false; this.executeRegistration() })
    document.getElementById('domain-dismiss-error')?.addEventListener('click', () => { this.error = null; this.refresh() })
    document.getElementById('domain-new')?.addEventListener('click', () => { this.resetForm(); this.refresh() })
  }

  // ─── AVAILABILITY CHECK ────────────────────────────────────

  private static async checkAvailability(): Promise<void> {
    const name = this.domainInput.toLowerCase().trim()
    if (!name) { this.error = 'Please enter a domain name'; this.refresh(); return }

    this.isChecking  = true
    this.checkResult = null
    this.error       = null
    this.refresh()

    try {
      const url  = `${API_BASE_URL}/api/domains/check?name=${encodeURIComponent(name)}&tld=${this.selectedTld}&years=${this.years}`
      const res  = await fetch(url)
      const data = await res.json() as CheckResult & { success: boolean; error?: string }
      if (!data.success) throw new Error(data.error || 'Availability check failed')
      this.checkResult = data
    } catch (err: any) {
      console.error('[DomainTool] checkAvailability error:', err)
      this.error = err.message || 'Failed to check availability'
    } finally {
      this.isChecking = false
      this.refresh()
    }
  }

  // ─── REGISTRATION ──────────────────────────────────────────

  private static startRegistration(): void {
    const ws = WalletConnectService.getState()
    if (!ws.connected || !ws.accountId) { this.error = 'Please connect your wallet first.'; this.refresh(); return }
    if (!this.checkResult?.available) { this.error = 'Please check domain availability first.'; this.refresh(); return }
    this.showConfirmModal = true
    this.refresh()
  }

  private static async executeRegistration(): Promise<void> {
    const r = this.checkResult
    if (!r?.available || !r.feeAccount) return

    const ws = WalletConnectService.getState()
    if (!ws.connected || !ws.accountId) return

    this.loading = true
    this.error   = null
    this.statusMessage = 'Building payment transaction...'
    this.refresh()

    try {
      const accountId = ws.accountId
      const signer    = WalletConnectService.getSigner(accountId)
      const acctId    = AccountId.fromString(accountId)
      const client    = getHederaClient()
      const tinybars  = Math.ceil(r.priceHbar! * 1e8)

      // Step 1: Send HBAR payment to the registry fee account
      this.statusMessage = 'Sending payment — approve in wallet...'
      this.refresh()

      const payTx = new TransferTransaction()
        .addHbarTransfer(acctId, Hbar.fromTinybars(-tinybars))
        .addHbarTransfer(AccountId.fromString(r.feeAccount), Hbar.fromTinybars(tinybars))
        .setTransactionMemo(`domain:${r.name}.${r.tld}:${r.years}yr`)
        .setTransactionId(TransactionId.generate(acctId))
        .freezeWith(client)

      const payResponse = await payTx.executeWithSigner(signer)
      const paymentTxId = payResponse?.transactionId?.toString() ?? null
      if (!paymentTxId) throw new Error('Wallet did not return a transaction ID')

      this.txId          = paymentTxId
      this.statusMessage = 'Payment sent — verifying and registering on HCS...'
      this.refresh()

      // Step 2: Tell backend to verify payment and register on HCS
      const regRes = await fetch(`${API_BASE_URL}/api/domains/register`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:           r.name,
          tld:            r.tld,
          years:          r.years,
          ownerAccountId: accountId,
          paymentTxId:    paymentTxId,
        }),
      })
      const regData = await regRes.json() as { success: boolean; domain?: string; error?: string }
      if (!regData.success) throw new Error(`${regData.error || 'Registration failed'}${paymentTxId ? ` (payment tx: ${paymentTxId})` : ''}`)

      this.registeredDomain = regData.domain ?? `${r.name}.${r.tld}`
      this.step          = 'success'
      this.loading       = false
      this.statusMessage = `Registered — ${this.registeredDomain}`
      this.refresh()
    } catch (err: any) {
      console.error('[DomainTool] executeRegistration error:', err)
      this.loading       = false
      this.error         = err.message || 'Registration failed'
      this.statusMessage = ''
      this.refresh()
    }
  }

  // ─── ADMIN REGISTRATION (no payment) ───────────────────────

  private static async executeAdminRegistration(): Promise<void> {
    const r = this.checkResult
    if (!r?.available) return
    const ws = WalletConnectService.getState()
    if (!ws.connected || !ws.accountId) return

    this.loading = true
    this.error   = null
    this.statusMessage = 'Registering domain (admin — no payment required)...'
    this.refresh()

    try {
      const res = await fetch(`${API_BASE_URL}/api/domains/register`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:           r.name,
          tld:            r.tld,
          years:          r.years,
          ownerAccountId: ws.accountId,
        }),
      })
      const data = await res.json() as { success: boolean; domain?: string; error?: string }
      if (!data.success) throw new Error(data.error || 'Admin registration failed')

      this.registeredDomain = data.domain ?? `${r.name}.${r.tld}`
      this.txId          = null
      this.step          = 'success'
      this.loading       = false
      this.statusMessage = `Registered — ${this.registeredDomain}`
      this.refresh()
    } catch (err: any) {
      console.error('[DomainTool] executeAdminRegistration error:', err)
      this.loading       = false
      this.error         = err.message || 'Admin registration failed'
      this.statusMessage = ''
      this.refresh()
    }
  }
}
