/**
 * Update NFT Metadata Tool
 *
 * Updates the on-chain metadata URI of an existing NFT using TokenUpdateNftsTransaction.
 * Requires the collection to have a metadata key and the connected wallet to match it.
 */
import WalletConnectService from '../services/WalletConnectService'
import { API_BASE_URL, MIRROR_NODE_URL, getHederaClient } from '../config'
import {
  TokenId,
  AccountId,
  TransactionId,
  TokenUpdateNftsTransaction,
  Long,
  PrivateKey,
  Client,
} from '@hashgraph/sdk'

interface NftAttribute {
  trait_type: string
  value: string
  display_type?: string
}

interface NftMetadata {
  name: string
  description?: string
  image: string
  creator?: string
  type?: string
  format?: string
  files?: Array<{ uri: string; type: string; is_default_file?: boolean }>
  attributes?: NftAttribute[]
  [key: string]: any
}

type UpdateStep = 'input' | 'loading' | 'edit' | 'signing' | 'success'

export class UpdateNftMetadata {
  private static step: UpdateStep = 'input'
  private static tokenIdInput = ''
  private static serialInput = ''
  private static tokenId = ''
  private static serial = 0
  private static currentMetadataUri = ''
  private static metadata: NftMetadata = {
    name: '',
    image: '',
  }
  private static metadataKey: string | null = null
  private static txId: string | null = null
  private static error: string | null = null
  private static statusMessage = ''
  private static newMetadataCID = ''

  // Private-key signing fallback
  private static usePrivateKey = false
  private static privateKeyInput = ''
  private static privateKeyRevealed = false

  // ─── RENDER ───────────────────────────────────────────────
  static render(): string {
    const ws = WalletConnectService.getState()
    const connected = ws.connected && ws.accountId

    return `
      <div class="terminal-window">
        <div class="window-chrome">
          <div class="window-controls"><div class="window-dot close"></div><div class="window-dot minimize"></div><div class="window-dot maximize"></div></div>
          <div class="window-title">hedera-creator-kit — update nft metadata</div>
        </div>
        <div class="terminal-content">
          <div class="art-gen-layout">
            <div class="art-gen-left">
              <div class="art-gen-section">
                <div class="back-link" id="update-meta-back"><span class="back-arrow">←</span><span>Back</span></div>
                <h3 class="section-title">◆ Update NFT Metadata</h3>
                <p class="cc-hip-badge">⬡ TokenUpdateNftsTransaction</p>
                ${!connected ? this.renderConnectPrompt() : this.renderContent()}
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
      </div>`
  }

  private static renderConnectPrompt(): string {
    return `<div class="error-state"><p class="error-message">Please connect your wallet to update NFT metadata.</p></div>`
  }

  private static renderContent(): string {
    switch (this.step) {
      case 'input': return this.renderInputStep()
      case 'loading': return this.renderLoadingStep()
      case 'edit': return this.renderEditStep()
      case 'signing': return this.renderSigningStep()
      case 'success': return this.renderSuccessStep()
      default: return ''
    }
  }

  private static renderInputStep(): string {
    return `
      <div class="input-group">
        <label for="update-meta-token-id">Token ID <span class="cc-field-hint">e.g. 0.0.10622417</span></label>
        <input type="text" id="update-meta-token-id" class="token-input" placeholder="0.0.xxxxx" value="${this.escapeHtml(this.tokenIdInput)}" />
      </div>
      <div class="input-group">
        <label for="update-meta-serial">Serial Number <span class="cc-field-hint">e.g. 1502</span></label>
        <input type="number" id="update-meta-serial" class="token-input" min="1" placeholder="1502" value="${this.escapeHtml(this.serialInput)}" />
      </div>
      <p style="color:var(--terminal-text-dim);font-size:0.78rem;margin:0.5rem 0 0">
        This tool updates the metadata URI of a single NFT. The collection must have a metadata key and your connected wallet must match it.
      </p>
      <button class="terminal-button" id="update-meta-load" style="margin-top:1rem">LOAD NFT METADATA</button>
      ${this.error ? `<div class="error-state" style="margin-top:0.75rem"><p class="error-message">${this.error}</p></div>` : ''}
    `
  }

