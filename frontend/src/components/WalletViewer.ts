/**
 * Wallet Viewer Component (Tool #17)
 * Look up any Hedera account: HBAR + token balances, NFT holdings grouped by
 * collection, and recent activity. Read-only via the public mirror node.
 * NFT media goes through the shared mediaSafety plan where it is rendered.
 */
import { MIRROR_NODE_URL } from '../config'

interface AccountInfo {
  accountId: string
  balanceHbar: string
  created: string | null
  keyType: string
  memo: string
  numTokens: number
  numNfts: number
  evmAddress: string
}

interface TokenBalance {
  tokenId: string
  name: string
  symbol: string
  balance: string
  decimals: number
  type: string
}

interface NftGroup {
  tokenId: string
  name: string
  serials: number[]
  thumbnail: string | null   // ipfs/http image url when resolvable cheaply
}

interface ActivityItem {
  consensusTimestamp: string
  type: string
  memo: string
  transactionId: string
}

export class WalletViewer {
  private static accountInput = ''
  private static account: AccountInfo | null = null
  private static tokens: TokenBalance[] = []
  private static nftGroups: NftGroup[] = []
  private static activity: ActivityItem[] = []
  private static loading = false
  private static error: string | null = null
  private static activeTab: 'tokens' | 'nfts' | 'activity' = 'tokens'
  private static expandedNft: string | null = null

  static render(): string {
    return `
      <div class="terminal-window">
        <div class="window-chrome">
          <div class="window-dots"><span class="dot red"></span><span class="dot yellow"></span><span class="dot green"></span></div>
          <div class="window-title">SLIME TOOLS</div>
        </div>
        <div class="terminal-content">
          <div class="art-gen-layout">
            <div class="art-gen-left">
              <div class="art-gen-section">
                <div class="back-link" id="wallet-back"><span class="back-arrow">←</span><span>Back to Home</span></div>
                <h3 class="section-title">◆ Wallet Viewer</h3>
                <p class="cc-hip-badge">⬡ Read-only account explorer</p>
                ${this.renderLookup()}
                ${this.account ? this.renderAccount() : ''}
                ${this.error ? `<div class="cc-error-banner" style="margin-top:1rem">✗ ${this.escapeHtml(this.error)}</div>` : ''}
              </div>
            </div>
            <div class="art-gen-right" style="padding:1.25rem">
              ${this.renderRightPanel()}
            </div>
          </div>
        </div>
        <div class="status-bar">
          <span class="status-left">⬡ Read-only explorer</span>
          <span class="status-right">Mainnet</span>
        </div>
      </div>
    `
  }

  private static renderLookup(): string {
    return `
      <div class="cc-panel" style="margin-top:1rem">
        <div style="display:flex;gap:0.5rem">
          <input type="text" id="wallet-account-input" class="cc-input mono" placeholder="0.0.XXXXXXX"
            value="${this.escapeHtml(this.accountInput)}" style="flex:1" />
          <button id="wallet-load" class="cc-btn" ${this.loading ? 'disabled' : ''}>${this.loading ? 'Loading…' : 'Look Up'}</button>
        </div>
      </div>
    `
  }

