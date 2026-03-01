/**
 * Swap Tool — Admin Configuration
 *
 * Creators configure NFT or fungible token swap programs here.
 * Community members execute swaps via the public API on the SLIME dApp.
 *
 * Flow:
 *  1. Creator fills in swap details (from/to token, treasury, type, rate).
 *  2. Creator approves an allowance on their treasury wallet so our backend
 *     operator can distribute "to" tokens on their behalf.
 *  3. Program is saved to the database and becomes available via
 *     GET /api/swap-programs/public for community-facing dApps.
 */
import WalletConnectService from '../services/WalletConnectService'
import { API_BASE_URL, BACKEND_MINTER_ACCOUNT, getHederaClient } from '../config'
import {
  AccountAllowanceApproveTransaction,
  AccountId,
  TokenId,
  NftId,
  TransactionId,
} from '@hashgraph/sdk'

type SwapStep = 'form' | 'allowance' | 'success'
type SwapType = 'nft' | 'fungible'

interface SwapProgram {
  id: string
  name: string
  description: string | null
  swap_type: SwapType
  from_token_id: string
  to_token_id: string
  treasury_account_id: string
  rate_from: number
  rate_to: number
  total_supply: number | null
  status: 'active' | 'paused' | 'completed'
  created_by: string
  created_at: string
}

export class SwapTool {
  // ─── Form state ────────────────────────────────────────────
  private static step: SwapStep = 'form'
  private static swapType: SwapType = 'nft'
  private static programName = ''
  private static description = ''
  private static fromTokenId = ''
  private static toTokenId = ''
  private static treasuryAccountId = ''
  private static rateFrom = '1'
  private static rateTo = '1'
  private static totalSupply = ''

  // ─── Program list state ────────────────────────────────────
  private static programs: SwapProgram[] = []
  private static loadingPrograms = false

  // ─── Flow state ────────────────────────────────────────────
  private static loading = false
  private static error: string | null = null
  private static statusMessage = ''
  private static createdProgramId: string | null = null
  private static showConfirmModal = false

  // ─── RENDER ────────────────────────────────────────────────

  static render(): string {
    return `
      <div class="terminal-window">
        ${this.renderChrome()}
        ${this.renderContent()}
        ${this.renderStatusBar()}
      </div>
      ${this.showConfirmModal ? this.renderConfirmModal() : ''}
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
        <div class="window-title">hedera-creator-kit — swap tool</div>
      </div>`
  }

  private static renderStatusBar(): string {
    const ws = WalletConnectService.getState()
    const walletInfo = ws.connected ? `${ws.accountId} | ${ws.hbarBalance || '0'} ℏ` : 'Not Connected'
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
    return `
      <div class="terminal-content">
        <div class="art-gen-layout">
          <div class="art-gen-left">${this.renderLeft()}</div>
          <div class="art-gen-right">${this.renderRight()}</div>
        </div>
      </div>`
  }

  private static renderLeft(): string {
    if (this.loading) {
      return `
        <div class="art-gen-section">
          <h3 class="section-title">◆ Processing...</h3>
          <div class="loading-state">
            <div class="spinner"></div>
            <p>${this.statusMessage || 'Please wait...'}</p>
          </div>
        </div>`
    }
    if (this.step === 'success') return this.renderSuccess()
    if (this.step === 'allowance') return this.renderAllowanceStep()
    return this.renderForm()
  }

  private static renderRight(): string {
    if (this.error) {
      return `
        <div class="cc-right-content">
          <div class="error-state">
            <p class="error-message">⚠ ${this.error}</p>
            <button class="terminal-button" id="swap-dismiss-error" style="margin-top:1rem">DISMISS</button>
          </div>
        </div>`
    }
    return this.renderProgramList()
  }

  // ─── FORM ──────────────────────────────────────────────────

