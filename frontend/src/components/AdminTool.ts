/**
 * Admin Tool — API Key Management
 *
 * Only accessible when the operator wallet (BACKEND_MINTER_ACCOUNT) is connected.
 * Allows generating, viewing, and revoking API keys for third-party projects.
 * API keys are independent of staking programs — you can issue a key before a
 * project has set up any programs.
 */
import WalletConnectService from '../services/WalletConnectService'
import { API_BASE_URL, BACKEND_MINTER_ACCOUNT } from '../config'

interface ApiKey {
  id: string
  account_id: string
  name: string | null
  scopes: string[]
  is_active: boolean
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
}

export class AdminTool {
  private static keys: ApiKey[] = []
  private static loading = false
  private static generating = false
  private static error: string | null = null
  private static projectAccountId = ''
  private static projectName = ''
  private static generatedKey: string | null = null
  private static copied = false

  static render(): string {
    const ws = WalletConnectService.getState()
    if (!ws.connected || ws.accountId !== BACKEND_MINTER_ACCOUNT) {
      return `
        <div class="terminal-window">
          ${this.renderChrome()}
          <div class="terminal-content" style="display:flex;align-items:center;justify-content:center;height:300px">
            <p style="color:var(--terminal-text);opacity:0.5">Admin access only.</p>
          </div>
          ${this.renderStatusBar()}
        </div>`
    }
    return `
      <div class="terminal-window">
        ${this.renderChrome()}
        <div class="terminal-content">
          <div class="art-gen-layout">
            <div class="art-gen-left">${this.renderLeft()}</div>
            <div class="art-gen-right">${this.renderRight()}</div>
          </div>
        </div>
        ${this.renderStatusBar()}
      </div>`
  }

  private static renderChrome(): string {
    return `
      <div class="window-chrome">
        <div class="window-controls">
          <div class="window-dot close"></div>
          <div class="window-dot minimize"></div>
          <div class="window-dot maximize"></div>
        </div>
        <div class="window-title">hedera-creator-kit — api key management</div>
      </div>`
  }

  private static renderStatusBar(): string {
    const ws = WalletConnectService.getState()
    return `
      <div class="status-bar">
        <div class="status-left"><span class="status-item">${ws.accountId || 'Not connected'}</span></div>
        <div class="status-center"><span class="status-item">Admin · SLIME Tools</span></div>
        <div class="status-right"><span class="status-item">MAINNET</span></div>
      </div>`
  }

  private static renderLeft(): string {
    return `
      <div class="art-gen-section">
        <h3 class="section-title">◆ Generate API Key</h3>
        <div class="back-link" id="admin-back"><span class="back-arrow">←</span><span>Back</span></div>

        <div style="margin:0.75rem 0;padding:0.6rem 0.8rem;background:rgba(0,255,64,0.06);border:1px solid rgba(0,255,64,0.2);border-radius:6px">
          <p style="font-size:0.78rem;color:var(--accent-green,#00ff40);margin:0 0 0.25rem">◆ <strong>How it works</strong></p>
          <p style="font-size:0.77rem;color:var(--terminal-text);opacity:0.7;margin:0">
            Enter the project's Hedera wallet address and an optional name. The key is shown once — copy it and send it to them securely.
            The key will automatically scope to all staking programs created by their wallet.
          </p>
        </div>

        <div class="filter-divider"></div>

        <div class="input-group">
          <label for="admin-account">Project Wallet Address *</label>
          <input type="text" id="admin-account" class="token-input" placeholder="0.0.xxxxx" value="${this.escapeHtml(this.projectAccountId)}" />
          <p style="font-size:0.74rem;opacity:0.5;margin:0.25rem 0 0">The project's Hedera account ID — their programs auto-scope to this wallet.</p>
        </div>

        <div class="input-group">
          <label for="admin-name">Project Name</label>
          <input type="text" id="admin-name" class="token-input" placeholder="e.g. SLIME, HMNKY, etc..." value="${this.escapeHtml(this.projectName)}" />
        </div>

        <div class="filter-divider"></div>

        <button class="terminal-button" id="admin-generate" style="width:100%" ${this.generating ? 'disabled' : ''}>
          ${this.generating ? '◆ Generating...' : '◆ GENERATE API KEY'}
        </button>

        ${this.error ? `<div class="error-state" style="margin-top:0.75rem"><p class="error-message">⚠ ${this.escapeHtml(this.error)}</p></div>` : ''}

        ${this.generatedKey ? `
          <div style="margin-top:1rem;padding:0.8rem;background:rgba(0,255,64,0.06);border:1px solid rgba(0,255,64,0.3);border-radius:6px">
            <p style="font-size:0.78rem;color:var(--accent-green,#00ff40);margin:0 0 0.4rem">✓ Key generated — shown once only. Copy and send securely.</p>
            <code id="admin-key-display" style="display:block;font-size:0.72rem;word-break:break-all;background:rgba(0,0,0,0.3);padding:0.5rem;border-radius:4px;color:#e2e8f0;margin-bottom:0.5rem">${this.escapeHtml(this.generatedKey)}</code>
            <button class="terminal-button ${this.copied ? 'secondary' : ''}" id="admin-copy" style="width:100%">
              ${this.copied ? '✓ Copied!' : 'Copy to Clipboard'}
            </button>
          </div>
        ` : ''}
      </div>`
  }