  private static renderAccount(): string {
    const a = this.account!
    return `
      <div class="cc-panel" style="margin-top:1rem">
        <div style="display:flex;gap:0.5rem;align-items:baseline;flex-wrap:wrap">
          <h4 style="margin:0;color:var(--terminal-green)">${a.accountId}</h4>
          <span style="font-size:0.9rem;color:var(--terminal-text)">${a.balanceHbar} ℏ</span>
        </div>
        <p class="mono" style="font-size:0.72rem;color:var(--terminal-text);word-break:break-all;margin:0.4rem 0 0">${a.evmAddress}</p>
        <p style="font-size:0.75rem;color:var(--terminal-text);margin:0.4rem 0 0">
          created ${a.created ? new Date(Number(a.created) * 1000).toLocaleDateString() : 'unknown'}
          · key: ${a.keyType} · ${a.numTokens} token association${a.numTokens === 1 ? '' : 's'} · ${a.numNfts} NFT${a.numNfts === 1 ? '' : 's'}
          ${a.memo ? ` · memo: ${this.escapeHtml(a.memo)}` : ''}
        </p>

        <div style="display:flex;gap:0.25rem;margin-top:0.9rem;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:0">
          ${(['tokens', 'nfts', 'activity'] as const).map(t => `
            <button class="wv-tab ${this.activeTab === t ? 'wv-tab-active' : ''}" data-tab="${t}" type="button"
              style="text-transform:capitalize">${t}${t === 'nfts' && a.numNfts ? ` (${a.numNfts})` : ''}</button>
          `).join('')}
        </div>
        <div style="margin-top:0.75rem">
          ${this.activeTab === 'tokens' ? this.renderTokens() : this.activeTab === 'nfts' ? this.renderNfts() : this.renderActivity()}
        </div>
        <style>
          .wv-tab { background:none;border:none;color:var(--terminal-text);padding:0.4rem 0.7rem;cursor:pointer;font-size:0.82rem;border-bottom:2px solid transparent; }
          .wv-tab-active { color:var(--terminal-green);border-bottom-color:var(--terminal-green);font-weight:700; }
        </style>
      </div>
    `
  }

  private static renderTokens(): string {
    if (!this.tokens.length) return `<p style="font-size:0.82rem;color:var(--terminal-text)">No token balances.</p>`
    return this.tokens.map((t) => `
      <div style="display:flex;gap:0.5rem;align-items:center;padding:0.4rem 0;border-bottom:1px solid rgba(255,255,255,0.06)">
        <div style="flex:1;min-width:0">
          <span style="font-size:0.82rem;color:var(--terminal-text)">${this.escapeHtml(t.name || t.tokenId)}</span>
          ${t.symbol ? `<span style="font-size:0.72rem;color:var(--terminal-text)"> $${this.escapeHtml(t.symbol)}</span>` : ''}
          <span class="mono" style="display:block;font-size:0.68rem;color:var(--terminal-text)">${t.tokenId}</span>
        </div>
        <span class="mono" style="font-size:0.8rem;color:var(--terminal-green)">${t.balance}</span>
        <span class="tv-chip tv-chip-${t.type === 'NON_FUNGIBLE_UNIQUE' ? 'hcs6-register' : 'json'}">${t.type === 'NON_FUNGIBLE_UNIQUE' ? 'NFT' : 'FT'}</span>
      </div>
    `).join('')
  }

  private static renderNfts(): string {
    if (!this.nftGroups.length) return `<p style="font-size:0.82rem;color:var(--terminal-text)">No NFT holdings.</p>`
    return this.nftGroups.map((g) => `
      <div style="border-bottom:1px solid rgba(255,255,255,0.06);padding:0.5rem 0">
        <div style="display:flex;gap:0.6rem;align-items:center">
          ${g.thumbnail ? `<img src="${g.thumbnail}" alt="" style="width:34px;height:34px;object-fit:cover;border-radius:4px" />` : ''}
          <div style="flex:1;min-width:0">
            <span style="font-size:0.82rem;color:var(--terminal-text)">${this.escapeHtml(g.name || g.tokenId)}</span>
            <span class="mono" style="display:block;font-size:0.68rem;color:var(--terminal-text)">${g.tokenId}</span>
          </div>
          <button class="cc-btn cc-btn-secondary wv-nft-toggle" data-token="${g.tokenId}" type="button" style="font-size:0.7rem;padding:0.2rem 0.5rem">
            ${this.expandedNft === g.tokenId ? 'Hide' : g.serials.length + ' serials'}
          </button>
        </div>
        ${this.expandedNft === g.tokenId ? `
          <p class="mono" style="font-size:0.75rem;color:var(--terminal-text);margin:0.5rem 0 0;word-break:break-word">
            ${g.serials.join(', ')}
          </p>
        ` : ''}
      </div>
    `).join('')
  }

