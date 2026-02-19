/**
 * Update Token Icon Component
 * Updates a token's metadata/icon on Hedera via TokenUpdateTransaction + WalletConnect signing
 */
import WalletConnectService from '../services/WalletConnectService'
import { API_BASE_URL, MIRROR_NODE_URL, getHederaClient } from '../config'
import {
  TokenUpdateTransaction,
  TokenId,
  AccountId,
  TransactionId,
} from '@hashgraph/sdk'

type UpdateStep = 'form' | 'updating' | 'success';

export class UpdateTokenIcon {
  // Form state
  private static tokenIdInput = '';
  private static tokenValidated = false;
  private static tokenInfo: { tokenId: string; name: string; symbol: string; type: string; metadataKey: string | null; currentMetadata: string | null } | null = null;
  private static tokenError: string | null = null;

  // Image upload
  private static imageFile: File | null = null;
  private static imagePreview: string | null = null;

  // UI state
  private static step: UpdateStep = 'form';
  private static loading = false;
  private static error: string | null = null;
  private static statusMessage = '';

  // Result
  private static txId: string | null = null;

  static render(): string {
    return `<div class="terminal-window">${this.renderChrome()}${this.renderContent()}${this.renderStatusBar()}</div>`;
  }

  private static renderChrome(): string {
    return `<div class="window-chrome"><div class="window-controls"><div class="window-dot close"></div><div class="window-dot minimize"></div><div class="window-dot maximize"></div></div><div class="window-title">hedera-creator-kit — update token icon</div></div>`;
  }

  private static renderStatusBar(): string {
    const ws = WalletConnectService.getState();
    const walletInfo = ws.connected ? `${ws.accountId} | ${ws.hbarBalance || '0'} ℏ` : 'Not Connected';
    return `<div class="status-bar"><div class="status-left"><div class="status-item"><div class="status-indicator"></div><span>${walletInfo}</span></div></div><div class="status-center"><span class="status-highlight">${this.statusMessage}</span></div><div class="status-right"><div class="status-item"><span>Update Token Icon</span></div></div></div>`;
  }

  private static renderContent(): string {
    return `<div class="terminal-content"><div class="art-gen-layout"><div class="art-gen-left">${this.renderLeftPanel()}</div><div class="art-gen-right">${this.renderRightPanel()}</div></div></div>`;
  }

  private static renderLeftPanel(): string {
    if (this.loading) {
      return `<div class="art-gen-section"><h3 class="section-title">◆ Updating Token</h3><div class="loading-state"><div class="spinner"></div><p>${this.statusMessage || 'Processing...'}</p></div></div>`;
    }
    switch (this.step) {
      case 'form': return this.renderForm();
      case 'success': return this.renderSuccessPanel();
      default: return '';
    }
  }

  private static renderRightPanel(): string {
    if (this.loading) {
      return `<div class="loading-state"><div class="spinner"></div><p>${this.statusMessage || 'Processing...'}</p></div>`;
    }
    if (this.error) {
      return `<div class="cc-right-content"><div class="error-state"><p class="error-message">⚠ ${this.error}</p><button class="terminal-button" id="uti-dismiss-error" style="margin-top:1rem">DISMISS</button></div></div>`;
    }
    switch (this.step) {
      case 'form': return this.renderPreview();
      case 'success': return this.renderSuccessDetails();
      default: return '';
    }
  }

