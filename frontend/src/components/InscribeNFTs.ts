/**
 * Inscribe NFTs (Hashinal) Component
 * Inscribes media fully on-chain via HCS-1 (zstd + base64 data-URI chunks), writes
 * HIP-412 metadata to its own topic pointing at hcs://1/<media>, optionally wraps it
 * in an HCS-6 registry for updatability, then mints through the shared operator pipeline.
 */
import WalletConnectService from '../services/WalletConnectService'
import { API_BASE_URL, MIRROR_NODE_URL, BACKEND_MINTER_ACCOUNT, getHederaClient } from '../config'
import {
  AccountId,
  TransactionId,
  Hbar,
  TransferTransaction,
  PrivateKey,
} from '@hashgraph/sdk'

interface TokenInfo {
  tokenId: string
  name: string
  symbol: string
  totalSupply: number
  maxSupply: number
  supplyKey: string | null
  type: string
}

interface Prepared {
  preparedId: string
  sha256: string
  mime: string
  size: number
  compressedSize: number
  chunks: number
  estCostUsd: number
  estCostHbar: number
}

interface InscribeResult {
  pointer: string
  mediaTopic?: string
  metaTopic?: string
  registryTopic?: string
}

type Step = 'setup' | 'inscribing' | 'minting' | 'complete'

export class InscribeNFTs {
  private static step: Step = 'setup'
  private static error: string | null = null
  private static statusMessage = ''

  // token
  private static tokenIdInput = ''
  private static tokenInfo: TokenInfo | null = null
  private static tokenValidated = false
  private static tokenError: string | null = null
  private static checkingToken = false

  // supply key
  private static supplyKeyInput = ''
  private static supplyKeyRevealed = false
  private static supplyKeyError: string | null = null

  // file
  private static file: File | null = null
  private static previewUrl: string | null = null
  private static preparing = false
  private static prepareError: string | null = null
  private static prepared: Prepared | null = null

  // metadata form
  private static name = ''
  private static creator = ''
  private static description = ''
  private static attributes: Array<{ trait_type: string; value: string }> = []
  private static updatable = false
  private static copies = 1

  // jobs
  private static inscribeJobId: string | null = null
  private static inscription: InscribeResult | null = null
  private static chunksDone = 0
  private static chunksTotal = 0
  private static mintJobId: string | null = null
  private static mintedSerials: number[] = []

  // ─── RENDER ─────────────────────────────────────────────