  private static renderActivity(): string {
    if (!this.activity.length) return `<p style="font-size:0.82rem;color:var(--terminal-text)">No recent transactions.</p>`
    return this.activity.map((tx) => `
      <div style="padding:0.4rem 0;border-bottom:1px solid rgba(255,255,255,0.06)">
        <div style="display:flex;gap:0.5rem;align-items:center">
          <span class="tv-chip tv-chip-json">${tx.type}</span>
          <span style="font-size:0.72rem;color:var(--terminal-text)">${tx.consensusTimestamp}</span>
        </div>
        ${tx.memo ? `<p style="font-size:0.72rem;color:var(--terminal-text);margin:0.2rem 0 0">${this.escapeHtml(tx.memo.slice(0, 80))}</p>` : ''}
      </div>
    `).join('')
  }

  private static renderRightPanel(): string {
    if (this.loading) {
      return `<h4 style="color:var(--terminal-green);margin:0 0 0.75rem">Wallet</h4>
        <p style="font-size:0.82rem;color:var(--terminal-text)">Querying the mirror node…</p>`
    }
    if (this.account) {
      return `
        <h4 style="color:var(--terminal-green);margin:0 0 0.75rem">Snapshot</h4>
        <p style="font-size:1.4rem;color:var(--terminal-green);margin:0;font-weight:700">${this.account.balanceHbar} ℏ</p>
        <p style="font-size:0.8rem;color:var(--terminal-text);margin:0.6rem 0 0">
          ${this.account.numNfts} NFT${this.account.numNfts === 1 ? '' : 's'} across ${this.nftGroups.length} collection${this.nftGroups.length === 1 ? '' : 's'}
          · ${this.tokens.length} token balance${this.tokens.length === 1 ? '' : 's'}
        </p>
      `
    }
    return `
      <h4 style="color:var(--terminal-green);margin:0 0 0.75rem">Wallet Viewer</h4>
      <p style="font-size:0.8rem;color:var(--terminal-text);margin:0">
        Enter any Hedera account ID to see its HBAR balance, token and NFT
        holdings, and recent activity. Nothing here touches the chain — pure
        mirror-node reads.
      </p>
    `
  }

  // ─── INIT ───────────────────────────────────────────────