  private static renderLoadingStep(): string {
    return `
      <div class="loading-state" style="padding:2rem 0">
        <div class="spinner"></div>
        <p style="margin-top:1rem">${this.statusMessage || 'Loading...'}</p>
      </div>
      ${this.error ? `<div class="error-state" style="margin-top:0.75rem"><p class="error-message">${this.error}</p></div>` : ''}
    `
  }

  private static renderEditStep(): string {
    const attrs = this.metadata.attributes || []
    const attrRows = attrs.map((attr, i) => `
      <div class="cc-royalty-row" data-index="${i}">
        <div class="input-group" style="flex:1"><input type="text" class="token-input update-meta-attr-type" data-index="${i}" placeholder="Trait" value="${this.escapeHtml(attr.trait_type)}" /></div>
        <div class="input-group" style="flex:1"><input type="text" class="token-input update-meta-attr-value" data-index="${i}" placeholder="Value" value="${this.escapeHtml(attr.value)}" /></div>
        <button class="cc-royalty-remove update-meta-attr-remove" data-index="${i}" title="Remove">✕</button>
      </div>
    `).join('')

    return `
      <div class="preview-info" style="margin-bottom:1rem">
        <div class="info-row"><span>Token ID</span><span class="status-value">${this.tokenId}</span></div>
        <div class="info-row"><span>Serial</span><span class="status-value">${this.serial}</span></div>
        <div class="info-row"><span>Current Metadata</span><span class="status-value" style="font-size:0.75rem;word-break:break-all">${this.escapeHtml(this.currentMetadataUri)}</span></div>
      </div>

      <div class="input-group">
        <label for="update-meta-name">Name *</label>
        <input type="text" id="update-meta-name" class="token-input" value="${this.escapeHtml(this.metadata.name)}" />
      </div>
      <div class="input-group">
        <label for="update-meta-description">Description</label>
        <input type="text" id="update-meta-description" class="token-input" value="${this.escapeHtml(this.metadata.description || '')}" />
      </div>
      <div class="input-group">
        <label for="update-meta-creator">Creator</label>
        <input type="text" id="update-meta-creator" class="token-input" value="${this.escapeHtml(this.metadata.creator || '')}" />
      </div>
      <div class="input-group">
        <label for="update-meta-image">Image URI *</label>
        <input type="text" id="update-meta-image" class="token-input" value="${this.escapeHtml(this.metadata.image)}" />
      </div>

      <div style="margin-top:0.5rem">
        <label style="color:var(--terminal-text);font-size:0.9rem;text-transform:uppercase;letter-spacing:0.05em">Attributes <span class="cc-field-hint">optional</span></label>
        ${attrRows ? `<div class="cc-royalty-entries" style="margin-top:0.35rem">${attrRows}</div>` : ''}
        <button class="terminal-button secondary" id="update-meta-add-attr" style="font-size:0.8rem;padding:0.4rem 0.8rem;margin-top:0.35rem">+ ADD ATTRIBUTE</button>
      </div>

      <div class="filter-divider"></div>

      <div class="input-group" style="margin-top:1rem">
        <label>Signing Method</label>
        <div style="display:flex;gap:0.75rem;margin-top:0.35rem;flex-wrap:wrap">
          <label style="display:flex;align-items:center;gap:0.35rem;cursor:pointer;color:var(--terminal-text);font-size:0.85rem">
            <input type="radio" name="update-meta-sign-method" value="wallet" ${!this.usePrivateKey ? 'checked' : ''} />
            WalletConnect
          </label>
          <label style="display:flex;align-items:center;gap:0.35rem;cursor:pointer;color:var(--terminal-text);font-size:0.85rem">
            <input type="radio" name="update-meta-sign-method" value="privatekey" ${this.usePrivateKey ? 'checked' : ''} />
            Private Key (fallback)
          </label>
        </div>
      </div>

      ${this.usePrivateKey ? `
        <div class="input-group" style="margin-top:0.75rem">
          <label for="update-meta-private-key">Metadata Key Private Key <span class="cc-field-hint">never saved or sent</span></label>
          <div style="display:flex;gap:0.5rem">
            <input type="${this.privateKeyRevealed ? 'text' : 'password'}" id="update-meta-private-key" class="token-input" placeholder="Paste the metadata key private key..." value="${this.escapeHtml(this.privateKeyInput)}" style="flex:1;font-family:monospace;font-size:0.85rem" autocomplete="off" />
            <button class="terminal-button small" id="update-meta-toggle-private-key" style="padding:0.4rem 0.6rem">${this.privateKeyRevealed ? 'HIDE' : 'SHOW'}</button>
          </div>
          <p style="color:var(--terminal-text-dim);font-size:0.75rem;margin:0.25rem 0 0">The key stays in your browser memory only long enough to sign. It is never persisted, logged, or sent to the server.</p>
        </div>
      ` : ''}

      <div style="padding:0.6rem 0.8rem;background:rgba(255,193,7,0.08);border:1px solid rgba(255,193,7,0.25);border-radius:6px;margin:1rem 0">
        <p style="font-size:0.78rem;color:var(--warning-yellow);margin:0">⚠️ This will permanently update the on-chain metadata URI for serial ${this.serial}. The old metadata CID will no longer be referenced by this NFT.</p>
      </div>

      <button class="terminal-button" id="update-meta-pin">PIN UPDATED METADATA</button>
      ${this.error ? `<div class="error-state" style="margin-top:0.75rem"><p class="error-message">${this.error}</p></div>` : ''}
    `
  }