  private static renderForm(): string {
    const ws = WalletConnectService.getState()
    const isFungible = this.swapType === 'fungible'

    return `
      <div class="art-gen-section">
        <h3 class="section-title">◆ Configure Swap Program</h3>
        <div class="back-link" id="swap-back"><span class="back-arrow">←</span><span>Back</span></div>

        <div style="margin:0.75rem 0;padding:0.6rem 0.8rem;background:rgba(0,255,64,0.06);border:1px solid rgba(0,255,64,0.2);border-radius:6px">
          <p style="font-size:0.78rem;color:var(--accent-green,#00ff40);margin:0 0 0.3rem">◆ <strong>How it works</strong></p>
          <p style="font-size:0.77rem;color:var(--terminal-text);opacity:0.7;margin:0">Configure a swap program here, then grant our backend an allowance on your treasury wallet. Community members swap on your dApp — no private keys, no custody transfers.</p>
        </div>

        <div class="filter-divider"></div>

        <div class="input-group">
          <label>Swap Type *</label>
          <div style="display:flex;gap:0.5rem">
            <button class="terminal-button ${this.swapType === 'nft' ? '' : 'secondary'}" id="swap-type-nft" style="flex:1">NFT</button>
            <button class="terminal-button ${this.swapType === 'fungible' ? '' : 'secondary'}" id="swap-type-fungible" style="flex:1">Fungible Token</button>
          </div>
          <p style="font-size:0.75rem;color:var(--terminal-text);opacity:0.5;margin:0.3rem 0 0">
            ${isFungible ? 'Exchange one fungible token for another at a configured rate.' : 'Swap old NFT serials for new collection NFTs (1:1 by serial).'}
          </p>
        </div>

        <div class="input-group">
          <label for="swap-name">Program Name *</label>
          <input type="text" id="swap-name" class="token-input" placeholder="e.g. SLIME V1 → V2 Upgrade" value="${this.escapeHtml(this.programName)}" />
        </div>

        <div class="input-group">
          <label for="swap-description">Description</label>
          <input type="text" id="swap-description" class="token-input" placeholder="Optional description for community members" value="${this.escapeHtml(this.description)}" />
        </div>

        <div class="filter-divider"></div>

        <div class="input-group">
          <label for="swap-from-token">From Token ID * <span style="opacity:0.5;font-size:0.75rem">(token holders currently own)</span></label>
          <input type="text" id="swap-from-token" class="token-input" placeholder="0.0.xxxxxxx" value="${this.escapeHtml(this.fromTokenId)}" />
        </div>

        <div class="input-group">
          <label for="swap-to-token">To Token ID * <span style="opacity:0.5;font-size:0.75rem">(token holders will receive)</span></label>
          <input type="text" id="swap-to-token" class="token-input" placeholder="0.0.xxxxxxx" value="${this.escapeHtml(this.toTokenId)}" />
        </div>

        <div class="input-group">
          <label for="swap-treasury">Treasury Account ID * <span style="opacity:0.5;font-size:0.75rem">(wallet holding the "to" tokens)</span></label>
          <input type="text" id="swap-treasury" class="token-input" placeholder="0.0.xxxxxxx" value="${this.escapeHtml(this.treasuryAccountId)}" />
        </div>

        ${isFungible ? `
        <div class="filter-divider"></div>
        <div class="input-group">
          <label>Exchange Rate *</label>
          <div class="input-row" style="gap:0.5rem;align-items:center">
            <input type="number" id="swap-rate-from" class="token-input" placeholder="1" value="${this.escapeHtml(this.rateFrom)}" min="1" style="flex:1" />
            <span style="color:var(--terminal-text);opacity:0.6">from =</span>
            <input type="number" id="swap-rate-to" class="token-input" placeholder="1" value="${this.escapeHtml(this.rateTo)}" min="1" style="flex:1" />
            <span style="color:var(--terminal-text);opacity:0.6">to</span>
          </div>
          <p style="font-size:0.75rem;color:var(--terminal-text);opacity:0.5;margin:0.3rem 0 0">e.g. 1 from = 1 to means 1:1. 1 from = 2 to means users receive double.</p>
        </div>` : ''}

        <div class="input-group">
          <label for="swap-total-supply">Total Supply Available <span style="opacity:0.5;font-size:0.75rem">(optional — for display purposes)</span></label>
          <input type="number" id="swap-total-supply" class="token-input" placeholder="Leave blank if unlimited" value="${this.escapeHtml(this.totalSupply)}" min="1" />
        </div>

        <div class="filter-divider"></div>

        ${!ws.connected ? `
          <div style="padding:0.6rem 0.8rem;background:rgba(255,107,107,0.08);border:1px solid rgba(255,107,107,0.25);border-radius:6px;margin-bottom:0.75rem">
            <p style="font-size:0.8rem;color:#ff6b6b;margin:0">⚠ Connect your wallet before configuring a swap.</p>
          </div>` : ''}

        <button class="terminal-button" id="swap-submit" ${!ws.connected ? 'disabled' : ''}>
          ◆ NEXT: APPROVE ALLOWANCE
        </button>
      </div>`
  }