  // --- FORM ---
  private static renderForm(): string {
    const tokenValid = this.tokenValidated && this.tokenInfo;
    return `
      <div class="art-gen-section">
        <h3 class="section-title">◆ Update Token Icon</h3>
        <div class="back-link" id="uti-back"><span class="back-arrow">←</span><span>Back</span></div>

        <div style="margin:0.75rem 0;padding:0.6rem 0.8rem;background:rgba(240,160,64,0.08);border:1px solid rgba(240,160,64,0.25);border-radius:6px">
          <p style="font-size:0.78rem;color:#f0a040;margin:0 0 0.35rem">⚠ <strong>Metadata Key Required</strong> — You can only update a token's icon if the token was created with a Metadata Key and your wallet holds that key.</p>
          <p style="font-size:0.78rem;color:#f0a040;margin:0">⏳ <strong>Wallet Cache</strong> — Changes are on graph immediately, but wallets (HashPack, Kabila) may take minutes to hours to display the new image due to caching.</p>
        </div>

        <div class="filter-divider"></div>

        <div class="input-group">
          <label for="uti-token-id">Token ID *</label>
          <div class="input-row" style="gap:0.5rem">
            <input type="text" id="uti-token-id" class="token-input" placeholder="0.0.xxxxx" value="${this.escapeHtml(this.tokenIdInput)}" style="flex:1" />
            <button class="terminal-button" id="uti-validate" style="white-space:nowrap">${this.loading ? '...' : 'VALIDATE'}</button>
          </div>
          ${this.tokenError ? `<p style="font-size:0.78rem;color:#ff6b6b;margin:0.35rem 0 0">${this.tokenError}</p>` : ''}
          ${tokenValid ? `<p style="font-size:0.78rem;color:#6bff9e;margin:0.35rem 0 0">✓ ${this.tokenInfo!.name} (${this.tokenInfo!.symbol}) — Metadata Key found</p>` : ''}
        </div>

        ${tokenValid ? this.renderImageUpload() : ''}

        ${tokenValid && this.imageFile ? `
          <div class="filter-divider"></div>
          <button class="terminal-button" id="uti-update-btn">⚡ UPDATE TOKEN ICON</button>
        ` : ''}
      </div>`;
  }

  private static renderImageUpload(): string {
    return `
      <div class="filter-divider"></div>
      <div class="input-group">
        <label>New Token Image *</label>
        <div class="cc-image-upload" id="uti-image-zone">
          ${this.imagePreview
            ? `<img src="${this.imagePreview}" class="cc-image-thumb" /><span class="cc-image-name">${this.imageFile?.name || 'image'}</span><button class="cc-image-remove" id="uti-image-remove">✕</button>`
            : `<span class="cc-image-placeholder">📷 Click to upload</span>`}
          <input type="file" id="uti-image-input" accept="image/*" style="display:none" />
        </div>
      </div>`;
  }

  // --- PREVIEW (right panel) ---
  private static renderPreview(): string {
    if (!this.tokenValidated || !this.tokenInfo) {
      return `<div class="cc-right-content"><h4 class="section-title" style="font-size:0.95rem">Token Preview</h4><p style="font-size:0.82rem;color:var(--terminal-text);opacity:0.5">Enter a Token ID and click VALIDATE to see token details.</p></div>`;
    }
    return `
      <div class="cc-right-content">
        <h4 class="section-title" style="font-size:0.95rem">Token Preview</h4>
        ${this.imagePreview ? `<div style="text-align:center;margin-bottom:1rem"><img src="${this.imagePreview}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;border:2px solid var(--terminal-purple)" /></div>` : ''}
        <div class="preview-info">
          <div class="info-row"><span>Token ID</span><span class="status-value">${this.tokenInfo.tokenId}</span></div>
          <div class="info-row"><span>Name</span><span class="status-value">${this.tokenInfo.name}</span></div>
          <div class="info-row"><span>Symbol</span><span class="status-value">${this.tokenInfo.symbol}</span></div>
          <div class="info-row"><span>Type</span><span class="status-value">${this.tokenInfo.type === 'FUNGIBLE_COMMON' ? 'Fungible' : 'NFT Collection'}</span></div>
          <div class="info-row"><span>Metadata Key</span><span class="status-value" style="color:#6bff9e">✓ Present</span></div>
        </div>
        ${this.imageFile ? `<div class="result-block" style="margin-top:0.75rem"><label>New Image</label><p style="font-size:0.82rem;color:var(--terminal-text);margin:0">${this.imageFile.name} (${(this.imageFile.size / 1024).toFixed(1)} KB)</p></div>` : ''}
      </div>`;
  }

  // --- SUCCESS PANELS ---
  private static renderSuccessPanel(): string {
    return `
      <div class="art-gen-section">
        <h3 class="section-title">◆ Token Icon Updated ✓</h3>
        <div class="back-link" id="uti-back"><span class="back-arrow">←</span><span>Back to Home</span></div>
        <div class="preview-info">
          <div class="info-row"><span>Token ID</span><span class="status-value">${this.tokenInfo?.tokenId || '—'}</span></div>
          <div class="info-row"><span>Name</span><span class="status-value">${this.tokenInfo?.name || '—'}</span></div>
          <div class="info-row"><span>Symbol</span><span class="status-value">${this.tokenInfo?.symbol || '—'}</span></div>
        </div>
        <button class="terminal-button" id="uti-new" style="margin-top:1rem">UPDATE ANOTHER TOKEN</button>
      </div>`;
  }