  private static renderRight(): string {
    if (this.loading) {
      return `<div class="cc-right-content"><div class="loading-state"><div class="spinner"></div><p>Loading keys...</p></div></div>`
    }

    const activeKeys = this.keys.filter(k => k.is_active)
    const revokedKeys = this.keys.filter(k => !k.is_active)

    return `
      <div class="cc-right-content">
        <h4 class="section-title" style="font-size:0.95rem">◆ Issued API Keys</h4>
        ${this.keys.length === 0
          ? `<p style="font-size:0.82rem;opacity:0.5">No API keys issued yet.</p>`
          : `
            ${activeKeys.length > 0 ? `
              <p style="font-size:0.75rem;opacity:0.5;margin:0 0 0.5rem;text-transform:uppercase;letter-spacing:0.05em">Active (${activeKeys.length})</p>
              ${activeKeys.map(k => this.renderKeyCard(k)).join('')}
            ` : ''}
            ${revokedKeys.length > 0 ? `
              <p style="font-size:0.75rem;opacity:0.5;margin:0.75rem 0 0.5rem;text-transform:uppercase;letter-spacing:0.05em">Revoked (${revokedKeys.length})</p>
              ${revokedKeys.map(k => this.renderKeyCard(k)).join('')}
            ` : ''}
          `
        }
      </div>`
  }

  private static renderKeyCard(k: ApiKey): string {
    const lastUsed = k.last_used_at ? new Date(k.last_used_at).toLocaleDateString() : 'Never'
    const created = new Date(k.created_at).toLocaleDateString()
    const statusColor = k.is_active ? 'var(--accent-green,#00ff40)' : '#ff6b6b'
    return `
      <div style="margin-bottom:0.75rem;padding:0.7rem;border:1px solid ${k.is_active ? 'rgba(0,255,64,0.15)' : 'rgba(255,107,107,0.15)'};border-radius:6px;background:rgba(255,255,255,0.02)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.3rem">
          <strong style="font-size:0.85rem">${this.escapeHtml(k.name || 'Unnamed')}</strong>
          <span style="font-size:0.72rem;color:${statusColor}">${k.is_active ? 'ACTIVE' : 'REVOKED'}</span>
        </div>
        <p style="font-size:0.75rem;opacity:0.65;margin:0 0 0.15rem;font-family:monospace">${k.account_id}</p>
        <p style="font-size:0.72rem;opacity:0.5;margin:0 0 0.4rem">Created: ${created} · Last used: ${lastUsed}</p>
        ${k.is_active ? `
          <button class="terminal-button secondary" data-action="revoke" data-id="${k.id}"
            style="font-size:0.7rem;padding:0.25rem 0.6rem;color:#ff6b6b;border-color:rgba(255,107,107,0.4)">
            Revoke
          </button>` : ''}
      </div>`
  }

  private static escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  private static refresh(): void {
    const app = document.querySelector<HTMLDivElement>('#app')!
    app.innerHTML = this.render()
    this.init()
  }

  static resetState(): void {
    this.keys = []
    this.loading = false
    this.generating = false
    this.error = null
    this.projectAccountId = ''
    this.projectName = ''
    this.generatedKey = null
    this.copied = false
  }

  static init(): void {
    document.getElementById('admin-back')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('navigate-to-tool', { detail: { toolId: 'home' } }))
    })

    const accountInput = document.getElementById('admin-account') as HTMLInputElement
    accountInput?.addEventListener('input', () => { this.projectAccountId = accountInput.value })

    const nameInput = document.getElementById('admin-name') as HTMLInputElement
    nameInput?.addEventListener('input', () => { this.projectName = nameInput.value })

    document.getElementById('admin-generate')?.addEventListener('click', () => this.handleGenerate())

    document.getElementById('admin-copy')?.addEventListener('click', () => {
      if (!this.generatedKey) return
      navigator.clipboard.writeText(this.generatedKey)
      this.copied = true
      this.refresh()
      setTimeout(() => { this.copied = false; this.refresh() }, 2500)
    })

    document.querySelector('.cc-right-content')?.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-action]') as HTMLElement
      if (!btn) return
      if (btn.dataset.action === 'revoke') this.handleRevoke(btn.dataset.id!)
    })

    this.loadKeys()
  }

  private static async handleGenerate(): Promise<void> {
    const ws = WalletConnectService.getState()
    if (!this.projectAccountId.trim()) { this.error = 'Project wallet address is required'; this.refresh(); return }
    this.generating = true; this.error = null; this.generatedKey = null; this.copied = false; this.refresh()
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/api-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          createdBy: ws.accountId,
          accountId: this.projectAccountId.trim(),
          name: this.projectName.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error || 'Failed')
      this.generatedKey = data.apiKey
      this.projectAccountId = ''
      this.projectName = ''
      await this.loadKeys()
    } catch (err: any) {
      this.error = err.message
    } finally {
      this.generating = false; this.refresh()
    }
  }

  private static async handleRevoke(id: string): Promise<void> {
    const ws = WalletConnectService.getState()
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/api-keys/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ createdBy: ws.accountId }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error)
      await this.loadKeys()
      this.refresh()
    } catch (err: any) {
      this.error = err.message; this.refresh()
    }
  }

  private static async loadKeys(): Promise<void> {
    const ws = WalletConnectService.getState()
    this.loading = true
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/api-keys?createdBy=${ws.accountId}`)
      const data = await res.json()
      if (data.success) this.keys = data.keys
    } catch { /* silent */ }
    finally { this.loading = false }
  }
}