  // ─── ALLOWANCE STEP ────────────────────────────────────────

  private static renderAllowanceStep(): string {
    const isFungible = this.swapType === 'fungible'
    return `
      <div class="art-gen-section">
        <h3 class="section-title">◆ Grant Operator Allowance</h3>
        <div class="back-link" id="swap-back-to-form"><span class="back-arrow">←</span><span>Back to Form</span></div>

        <div style="margin:0.75rem 0;padding:0.6rem 0.8rem;background:rgba(0,255,64,0.06);border:1px solid rgba(0,255,64,0.2);border-radius:6px">
          <p style="font-size:0.78rem;color:var(--accent-green,#00ff40);margin:0 0 0.3rem">◆ <strong>One-time wallet approval required</strong></p>
          <p style="font-size:0.77rem;color:var(--terminal-text);opacity:0.7;margin:0">
            You need to grant our backend operator allowance to distribute your
            <strong>${this.escapeHtml(this.toTokenId)}</strong> tokens from your treasury.
            This does <strong>not</strong> transfer ownership — you remain in full control and can revoke any time.
          </p>
        </div>

        <div class="preview-info" style="margin:0.75rem 0">
          <div class="info-row"><span>Program</span><span class="status-value">${this.escapeHtml(this.programName)}</span></div>
          <div class="info-row"><span>Type</span><span class="status-value">${this.swapType === 'nft' ? 'NFT Swap' : 'Fungible Token Swap'}</span></div>
          <div class="info-row"><span>From Token</span><span class="status-value">${this.escapeHtml(this.fromTokenId)}</span></div>
          <div class="info-row"><span>To Token</span><span class="status-value">${this.escapeHtml(this.toTokenId)}</span></div>
          <div class="info-row"><span>Treasury</span><span class="status-value">${this.escapeHtml(this.treasuryAccountId)}</span></div>
          ${!isFungible ? '' : `<div class="info-row"><span>Rate</span><span class="status-value">${this.rateFrom} → ${this.rateTo}</span></div>`}
          <div class="info-row"><span>Operator</span><span class="status-value">${BACKEND_MINTER_ACCOUNT}</span></div>
        </div>

        ${isFungible ? `
        <div class="input-group">
          <label for="swap-allowance-amount">Allowance Amount * <span style="opacity:0.5;font-size:0.75rem">(total "to" tokens operator may distribute)</span></label>
          <input type="number" id="swap-allowance-amount" class="token-input" placeholder="e.g. 1000000" min="1" />
          <p style="font-size:0.75rem;color:var(--terminal-text);opacity:0.5;margin:0.3rem 0 0">In base token units (smallest denomination). You can always increase later.</p>
        </div>` : `
        <div class="input-group">
          <label for="swap-allowance-serials">Serial Numbers to Allow * <span style="opacity:0.5;font-size:0.75rem">(comma-separated or range e.g. 1-500)</span></label>
          <input type="text" id="swap-allowance-serials" class="token-input" placeholder="e.g. 1-500 or 1,2,3,4,5" />
          <p style="font-size:0.75rem;color:var(--terminal-text);opacity:0.5;margin:0.3rem 0 0">Serials of the "to" NFT collection that the operator can send to swappers.</p>
        </div>`}

        <div class="filter-divider"></div>
        <button class="terminal-button" id="swap-grant-allowance">◆ SIGN & GRANT ALLOWANCE</button>
        <p style="font-size:0.75rem;color:var(--terminal-text);opacity:0.5;margin:0.5rem 0 0">Your wallet will prompt you to sign the allowance transaction.</p>
      </div>`
  }