  private static renderSuccessDetails(): string {
    const network = WalletConnectService.getState().network?.toLowerCase() || 'mainnet';
    return `
      <div class="cc-right-content">
        <h4 class="section-title" style="font-size:0.95rem">🎉 Success!</h4>
        ${this.imagePreview ? `<div style="text-align:center;margin-bottom:1rem"><img src="${this.imagePreview}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;border:2px solid var(--terminal-purple)" /></div>` : ''}
        <div class="result-block">
          <label>Token ID</label>
          <code class="cid-value" style="font-size:1.1rem">${this.tokenInfo?.tokenId}</code>
        </div>
        ${this.txId ? `<div class="result-block" style="margin-top:0.75rem"><label>Transaction ID</label><code class="cid-value" style="font-size:0.82rem">${this.txId}</code></div>` : ''}
        <div class="result-block" style="margin-top:0.75rem">
          <label>View on HashScan</label>
          <a class="cid-link" href="https://hashscan.io/${network}/token/${this.tokenInfo?.tokenId}" target="_blank" rel="noopener">https://hashscan.io/${network}/token/${this.tokenInfo?.tokenId}</a>
        </div>
        <div class="result-block" style="margin-top:0.75rem">
          <label>Note</label>
          <p style="font-size:0.82rem;color:#f0a040;margin:0">⏳ Wallets may take several minutes to hours to display the new image due to caching. The change is already on graph.</p>
        </div>
      </div>`;
  }