  private static renderSigningStep(): string {
    return `
      <div class="loading-state" style="padding:2rem 0">
        <div class="spinner"></div>
        <p style="margin-top:1rem">${this.statusMessage || 'Waiting for wallet signature...'}</p>
      </div>
      ${this.error ? `<div class="error-state" style="margin-top:0.75rem"><p class="error-message">${this.error}</p></div>` : ''}
    `
  }

  private static renderSuccessStep(): string {
    const network = WalletConnectService.getState().network?.toLowerCase() || 'mainnet'
    return `
      <h3 class="section-title">◆ Metadata Updated ✓</h3>
      <div class="preview-info">
        <div class="info-row"><span>Token ID</span><span class="status-value">${this.tokenId}</span></div>
        <div class="info-row"><span>Serial</span><span class="status-value">${this.serial}</span></div>
        <div class="info-row"><span>New Metadata CID</span><span class="status-value" style="font-size:0.75rem;word-break:break-all">${this.escapeHtml(this.newMetadataCID)}</span></div>
      </div>
      <div style="margin-top:1rem;display:flex;gap:0.5rem;flex-wrap:wrap">
        <a class="terminal-button" href="https://hashscan.io/${network}/token/${this.tokenId}?serial=${this.serial}" target="_blank" rel="noopener" style="text-decoration:none">View on HashScan</a>
        <button class="terminal-button secondary" id="update-meta-another">UPDATE ANOTHER</button>
      </div>
    `
  }

  private static renderRightPanel(): string {
    if (this.step === 'edit') {
      return `
        <div class="cc-right-content">
          <h4 class="section-title" style="font-size:0.95rem">Preview</h4>
          <p style="color:var(--terminal-text-dim);font-size:0.85rem">Review the metadata before pinning and signing.</p>
          <div class="preview-info" style="margin-top:0.75rem">
            <div class="info-row"><span>Name</span><span class="status-value">${this.escapeHtml(this.metadata.name)}</span></div>
            <div class="info-row"><span>Image</span><span class="status-value" style="font-size:0.75rem;word-break:break-all">${this.escapeHtml(this.metadata.image)}</span></div>
          </div>
          ${this.metadata.image?.startsWith('ipfs://') || this.metadata.image?.startsWith('http') ? `
            <div style="margin-top:1rem">
              <img src="${this.metadata.image.replace('ipfs://', 'https://ipfs.io/ipfs/')}" class="cc-preview-image" style="max-height:240px;object-fit:contain" alt="NFT preview" />
            </div>
          ` : ''}
        </div>
      `
    }

    return `
      <div class="cc-right-content">
        <h4 class="section-title" style="font-size:0.95rem">About This Tool</h4>
        <p style="color:var(--terminal-text-dim);font-size:0.85rem">
          Use this tool to fix metadata mistakes (like a wrong name) on NFTs that have already been minted.
        </p>
        <div class="result-block" style="margin-top:0.75rem">
          <label>Requirements</label>
          <p style="font-size:0.82rem;color:var(--terminal-text);margin:0.25rem 0 0">✓ Collection must have a metadata key</p>
          <p style="font-size:0.82rem;color:var(--terminal-text);margin:0.25rem 0 0">✓ Connected wallet must match metadata key</p>
          <p style="font-size:0.82rem;color:var(--terminal-text);margin:0.25rem 0 0">✓ Small HBAR fee for the transaction</p>
        </div>
      </div>
    `
  }