  // ─── SUCCESS ───────────────────────────────────────────────

  private static renderSuccess(): string {
    return `
      <div class="art-gen-section">
        <h3 class="section-title">◆ Swap Program Active</h3>
        <div class="back-link" id="swap-back"><span class="back-arrow">←</span><span>Back to Home</span></div>
        <div style="margin:0.75rem 0;padding:0.6rem 0.8rem;background:rgba(0,255,64,0.08);border:1px solid rgba(0,255,64,0.3);border-radius:6px">
          <p style="font-size:0.82rem;color:var(--accent-green,#00ff40);margin:0">✓ <strong>${this.escapeHtml(this.programName)}</strong> is live and ready for community swaps.</p>
        </div>
        <div class="preview-info">
          <div class="info-row"><span>Program ID</span><span class="status-value" style="font-size:0.75rem">${this.createdProgramId || '—'}</span></div>
          <div class="info-row"><span>Type</span><span class="status-value">${this.swapType === 'nft' ? 'NFT Swap' : 'Fungible Token Swap'}</span></div>
          <div class="info-row"><span>From</span><span class="status-value">${this.escapeHtml(this.fromTokenId)}</span></div>
          <div class="info-row"><span>To</span><span class="status-value">${this.escapeHtml(this.toTokenId)}</span></div>
          <div class="info-row"><span>Status</span><span class="status-value" style="color:var(--accent-green,#00ff40)">Active</span></div>
        </div>
        <div class="filter-divider"></div>
        <div style="padding:0.6rem 0.8rem;background:rgba(0,255,64,0.06);border:1px solid rgba(0,255,64,0.15);border-radius:6px;margin-bottom:0.75rem">
          <p style="font-size:0.78rem;color:var(--terminal-text);opacity:0.8;margin:0 0 0.25rem"><strong>SLIME dApp Endpoint:</strong></p>
          <code style="font-size:0.72rem;color:var(--accent-green,#00ff40);word-break:break-all">GET ${API_BASE_URL}/api/swap-programs/public</code>
          <br/>
          <code style="font-size:0.72rem;color:var(--accent-green,#00ff40);word-break:break-all">POST ${API_BASE_URL}/api/swap-programs/${this.createdProgramId}/execute</code>
        </div>
        <button class="terminal-button" id="swap-new">◆ CREATE ANOTHER PROGRAM</button>
      </div>`
  }

  // ─── PROGRAM LIST (right panel) ────────────────────────────

  private static renderProgramList(): string {
    const ws = WalletConnectService.getState()
    if (!ws.connected) {
      return `
        <div class="cc-right-content">
          <h4 class="section-title" style="font-size:0.95rem">◆ Your Swap Programs</h4>
          <p style="font-size:0.82rem;color:var(--terminal-text);opacity:0.5">Connect your wallet to view and manage your swap programs.</p>
        </div>`
    }

    if (this.loadingPrograms) {
      return `
        <div class="cc-right-content">
          <div class="loading-state"><div class="spinner"></div><p>Loading programs...</p></div>
        </div>`
    }

    const myPrograms = this.programs.filter(p => p.created_by === ws.accountId)

    return `
      <div class="cc-right-content">
        <h4 class="section-title" style="font-size:0.95rem">◆ Your Swap Programs</h4>
        ${myPrograms.length === 0
          ? `<p style="font-size:0.82rem;color:var(--terminal-text);opacity:0.5">No swap programs yet. Create one using the form.</p>`
          : myPrograms.map(p => this.renderProgramCard(p)).join('')
        }
      </div>`
  }

