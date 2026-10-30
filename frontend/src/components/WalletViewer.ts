/**
 * Wallet Viewer Component (Tool #17)
 * Look up any Hedera account: HBAR + token balances (with icons), NFT holdings
 * grouped by collection (icons, supply share, royalty, last moved, serials),
 * and recent activity. Read-only via the public mirror node.
 * Icon resolution mirrors the proven lookup chain: DaVinciPics registry ->
 * ETA Finance token list -> HIP-405/766 token metadata -> first-NFT image ->
 * deterministic letter badge.
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
  staked: string
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
  symbol: string
  serials: number[]
  supply: number
  royalty: number
  last: number
  unlisted: boolean
}

interface TxTokenMove {
  id: string
  amount: number
  sym: string
  amt: number
}

interface TxNftMove {
  token: string
  serial: number
  dir: 1 | -1
  sym: string
}

interface WalletTxRow {
  ts: string
  id: string
  name: string
  result: string
  hbar: number
  fee: number
  tokens: TxTokenMove[]
  nfts: TxNftMove[]
  others: string[]
}

/* ─── icon engine constants ─── */
const DAVINCI_PICS = ['https://s1.pics.davincigraph.io/api/v2', 'https://s2.pics.davincigraph.io/api/v2']
const ICON_LIST_URL = 'https://api.etaswap.com/v1/tokens'
const ICON_LIST_BASE = 'https://eta.finance'
const ICON_IPFS_GATEWAYS = [
  'https://ipfs.filebase.io/ipfs/',
  'https://ipfs.aleph.cloud/ipfs/',
  'https://ipfs.orbitor.dev/ipfs/',
]
const HASHSCAN = 'https://hashscan.io/mainnet'
const HBAR_ICON = '<img src="/hedera-hbar-logo.svg" alt="">'

export class WalletViewer {
  private static accountInput = ''
  private static account: AccountInfo | null = null
  private static tokens: TokenBalance[] = []
  private static nftGroups: NftGroup[] = []
  private static activity: WalletTxRow[] = []
  private static activityNext: string | null = null
  private static activityLoading = false
  private static activityDone = false
  private static tokenDecimals = new Map<string, number>()
  private static tokenSymbols = new Map<string, string>()
  private static loading = false
  private static error: string | null = null
  private static activeTab: 'tokens' | 'nfts' | 'activity' = 'tokens'
  private static expandedCollections = new Set<string>()
  private static tokenListTruncated = false
  private static nftListTruncated = false