  // ─── INIT ─────────────────────────────────────────────────
  static init(): void {
    document.getElementById('update-meta-back')?.addEventListener('click', () => {
      // Clear any private key from memory when leaving the tool
      this.privateKeyInput = ''
      this.privateKeyRevealed = false
      window.dispatchEvent(new CustomEvent('navigate-to-tool', { detail: { toolId: 'home' } }))
    })

    const tokenInput = document.getElementById('update-meta-token-id') as HTMLInputElement | null
    tokenInput?.addEventListener('input', () => { this.tokenIdInput = tokenInput.value })

    const serialInput = document.getElementById('update-meta-serial') as HTMLInputElement | null
    serialInput?.addEventListener('input', () => { this.serialInput = serialInput.value })

    document.getElementById('update-meta-load')?.addEventListener('click', () => this.loadMetadata())

    // Edit step inputs
    const nameInput = document.getElementById('update-meta-name') as HTMLInputElement | null
    nameInput?.addEventListener('input', () => { this.metadata.name = nameInput.value })

    const descInput = document.getElementById('update-meta-description') as HTMLInputElement | null
    descInput?.addEventListener('input', () => { this.metadata.description = descInput.value })

    const creatorInput = document.getElementById('update-meta-creator') as HTMLInputElement | null
    creatorInput?.addEventListener('input', () => { this.metadata.creator = creatorInput.value })

    const imageInput = document.getElementById('update-meta-image') as HTMLInputElement | null
    imageInput?.addEventListener('input', () => { this.metadata.image = imageInput.value; this.refresh() })

    document.querySelectorAll('.update-meta-attr-type').forEach(el => {
      el.addEventListener('input', () => {
        const idx = parseInt((el as HTMLElement).dataset.index || '0')
        if (this.metadata.attributes?.[idx]) this.metadata.attributes[idx].trait_type = (el as HTMLInputElement).value
      })
    })

    document.querySelectorAll('.update-meta-attr-value').forEach(el => {
      el.addEventListener('input', () => {
        const idx = parseInt((el as HTMLElement).dataset.index || '0')
        if (this.metadata.attributes?.[idx]) this.metadata.attributes[idx].value = (el as HTMLInputElement).value
      })
    })

    document.querySelectorAll('.update-meta-attr-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt((btn as HTMLElement).dataset.index || '0')
        this.metadata.attributes?.splice(idx, 1)
        this.refresh()
      })
    })

    document.getElementById('update-meta-add-attr')?.addEventListener('click', () => {
      if (!this.metadata.attributes) this.metadata.attributes = []
      this.metadata.attributes.push({ trait_type: '', value: '' })
      this.refresh()
    })

    document.getElementById('update-meta-pin')?.addEventListener('click', () => this.pinAndUpdate())
    document.getElementById('update-meta-another')?.addEventListener('click', () => {
      this.resetState()
      this.refresh()
    })

    // Signing method radios
    document.querySelectorAll('input[name="update-meta-sign-method"]').forEach((radio) => {
      radio.addEventListener('change', (e) => {
        this.usePrivateKey = (e.target as HTMLInputElement).value === 'privatekey'
        this.refresh()
      })
    })

    // Private key input
    const privateKeyInput = document.getElementById('update-meta-private-key') as HTMLInputElement | null
    privateKeyInput?.addEventListener('input', () => {
      this.privateKeyInput = privateKeyInput.value
    })

    // Private key show/hide toggle
    document.getElementById('update-meta-toggle-private-key')?.addEventListener('click', () => {
      this.privateKeyRevealed = !this.privateKeyRevealed
      this.refresh()
    })
  }

  private static refresh(): void {
    const app = document.querySelector<HTMLDivElement>('#app')!
    app.innerHTML = this.render()
    this.init()
  }

  // ─── LOAD METADATA ────────────────────────────────────────
  private static async loadMetadata(): Promise<void> {
    const ws = WalletConnectService.getState()
    if (!ws.connected || !ws.accountId) {
      this.error = 'Wallet not connected'
      this.refresh()
      return
    }

    const tokenId = this.tokenIdInput.trim()
    const serial = parseInt(this.serialInput.trim())

    if (!tokenId) {
      this.error = 'Please enter a Token ID'
      this.refresh()
      return
    }
    if (!serial || serial < 1) {
      this.error = 'Please enter a valid serial number'
      this.refresh()
      return
    }

    this.step = 'loading'
    this.error = null
    this.statusMessage = 'Fetching NFT info from mirror node...'
    this.refresh()

    try {
      // 1. Fetch token info to check metadata key
      const tokenRes = await fetch(`${MIRROR_NODE_URL}/api/v1/tokens/${tokenId}`)
      if (!tokenRes.ok) throw new Error(`Token ${tokenId} not found`)
      const tokenData = await tokenRes.json()

      if (tokenData.type !== 'NON_FUNGIBLE_UNIQUE') {
        throw new Error('This token is not an NFT collection')
      }

      this.metadataKey = tokenData.metadata_key?.key || null
      if (!this.metadataKey) {
        throw new Error('This collection does not have a metadata key — metadata cannot be updated')
      }

      // 2. Verify connected wallet matches metadata key
      const accountRes = await fetch(`${MIRROR_NODE_URL}/api/v1/accounts/${ws.accountId}`)
      if (!accountRes.ok) throw new Error('Could not fetch wallet account info')
      const accountData = await accountRes.json()
      const walletKey = accountData.key?.key

      if (walletKey !== this.metadataKey) {
        throw new Error('Your connected wallet is not the metadata key for this collection')
      }

      // 3. Fetch NFT info
      this.statusMessage = 'Fetching current metadata...'
      this.refresh()

      const nftRes = await fetch(`${MIRROR_NODE_URL}/api/v1/tokens/${tokenId}/nfts/${serial}`)
      if (!nftRes.ok) throw new Error(`Serial ${serial} not found for token ${tokenId}`)
      const nftData = await nftRes.json()

      // nftData.account_id available if needed later
      const metadataBytes = nftData.metadata
      if (!metadataBytes) throw new Error('No metadata found for this NFT')

      this.currentMetadataUri = this.base64Decode(metadataBytes)

      // 4. Fetch metadata JSON from IPFS
      this.statusMessage = 'Fetching metadata JSON from IPFS...'
      this.refresh()

      const metaUrl = this.currentMetadataUri.replace('ipfs://', 'https://ipfs.io/ipfs/')
      const metaRes = await fetch(metaUrl)
      if (!metaRes.ok) throw new Error('Could not fetch metadata from IPFS')
      const metaJson = await metaRes.json()

      this.metadata = { ...metaJson }
      this.tokenId = tokenId
      this.serial = serial

      this.step = 'edit'
      this.statusMessage = ''
      this.refresh()
    } catch (err: any) {
      this.step = 'input'
      this.error = err.message || 'Failed to load NFT metadata'
      this.statusMessage = ''
      this.refresh()
    }
  }

  // ─── PIN AND UPDATE ───────────────────────────────────────
  private static async pinAndUpdate(): Promise<void> {
    const ws = WalletConnectService.getState()
    if (!ws.connected || !ws.accountId) {
      this.error = 'Wallet not connected'
      this.refresh()
      return
    }

    if (!this.metadata.name.trim()) {
      this.error = 'Name is required'
      this.refresh()
      return
    }
    if (!this.metadata.image.trim()) {
      this.error = 'Image URI is required'
      this.refresh()
      return
    }

    this.step = 'signing'
    this.error = null
    this.statusMessage = 'Pinning updated metadata to IPFS...'
    this.refresh()

    try {
      // 1. Pin updated metadata JSON
      const pinRes = await fetch(`${API_BASE_URL}/api/pin-metadata-json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metadata: this.metadata,
          label: `${this.metadata.name} - Updated Metadata`,
        }),
      })

      const pinText = await pinRes.text()
      let pinData: any
      try { pinData = JSON.parse(pinText) } catch { throw new Error(`Server returned ${pinRes.status}: ${pinText || 'empty response'}`) }
      if (!pinData.success) throw new Error(pinData.error || 'Failed to pin metadata')

      this.newMetadataCID = pinData.metadataCID
      const newMetadataUri = pinData.tokenURI

      // 2. Build and sign TokenUpdateNftsTransaction
      this.statusMessage = 'Waiting for wallet approval to update metadata...'
      this.refresh()

      const accountId = ws.accountId
      const tokenId = TokenId.fromString(this.tokenId)

      const updateTx = new TokenUpdateNftsTransaction()
        .setTokenId(tokenId)
        .setSerialNumbers([Long.fromNumber(this.serial)])
        .setMetadata(new TextEncoder().encode(newMetadataUri))

      const signer = WalletConnectService.getSigner(accountId)
      const acctId = AccountId.fromString(accountId)
      const frozenTx = await updateTx
        .setTransactionId(TransactionId.generate(acctId))
        .freezeWith(getHederaClient())

      // Sign and submit the update transaction
      let txResponse
      if (this.usePrivateKey) {
        if (!this.privateKeyInput.trim()) {
          throw new Error('Private key is required when using private-key signing')
        }

        this.statusMessage = 'Signing transaction locally with private key...'
        this.refresh()

        const client = Client.forMainnet()
        const privateKey = PrivateKey.fromString(this.privateKeyInput.trim())
        client.setOperator(acctId, privateKey)

        // Clear the key from our state now that it has been loaded into the
        // local SDK client. It is never logged, persisted, or sent anywhere.
        this.privateKeyInput = ''
        this.privateKeyRevealed = false

        txResponse = await frozenTx.execute(client)
      } else {
        // WalletConnect path (currently unsupported by HashPack for this tx type)
        this.statusMessage = 'Waiting for wallet signature...'
        this.refresh()
        const signedTx = await signer.signTransaction(frozenTx)

        this.statusMessage = 'Submitting signed transaction...'
        this.refresh()
        txResponse = await signedTx.execute(getHederaClient())
      }
      this.txId = txResponse.transactionId?.toString() || null

      this.statusMessage = 'Transaction submitted. Confirming...'
      this.refresh()

      // 3. Poll mirror node for confirmation
      await this.pollForConfirmation()

      this.step = 'success'
      this.statusMessage = ''
      this.refresh()
    } catch (err: any) {
      this.step = 'edit'
      this.error = err.message || 'Failed to update metadata'
      this.statusMessage = ''
      this.refresh()
    }
  }

  private static async pollForConfirmation(): Promise<void> {
    if (!this.txId) return
    const formattedId = this.txId.replace('@', '-')

    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 3000))
      try {
        const res = await fetch(`${MIRROR_NODE_URL}/api/v1/transactions/${formattedId}`)
        if (res.ok) {
          const data = await res.json()
          const tx = data.transactions?.[0]
          if (tx?.result === 'SUCCESS') return
          if (tx?.result && tx.result !== 'SUCCESS') throw new Error(`Transaction failed: ${tx.result}`)
        }
      } catch (err: any) {
        if (err.message?.includes('Transaction failed')) throw err
      }
    }

    throw new Error('Timed out waiting for transaction confirmation. Check HashScan for status.')
  }

  // ─── HELPERS ──────────────────────────────────────────────
  private static base64Decode(str: string): string {
    try {
      if (typeof window !== 'undefined') {
        return decodeURIComponent(escape(window.atob(str)))
      }
      return Buffer.from(str, 'base64').toString('utf8')
    } catch {
      return str
    }
  }

  private static escapeHtml(str: string): string {
    if (!str) return ''
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
  }

  static resetState(): void {
    this.step = 'input'
    this.tokenIdInput = ''
    this.serialInput = ''
    this.tokenId = ''
    this.serial = 0
    this.currentMetadataUri = ''
    this.metadata = { name: '', image: '' }
    this.metadataKey = null
    this.txId = null
    this.error = null
    this.statusMessage = ''
    this.newMetadataCID = ''
    this.usePrivateKey = false
    this.privateKeyInput = ''
    this.privateKeyRevealed = false
  }
}