  static init(): void {
    document.getElementById('wallet-back')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('navigate-to-tool', { detail: { toolId: 'home' } }))
    })
    document.getElementById('wallet-load')?.addEventListener('click', () => this.load())
    document.getElementById('wallet-account-input')?.addEventListener('input', (e) => {
      this.accountInput = (e.target as HTMLInputElement).value.trim()
    })
    document.getElementById('wallet-account-input')?.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') this.load()
    })
    document.querySelectorAll('.wv-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        this.activeTab = (btn as HTMLElement).dataset.tab as 'tokens' | 'nfts' | 'activity'
        this.refresh()
      })
    })
    document.querySelectorAll('.wv-nft-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = (btn as HTMLElement).dataset.token
        this.expandedNft = t && this.expandedNft !== t ? t : null
        this.refresh()
      })
    })
  }

  // ─── ACTIONS ────────────────────────────────────────────

  private static async load(): Promise<void> {
    const id = this.accountInput.trim()
    if (!id) { this.error = 'Enter an account ID'; this.refresh(); return }
    this.loading = true
    this.error = null
    this.refresh()
    try {
      const acctRes = await fetch(`${MIRROR_NODE_URL}/api/v1/accounts/${id}`)
      if (!acctRes.ok) throw new Error(`Account ${id} not found`)
      const a = await acctRes.json()
      this.account = {
        accountId: a.account,
        balanceHbar: (Number(a.balance?.balance || 0) / 1e8).toLocaleString(undefined, { maximumFractionDigits: 2 }),
        created: a.created_timestamp || null,
        keyType: a.key?._type?.replace('Key', '') || 'unknown',
        memo: a.memo || '',
        numTokens: parseInt(a.max_automatic_token_associations || '0') >= 0 ? (a.tokens?.length ?? 0) : (a.tokens?.length ?? 0),
        numNfts: 0,
        evmAddress: a.evm_address || '',
      }

      // Balances + NFTs in parallel
      const [balRes, nftRes] = await Promise.all([
        fetch(`${MIRROR_NODE_URL}/api/v1/accounts/${id}/tokens?limit=100`),
        fetch(`${MIRROR_NODE_URL}/api/v1/accounts/${id}/nfts?limit=100`),
      ])
      const bal = await balRes.json()
      const nfts = await nftRes.json()

      const tokenMeta = new Map<string, any>()
      await Promise.all((bal.tokens || []).slice(0, 100).map(async (t: any) => {
        try {
          const r = await fetch(`${MIRROR_NODE_URL}/api/v1/tokens/${t.token_id}`)
          if (r.ok) tokenMeta.set(t.token_id, await r.json())
        } catch { /* name lookup is best-effort */ }
      }))

      this.tokens = (bal.tokens || []).map((t: any) => {
        const meta = tokenMeta.get(t.token_id) || {}
        const decimals = Number(meta.decimals ?? 0)
        const raw = Number(t.balance ?? 0)
        return {
          tokenId: t.token_id,
          name: meta.name || '',
          symbol: meta.symbol || '',
          balance: meta.type === 'NON_FUNGIBLE_UNIQUE' ? String(raw) : this.fmtTokenAmount(raw, decimals),
          decimals,
          type: meta.type || 'FUNGIBLE_COMMON',
        }
      })

      const groups = new Map<string, number[]>()
      for (const n of nfts.nfts || []) {
        if (!groups.has(n.token_id)) groups.set(n.token_id, [])
        groups.get(n.token_id)!.push(n.serial_number)
      }
      this.nftGroups = await Promise.all([...groups.entries()].map(async ([tokenId, serials]) => {
        let name = tokenId
        let thumbnail: string | null = null
        try {
          const meta = tokenMeta.get(tokenId) || await (await fetch(`${MIRROR_NODE_URL}/api/v1/tokens/${tokenId}`)).json()
          name = meta.name || tokenId
        } catch { /* ok */ }
        return { tokenId, name, serials: serials.sort((x, y) => x - y), thumbnail }
      }))
      if (this.account) this.account.numNfts = (nfts.nfts || []).length

      const txRes = await fetch(`${MIRROR_NODE_URL}/api/v1/transactions?account.id=${id}&limit=25&order=desc`)
      const txs = await txRes.json()
      this.activity = (txs.transactions || []).map((t: any) => ({
        consensusTimestamp: t.consensus_timestamp?.replace('T', ' ').slice(0, 19) || '',
        type: (t.transaction_type || '').replace(/^CONSENSUS/, 'HCS-').replace(/^TOKEN/, 'TOKEN-').replace(/^CRYPTO/, ''),
        memo: t.memo_base64 ? atob(t.memo_base64) : '',
        transactionId: t.transaction_id,
      }))
    } catch (err: any) {
      this.error = err.message || 'Failed to load account'
      this.account = null
    }
    this.loading = false
    this.refresh()
  }

  private static fmtTokenAmount(raw: number, decimals: number): string {
    if (!decimals) return raw.toLocaleString()
    return (raw / Math.pow(10, decimals)).toLocaleString(undefined, { maximumFractionDigits: Math.min(decimals, 4) })
  }

  static resetForm(): void {
    this.accountInput = ''
    this.account = null
    this.tokens = []
    this.nftGroups = []
    this.activity = []
    this.loading = false
    this.error = null
    this.activeTab = 'tokens'
    this.expandedNft = null
  }

  private static refresh(): void {
    const scrollContainer = document.querySelector('.art-gen-left')
    const scrollTop = scrollContainer?.scrollTop ?? 0
    const app = document.querySelector<HTMLDivElement>('#app')!
    app.innerHTML = this.render()
    this.init()
    const newContainer = document.querySelector('.art-gen-left')
    if (newContainer) newContainer.scrollTop = scrollTop
  }

  private static escapeHtml(str: string): string {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }
}