  // --- HELPERS ---
  private static escapeHtml(s: string): string {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  private static refresh(): void {
    const leftPanel = document.querySelector('.art-gen-left');
    const scrollTop = leftPanel?.scrollTop ?? 0;
    const app = document.querySelector<HTMLDivElement>('#app')!;
    app.innerHTML = this.render();
    this.init();
    const newLeftPanel = document.querySelector('.art-gen-left');
    if (newLeftPanel) newLeftPanel.scrollTop = scrollTop;
  }

  private static resetForm(): void {
    this.tokenIdInput = '';
    this.tokenValidated = false;
    this.tokenInfo = null;
    this.tokenError = null;
    this.imageFile = null;
    this.imagePreview = null;
    this.step = 'form';
    this.loading = false;
    this.error = null;
    this.statusMessage = '';
    this.txId = null;
  }

  // --- INIT: wire up event listeners ---
  static init(): void {
    // Back button
    document.getElementById('uti-back')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('navigate-to-tool', { detail: { toolId: 'home' } }));
    });

    // Token ID input
    const tokenInput = document.getElementById('uti-token-id') as HTMLInputElement;
    tokenInput?.addEventListener('input', () => { this.tokenIdInput = tokenInput.value; });
    tokenInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.validateToken(); });

    // Validate button
    document.getElementById('uti-validate')?.addEventListener('click', () => this.validateToken());

    // Image upload
    const imageZone = document.getElementById('uti-image-zone');
    const imageInput = document.getElementById('uti-image-input') as HTMLInputElement;
    imageZone?.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.id !== 'uti-image-remove') imageInput?.click();
    });
    imageInput?.addEventListener('change', () => {
      const file = imageInput.files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = () => { this.imageFile = file; this.imagePreview = reader.result as string; this.refresh(); };
        reader.readAsDataURL(file);
      }
    });
    document.getElementById('uti-image-remove')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.imageFile = null;
      this.imagePreview = null;
      this.refresh();
    });

    // Update button
    document.getElementById('uti-update-btn')?.addEventListener('click', () => { this.updateTokenIcon(); });

    // Dismiss error
    document.getElementById('uti-dismiss-error')?.addEventListener('click', () => { this.error = null; this.refresh(); });

    // New update button (from success screen)
    document.getElementById('uti-new')?.addEventListener('click', () => { this.resetForm(); this.refresh(); });
  }

  // --- TOKEN VALIDATION ---
  private static async validateToken(): Promise<void> {
    const tokenId = this.tokenIdInput.trim();
    if (!tokenId) {
      this.tokenError = 'Please enter a Token ID';
      this.refresh();
      return;
    }

    this.loading = true;
    this.tokenError = null;
    this.tokenValidated = false;
    this.tokenInfo = null;
    this.refresh();

    try {
      const res = await fetch(`${MIRROR_NODE_URL}/api/v1/tokens/${tokenId}`);
      if (!res.ok) throw new Error(`Token ${tokenId} not found`);
      const data = await res.json();

      if (!data.metadata_key) {
        throw new Error('This token has no Metadata Key — its metadata/icon cannot be updated.');
      }

      // Check if connected wallet's public key matches metadata key
      const ws = WalletConnectService.getState();
      if (ws.accountId) {
        const acctRes = await fetch(`${MIRROR_NODE_URL}/api/v1/accounts/${ws.accountId}`);
        if (acctRes.ok) {
          const acctData = await acctRes.json();
          const walletKey = acctData.key?.key;
          const metadataKey = data.metadata_key?.key;
          if (walletKey && metadataKey && walletKey !== metadataKey) {
            throw new Error(`Your wallet's public key does not match this token's Metadata Key. You cannot update its icon.`);
          }
        }
      }

      this.tokenInfo = {
        tokenId: data.token_id,
        name: data.name || 'Unnamed',
        symbol: data.symbol || '',
        type: data.type || 'FUNGIBLE_COMMON',
        metadataKey: data.metadata_key?.key || null,
        currentMetadata: data.metadata || null,
      };
      this.tokenValidated = true;
      this.tokenError = null;
    } catch (err: any) {
      this.tokenError = err.message || 'Failed to validate token';
      this.tokenValidated = false;
      this.tokenInfo = null;
    }

    this.loading = false;
    this.refresh();
  }

  // --- UPDATE TRANSACTION ---
  private static async updateTokenIcon(): Promise<void> {
    if (!this.tokenValidated || !this.tokenInfo || !this.imageFile) return;
    this.loading = true;
    this.error = null;
    this.statusMessage = 'Preparing update...';
    this.refresh();

    try {
      const ws = WalletConnectService.getState();
      if (!ws.connected || !ws.accountId) throw new Error('Wallet not connected');
      const accountId = ws.accountId;

      // 1. Pin new image + metadata to IPFS
      this.statusMessage = 'Pinning new image to IPFS...';
      this.refresh();
      const metadataBytes = await this.pinTokenMetadata();

      // 2. Build TokenUpdateTransaction
      this.statusMessage = 'Building transaction...';
      this.refresh();

      const tx = new TokenUpdateTransaction()
        .setTokenId(TokenId.fromString(this.tokenInfo.tokenId))
        .setMetadata(metadataBytes);

      // 3. Freeze & execute via WalletConnect
      this.statusMessage = 'Waiting for wallet approval...';
      this.refresh();

      const signer = WalletConnectService.getSigner(accountId);
      const acctId = AccountId.fromString(accountId);
      tx.setTransactionId(TransactionId.generate(acctId));
      tx.freezeWith(getHederaClient());
      const txResponse = await tx.executeWithSigner(signer);

      this.statusMessage = 'Confirming on network...';
      this.refresh();

      // Store transaction ID
      this.txId = txResponse?.transactionId?.toString() || null;

      // Wait a moment for network confirmation
      await new Promise(r => setTimeout(r, 3000));

      this.step = 'success';
      this.loading = false;
      this.statusMessage = `Token icon updated for ${this.tokenInfo.tokenId}`;
      this.refresh();
    } catch (err: any) {
      console.error('Update token icon error:', err);
      this.loading = false;
      this.error = err.message || 'Failed to update token icon';
      this.statusMessage = '';
      this.refresh();
    }
  }

  // Pin token image + metadata to IPFS via backend (reuses collection metadata endpoint)
  private static async pinTokenMetadata(): Promise<Uint8Array> {
    const formData = new FormData();
    if (this.imageFile) formData.append('logo', this.imageFile);
    if (this.tokenInfo?.name) formData.append('collectionName', this.tokenInfo.name);

    const res = await fetch(`${API_BASE_URL}/api/pin-collection-metadata`, {
      method: 'POST',
      body: formData,
    });

    const text = await res.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Server returned ${res.status}: ${text || 'empty response'}`);
    }
    if (!data.success || !data.metadataURI) throw new Error(data.error || 'Failed to pin metadata');
    return new TextEncoder().encode(data.metadataURI);
  }
}