  private static renderProgramCard(p: SwapProgram): string {
    const statusColor = p.status === 'active' ? '#00ff40' : p.status === 'paused' ? '#ffaa00' : '#ff6b6b'
    const isActive = p.status === 'active'
    return `
      <div style="margin-bottom:1rem;padding:0.75rem;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:6px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:0.5rem">
          <strong style="font-size:0.88rem">${this.escapeHtml(p.name)}</strong>
          <span style="font-size:0.72rem;color:${statusColor};text-transform:uppercase">${p.status}</span>
        </div>
        <div style="font-size:0.75rem;color:var(--terminal-text);opacity:0.6;margin-bottom:0.5rem">
          ${p.swap_type === 'nft' ? 'NFT Swap' : 'Fungible'} · ${this.escapeHtml(p.from_token_id)} → ${this.escapeHtml(p.to_token_id)}
        </div>
        <div style="display:flex;gap:0.4rem;flex-wrap:wrap">
          <button class="terminal-button secondary" data-action="toggle-status" data-id="${p.id}" data-status="${isActive ? 'paused' : 'active'}" style="font-size:0.72rem;padding:0.25rem 0.6rem">
            ${isActive ? 'PAUSE' : 'ACTIVATE'}
          </button>
          <button class="terminal-button secondary" data-action="delete-program" data-id="${p.id}" style="font-size:0.72rem;padding:0.25rem 0.6rem;border-color:rgba(255,107,107,0.4);color:#ff6b6b">
            DELETE
          </button>
        </div>
      </div>`
  }

  // ─── CONFIRM MODAL ─────────────────────────────────────────