  // icon caches (session-only; badges render instantly, images swap in when found)
  private static icons = new Map<string, string[]>() // tokenId -> candidate urls
  private static iconPending = new Set<string>()
  private static iconListPromise: Promise<Record<string, string>> | null = null
  private static metaJsonCache = new Map<string, Promise<Record<string, any> | null>>()
  private static errorListenerAttached = false

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
    const fact = (label: string, value: string) =>
      value ? `<div><dt>${label}</dt><dd>${value}</dd></div>` : ''
    return `
      <div class="cc-panel" style="margin-top:1rem">
        <h4 style="margin:0;color:var(--terminal-green)">${a.accountId}</h4>
        <dl class="wv-facts">
          ${fact('HBAR balance', `${this.hbarIcon()} ${a.balanceHbar} ℏ`)}
          ${fact('Account created', a.created ? this.fmtDate(Number(a.created) * 1000) : '')}
          ${fact('Key type', a.keyType)}
          ${fact('Token associations', String(a.numTokens))}
          ${fact('Staked to', this.escapeHtml(a.staked))}
          ${fact('Memo', this.escapeHtml(a.memo))}
          ${fact('EVM address', a.evmAddress ? `<small>${a.evmAddress}</small>` : '')}
        </dl>

        <div style="display:flex;gap:0.25rem;margin-top:0.9rem;border-bottom:1px solid rgba(255,255,255,0.1)">
          ${(['tokens', 'nfts', 'activity'] as const).map(t => `
            <button class="wv-tab ${this.activeTab === t ? 'wv-tab-active' : ''}" data-tab="${t}" type="button"
              style="text-transform:capitalize">${t}${t === 'nfts' && a.numNfts ? ` (${a.numNfts})` : ''}</button>
          `).join('')}
        </div>
        <p style="font-size:0.72rem;color:var(--terminal-text);margin:0.5rem 0 0">
          ${this.activeTab === 'tokens' ? 'Token balances' : this.activeTab === 'nfts' ? 'NFT collections' : 'Recent activity'} are shown on the right →
        </p>
      </div>
    `
  }

  private static renderTokens(): string {
    if (!this.tokens.length) return `<p style="font-size:0.82rem;color:var(--terminal-text)">No token balances.</p>`
    const rows = this.tokens.map((t) => `
      <li>
        <span class="wv-tk">
          ${this.tokenIconHtml(t.tokenId, t.symbol, 'mid')}
          <span class="wv-tkn">
            <span>${this.escapeHtml(t.name || t.symbol || t.tokenId)}${t.symbol ? ` <em>$${this.escapeHtml(t.symbol)}</em>` : ''}<em>${t.tokenId}</em></span>
          </span>
        </span>
        <b>${t.balance}</b>
        <span class="tv-chip tv-chip-${t.type === 'NON_FUNGIBLE_UNIQUE' ? 'hcs6-register' : 'json'}">${t.type === 'NON_FUNGIBLE_UNIQUE' ? 'NFT' : 'FT'}</span>
      </li>
    `).join('')
    return `<ul class="wv-toklist">${rows}</ul>
      ${this.tokenListTruncated ? `<p style="font-size:0.72rem;color:var(--terminal-text)">Showing the first ${this.tokens.length} balances held.</p>` : ''}`
  }

  private static renderNfts(): string {
    if (!this.nftGroups.length) return `<p style="font-size:0.82rem;color:var(--terminal-text)">No NFT holdings.</p>`
    const total = this.nftGroups.reduce((s, g) => s + g.serials.length, 0)
    const cards = this.nftGroups.map((g) => {
      const expanded = this.expandedCollections.has(g.tokenId)
      const pct = g.supply ? ((g.serials.length / g.supply) * 100).toFixed((g.serials.length / g.supply) * 100 < 1 ? 2 : 1) + '%' : ''
      const shown = expanded ? g.serials : g.serials.slice(0, 24)
      return `
        <div class="wv-nft">
          <b>${this.tokenIconHtml(g.tokenId, g.symbol || g.name, 'coll')}${this.escapeHtml(g.name || g.symbol || g.tokenId)}</b>
          <em>${this.escapeHtml(g.symbol || '')} · ${g.tokenId}</em>
          <p>
            ${g.serials.length.toLocaleString()} held
            ${g.supply ? ` of ${g.supply.toLocaleString()} minted (${pct})` : ''}
            ${g.royalty ? ` · ${this.royaltyText(g.royalty)}% royalty` : ''}
            ${g.last ? ` · last moved ${this.fmtDate(g.last)}` : ''}
            ${g.unlisted ? ' · serials not returned by the mirror node' : ''}
          </p>
          <p class="wv-serials">
            ${shown.map(s => `<a class="wv-ser" href="${HASHSCAN}/token/${g.tokenId}/${s}" target="_blank" rel="noopener" title="View #${s} on HashScan">#${s}</a>`).join('')}
            ${g.serials.length > 24 ? `<button type="button" class="wv-lnk wv-nft-toggle" data-token="${g.tokenId}">${expanded ? 'Show fewer' : `Show all ${g.serials.length.toLocaleString()} serials`}</button>` : ''}
          </p>
          <p>
            <a href="${HASHSCAN}/token/${g.tokenId}" target="_blank" rel="noopener">Collection on HashScan</a>
          </p>
        </div>
      `
    }).join('')
    return `
      <h4 style="margin:0.75rem 0 0.25rem;color:var(--terminal-text)">
        NFTs: ${total.toLocaleString()} across ${this.nftGroups.length} ${this.nftGroups.length === 1 ? 'collection' : 'collections'}
      </h4>
      <p style="font-size:0.75rem;color:var(--terminal-text);margin:0 0 0.5rem">Tap a serial to view the NFT on HashScan.</p>
      <div class="wv-nfts">${cards}</div>
      ${this.nftListTruncated ? `<p style="font-size:0.72rem;color:var(--terminal-text)">Showing the first ${total} NFTs held.</p>` : ''}
    `
  }

  private static TX_NAMES: Record<string, string> = {
      CRYPTOTRANSFER: 'Transfer',
      CONTRACTCALL: 'Contract call',
      ETHEREUMTRANSACTION: 'Contract call (EVM)',
      TOKENASSOCIATE: 'Token associated',
      TOKENDISSOCIATE: 'Token dissociated',
      TOKENMINT: 'Mint',
      TOKENBURN: 'Burn',
      TOKENWIPE: 'Wipe',
      TOKENAIRDROP: 'Airdrop',
      TOKENCLAIMAIRDROP: 'Airdrop claimed',
      TOKENCANCELAIRDROP: 'Airdrop cancelled',
      TOKENREJECT: 'Token rejected',
      CONSENSUSSUBMITMESSAGE: 'Topic message',
      CRYPTOAPPROVEALLOWANCE: 'Allowance approved',
      CRYPTODELETEALLOWANCE: 'Allowance removed',
      CRYPTOUPDATEACCOUNT: 'Account updated',
      CRYPTOCREATEACCOUNT: 'Account created',
      SCHEDULECREATE: 'Schedule created',
      SCHEDULESIGN: 'Schedule signed',
    }

  private static renderActivity(): string {
    if (!this.activity.length) {
      if (this.activityLoading) return `<p style="font-size:0.82rem;color:var(--terminal-text)">Loading transfers…</p>`
      if (this.activityDone) return `<p style="font-size:0.82rem;color:var(--terminal-text)">No transactions found for this wallet.</p>`
      return `<p style="font-size:0.82rem;color:var(--terminal-text)">No recent transactions.</p>`
    }
    const amount = (v: number) => (v > 0 ? '+' : '−') + Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 4 })
    const rows = this.activity.map((row) => {
      const failed = row.result && row.result !== 'SUCCESS'
      const parts: string[] = []
      row.tokens.forEach((tok) => {
        parts.push(`<span class="${tok.amt > 0 ? 'wv-up' : 'wv-down'}">${amount(tok.amt)} ${this.tokenIconHtml(tok.id, tok.sym, 'sm')}${this.escapeHtml(tok.sym)}</span>`)
      })
      row.nfts.forEach((nft) => {
        parts.push(`<span class="${nft.dir > 0 ? 'wv-up' : 'wv-down'}">${nft.dir > 0 ? '+' : '−'} ${this.tokenIconHtml(nft.token, nft.sym, 'sm')}${this.escapeHtml(nft.sym)} <a class="wv-ser" href="${HASHSCAN}/token/${nft.token}/${nft.serial}" target="_blank" rel="noopener" title="View #${nft.serial} on HashScan">#${nft.serial}</a></span>`)
      })
      if (Math.abs(row.hbar) >= 1e-8) {
        parts.push(`<span class="${row.hbar > 0 ? 'wv-up' : 'wv-down'}">${row.hbar > 0 ? '+' : '−'}${Math.abs(row.hbar).toLocaleString(undefined, { maximumFractionDigits: 4 })} ℏ</span>`)
      }
      if (row.fee) parts.push(`<span class="wv-dim">fee ${row.fee.toLocaleString(undefined, { maximumFractionDigits: 4 })} ℏ</span>`)
      const kind = this.TX_NAMES[row.name] || (row.name ? row.name.charAt(0) + row.name.slice(1).toLowerCase() : '')
      const signs = new Set(
        [...row.tokens.map((t) => t.amount), ...row.nfts.map((n) => n.dir), row.hbar]
          .filter((v) => Math.abs(v) >= 1e-8)
          .map(Math.sign),
      )
      const who = row.others.length
        ? (signs.size > 1 ? 'with ' : signs.has(1) ? 'from ' : 'to ') +
          row.others.slice(0, 2).map((id) => `<button type="button" class="wv-lnk" data-wallet="${id}">${id}</button>`).join(', ') +
          (row.others.length > 2 ? ` +${row.others.length - 2}` : '')
        : ''
      const when = new Date(Math.round(1e3 * parseFloat(row.ts))).toLocaleString(undefined, {
        day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit',
      })
      return `<tr>
        <td><a href="${HASHSCAN}/transaction/${row.ts}" target="_blank" rel="noopener">${when}</a></td>
        <td class="wv-moves">${parts.join(' ') || '<span class="wv-dim">no balance change</span>'}</td>
        <td class="wv-kind">${this.escapeHtml(kind)}${failed ? ` <span class="wv-down">failed: ${this.escapeHtml(row.result.toLowerCase().replace(/_/g, ' '))}</span>` : ''}${who ? `<br>${who}` : ''}</td>
      </tr>`
    }).join('')
    const oldest = this.activity.length ? this.fmtDate(1e3 * parseFloat(this.activity[this.activity.length - 1].ts)) : ''
    return `
      <p style="font-size:0.72rem;color:var(--terminal-text)">
        ${this.activity.length.toLocaleString()} transaction${this.activity.length === 1 ? '' : 's'}${this.activityDone ? `, back to ${oldest}` : ''}.
        Amounts are what this wallet gained or lost; HBAR is shown apart from the network fee it paid.
      </p>
      <table class="wv-tx"><tbody>${rows}</tbody></table>
      <div style="display:flex;gap:0.5rem;margin-top:0.6rem;flex-wrap:wrap">
        ${this.activityLoading
          ? `<button class="cc-btn" type="button" disabled>Loading transfers…</button>`
          : this.activityDone
            ? ''
            : `<button class="cc-btn cc-btn-secondary" type="button" data-whmore>Load older transfers</button>`}
        ${this.activity.length ? `<button class="cc-btn cc-btn-secondary" type="button" data-whcsv>Export history CSV</button>` : ''}
      </div>
    `
  }

  private static renderRightPanel(): string {
    if (this.loading) {
      return `<h4 style="color:var(--terminal-green);margin:0 0 0.75rem">Wallet</h4>
        <p style="font-size:0.82rem;color:var(--terminal-text)">Querying the mirror node…</p>`
    }
    if (this.account) {
      const a = this.account
      return `
        <h4 style="color:var(--terminal-green);margin:0 0 0.75rem">Snapshot</h4>
        <p style="display:flex;align-items:center;gap:0.5rem;margin:0">
          <i class="ticon hero hbar" title="HBAR">${HBAR_ICON}</i>
          <span style="font-size:1.4rem;color:var(--terminal-green);font-weight:700">${a.balanceHbar} ℏ</span>
        </p>
        <p style="font-size:0.8rem;color:var(--terminal-text);margin:0.6rem 0 0">
          ${a.numNfts} NFT${a.numNfts === 1 ? '' : 's'} across ${this.nftGroups.length} collection${this.nftGroups.length === 1 ? '' : 's'}
          · ${this.tokens.length} token balance${this.tokens.length === 1 ? '' : 's'}
        </p>
        <div class="filter-divider" style="margin:0.9rem 0"></div>
        ${this.activeTab === 'tokens' ? this.renderTokens() : this.activeTab === 'nfts' ? this.renderNfts() : this.renderActivity()}
      `
    }
    return `
      <h4 style="color:var(--terminal-green);margin:0 0 0.75rem">Wallet Viewer</h4>
      <p style="font-size:0.8rem;color:var(--terminal-text);margin:0">
        Enter any Hedera account ID to see its HBAR balance, token and NFT
        holdings with icons, and recent activity. Nothing here touches the
        chain — pure mirror-node reads.
      </p>
    `
  }

  // ─── INIT ─────────────────────────────────────────────────

  static init(): void {
    this.attachIconErrorHandler()
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
        if (!t) return
        this.expandedCollections.has(t) ? this.expandedCollections.delete(t) : this.expandedCollections.add(t)
        this.refresh()
      })
    })
    document.querySelectorAll('[data-whmore]').forEach(btn => {
      btn.addEventListener('click', () => this.loadOlderActivity())
    })
    document.querySelectorAll('[data-whcsv]').forEach(btn => {
      btn.addEventListener('click', () => this.exportHistoryCsv())
    })
    document.querySelectorAll('[data-wallet]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.wallet
        if (id) { this.accountInput = id; this.load() }
      })
    })
  }

  // ─── DATA LOADING ─────────────────────────────────────────

  private static async load(): Promise<void> {
    const id = this.accountInput.trim()
    if (!id) { this.error = 'Enter an account ID'; this.refresh(); return }
    this.loading = true
    this.error = null
    this.expandedCollections.clear()
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
        numTokens: a.tokens?.length ?? 0,
        numNfts: 0,
        evmAddress: a.evm_address || '',
        staked: a.staked_node_id != null ? `node ${a.staked_node_id}` : (a.staked_account_id || ''),
      }

      // All token balances and all NFTs, paginated (100 per mirror page)
      const [balPage, nftPage] = await Promise.all([
        this.fetchAllPages(`/api/v1/accounts/${id}/tokens?limit=100`, 'tokens', 10),
        this.fetchAllPages(`/api/v1/accounts/${id}/nfts?limit=100`, 'nfts', 25),
      ])
      this.tokenListTruncated = balPage.truncated
      this.nftListTruncated = nftPage.truncated
      const heldTokens = balPage.items.filter((t: any) => Number(t.balance) > 0)

      // Token metadata (name/decimals/type), 6 at a time
      const metas = await this.mapLimit(heldTokens, 6, async (t: any) => {
        try {
          const r = await fetch(`${MIRROR_NODE_URL}/api/v1/tokens/${t.token_id}`)
          return r.ok ? await r.json() : {}
        } catch { return {} }
      })
      this.tokens = heldTokens.map((t: any, i: number) => {
        const meta = metas[i] || {}
        const decimals = Number(meta.decimals ?? 0)
        const raw = Number(t.balance ?? 0)
        this.tokenDecimals.set(t.token_id, decimals)
        this.tokenSymbols.set(t.token_id, meta.symbol || '')
        return {
          tokenId: t.token_id,
          name: meta.name || '',
          symbol: meta.symbol || '',
          balance: meta.type === 'NON_FUNGIBLE_UNIQUE' ? raw.toLocaleString() : this.fmtTokenAmount(raw, decimals),
          decimals,
          type: meta.type || 'FUNGIBLE_COMMON',
        }
      })

      // NFTs grouped by collection (every page, so late collections like Hbuds show up)
      const byToken = new Map<string, NftGroup>()
      for (const n of nftPage.items) {
        if (!byToken.has(n.token_id)) {
          byToken.set(n.token_id, {
            tokenId: n.token_id, name: '', symbol: '', serials: [],
            supply: 0, royalty: 0, last: 0, unlisted: false,
          })
        }
        const g = byToken.get(n.token_id)!
        g.serials.push(Number(n.serial_number))
        const ms = Math.round(1e3 * parseFloat(n.modified_timestamp || n.created_timestamp || '0'))
        if (ms > g.last) g.last = ms
      }
      const groups = [...byToken.values()].sort((x, y) => y.serials.length - x.serials.length)
      await this.mapLimit(groups, 6, async (g) => {
        try {
          const r = await fetch(`${MIRROR_NODE_URL}/api/v1/tokens/${g.tokenId}`)
          if (!r.ok) return
          const info = await r.json()
          g.name = info.name || ''
          g.symbol = info.symbol || ''
          g.supply = Number(info.total_supply) || 0
          g.royalty = ((info.custom_fees || {}).royalty_fees || []).reduce(
            (sum: number, fee: any) =>
              sum + (fee.amount && fee.amount.denominator ? (fee.amount.numerator / fee.amount.denominator) * 100 : 0),
            0,
          )
        } catch { /* collection details are best-effort */ }
      })
      groups.forEach(g => g.serials.sort((x, y) => x - y))
      this.nftGroups = groups
      if (this.account) this.account.numNfts = nftPage.items.length

      // First page of the parsed transfer history
      await this.loadActivityPage(`${MIRROR_NODE_URL}/api/v1/transactions?account.id=${id}&limit=50&order=desc`)
    } catch (err: any) {
      this.error = err.message || 'Failed to load account'
      this.account = null
    }
    this.loading = false
    this.refresh()
  }

  // ─── ICON ENGINE ──────────────────────────────────────────

  private static hbarIcon(): string {
    return `<i class="ticon hbar" title="HBAR">${HBAR_ICON}</i>`
  }

  // Badge markup for a token icon; letters show at once, a found icon is laid over it.
  private static tokenIconHtml(id: string, sym: string, size: string): string {
    const cls = 'ticon' + (size ? ' ' + size : '')
    const known = this.icons.get(id)
    if (!known) this.queueIcon(id)
    return `<i class="${cls}" data-icon="${id}" style="--h:${this.iconHue(id)}">${this.escapeHtml(this.iconLetters(sym))}${known && known.length ? this.iconImg(known) : ''}</i>`
  }

  private static iconImg(urls: string[]): string {
    return `<img src="${this.escapeHtml(urls[0])}" data-alts="${this.escapeHtml(urls.slice(1).join(' '))}" alt="" loading="lazy" referrerpolicy="no-referrer">`
  }

  // A colour hue worked out from a token ID, so a badge always has the same colour.
  private static iconHue(id: string): number {
    let hue = 0
    for (const ch of String(id)) hue = (hue * 31 + ch.charCodeAt(0)) % 360
    return hue
  }

  private static iconLetters(sym: string): string {
    const clean = String(sym || '').replace(/[^\p{L}\p{N}]/gu, '')
    return (clean || '?').slice(0, clean.length > 3 ? 2 : 3).toUpperCase()
  }

  // Resolve a token's icon: DaVinciPics -> ETA list -> token metadata logo ->
  // first-NFT image (collections). Remembers the answer for the session and
  // patches any badges already on screen.
  private static async queueIcon(id: string): Promise<void> {
    if (this.iconPending.has(id) || this.icons.has(id)) return
    this.iconPending.add(id)
    let urls: string[] = []
    try {
      urls = await this.davinciIcon(id)
      if (!urls.length) {
        const listed = (await this.iconList())[id]
        if (listed) urls = [listed]
      }
      if (!urls.length) {
        try {
          const r = await fetch(`${MIRROR_NODE_URL}/api/v1/tokens/${id}`)
          if (r.ok) {
            const info = await r.json()
            urls = await this.logoFromMetadata(info, id)
            if (!urls.length && info.type === 'NON_FUNGIBLE_UNIQUE') {
              urls = await this.collectionThumb(id)
            }
          }
        } catch { /* fall through to the badge */ }
      }
    } catch { /* badge stays */ }
    this.iconPending.delete(id)
    this.icons.set(id, urls)
    if (urls.length) {
      document.querySelectorAll(`.ticon[data-icon="${id}"]`).forEach(el => {
        if (!el.querySelector('img')) el.insertAdjacentHTML('beforeend', this.iconImg(urls))
      })
    }
  }

  // DaVinciPics, the icon registry Hedera wallets use. Mainnet only.
  private static async davinciIcon(id: string): Promise<string[]> {
    for (const base of DAVINCI_PICS) {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 8000)
      try {
        const res = await fetch(`${base}/tokens/hedera/${id}?scope=supplementary&noMissingError=true&context=false`, {
          signal: ctrl.signal,
          referrerPolicy: 'no-referrer',
        })
        if (res.status === 404) return []
        if (!res.ok) continue
        const data = await res.json()
        if (!data || /sensitive|inappropriate|copyright/i.test(data.sensitivity || '')) return []
        const pic = data.pic || (data.token0 && data.token0.pic) || (data.originalToken && data.originalToken.pic) || ''
        if (/^https:\/\//i.test(pic)) return [pic]
        return []
      } catch {
        continue
      } finally {
        clearTimeout(timer)
      }
    }
    return []
  }

  // ETA Finance public token list, read once per session.
  private static iconList(): Promise<Record<string, string>> {
    if (this.iconListPromise) return this.iconListPromise
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 12000)
    this.iconListPromise = fetch(ICON_LIST_URL, { signal: ctrl.signal, referrerPolicy: 'no-referrer' })
      .then(res => (res.ok ? res.json() : Promise.reject(new Error('HTTP ' + res.status))))
      .then((list: any) => {
        const map: Record<string, string> = {}
        ;(Array.isArray(list) ? list : []).forEach((entry: any) => {
          const tid = entry && entry.address
          const icon = entry && entry.icon
          if (!/^\d+\.\d+\.\d+$/.test(tid || '') || !icon || /hbar[^/]*$/i.test(icon)) return
          if (/^https:\/\//i.test(icon)) map[tid] = icon
          else if (icon.startsWith('/')) map[tid] = ICON_LIST_BASE + icon
        })
        return map
      })
      .catch(() => ({}))
      .finally(() => clearTimeout(timer))
    return this.iconListPromise
  }

  // A metadata/memo pointer (HIP-405 / HIP-766 style), or ''.
  private static logoPointer(info: any): string {
    const texts: string[] = []
    try { if (info.metadata) texts.push(atob(info.metadata)) } catch { /* not base64 */ }
    if (info.memo) texts.push(info.memo)
    return texts
      .map(t => t.trim())
      .find(t => /^(ipfs:\/\/|ar:\/\/|https:\/\/)\S+$/i.test(t) || /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|baf[a-z2-7]{20,})(\/\S*)?$/.test(t)) || ''
  }

  // Web addresses to try for a pointer, in order. '#' and spaces in file names
  // are percent-encoded so the browser doesn't treat them as a URL fragment.
  private static pointerUrls(ptr: string): string[] {
    const clean = (u: string) => u.replace(/#/g, '%23').replace(/ /g, '%20')
    const t = String(ptr || '').trim()
    if (/^https:\/\//i.test(t)) return [clean(t)]
    if (/^ar:\/\//i.test(t)) return [clean('https://arweave.net/' + t.slice(5))]
    const cid = t.replace(/^ipfs:\/\/(ipfs\/)?/i, '')
    if (/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|baf[a-z2-7]{20,})/.test(cid)) {
      return ICON_IPFS_GATEWAYS.map(g => clean(g + cid))
    }
    return []
  }

  // The logo named in a token's metadata JSON, or [].
  private static async logoFromMetadata(info: any, id: string): Promise<string[]> {
    const ptr = this.logoPointer(info)
    if (!ptr) return []
    const urls = this.pointerUrls(ptr)
    if (!urls.length) return []
    const key = id
    if (!this.metaJsonCache.has(key)) {
      this.metaJsonCache.set(key, (async () => {
        for (const url of urls) {
          const ctrl = new AbortController()
          const timer = setTimeout(() => ctrl.abort(), 8000)
          try {
            const res = await fetch(url, { signal: ctrl.signal, referrerPolicy: 'no-referrer' })
            if (!res.ok) continue
            const json = await res.json()
            return json && typeof json === 'object' ? json : null
          } catch {
            continue
          } finally {
            clearTimeout(timer)
          }
        }
        return null
      })())
    }
    const json = await this.metaJsonCache.get(key)!
    const logo = json && (json.lightLogo || json.darkLogo || json.logo || json.icon || json.image)
    return typeof logo === 'string' ? this.pointerUrls(logo) : []
  }

  // An unregistered collection's icon: the image of its first NFT.
  private static async collectionThumb(id: string): Promise<string[]> {
    try {
      const r = await fetch(`${MIRROR_NODE_URL}/api/v1/tokens/${id}/nfts?limit=1&order=asc`)
      if (!r.ok) return []
      const page = await r.json()
      const first = (page.nfts || [])[0]
      if (!first || !first.metadata) return []
      let pointer = ''
      try { pointer = atob(first.metadata) } catch { return [] }
      pointer = pointer.trim()
      if (/^hcs:\/\//i.test(pointer)) return [] // on-chain media: letter badge for now
      return await this.logoFromMetadata({ metadata: first.metadata }, id + ':nft')
    } catch {
      return []
    }
  }

  // An icon <img> that fails tries its next candidate address, then gives way to the badge.
  private static attachIconErrorHandler(): void {
    if (this.errorListenerAttached) return
    this.errorListenerAttached = true
    document.addEventListener('error', (ev) => {
      const img = ev.target
      if (!(img instanceof HTMLImageElement)) return
      const holder = img.closest('.ticon[data-icon]') as HTMLElement | null
      if (!holder) return
      const alts = (img.dataset.alts || '').split(' ').filter(Boolean)
      if (alts.length) {
        img.dataset.alts = alts.slice(1).join(' ')
        img.src = alts[0]
        return
      }
      img.remove()
      this.icons.set(holder.dataset.icon!, [])
    }, true)
  }

  // ─── HELPERS ──────────────────────────────────────────────

  // Follow mirror-node pagination for a path like 'tokens'/'nfts' on an account.
  private static async fetchAllPages(path: string, key: string, maxPages: number): Promise<{ items: any[], truncated: boolean }> {
    const items: any[] = []
    let url: string | null = `${MIRROR_NODE_URL}/api/v1/accounts/${encodeURIComponent(this.accountInput.trim())}/${path}?limit=100`
    let pages = 0
    let truncated = false
    while (url) {
      const res: Response = await fetch(url)
      if (!res.ok) break
      const page: any = await res.json()
      items.push(...(page[key] || []))
      pages++
      const next: string | null = page?.links?.next || null
      if (!next || pages >= maxPages) {
        truncated = !!next && pages >= maxPages
        break
      }
      url = next.startsWith('http') ? next : MIRROR_NODE_URL + next
      await this.sleep(120)
    }
    return { items, truncated }
  }

  private static sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms))
  }

  // ─── ACTIVITY (transfer history) ──────────────────────────

  private static async loadActivityPage(url?: string): Promise<void> {
    if (this.activityLoading || this.activityDone || !this.account) return
    this.activityLoading = true
    if (!this.loading) this.refresh()
    try {
      const next = url || this.activityNext || `${MIRROR_NODE_URL}/api/v1/transactions?account.id=${encodeURIComponent(this.account.accountId)}&limit=50&order=desc`
      const res = await fetch(next)
      if (!res.ok) throw new Error('activity fetch failed')
      const page = await res.json()
      const acct = this.account.accountId
      const rows = (page.transactions || []).map((tx: any) => this.walletHistoryRow(tx, acct))
      const tokenIds = new Set<string>()
      for (const row of rows) {
        for (const t of row.tokens) tokenIds.add(t.id)
        for (const n of row.nfts) tokenIds.add(n.token)
      }
      await this.mapLimit([...tokenIds], 6, async (id: string) => {
        if (this.tokenSymbols.has(id) && this.tokenDecimals.has(id)) return
        try {
          const r = await fetch(`${MIRROR_NODE_URL}/api/v1/tokens/${id}`)
          if (!r.ok) return
          const tok = await r.json()
          this.tokenSymbols.set(id, tok.symbol || '')
          this.tokenDecimals.set(id, typeof tok.decimals === 'number' ? tok.decimals : 0)
        } catch { /* keep defaults */ }
      })
      for (const row of rows) {
        for (const t of row.tokens) {
          t.sym = this.tokenSymbols.get(t.id) || ''
          const dec = this.tokenDecimals.get(t.id) || 0
          t.amt = dec ? t.amount / Math.pow(10, dec) : t.amount
        }
        for (const n of row.nfts) n.sym = this.tokenSymbols.get(n.token) || ''
      }
      this.activity.push(...rows)
      this.activityNext = page?.links?.next || null
      if (!this.activityNext) this.activityDone = true
    } catch { this.activityDone = true }
    this.activityLoading = false
    if (!this.loading) this.refresh()
  }

  private static loadOlderActivity(): void {
    void this.loadActivityPage()
  }

  // Parse one mirror-node transaction into a wallet-history row (ported from the
  // original tool's walletHistoryRow in trace/src/tracker/main.ts).
  private static walletHistoryRow(tx: any, acct: string): WalletTxRow {
    const id: string = tx.transaction_id || ''
    let tiny = 0
    for (const tr of tx.transfers || []) {
      if (tr.account === acct) tiny += Number(tr.amount || 0)
    }
    const tokens = new Map<string, number>()
    for (const tt of tx.token_transfers || []) {
      if (tt.account === acct) tokens.set(tt.token_id, (tokens.get(tt.token_id) || 0) + Number(tt.amount || 0))
    }
    const nfts: TxNftMove[] = []
    for (const nt of tx.nft_transfers || []) {
      if (nt.sender_account_id === acct) {
        nfts.push({ token: nt.token_id, serial: nt.serial_number, dir: -1, sym: '' })
        if (nt.receiver_account_id) tokens.set(`→${nt.receiver_account_id}`, (tokens.get(`→${nt.receiver_account_id}`) || 0) + 0)
      } else if (nt.receiver_account_id === acct) {
        nfts.push({ token: nt.token_id, serial: nt.serial_number, dir: 1, sym: '' })
        if (nt.sender_account_id) tokens.set(`←${nt.sender_account_id}`, (tokens.get(`←${nt.sender_account_id}`) || 0) + 0)
      }
    }
    // Counterparties from token transfers (accounts on the other side of our moves).
    const others: string[] = []
    for (const tt of tx.token_transfers || []) {
      if (tt.account !== acct && !this.isSystemAccount(tt.account)) {
        const sign = (tokens.get(tt.token_id) || 0) > 0 ? '←' : '→'
        const key = `${sign}${tt.account}`
        tokens.set(key, (tokens.get(key) || 0) + 0)
      }
    }
    const paidFee = id.startsWith(acct + '-')
    const fee = paidFee ? Number(tx.charged_tx_fee || 0) : 0
    const moved = tiny + fee
    if (!nfts.length && !tokens.size) {
      for (const tr of tx.transfers || []) {
        if (tr.account !== acct && !this.isSystemAccount(tr.account)) {
          const amt = Number(tr.amount || 0)
          if ((tiny > 0 && amt < 0) || (tiny < 0 && amt > 0)) {
            if (!others.includes(tr.account)) others.push(tr.account)
            if (others.length >= 3) break
          }
        }
      }
    }
    return {
      ts: String(tx.consensus_timestamp || 0),
      id,
      name: tx.name || '',
      result: tx.result || '',
      hbar: moved / 1e8,
      fee: fee / 1e8,
      tokens: [...tokens.entries()]
        .filter(([k, v]) => !k.startsWith('→') && !k.startsWith('←') && v !== 0)
        .map(([tid, amount]) => ({ id: tid, amount, sym: '', amt: amount })),
      nfts,
      others: [...new Set([...others, ...[...tokens.keys()].filter((k) => k.startsWith('→') || k.startsWith('←')).map((k) => k.slice(1))])].slice(0, 3),
    }
  }

  private static isSystemAccount(id: string): boolean {
    const m = /^0\.0\.(\d+)$/.exec(id || '')
    return !!m && Number(m[1]) < 1000
  }

  private static exportHistoryCsv(): void {
    const esc = (c: string | number) => `"${String(c).replace(/"/g, '""')}"`
    const lines = ['time_utc,type,result,hbar_change,fee_paid_hbar,token_changes,nfts,counterparties,transaction_id']
    for (const r of this.activity) {
      const tok = r.tokens.map((t) => `${t.amt > 0 ? '+' : ''}${t.amt} ${t.sym || t.id}`).join('; ')
      const nft = r.nfts.map((n) => `${n.dir > 0 ? '+' : '-'}${n.sym || n.token}#${n.serial}`).join('; ')
      lines.push([
        esc(new Date(Math.round(1e3 * parseFloat(r.ts))).toISOString()),
        esc(WalletViewer.TX_NAMES[r.name] || r.name),
        esc(r.result),
        r.hbar,
        r.fee,
        esc(tok),
        esc(nft),
        esc(r.others.join('; ')),
        esc(r.id),
      ].join(','))
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `wallet-history-${this.account?.accountId || 'account'}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  private static royaltyText(royalty: number): string {
    const rounded = Math.round(100 * royalty) / 100
    return rounded % 1 ? rounded.toFixed((10 * rounded) % 1 ? 2 : 1) : String(rounded)
  }

  private static fmtDate(ms: number): string {
    return new Date(ms).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
  }

  private static fmtTokenAmount(raw: number, decimals: number): string {
    if (!decimals) return raw.toLocaleString()
    return (raw / Math.pow(10, decimals)).toLocaleString(undefined, { maximumFractionDigits: Math.min(decimals, 4) })
  }

  private static async mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const out: R[] = new Array(items.length)
    let i = 0
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++
        out[idx] = await fn(items[idx])
      }
    })
    await Promise.all(workers)
    return out
  }

  static resetForm(): void {
    this.accountInput = ''
    this.account = null
    this.tokens = []
    this.nftGroups = []
    this.loading = false
    this.error = null
    this.activeTab = 'tokens'
    this.expandedCollections.clear()
    this.tokenListTruncated = false
    this.nftListTruncated = false
    this.activity = []
    this.activityNext = null
    this.activityLoading = false
    this.activityDone = false
    this.tokenDecimals = new Map()
    this.tokenSymbols = new Map()
  }

  private static refresh(): void {
    const left = document.querySelector('.art-gen-left')
    const right = document.querySelector('.art-gen-right')
    const leftTop = left?.scrollTop ?? 0
    const rightTop = right?.scrollTop ?? 0
    const app = document.querySelector<HTMLDivElement>('#app')!
    app.innerHTML = this.render()
    this.init()
    const newLeft = document.querySelector('.art-gen-left')
    const newRight = document.querySelector('.art-gen-right')
    if (newLeft) newLeft.scrollTop = leftTop
    if (newRight) newRight.scrollTop = rightTop
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