  static render(): string {
    const ws = WalletConnectService.getState()
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
                <div class="back-link" id="inscribe-back"><span class="back-arrow">←</span><span>Back to Home</span></div>
                <h3 class="section-title">◆ Inscribe NFTs (Hashinal)</h3>
                <p class="cc-hip-badge">⬡ HCS-1 On-Chain Inscription · media lives on the ledger, not IPFS</p>
                ${!ws.connected ? this.renderConnectPrompt() : this.renderContent()}
              </div>
            </div>
            <div class="art-gen-right" style="padding:1.25rem">
              ${this.renderRightPanel()}
            </div>
          </div>
        </div>
        <div class="status-bar">
          <span class="status-left">${ws.accountId ? `⬡ ${ws.accountId}` : '⬡ Not connected'}</span>
          <span class="status-right">${ws.hbarBalance ? `${ws.hbarBalance} ℏ` : ''} · Mainnet</span>
        </div>
      </div>
    `
  }

  private static renderConnectPrompt(): string {
    return `
      <div class="cc-panel" style="margin-top:1rem">
        <p style="color:var(--terminal-text);margin:0 0 0.75rem">Connect your wallet to inscribe NFTs.</p>
      </div>
    `
  }

  private static renderContent(): string {
    if (this.step === 'inscribing') return this.renderProgress('INSCRIBING ON-CHAIN')
    if (this.step === 'minting') return this.renderProgress('MINTING NFT')
    if (this.step === 'complete') return this.renderComplete()
    return this.renderSetup()
  }

  private static renderSetup(): string {
    return `
      ${this.renderTokenSection()}
      ${this.tokenValidated ? this.renderSupplyKeySection() : ''}
      ${this.tokenValidated ? this.renderFileSection() : ''}
      ${this.prepared ? this.renderMetadataSection() : ''}
      ${this.error ? `<div class="cc-error-banner" style="margin-top:1rem">✗ ${this.escapeHtml(this.error)}</div>` : ''}
    `
  }

  private static renderTokenSection(): string {
    return `
      <div class="cc-panel" style="margin-top:1rem">
        <h4 style="margin:0 0 0.75rem;color:var(--terminal-green)">1. Collection</h4>
        <div style="display:flex;gap:0.5rem">
          <input type="text" id="inscribe-token-id" class="cc-input" placeholder="0.0.XXXXXXX (NFT collection token ID)"
            value="${this.escapeHtml(this.tokenIdInput)}" style="flex:1" />
          <button id="inscribe-validate-token" class="cc-btn" ${this.checkingToken ? 'disabled' : ''}>
            ${this.checkingToken ? 'Checking…' : 'Validate'}
          </button>
        </div>
        ${this.tokenError ? `<p style="color:var(--terminal-red);font-size:0.82rem;margin:0.5rem 0 0">${this.escapeHtml(this.tokenError)}</p>` : ''}
        ${this.tokenValidated && this.tokenInfo ? `
          <p style="color:var(--terminal-text);font-size:0.82rem;margin:0.75rem 0 0">
            ✓ <strong>${this.escapeHtml(this.tokenInfo.name)}</strong> ($${this.escapeHtml(this.tokenInfo.symbol)})
            — supply ${this.tokenInfo.totalSupply}${this.tokenInfo.maxSupply ? ' / ' + this.tokenInfo.maxSupply : ''}
          </p>
        ` : ''}
      </div>
    `
  }

  private static renderSupplyKeySection(): string {
    return `
      <div class="cc-panel" style="margin-top:1rem">
        <h4 style="margin:0 0 0.75rem;color:var(--terminal-green)">2. Supply Key</h4>
        <p style="font-size:0.78rem;color:var(--terminal-text);margin:0 0 0.5rem">
          The supply key signs mints — same as the Mint NFTs (IPFS) tool. It is sent to the
          backend only to sign the mint, never stored.
        </p>
        <div style="display:flex;gap:0.5rem;align-items:center">
          <input type="${this.supplyKeyRevealed ? 'text' : 'password'}" id="inscribe-supply-key" class="cc-input mono"
            placeholder="Supply private key" value="${this.escapeHtml(this.supplyKeyInput)}" style="flex:1" />
          <button id="inscribe-toggle-supply-key" class="cc-btn cc-btn-secondary" type="button">
            ${this.supplyKeyRevealed ? 'Hide' : 'Show'}
          </button>
        </div>
        ${this.supplyKeyError ? `<p style="color:var(--terminal-red);font-size:0.82rem;margin:0.5rem 0 0">${this.escapeHtml(this.supplyKeyError)}</p>` : ''}
      </div>
    `
  }

  private static renderFileSection(): string {
    return `
      <div class="cc-panel" style="margin-top:1rem">
        <h4 style="margin:0 0 0.75rem;color:var(--terminal-green)">3. Media File</h4>
        <div id="inscribe-drop" class="mint-upload-zone" style="cursor:pointer">
          <input type="file" id="inscribe-file-input" accept="image/*,video/mp4,video/quicktime,video/webm,video/ogg" style="display:none" />
          ${this.file ? `
            <p style="margin:0;color:var(--terminal-green)">✓ ${this.escapeHtml(this.file.name)}
              (${this.fmtBytes(this.file.size)})</p>
            <p style="margin:0.25rem 0 0;font-size:0.78rem;color:var(--terminal-text)">Click to choose a different file</p>
          ` : `
            <p style="margin:0">Drop your media file here or click to browse</p>
            <p style="margin:0.25rem 0 0;font-size:0.78rem;color:var(--terminal-text)">
              PNG · JPEG · GIF · WebP · AVIF · BMP · SVG · MP4 · MOV · WebM · OGG
            </p>
          `}
        </div>
        ${this.preparing ? `<p style="color:var(--terminal-text);font-size:0.82rem;margin:0.5rem 0 0">⟳ Preparing (compressing + quoting)…</p>` : ''}
        ${this.prepareError ? `<p style="color:var(--terminal-red);font-size:0.82rem;margin:0.5rem 0 0">${this.escapeHtml(this.prepareError)}</p>` : ''}
      </div>
    `
  }

  private static renderMetadataSection(): string {
    const p = this.prepared!
    return `
      <div class="cc-panel" style="margin-top:1rem">
        <h4 style="margin:0 0 0.75rem;color:var(--terminal-green)">4. Metadata & Mint</h4>
        <div class="inscribe-field"><label>Name *</label>
          <input type="text" id="inscribe-name" class="cc-input" value="${this.escapeHtml(this.name)}" placeholder="NFT name" /></div>
        <div class="inscribe-field"><label>Creator *</label>
          <input type="text" id="inscribe-creator" class="cc-input" value="${this.escapeHtml(this.creator)}" placeholder="Artist / project name" /></div>
        <div class="inscribe-field"><label>Description</label>
          <textarea id="inscribe-desc" class="cc-input" rows="2" placeholder="Optional description">${this.escapeHtml(this.description)}</textarea></div>

        <label style="display:block;font-size:0.82rem;color:var(--terminal-text);margin:0.75rem 0 0.25rem">Attributes (optional)</label>
        ${this.attributes.map((a, i) => `
          <div style="display:flex;gap:0.5rem;margin-bottom:0.4rem">
            <input type="text" class="cc-input inscribe-attr-type" data-index="${i}" placeholder="trait_type" value="${this.escapeHtml(a.trait_type)}" style="flex:1" />
            <input type="text" class="cc-input inscribe-attr-value" data-index="${i}" placeholder="value" value="${this.escapeHtml(a.value)}" style="flex:1" />
            <button class="cc-btn cc-btn-secondary inscribe-attr-remove" data-index="${i}" type="button">✕</button>
          </div>
        `).join('')}
        <button id="inscribe-add-attr" class="cc-btn cc-btn-secondary" type="button" style="margin-bottom:0.75rem">+ Add trait</button>

        <div style="display:flex;gap:1rem;align-items:center;flex-wrap:wrap">
          <div class="inscribe-field" style="min-width:90px"><label>Copies</label>
            <input type="number" id="inscribe-copies" class="cc-input" min="1" max="10" value="${this.copies}" /></div>
          <label style="display:flex;gap:0.4rem;align-items:center;font-size:0.82rem;color:var(--terminal-text);cursor:pointer">
            <input type="checkbox" id="inscribe-updatable" ${this.updatable ? 'checked' : ''} />
            Updatable (HCS-6 registry — metadata can be re-inscribed later)
          </label>
        </div>

        <div class="cc-panel" style="background:rgba(0,0,0,0.25);margin-top:0.75rem">
          <p style="margin:0;font-size:0.82rem;color:var(--terminal-text)">
            <strong>${p.mime}</strong> · ${this.fmtBytes(p.size)} → ${this.fmtBytes(p.compressedSize)} zstd
            · ${p.chunks} HCS message${p.chunks === 1 ? '' : 's'}
          </p>
          <p style="margin:0.35rem 0 0;font-size:0.82rem;color:var(--terminal-text)">
            Inscription cost: ≈ <strong>${p.estCostHbar} HBAR</strong> (~$${p.estCostUsd.toFixed(3)}) + minting fees
          </p>
        </div>

        <button id="inscribe-start" class="cc-btn" style="margin-top:0.9rem;width:100%">
          ⚡ INSCRIBE & MINT
        </button>
        <p style="font-size:0.75rem;color:var(--terminal-text);margin:0.5rem 0 0">
          One wallet signature covers inscription + mint network fees. The backend operator writes the
          chunks and signs mints with your supply key; your wallet stays treasury.
        </p>
      </div>
      <style>
        .inscribe-field { margin-bottom: 0.6rem; }
        .inscribe-field label { display:block; font-size:0.82rem; color:var(--terminal-text); margin-bottom:0.25rem; }
      </style>
    `
  }

  private static renderProgress(title: string): string {
    const isInscribe = this.step === 'inscribing'
    const pct = this.chunksTotal ? Math.round((this.chunksDone / this.chunksTotal) * 100) : 0
    return `
      <div class="cc-panel" style="margin-top:1rem">
        <h4 style="margin:0 0 0.75rem;color:var(--terminal-green)">${title}</h4>
        ${this.statusMessage ? `<p style="color:var(--terminal-text);font-size:0.85rem;margin:0 0 0.75rem">${this.escapeHtml(this.statusMessage)}</p>` : ''}
        ${isInscribe ? `
          <div style="background:rgba(255,255,255,0.08);border-radius:4px;height:10px;overflow:hidden">
            <div style="background:var(--terminal-green);height:100%;width:${pct}%;transition:width 0.4s"></div>
          </div>
          <p style="font-size:0.78rem;color:var(--terminal-text);margin:0.5rem 0 0">
            ${this.chunksDone} / ${this.chunksTotal} chunks (${pct}%)
          </p>
        ` : ''}
        ${this.inscription?.mediaTopic ? `<p class="mono" style="font-size:0.75rem;color:var(--terminal-text);margin:0.6rem 0 0">media topic: ${this.inscription.mediaTopic}</p>` : ''}
        ${this.inscription?.metaTopic ? `<p class="mono" style="font-size:0.75rem;color:var(--terminal-text);margin:0.25rem 0 0">metadata topic: ${this.inscription.metaTopic}</p>` : ''}
        ${this.inscription?.registryTopic ? `<p class="mono" style="font-size:0.75rem;color:var(--terminal-text);margin:0.25rem 0 0">registry topic: ${this.inscription.registryTopic}</p>` : ''}
        ${this.error ? `<div class="cc-error-banner" style="margin-top:1rem">✗ ${this.escapeHtml(this.error)}</div>` : ''}
      </div>
    `
  }

  private static renderComplete(): string {
    return `
      <div class="cc-panel" style="margin-top:1rem">
        <h4 style="margin:0 0 0.75rem;color:var(--terminal-green)">✓ Inscription Complete</h4>
        ${this.inscription ? `
          <p class="mono" style="font-size:0.8rem;color:var(--terminal-text);word-break:break-all;margin:0.4rem 0">
            pointer: ${this.escapeHtml(this.inscription.pointer)}
          </p>
          <p class="mono" style="font-size:0.8rem;color:var(--terminal-text);margin:0.4rem 0">
            media topic: ${this.inscription.mediaTopic}
          </p>
          <p class="mono" style="font-size:0.8rem;color:var(--terminal-text);margin:0.4rem 0">
            metadata topic: ${this.inscription.metaTopic}
          </p>
          ${this.inscription.registryTopic ? `<p class="mono" style="font-size:0.8rem;color:var(--terminal-text);margin:0.4rem 0">registry topic: ${this.inscription.registryTopic}</p>` : ''}
        ` : ''}
        ${this.mintedSerials.length ? `
          <p style="color:var(--terminal-text);font-size:0.85rem;margin:0.75rem 0 0">
            Minted serial${this.mintedSerials.length === 1 ? '' : 's'}:
            ${this.mintedSerials.join(', ')}
          </p>
        ` : ''}
        <button id="inscribe-new" class="cc-btn" style="margin-top:1rem">Inscribe Another</button>
      </div>
    `
  }

  private static renderRightPanel(): string {
    if (this.step === 'complete') {
      return `
        <h4 style="color:var(--terminal-green);margin:0 0 0.75rem">On-Chain Manifest</h4>
        ${this.inscription ? `
          <p style="font-size:0.8rem;color:var(--terminal-text);margin:0 0 0.5rem">
            Every byte of this NFT lives on the Hedera ledger. The NFT's on-chain metadata field
            points at <span class="mono">${this.escapeHtml(this.inscription.pointer)}</span> —
            resolvable by HashPack and HCS-1/6-compatible viewers.
          </p>
          <p style="font-size:0.8rem;color:var(--terminal-text);margin:0">
            No IPFS. No gateway. No pinning service. Immutable by design
            ${this.inscription.registryTopic ? ' (updatable via the HCS-6 registry)' : ''}.
          </p>
        ` : ''}
      `
    }
    if (this.previewUrl && this.file) {
      const isVideo = this.file.type.startsWith('video/') || this.prepared?.mime.startsWith('video/')
      return `
        <h4 style="color:var(--terminal-green);margin:0 0 0.75rem">Preview</h4>
        ${isVideo
          ? `<video src="${this.previewUrl}" controls muted style="max-width:100%;border-radius:6px"></video>`
          : `<img src="${this.previewUrl}" alt="preview" style="max-width:100%;border-radius:6px" />`}
        ${this.prepared ? `
          <p class="mono" style="font-size:0.72rem;color:var(--terminal-text);word-break:break-all;margin:0.6rem 0 0">
            sha-256: ${this.prepared.sha256}
          </p>
          <p style="font-size:0.78rem;color:var(--terminal-text);margin:0.4rem 0 0">
            memo will read:<br/><span class="mono">${this.prepared.sha256}:zstd:base64</span>
          </p>
        ` : ''}
      `
    }
    return `
      <h4 style="color:var(--terminal-green);margin:0 0 0.75rem">Hashinal Inscription</h4>
      <p style="font-size:0.8rem;color:var(--terminal-text);margin:0 0 0.5rem">
        Your media is zstd-compressed, base64-encoded and written to a dedicated HCS topic
        in ≤1 KB messages, then read back and hash-verified before minting.
      </p>
      <p style="font-size:0.8rem;color:var(--terminal-text);margin:0">
        Topics are created with a submit key and <strong>no admin key</strong> — the inscription
        can never be altered or deleted.
      </p>
    `
  }

  // ─── INIT / EVENTS ──────────────────────────────────────

  static init(): void {
    const app = document.getElementById('app')
    if (!app) return

    document.getElementById('inscribe-back')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('navigate-to-tool', { detail: { toolId: 'home' } }))
    })

    if (this.step !== 'setup') {
      document.getElementById('inscribe-new')?.addEventListener('click', () => {
        this.resetState()
        this.refresh()
      })
      return
    }

    document.getElementById('inscribe-validate-token')?.addEventListener('click', () => this.validateToken())
    document.getElementById('inscribe-token-id')?.addEventListener('input', (e) => {
      this.tokenIdInput = (e.target as HTMLInputElement).value
    })

    document.getElementById('inscribe-toggle-supply-key')?.addEventListener('click', () => {
      this.supplyKeyRevealed = !this.supplyKeyRevealed
      this.refresh()
    })
    document.getElementById('inscribe-supply-key')?.addEventListener('input', (e) => {
      this.supplyKeyInput = (e.target as HTMLInputElement).value
    })

    // File drop zone
    const drop = document.getElementById('inscribe-drop')
    const input = document.getElementById('inscribe-file-input') as HTMLInputElement | null
    if (drop && input) {
      drop.addEventListener('click', (e) => { if (e.target !== input) input.click() })
      drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag-over') })
      drop.addEventListener('dragleave', () => drop.classList.remove('drag-over'))
      drop.addEventListener('drop', (e) => {
        e.preventDefault()
        drop.classList.remove('drag-over')
        const f = e.dataTransfer?.files?.[0]
        if (f) this.selectFile(f)
      })
      input.addEventListener('change', () => {
        const f = input.files?.[0]
        if (f) this.selectFile(f)
      })
    }

    // Metadata inputs
    document.getElementById('inscribe-name')?.addEventListener('input', (e) => {
      this.name = (e.target as HTMLInputElement).value
    })
    document.getElementById('inscribe-creator')?.addEventListener('input', (e) => {
      this.creator = (e.target as HTMLInputElement).value
    })
    document.getElementById('inscribe-desc')?.addEventListener('input', (e) => {
      this.description = (e.target as HTMLTextAreaElement).value
    })
    document.querySelectorAll('.inscribe-attr-type').forEach(el => {
      el.addEventListener('input', () => {
        const i = parseInt((el as HTMLElement).dataset.index || '0')
        if (this.attributes[i]) this.attributes[i].trait_type = (el as HTMLInputElement).value
      })
    })
    document.querySelectorAll('.inscribe-attr-value').forEach(el => {
      el.addEventListener('input', () => {
        const i = parseInt((el as HTMLElement).dataset.index || '0')
        if (this.attributes[i]) this.attributes[i].value = (el as HTMLInputElement).value
      })
    })
    document.querySelectorAll('.inscribe-attr-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt((btn as HTMLElement).dataset.index || '0')
        this.attributes.splice(i, 1)
        this.refresh()
      })
    })
    document.getElementById('inscribe-add-attr')?.addEventListener('click', () => {
      this.attributes.push({ trait_type: '', value: '' })
      this.refresh()
    })
    document.getElementById('inscribe-copies')?.addEventListener('input', (e) => {
      const v = parseInt((e.target as HTMLInputElement).value)
      if (v >= 1 && v <= 10) this.copies = v
    })
    document.getElementById('inscribe-updatable')?.addEventListener('change', (e) => {
      this.updatable = (e.target as HTMLInputElement).checked
    })

    document.getElementById('inscribe-start')?.addEventListener('click', () => this.start())
  }

  // ─── ACTIONS ────────────────────────────────────────────

  private static async validateToken(): Promise<void> {
    const tokenId = this.tokenIdInput.trim()
    if (!tokenId) { this.tokenError = 'Please enter a Token ID'; this.refresh(); return }
    this.checkingToken = true
    this.tokenError = null
    this.tokenValidated = false
    this.tokenInfo = null
    this.refresh()
    try {
      const res = await fetch(`${MIRROR_NODE_URL}/api/v1/tokens/${tokenId}`)
      if (!res.ok) throw new Error(`Token ${tokenId} not found`)
      const data = await res.json()
      if (data.type !== 'NON_FUNGIBLE_UNIQUE') throw new Error('Not an NFT collection (must be NON_FUNGIBLE_UNIQUE)')
      if (!data.supply_key) throw new Error('This token has no Supply Key — minting is not possible')
      this.tokenInfo = {
        tokenId: data.token_id,
        name: data.name || 'Unnamed',
        symbol: data.symbol || '',
        totalSupply: parseInt(data.total_supply) || 0,
        maxSupply: parseInt(data.max_supply) || 0,
        supplyKey: data.supply_key?.key || null,
        type: data.type,
      }
      this.tokenValidated = true
    } catch (err: any) {
      this.tokenError = err.message || 'Failed to validate token'
    }
    this.checkingToken = false
    this.refresh()
  }

  private static async selectFile(file: File): Promise<void> {
    if (this.previewUrl) URL.revokeObjectURL(this.previewUrl)
    this.file = file
    this.previewUrl = URL.createObjectURL(file)
    this.prepared = null
    this.prepareError = null
    this.preparing = true
    this.refresh()
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch(`${API_BASE_URL}/api/inscribe/prepare`, { method: 'POST', body: formData })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.success) throw new Error(data.error || `Server returned ${res.status}`)
      this.prepared = data
    } catch (err: any) {
      this.prepareError = err.message || 'Failed to prepare file'
      this.file = null
      if (this.previewUrl) { URL.revokeObjectURL(this.previewUrl); this.previewUrl = null }
    }
    this.preparing = false
    this.refresh()
  }

  private static async start(): Promise<void> {
    const ws = WalletConnectService.getState()
    this.error = null
    if (!ws.connected || !ws.accountId) { this.error = 'Wallet not connected'; this.refresh(); return }
    if (!this.tokenInfo) { this.error = 'Validate the collection first'; this.refresh(); return }
    if (!this.prepared) { this.error = 'Choose a media file first'; this.refresh(); return }
    if (!this.name.trim()) { this.error = 'Name is required'; this.refresh(); return }
    if (!this.creator.trim()) { this.error = 'Creator is required'; this.refresh(); return }
    if (!this.supplyKeyInput.trim()) { this.supplyKeyError = 'Supply private key is required'; this.refresh(); return }
    try { PrivateKey.fromString(this.supplyKeyInput.trim()) } catch {
      this.supplyKeyError = 'Invalid supply key format'; this.refresh(); return
    }
    const remaining = this.tokenInfo.maxSupply - this.tokenInfo.totalSupply
    if (this.copies > remaining) { this.error = `Only ${remaining} mints remaining in max supply`; this.refresh(); return }

    this.step = 'inscribing'
    this.statusMessage = 'Calculating total network fees…'
    this.refresh()

    try {
      // Mint-side fee from the existing estimator
      const metadataCIDs = Array(this.copies).fill('hcs://placeholder')
      const feeRes = await fetch(`${API_BASE_URL}/api/calculate-mint-fee`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenId: this.tokenInfo.tokenId, metadataCIDs }),
      })
      const feeData = await feeRes.json()
      if (!feeRes.ok || !feeData.success) throw new Error(feeData.error || 'Fee calculation failed')

      const totalHbar = this.prepared.estCostHbar + feeData.totalFeeWithBuffer
      const feeTinybars = Math.ceil(totalHbar * 1e8)

      this.statusMessage = `Approve ONE transfer of ${totalHbar.toFixed(4)} HBAR — covers inscription (${this.prepared.estCostHbar}) + minting (${feeData.totalFeeWithBuffer})…`
      this.refresh()

      const transferTx = new TransferTransaction()
        .addHbarTransfer(AccountId.fromString(ws.accountId), Hbar.fromTinybars(-feeTinybars))
        .addHbarTransfer(AccountId.fromString(BACKEND_MINTER_ACCOUNT), Hbar.fromTinybars(feeTinybars))
      const signer = WalletConnectService.getSigner(ws.accountId)
      const frozen = await transferTx
        .setTransactionId(TransactionId.generate(AccountId.fromString(ws.accountId)))
        .freezeWith(getHederaClient())
      await frozen.executeWithSigner(signer)

      // 1. Inscribe (media + metadata + optional registry)
      this.statusMessage = 'Writing inscription to Hedera (this can take a few minutes for large files)…'
      this.refresh()
      const attrs = this.attributes.filter(a => a.trait_type.trim() && a.value.trim())
      const startRes = await fetch(`${API_BASE_URL}/api/inscribe/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preparedId: this.prepared.preparedId,
          name: this.name.trim(),
          creator: this.creator.trim(),
          description: this.description.trim(),
          attributes: attrs.length ? attrs : undefined,
          updatable: this.updatable,
        }),
      })
      const startData = await startRes.json()
      if (!startRes.ok || !startData.success) throw new Error(startData.error || 'Failed to start inscription')
      this.inscribeJobId = startData.jobId
      await this.pollInscribe()

      if (!this.inscription?.pointer) throw new Error('Inscription finished without a pointer')

      // 2. Mint through the shared operator pipeline
      this.step = 'minting'
      this.statusMessage = 'Inscription verified on-chain. Minting NFT…'
      this.refresh()
      const mintRes = await fetch(`${API_BASE_URL}/api/mint-nfts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenId: this.tokenInfo.tokenId,
          supplyKey: this.supplyKeyInput.trim(),
          metadataCIDs: Array(this.copies).fill(this.inscription.pointer),
          userAccountId: ws.accountId,
        }),
      })
      const mintData = await mintRes.json()
      if (!mintRes.ok || !mintData.success) throw new Error(mintData.error || 'Minting failed to start')
      this.mintJobId = mintData.jobId
      await this.pollMint()

      this.step = 'complete'
      this.statusMessage = ''
      this.refresh()
    } catch (err: any) {
      console.error('Inscribe error:', err)
      this.error = err.message || 'Inscription failed'
      this.step = 'setup'
      this.refresh()
    }
  }

  private static async pollInscribe(): Promise<void> {
    while (true) {
      const res = await fetch(`${API_BASE_URL}/api/inscribe/status/${this.inscribeJobId}`)
      const data = await res.json()
      if (!data.success) throw new Error(data.error || 'Lost inscription job')
      const job = data.job
      this.chunksDone = job.chunksDone
      this.chunksTotal = job.chunksTotal
      this.statusMessage = job.step || ''
      this.inscription = job.status === 'completed'
        ? { pointer: job.pointer, mediaTopic: job.mediaTopic, metaTopic: job.metaTopic, registryTopic: job.registryTopic }
        : this.inscription
      this.refresh()
      if (job.status === 'completed') return
      if (job.status === 'failed') throw new Error(job.error || 'Inscription failed')
      await new Promise(r => setTimeout(r, 3000))
    }
  }

  private static async pollMint(): Promise<void> {
    while (true) {
      const res = await fetch(`${API_BASE_URL}/api/mint-status/${this.mintJobId}`)
      const data = await res.json()
      if (!data.success) throw new Error(data.error || 'Lost minting job')
      this.statusMessage = `Minting: batch ${data.progress?.currentBatch || 0} of ${data.progress?.totalBatches || 1}`
      this.refresh()
      if (data.status === 'completed') {
        this.mintedSerials = data.progress?.serials || []
        return
      }
      if (data.status === 'failed') throw new Error(data.error || 'Minting failed')
      await new Promise(r => setTimeout(r, 3000))
    }
  }

  // ─── UTIL ───────────────────────────────────────────────

  static resetState(): void {
    if (this.previewUrl) URL.revokeObjectURL(this.previewUrl)
    this.step = 'setup'
    this.error = null
    this.statusMessage = ''
    this.tokenIdInput = ''
    this.tokenInfo = null
    this.tokenValidated = false
    this.tokenError = null
    this.supplyKeyInput = ''
    this.supplyKeyError = null
    this.file = null
    this.previewUrl = null
    this.prepared = null
    this.prepareError = null
    this.name = ''
    this.creator = ''
    this.description = ''
    this.attributes = []
    this.updatable = false
    this.copies = 1
    this.inscribeJobId = null
    this.inscription = null
    this.chunksDone = 0
    this.chunksTotal = 0
    this.mintJobId = null
    this.mintedSerials = []
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

  private static fmtBytes(n: number): string {
    if (n < 1024) return n + ' B'
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
    return (n / (1024 * 1024)).toFixed(2) + ' MB'
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