  private static renderConfirmModal(): string {
    return `
      <div class="burn-confirm-overlay" id="swap-confirm-overlay">
        <div class="burn-confirm-card">
          <div class="burn-confirm-icon">◆</div>
          <div class="burn-confirm-title">Delete Swap Program?</div>
          <div class="burn-confirm-warning">⚠ This cannot be undone. Active community swaps will stop.</div>
          <hr class="burn-confirm-divider" />
          <div class="burn-confirm-buttons">
            <button class="terminal-button secondary" id="swap-confirm-cancel">Cancel</button>
            <button class="terminal-button" id="swap-confirm-delete" style="border-color:rgba(255,107,107,0.5);color:#ff6b6b">DELETE</button>
          </div>
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

  static resetState(): void {
    this.step = 'form'
    this.swapType = 'nft'
    this.programName = ''
    this.description = ''
    this.fromTokenId = ''
    this.toTokenId = ''
    this.treasuryAccountId = ''
    this.rateFrom = '1'
    this.rateTo = '1'
    this.totalSupply = ''
    this.programs = []
    this.loading = false
    this.error = null
    this.statusMessage = ''
    this.createdProgramId = null
    this.showConfirmModal = false
    this.loadingPrograms = false
  }

  // ─── INIT ──────────────────────────────────────────────────

  static init(): void {
    const ws = WalletConnectService.getState()

    // Navigation
    document.getElementById('swap-back')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('navigate-to-tool', { detail: { toolId: 'home' } }))
    })
    document.getElementById('swap-back-to-form')?.addEventListener('click', () => {
      this.step = 'form'
      this.refresh()
    })

    // Swap type toggle
    document.getElementById('swap-type-nft')?.addEventListener('click', () => {
      this.swapType = 'nft'
      this.refresh()
    })
    document.getElementById('swap-type-fungible')?.addEventListener('click', () => {
      this.swapType = 'fungible'
      this.refresh()
    })

    // Form inputs
    const bind = (id: string, key: string) => {
      const el = document.getElementById(id) as HTMLInputElement
      el?.addEventListener('input', () => { (SwapTool as any)[key] = el.value })
    }
    bind('swap-name', 'programName')
    bind('swap-description', 'description')
    bind('swap-from-token', 'fromTokenId')
    bind('swap-to-token', 'toTokenId')
    bind('swap-treasury', 'treasuryAccountId')
    bind('swap-rate-from', 'rateFrom')
    bind('swap-rate-to', 'rateTo')
    bind('swap-total-supply', 'totalSupply')

    // Submit form → move to allowance step
    document.getElementById('swap-submit')?.addEventListener('click', () => this.handleSubmitForm())

    // Grant allowance
    document.getElementById('swap-grant-allowance')?.addEventListener('click', () => this.handleGrantAllowance())

    // New program
    document.getElementById('swap-new')?.addEventListener('click', () => { this.resetState(); this.refresh() })

    // Dismiss error
    document.getElementById('swap-dismiss-error')?.addEventListener('click', () => { this.error = null; this.refresh() })

    // Confirm modal
    document.getElementById('swap-confirm-cancel')?.addEventListener('click', () => {
      this.showConfirmModal = false
      this.refresh()
    })
    document.getElementById('swap-confirm-delete')?.addEventListener('click', () => this.executeDelete())

    // Program card action buttons (delegated)
    document.querySelector('.cc-right-content')?.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-action]') as HTMLElement
      if (!btn) return
      const action = btn.dataset.action
      const id = btn.dataset.id!
      if (action === 'toggle-status') {
        const newStatus = btn.dataset.status as 'active' | 'paused'
        this.handleToggleStatus(id, newStatus)
      } else if (action === 'delete-program') {
        this._pendingDeleteId = id
        this.showConfirmModal = true
        this.refresh()
      }
    })

    // Load programs list
    if (ws.connected) this.loadPrograms()
  }

  // ─── BUSINESS LOGIC ────────────────────────────────────────

  private static _pendingDeleteId: string | null = null

  private static handleSubmitForm(): void {
    const ws = WalletConnectService.getState()
    if (!ws.connected || !ws.accountId) {
      this.error = 'Connect your wallet first.'
      this.refresh()
      return
    }
    if (!this.programName.trim()) { this.error = 'Program name is required.'; this.refresh(); return }
    if (!this.fromTokenId.trim()) { this.error = 'From Token ID is required.'; this.refresh(); return }
    if (!this.toTokenId.trim()) { this.error = 'To Token ID is required.'; this.refresh(); return }
    if (!this.treasuryAccountId.trim()) { this.error = 'Treasury Account ID is required.'; this.refresh(); return }

    this.step = 'allowance'
    this.refresh()
  }

  private static async handleGrantAllowance(): Promise<void> {
    const ws = WalletConnectService.getState()
    if (!ws.connected || !ws.accountId) return

    const allowanceAmountEl = document.getElementById('swap-allowance-amount') as HTMLInputElement
    const allowanceSerialsEl = document.getElementById('swap-allowance-serials') as HTMLInputElement

    this.loading = true
    this.error = null

    try {
      const accountId = ws.accountId
      const signer = WalletConnectService.getSigner(accountId)
      const acctId = AccountId.fromString(accountId)
      const client = getHederaClient()
      const operatorId = AccountId.fromString(BACKEND_MINTER_ACCOUNT)

      if (this.swapType === 'nft') {
        // Parse serial numbers from input
        const serialInput = allowanceSerialsEl?.value?.trim() || ''
        if (!serialInput) throw new Error('Please enter serial numbers to allow.')
        const serials = this.parseSerials(serialInput)
        if (serials.length === 0) throw new Error('No valid serial numbers found.')

        this.statusMessage = `Approving ${serials.length} NFT serial(s) — approve in wallet...`
        this.refresh()

        const approveTx = new AccountAllowanceApproveTransaction()
        for (const serial of serials) {
          approveTx.approveTokenNftAllowance(
            new NftId(TokenId.fromString(this.toTokenId), serial),
            acctId,
            operatorId
          )
        }
        approveTx.setTransactionId(TransactionId.generate(acctId))
        await approveTx.freezeWith(client)
        await approveTx.executeWithSigner(signer)

      } else {
        // Fungible allowance
        const amount = parseInt(allowanceAmountEl?.value || '0')
        if (!amount || amount <= 0) throw new Error('Please enter a valid allowance amount.')

        this.statusMessage = `Approving ${amount} token allowance — approve in wallet...`
        this.refresh()

        const approveTx = new AccountAllowanceApproveTransaction()
          .approveTokenAllowance(TokenId.fromString(this.toTokenId), acctId, operatorId, amount)
        approveTx.setTransactionId(TransactionId.generate(acctId))
        approveTx.freezeWith(client)
        console.log('[SwapTool] fungible allowance tx before wallet:', {
          toTokenId: this.toTokenId,
          owner: acctId.toString(),
          spender: operatorId.toString(),
          amount,
          txId: approveTx.transactionId?.toString(),
          nodeIds: approveTx.nodeAccountIds?.map((n: any) => n.toString()),
        })
        await approveTx.executeWithSigner(signer)
      }

      // Wait for allowance to propagate before saving program
      this.statusMessage = 'Allowance confirmed — saving swap program...'
      await new Promise(r => setTimeout(r, 3000))

      // Save program to DB
      const res = await fetch(`${API_BASE_URL}/api/swap-programs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          createdBy: ws.accountId,
          name: this.programName.trim(),
          description: this.description.trim() || null,
          swapType: this.swapType,
          fromTokenId: this.fromTokenId.trim(),
          toTokenId: this.toTokenId.trim(),
          treasuryAccountId: this.treasuryAccountId.trim(),
          rateFrom: parseFloat(this.rateFrom) || 1,
          rateTo: parseFloat(this.rateTo) || 1,
          totalSupply: this.totalSupply ? parseInt(this.totalSupply) : null,
        }),
      })

      const data = await res.json()
      if (!data.success) throw new Error(data.error || 'Failed to save swap program')

      this.createdProgramId = data.program.id
      this.loading = false
      this.statusMessage = ''
      this.step = 'success'
      this.refresh()

    } catch (err: any) {
      console.error('handleGrantAllowance error:', err)
      this.loading = false
      this.statusMessage = ''
      this.error = err.message || 'Failed to set up swap program'
      this.refresh()
    }
  }

  private static async loadPrograms(): Promise<void> {
    const ws = WalletConnectService.getState()
    if (!ws.connected) return

    this.loadingPrograms = true
    try {
      const res = await fetch(`${API_BASE_URL}/api/swap-programs?createdBy=${ws.accountId}`)
      const data = await res.json()
      if (data.success) this.programs = data.programs
    } catch (err) {
      console.error('loadPrograms error:', err)
    } finally {
      this.loadingPrograms = false
      // Re-render just the right panel
      const right = document.querySelector('.art-gen-right')
      if (right) {
        right.innerHTML = this.renderRight()
        // Re-attach delegation listener
        document.querySelector('.cc-right-content')?.addEventListener('click', (e) => {
          const btn = (e.target as HTMLElement).closest('[data-action]') as HTMLElement
          if (!btn) return
          const action = btn.dataset.action
          const id = btn.dataset.id!
          if (action === 'toggle-status') {
            this.handleToggleStatus(id, btn.dataset.status as 'active' | 'paused')
          } else if (action === 'delete-program') {
            this._pendingDeleteId = id
            this.showConfirmModal = true
            this.refresh()
          }
        })
      }
    }
  }

  private static async handleToggleStatus(id: string, newStatus: 'active' | 'paused'): Promise<void> {
    const ws = WalletConnectService.getState()
    try {
      const res = await fetch(`${API_BASE_URL}/api/swap-programs/${id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, createdBy: ws.accountId }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error)
      // Update local state
      const prog = this.programs.find(p => p.id === id)
      if (prog) prog.status = newStatus
      this.refresh()
    } catch (err: any) {
      this.error = err.message || 'Failed to update status'
      this.refresh()
    }
  }

  private static async executeDelete(): Promise<void> {
    const ws = WalletConnectService.getState()
    const id = this._pendingDeleteId
    this.showConfirmModal = false
    if (!id) return

    try {
      const res = await fetch(`${API_BASE_URL}/api/swap-programs/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ createdBy: ws.accountId }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error)
      this.programs = this.programs.filter(p => p.id !== id)
      this._pendingDeleteId = null
      this.refresh()
    } catch (err: any) {
      this.error = err.message || 'Failed to delete program'
      this.refresh()
    }
  }

  /** Parse serial input: supports ranges (1-500) and comma-separated values (1,2,3) */
  private static parseSerials(input: string): number[] {
    const serials: number[] = []
    const parts = input.split(',').map(s => s.trim())
    for (const part of parts) {
      if (part.includes('-')) {
        const [start, end] = part.split('-').map(Number)
        if (!isNaN(start) && !isNaN(end) && end >= start) {
          for (let i = start; i <= end; i++) serials.push(i)
        }
      } else {
        const n = parseInt(part)
        if (!isNaN(n)) serials.push(n)
      }
    }
    return [...new Set(serials)].sort((a, b) => a - b)
  }
}
