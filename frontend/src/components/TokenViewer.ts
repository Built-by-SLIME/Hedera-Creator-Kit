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
  private static holdersPage: number = 0
  private static readonly HOLDERS_PER_PAGE = 50
  // Holder→holder link pairs (both sent this token to each other in recent history)
  private static tokenLinks: [string, string][] = []
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
        <div class="window-title">slime-tools</div>
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
      ${this.renderBubbleMap()}
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

    const perPage = this.HOLDERS_PER_PAGE
    const pageCount = Math.max(1, Math.ceil(this.holders.length / perPage))
    const page = Math.min(this.holdersPage, pageCount - 1)
    const start = page * perPage
    const rows = this.holders.slice(start, start + perPage)

    return `
      <div class="holders-section">
        <h3 class="section-title">All Holders (${this.holders.length})</h3>
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
              ${rows.map((holder, index) => `
                <tr>
                  <td>${start + index + 1}</td>
                  <td class="account-id">${holder.accountId}</td>
                  <td class="balance">${this.formatSupply(holder.balance)}</td>
                  <td class="percentage">${holder.percentage}%</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        ${pageCount > 1 ? `
          <div class="holders-pager">
            <button class="holders-nav-btn" data-holders-nav="prev" ${page === 0 ? 'disabled' : ''}>← Prev</button>
            <span class="holders-page-info">Page ${page + 1} of ${pageCount}</span>
            <button class="holders-nav-btn" data-holders-nav="next" ${page >= pageCount - 1 ? 'disabled' : ''}>Next →</button>
          </div>
        ` : ''}
      </div>
    `
  }

  // One bubble per holder, sized by share of supply. Wallets that have sent this
  // token to each other (recent history) are linked with lines and share a
  // cluster color — Bubblemaps-style entity detection. Unlinked wallets stay
  // neutral gray. Packing leaves a consistent gap between bubbles.
  private static renderBubbleMap(): string {
    if (this.holders.length === 0) return ''

    interface Bubble { x: number; y: number; r: number; holder: TokenHolder; color: string }

    // ── Cluster linked wallets via union-find ──
    const parent = new Map<string, string>()
    const find = (a: string): string => {
      let root = a
      while (parent.get(root) !== root) root = parent.get(root)!
      let cur = a
      while (parent.get(cur) !== cur) { const next = parent.get(cur)!; parent.set(cur, root); cur = next }
      return root
    }
    const union = (a: string, b: string) => {
      if (!parent.has(a)) parent.set(a, a)
      if (!parent.has(b)) parent.set(b, b)
      const ra = find(a); const rb = find(b)
      if (ra !== rb) parent.set(ra, rb)
    }
    for (const [a, b] of this.tokenLinks) union(a, b)

    const clusterOf = new Map<string, number>()
    const clusterMembers = new Map<number, Set<string>>()
    let nextCluster = 0
    for (const [a, b] of this.tokenLinks) {
      for (const acct of [a, b]) {
        if (!parent.has(acct)) continue
        const root = find(acct)
        if (!clusterOf.has(root)) clusterOf.set(root, nextCluster++)
        const c = clusterOf.get(root)!
        if (!clusterMembers.has(c)) clusterMembers.set(c, new Set())
        clusterMembers.get(c)!.add(acct)
      }
    }
    const clusterSizes = new Map<number, number>()
    for (const [c, members] of clusterMembers) clusterSizes.set(c, members.size)

    // Distinct, dark-mode-friendly cluster palette ( Bubblemaps-like)
    const PALETTE = [
      '155, 93, 229',   // purple
      '61, 220, 132',   // green
      '255, 99, 132',   // red-pink
      '255, 195, 56',   // amber
      '56, 189, 248',   // sky
      '244, 114, 182',  // pink
      '52, 211, 153',   // emerald
      '251, 146, 60',   // orange
    ]
    const clusterColor = new Map<number, string>()
    // Biggest clusters get the most distinct colors first
    const ranked = [...clusterSizes.entries()].sort((a, b) => b[1] - a[1])
    ranked.forEach(([c], i) => {
      clusterColor.set(c, PALETTE[i % PALETTE.length])
    })
    const colorFor = (accountId: string): string | null => {
      if (!parent.has(accountId)) return null
      const c = clusterOf.get(find(accountId))
      return c != null ? clusterColor.get(c)! : null
    }

    // ── Radii: area ∝ share of supply, consistent gap between bubbles ──
    const holders = this.holders
    const n = holders.length
    const GAP = 6
    const maxPct = Math.max(parseFloat(holders[0].percentage), 1e-9)
    const maxR = 100
    const K = maxR / Math.sqrt(maxPct)
    const radii = holders.map((h) => {
      const pct = Math.max(parseFloat(h.percentage), 1e-6)
      return Math.max(Math.sqrt(pct) * K, 2.5)
    })

    // ── Force-directed layout (Bubblemaps-style) ──
    // Repulsion between every pair, spring attraction along links, mild center
    // gravity, and hard collision spacing. Linked clusters pull tight together;
    // independent wallets drift to the outskirts.
    const bubbles: Bubble[] = holders.map((h, i) => {
      // Deterministic scattered start (golden-angle) so renders are stable
      const theta = i * 2.399963
      const dist = 12 * Math.sqrt(i + 1)
      return { x: Math.cos(theta) * dist, y: Math.sin(theta) * dist, r: radii[i], holder: h, color: '' }
    })

    const cell = maxR * 2
    const keyOf = (x: number, y: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`
    const neighborsOf = (x: number, y: number, reach: number): number[] => {
      const out: number[] = []
      const cx = Math.floor(x / cell); const cy = Math.floor(y / cell)
      const span = Math.ceil(reach / cell) + 1
      for (let gx = cx - span; gx <= cx + span; gx++) {
        for (let gy = cy - span; gy <= cy + span; gy++) {
          const bucket = grid.get(`${gx},${gy}`)
          if (bucket) out.push(...bucket)
        }
      }
      return out
    }

    const indexOfAccount = new Map(bubbles.map((b, i) => [b.holder.accountId, i]))
    const linkPairs: [number, number][] = []
    for (const [a, b] of this.tokenLinks) {
      const ia = indexOfAccount.get(a); const ib = indexOfAccount.get(b)
      if (ia != null && ib != null) linkPairs.push([ia, ib])
    }

    let grid = new Map<string, number[]>()
    const rebuildGrid = () => {
      grid = new Map()
      for (let i = 0; i < n; i++) {
        const k = keyOf(bubbles[i].x, bubbles[i].y)
        const bucket = grid.get(k)
        if (bucket) bucket.push(i); else grid.set(k, [i])
      }
    }

    const TICKS = 220
    for (let tick = 0; tick < TICKS; tick++) {
      const alpha = 1 - tick / TICKS
      const disp = bubbles.map(() => ({ x: 0, y: 0 }))
      rebuildGrid()

      // Repulsion (grid-bounded): F ∝ (r_i·r_j) / d, cut off past 4·maxR
      for (let i = 0; i < n; i++) {
        const a = bubbles[i]
        for (const j of neighborsOf(a.x, a.y, maxR * 4)) {
          if (j <= i) continue
          const b = bubbles[j]
          let dx = a.x - b.x; let dy = a.y - b.y
          let d = Math.hypot(dx, dy)
          if (d === 0) { dx = 0.01 * (i - j); dy = 0.01; d = Math.hypot(dx, dy) }
          const cutoff = maxR * 4
          if (d > cutoff) continue
          const f = (0.35 * alpha * (a.r * b.r)) / (d * Math.max(d, a.r + b.r))
          const fx = (dx / d) * f; const fy = (dy / d) * f
          disp[i].x += fx; disp[i].y += fy
          disp[j].x -= fx; disp[j].y -= fy
        }
      }

      // Springs along links: pull toward resting distance r_i + r_j + GAP
      for (const [ia, ib] of linkPairs) {
        const a = bubbles[ia]; const b = bubbles[ib]
        const dx = b.x - a.x; const dy = b.y - a.y
        const d = Math.hypot(dx, dy) || 0.001
        const rest = a.r + b.r + GAP
        const f = 0.06 * (d - rest)
        const fx = (dx / d) * f; const fy = (dy / d) * f
        disp[ia].x += fx; disp[ia].y += fy
        disp[ib].x -= fx; disp[ib].y -= fy
      }

      // Mild gravity toward origin keeps the whole map centered
      for (let i = 0; i < n; i++) {
        disp[i].x -= bubbles[i].x * 0.012
        disp[i].y -= bubbles[i].y * 0.012
      }

      // Integrate with damping
      for (let i = 0; i < n; i++) {
        bubbles[i].x += disp[i].x * 0.6
        bubbles[i].y += disp[i].y * 0.6
      }

      // Hard collision: never allow overlap (keeps the spacing visible)
      for (let pass = 0; pass < 2; pass++) {
        rebuildGrid()
        for (let i = 0; i < n; i++) {
          const a = bubbles[i]
          for (const j of neighborsOf(a.x, a.y, a.r + maxR)) {
            if (j <= i) continue
            const b = bubbles[j]
            const dx = b.x - a.x; const dy = b.y - a.y
            const minDist = a.r + b.r + GAP
            const d2 = dx * dx + dy * dy
            if (d2 >= minDist * minDist || d2 === 0) continue
            const d = Math.sqrt(d2)
            const push = (minDist - d) / d
            const wa = b.r / (a.r + b.r); const wb = 1 - wa
            a.x -= dx * push * wa; a.y -= dy * push * wa
            b.x += dx * push * wb; b.y += dy * push * wb
          }
        }
      }
    }

    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity
    for (const b of bubbles) {
      minX = Math.min(minX, b.x - b.r); minY = Math.min(minY, b.y - b.r)
      maxX = Math.max(maxX, b.x + b.r); maxY = Math.max(maxY, b.y + b.r)
    }
    const pad = 6
    const side = Math.max(maxX - minX, maxY - minY) + pad * 2
    const vbX = (minX + maxX) / 2 - side / 2; const vbY = (minY + maxY) / 2 - side / 2

    const byAccount = new Map(bubbles.map((b) => [b.holder.accountId, b]))

    // ── Connection lines under the bubbles ──
    const MAX_LINES = 400 // keep the visual readable on very linked tokens
    let lineCount = 0
    const lines: string[] = []
    for (const [a, b2] of this.tokenLinks) {
      if (lineCount >= MAX_LINES) break
      const ba = byAccount.get(a); const bb = byAccount.get(b2)
      if (!ba || !bb) continue
      lineCount++
      const mx = (ba.x + bb.x) / 2; const my = (ba.y + bb.y) / 2
      lines.push(`<line x1="${ba.x.toFixed(1)}" y1="${ba.y.toFixed(1)}" x2="${bb.x.toFixed(1)}" y2="${bb.y.toFixed(1)}" stroke="rgba(255,255,255,0.13)" stroke-width="1"/>
<circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="1.4" fill="rgba(255,255,255,0.3)"/>`)
    }

    // Muted pastel hues for independent (unlinked) holders, deterministic per wallet
    const SOLO_HUES = [210, 260, 190, 300, 170, 230, 320, 200, 280, 150, 240, 310]
    const soloColorFor = (accountId: string): number => {
      let h = 0
      for (let i = 0; i < accountId.length; i++) h = (h * 31 + accountId.charCodeAt(i)) >>> 0
      return SOLO_HUES[h % SOLO_HUES.length]
    }

    const circles = bubbles.map((b) => {
      const pct = parseFloat(b.holder.percentage)
      const rgb = colorFor(b.holder.accountId)
      const solo = rgb ? null : soloColorFor(b.holder.accountId)
      const fill = rgb ? `rgba(${rgb}, 0.55)` : `hsla(${solo}, 45%, 62%, 0.35)`
      const stroke = rgb ? `rgba(${rgb}, 0.95)` : `hsla(${solo}, 50%, 72%, 0.5)`
      const pctLabel = b.r >= 16
        ? `<text x="${b.x.toFixed(1)}" y="${(b.y + 3.5).toFixed(1)}" text-anchor="middle" class="bubble-label">${pct >= 1 ? pct.toFixed(1) + '%' : pct.toFixed(2) + '%'}</text>`
        : ''
      const idLabel = b.r >= 34
        ? `<text x="${b.x.toFixed(1)}" y="${(b.y - b.r - 5).toFixed(1)}" text-anchor="middle" class="bubble-id">${b.holder.accountId}</text>`
        : ''
      return `<circle cx="${b.x.toFixed(1)}" cy="${b.y.toFixed(1)}" r="${b.r.toFixed(1)}" fill="${fill}" stroke="${stroke}" stroke-width="1.2">
  <title>${b.holder.accountId} — ${this.formatSupply(b.holder.balance)} (${b.holder.percentage}%)${rgb ? ' · linked wallet' : ''}</title>
</circle>${pctLabel}${idLabel}`
    }).join('')

    // ── Legend: linked clusters with sizes ──
    const legend = ranked.length > 0
      ? `<div class="bubblemap-legend">
          ${ranked.slice(0, 8).map(([c]) => {
            const rgb = clusterColor.get(c)!
            return `<span class="bubblemap-legend-item"><span class="bubblemap-swatch" style="background:rgba(${rgb},0.85)"></span>${clusterSizes.get(c)} linked wallets</span>`
          }).join('')}
          <span class="bubblemap-legend-item"><span class="bubblemap-swatch" style="background:hsla(220, 45%, 62%, 0.6)"></span>independent</span>
        </div>`
      : ''

    return `
      <div class="holders-section bubblemap-section">
        <h3 class="section-title">Holder Bubble Map <span class="bubblemap-hint">(one bubble per holder · same color = wallets that have transacted with each other · hover for details)</span></h3>
        ${legend}
        <div class="bubblemap-wrapper">
          <svg viewBox="${vbX.toFixed(1)} ${vbY.toFixed(1)} ${side.toFixed(1)} ${side.toFixed(1)}" class="bubblemap-svg" role="img" aria-label="Holder distribution bubble map">
            ${lines.join('')}
            ${circles}
          </svg>
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

    document.querySelectorAll('[data-holders-nav]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const dir = btn.getAttribute('data-holders-nav')
        const pageCount = Math.max(1, Math.ceil(this.holders.length / this.HOLDERS_PER_PAGE))
        this.holdersPage = Math.min(Math.max(0, this.holdersPage + (dir === 'next' ? 1 : -1)), pageCount - 1)
        this.refresh()
      })
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
    this.holdersPage = 0
    this.tokenLinks = []
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
    this.holders = allHolders
    this.holdersPage = 0
    this.tokenLinks = await this.fetchTokenLinks(tokenId, allHolders)
    this.loading = false
    this.refresh()
  }

  // Build the holder→holder link graph by scanning recent transactions of the
  // top holders (the bulk /tokens/{id}/transfers endpoint doesn't exist on the
  // public mirror node — token_transfers are embedded in each account's txs).
  private static async fetchTokenLinks(tokenId: string, holders: TokenHolder[]): Promise<[string, string][]> {
    const holderSet = new Set(holders.map((h) => h.accountId))
    const seen = new Set<string>()
    const links: [string, string][] = []
    const MAX_LINKS = 1500
    const TOP_HOLDERS = 40

    const scanHolder = async (holder: TokenHolder): Promise<void> => {
      try {
        const res: Response = await fetch(`${this.mirrorNodeUrl}/api/v1/transactions?account.id=${holder.accountId}&limit=100&order=desc`)
        if (!res.ok) return
        const data: any = await res.json()
        for (const tx of data.transactions || []) {
          const senders: string[] = []; const receivers: string[] = []
          for (const tt of tx.token_transfers || []) {
            if (tt.token_id !== tokenId) continue
            if (Number(tt.amount) < 0) senders.push(tt.account)
            else if (Number(tt.amount) > 0) receivers.push(tt.account)
          }
          for (const nt of tx.nft_transfers || []) {
            if (nt.token_id !== tokenId) continue
            if (nt.sender_account_id) senders.push(nt.sender_account_id)
            if (nt.receiver_account_id) receivers.push(nt.receiver_account_id)
          }
          for (const s of senders) {
            for (const r of receivers) {
              if (s === r || !holderSet.has(s) || !holderSet.has(r)) continue
              const key = s < r ? `${s}|${r}` : `${r}|${s}`
              if (seen.has(key)) continue
              seen.add(key)
              links.push([s, r])
              if (links.length >= MAX_LINKS) return
            }
          }
        }
      } catch { /* skip this holder */ }
    }

    // Chunked concurrency (6 at a time) to stay friendly to the mirror node
    const top = holders.slice(0, TOP_HOLDERS)
    for (let i = 0; i < top.length; i += 6) {
      await Promise.all(top.slice(i, i + 6).map(scanHolder))
      if (links.length >= MAX_LINKS) break
    }
    return links
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
          <span class="status-item">SLIME TOOLS v1.2</span>
          <span class="status-item">MAINNET</span>
        </div>
      </div>
    `
  }
}
