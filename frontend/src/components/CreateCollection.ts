/**
 * Create Collection Component
 * Creates an NFT collection on Hedera via TokenCreateTransaction + WalletConnect signing
 */
import WalletConnectService from '../services/WalletConnectService'
import {
  TokenCreateTransaction,
  TokenType,
  TokenSupplyType,
  CustomRoyaltyFee,
  CustomFixedFee,
  Hbar,
  AccountId,
  PublicKey,
  Client,
  TransactionId,
} from '@hashgraph/sdk'

interface RoyaltyEntry { wallet: string; percentage: number; }
interface SocialEntry { label: string; url: string; info: string; }
type CreateStep = 'form' | 'creating' | 'success';

const API_BASE = 'http://localhost:3001';
const MIRROR_NODE_URL = 'https://mainnet-public.mirrornode.hedera.com';

const SOCIAL_PLATFORMS = ['Discord', 'Twitter', 'LinkedIn', 'Reddit', 'Telegram', 'Facebook', 'YouTube', 'Other'];

export class CreateCollection {
  // Form state — required
  private static collectionName = '';
  private static symbol = '';
  private static maxSupply = 10000;

  // HIP-766 metadata fields — all optional
  private static description = '';
  private static creator = '';

  private static website = '';
  private static discussion = '';
  private static whitepaper = '';

  // HIP-766 images — single set (used for both light/dark)
  private static logoFile: File | null = null;
  private static logoPreview: string | null = null;
  private static bannerFile: File | null = null;
  private static bannerPreview: string | null = null;
  private static featuredImageFile: File | null = null;
  private static featuredImagePreview: string | null = null;

  // HIP-766 socials — array of { label, url, info }
  private static socialsEnabled = false;
  private static socialEntries: SocialEntry[] = [{ label: 'Discord', url: '', info: '' }];

  // Royalties
  private static royaltiesEnabled = false;
  private static royaltyEntries: RoyaltyEntry[] = [{ wallet: '', percentage: 5 }];

  // Trade fee — OFF by default, only visible when royalties ON
  private static tradeFeeEnabled = false;
  private static tradeFeeAmount = 1;

  // Token keys — user selects which to include
  private static keyAdmin = true;
  private static keySupply = true;
  private static keyMetadata = true;
  private static keyFreeze = false;
  private static keyWipe = false;
  private static keyPause = false;
  private static keyFeeSchedule = false;

  // UI state
  private static step: CreateStep = 'form';
  private static loading = false;
  private static error: string | null = null;
  private static statusMessage = '';

  // Result
  private static tokenId: string | null = null;

  static render(): string {
    return `<div class="terminal-window">${this.renderChrome()}${this.renderContent()}${this.renderStatusBar()}</div>`;
  }

  private static renderChrome(): string {
    return `<div class="window-chrome"><div class="window-controls"><div class="window-dot close"></div><div class="window-dot minimize"></div><div class="window-dot maximize"></div></div><div class="window-title">hedera-creator-kit — create collection</div></div>`;
  }

  private static renderStatusBar(): string {
    const ws = WalletConnectService.getState();
    const walletInfo = ws.connected ? `${ws.accountId} | ${ws.hbarBalance || '0'} ℏ` : 'Not Connected';
    return `<div class="status-bar"><div class="status-left"><div class="status-item"><div class="status-indicator"></div><span>${walletInfo}</span></div></div><div class="status-center"><span class="status-highlight">${this.statusMessage}</span></div><div class="status-right"><div class="status-item"><span>Create Collection</span></div></div></div>`;
  }

  private static renderContent(): string {
    return `<div class="terminal-content"><div class="art-gen-layout"><div class="art-gen-left">${this.renderLeftPanel()}</div><div class="art-gen-right">${this.renderRightPanel()}</div></div></div>`;
  }

  private static renderLeftPanel(): string {
    if (this.loading) {
      return `<div class="art-gen-section"><h3 class="section-title">◆ Creating Collection</h3><div class="loading-state"><div class="spinner"></div><p>${this.statusMessage || 'Processing...'}</p></div></div>`;
    }
    switch (this.step) {
      case 'form': return this.renderForm();
      case 'creating': return this.renderForm(); // shouldn't hit this
      case 'success': return this.renderSuccessPanel();
      default: return '';
    }
  }

  private static renderRightPanel(): string {
    if (this.loading) {
      return `<div class="loading-state"><div class="spinner"></div><p>${this.statusMessage || 'Processing...'}</p></div>`;
    }
    if (this.error) {
      return `<div class="cc-right-content"><div class="error-state"><p class="error-message">⚠ ${this.error}</p><button class="terminal-button" id="cc-dismiss-error" style="margin-top:1rem">DISMISS</button></div></div>`;
    }
    switch (this.step) {
      case 'form': return this.renderPreview();
      case 'success': return this.renderSuccessDetails();
      default: return '';
    }
  }

  // --- FORM ---
  private static renderForm(): string {
    return `
      <div class="art-gen-section">
        <h3 class="section-title">◆ Create Collection</h3>
        <div class="back-link" id="cc-back"><span class="back-arrow">←</span><span>Back</span></div>

        <div class="input-group">
          <label for="cc-name">Collection Name *</label>
          <input type="text" id="cc-name" class="token-input" placeholder="My NFT Collection" value="${this.escapeHtml(this.collectionName)}" />
        </div>
        <div class="input-row">
          <div class="input-group"><label for="cc-symbol">Symbol *</label><input type="text" id="cc-symbol" class="token-input" placeholder="MYNFT" value="${this.escapeHtml(this.symbol)}" /></div>
          <div class="input-group"><label for="cc-supply">Max Supply *</label><input type="number" id="cc-supply" class="token-input" min="1" max="5000000" value="${this.maxSupply}" /></div>
        </div>

        <div class="filter-divider"></div>
        <p class="cc-hip-badge">⬡ HIP-766 Collection Metadata <span class="cc-hip-optional">(all fields optional)</span></p>

        <div class="input-group">
          <label for="cc-desc">Description <span class="cc-field-hint">max 500 chars</span></label>
          <textarea id="cc-desc" class="token-input cc-textarea" placeholder="Describe your collection and project" maxlength="500">${this.escapeHtml(this.description)}</textarea>
        </div>

        <div class="input-row">
          <div class="input-group"><label for="cc-creator">Creator</label><input type="text" id="cc-creator" class="token-input" placeholder="Studio / artist name" value="${this.escapeHtml(this.creator)}" /></div>
          <div class="input-group"><label for="cc-website">Website</label><input type="text" id="cc-website" class="token-input" placeholder="https://example.com" value="${this.escapeHtml(this.website)}" /></div>
        </div>
        <div class="input-row">
          <div class="input-group"><label for="cc-discussion">Discussion / Discord</label><input type="text" id="cc-discussion" class="token-input" placeholder="https://discord.gg/..." value="${this.escapeHtml(this.discussion)}" /></div>
          <div class="input-group"><label for="cc-whitepaper">Whitepaper</label><input type="text" id="cc-whitepaper" class="token-input" placeholder="https://..." value="${this.escapeHtml(this.whitepaper)}" /></div>
        </div>


        <div class="filter-divider"></div>
        <h4 class="cc-sub-heading">Collection Images</h4>

        ${this.renderImageUpload('logo', 'Logo', '350×350 recommended', this.logoPreview, this.logoFile)}
        ${this.renderImageUpload('banner', 'Banner', '2800×1000 recommended', this.bannerPreview, this.bannerFile)}
        ${this.renderImageUpload('featuredImage', 'Featured Image', '600×400 recommended', this.featuredImagePreview, this.featuredImageFile)}

        <div class="filter-divider"></div>
        ${this.renderSocialsSection()}

        <div class="filter-divider"></div>
        ${this.renderRoyaltiesSection()}

        <div class="filter-divider"></div>
        ${this.renderKeysSection()}

        <div class="filter-divider"></div>
        <button class="terminal-button" id="cc-create-btn" ${!this.canCreate() ? 'disabled' : ''}>⚡ CREATE COLLECTION</button>
      </div>`;
  }

  // --- REUSABLE IMAGE UPLOAD ---
  private static renderImageUpload(key: string, label: string, hint: string, preview: string | null, file: File | null): string {
    return `
      <div class="input-group">
        <label>${label} <span class="cc-field-hint">${hint}</span></label>
        <div class="cc-image-upload" id="cc-${key}-zone">
          ${preview
            ? `<img src="${preview}" class="cc-image-thumb" /><span class="cc-image-name">${file?.name || 'image'}</span><button class="cc-image-remove" data-key="${key}">✕</button>`
            : `<span class="cc-image-placeholder">📷 Click to upload</span>`}
          <input type="file" id="cc-${key}-input" accept="image/*" style="display:none" />
        </div>
      </div>`;
  }

  // --- SOCIALS SECTION ---
  private static renderSocialsSection(): string {
    const socialRows = this.socialsEnabled ? this.socialEntries.map((entry, i) => `
      <div class="cc-royalty-row" data-index="${i}">
        <div class="input-group" style="flex:0.8">
          <label>Platform</label>
          <select class="token-input cc-social-label" data-index="${i}">
            ${SOCIAL_PLATFORMS.map(p => `<option value="${p}" ${entry.label === p ? 'selected' : ''}>${p}</option>`).join('')}
          </select>
        </div>
        <div class="input-group" style="flex:2"><label>URL</label><input type="text" class="token-input cc-social-url" data-index="${i}" placeholder="https://..." value="${this.escapeHtml(entry.url)}" /></div>
        <div class="input-group" style="flex:1"><label>Info <span class="cc-field-hint">optional</span></label><input type="text" class="token-input cc-social-info" data-index="${i}" placeholder="Short description" value="${this.escapeHtml(entry.info)}" /></div>
        ${this.socialEntries.length > 1 ? `<button class="cc-royalty-remove cc-social-remove" data-index="${i}" title="Remove">✕</button>` : ''}
      </div>
    `).join('') : '';

    return `
      <div class="toggle-group">
        <label class="toggle-label">
          <span>Social Links</span>
          <div class="toggle-switch">
            <input type="checkbox" id="cc-socials-toggle" ${this.socialsEnabled ? 'checked' : ''} />
            <span class="toggle-slider"></span>
          </div>
        </label>
      </div>
      ${this.socialsEnabled ? `
        <div class="cc-royalty-entries">${socialRows}</div>
        <button class="terminal-button secondary" id="cc-add-social" style="font-size:0.8rem;padding:0.4rem 0.8rem">+ ADD SOCIAL</button>
      ` : ''}
    `;
  }

  // --- KEYS SECTION ---
  private static renderKeysSection(): string {
    const keys = [
      { id: 'admin', label: 'Admin Key', hint: 'Update/delete the token', prop: 'keyAdmin' as const },
      { id: 'supply', label: 'Supply Key', hint: 'Mint new NFTs', prop: 'keySupply' as const },
      { id: 'metadata', label: 'Metadata Key', hint: 'Update token metadata', prop: 'keyMetadata' as const },
      { id: 'freeze', label: 'Freeze Key', hint: 'Freeze/unfreeze accounts', prop: 'keyFreeze' as const },
      { id: 'wipe', label: 'Wipe Key', hint: 'Wipe tokens from accounts', prop: 'keyWipe' as const },
      { id: 'pause', label: 'Pause Key', hint: 'Pause/unpause all transfers', prop: 'keyPause' as const },
      { id: 'feeSchedule', label: 'Fee Schedule Key', hint: 'Update custom fees', prop: 'keyFeeSchedule' as const },
    ];

    return `
      <h4 class="cc-sub-heading">Token Keys <span class="cc-field-hint">(set to your treasury wallet)</span></h4>
      <div class="cc-keys-grid">
        ${keys.map(k => `
          <label class="cc-key-item">
            <input type="checkbox" class="cc-key-checkbox" data-key="${k.id}" ${(this as any)[k.prop] ? 'checked' : ''} />
            <span class="cc-key-label">${k.label}</span>
            <span class="cc-key-hint">${k.hint}</span>
          </label>
        `).join('')}
      </div>`;
  }

  // --- ROYALTIES SECTION ---
  private static renderRoyaltiesSection(): string {
    const royaltyRows = this.royaltiesEnabled ? this.royaltyEntries.map((entry, i) => `
      <div class="cc-royalty-row" data-index="${i}">
        <div class="input-group" style="flex:2"><label>Wallet Address</label><input type="text" class="token-input cc-royalty-wallet" data-index="${i}" placeholder="0.0.xxxxx" value="${this.escapeHtml(entry.wallet)}" /></div>
        <div class="input-group" style="flex:0.7"><label>%</label><input type="number" class="token-input cc-royalty-pct" data-index="${i}" min="0" max="100" step="1" value="${entry.percentage}" /></div>
        ${this.royaltyEntries.length > 1 ? `<button class="cc-royalty-remove" data-index="${i}" title="Remove">✕</button>` : ''}
      </div>
    `).join('') : '';

    const tradeFeeSection = this.royaltiesEnabled ? `
      <div class="cc-trade-fee-section">
        <div class="toggle-group">
          <label class="toggle-label">
            <span>Trade Fee / Fallback Fee (HBAR)</span>
            <div class="toggle-switch">
              <input type="checkbox" id="cc-trade-fee-toggle" ${this.tradeFeeEnabled ? 'checked' : ''} />
              <span class="toggle-slider"></span>
            </div>
          </label>
          <p class="cc-trade-fee-warning">⚠ Trade fees can prevent seamless NFT transfers. Only enable if you're sure.</p>
        </div>
        ${this.tradeFeeEnabled ? `
          <div class="input-group" style="margin-top:0.5rem">
            <label for="cc-trade-fee-amount">Fallback Fee (HBAR)</label>
            <input type="number" id="cc-trade-fee-amount" class="token-input" min="0" step="0.1" value="${this.tradeFeeAmount}" />
          </div>
        ` : ''}
      </div>
    ` : '';

    return `
      <div class="toggle-group">
        <label class="toggle-label">
          <span>Royalties</span>
          <div class="toggle-switch">
            <input type="checkbox" id="cc-royalties-toggle" ${this.royaltiesEnabled ? 'checked' : ''} />
            <span class="toggle-slider"></span>
          </div>
        </label>
      </div>
      ${this.royaltiesEnabled ? `
        <div class="cc-royalty-entries">${royaltyRows}</div>
        <button class="terminal-button secondary" id="cc-add-royalty" style="font-size:0.8rem;padding:0.4rem 0.8rem">+ ADD WALLET</button>
      ` : ''}
      ${tradeFeeSection}
    `;
  }

  // --- RIGHT PANEL: PREVIEW ---
  private static renderPreview(): string {
    const ws = WalletConnectService.getState();
    const treasury = ws.accountId || '—';
    const totalRoyalty = this.royaltiesEnabled
      ? this.royaltyEntries.reduce((sum, e) => sum + (e.percentage || 0), 0)
      : 0;

    // Count HIP-766 images and socials for preview
    const hip766Images = [this.logoPreview, this.bannerPreview, this.featuredImagePreview].filter(Boolean);
    const hip766Socials = this.socialsEnabled ? this.socialEntries.filter(e => e.url.trim()) : [];

    return `
      <div class="cc-right-content">
        <h4 class="section-title" style="font-size:0.95rem">Collection Preview</h4>
        ${this.logoPreview ? `<img src="${this.logoPreview}" class="cc-preview-image" />` : ''}
        <div class="preview-info">
          <div class="info-row"><span>Name</span><span class="status-value">${this.collectionName || '—'}</span></div>
          <div class="info-row"><span>Symbol</span><span class="status-value">${this.symbol || '—'}</span></div>
          <div class="info-row"><span>Max Supply</span><span class="status-value">${this.maxSupply.toLocaleString()}</span></div>
          <div class="info-row"><span>Treasury</span><span class="status-value">${treasury}</span></div>
          <div class="info-row"><span>Token Type</span><span class="status-value">Non-Fungible (NFT)</span></div>
          <div class="info-row"><span>Supply Type</span><span class="status-value">Finite</span></div>
        </div>
        ${this.description ? `<div class="result-block" style="margin-top:0.75rem"><label>Description</label><p style="font-size:0.85rem;color:var(--terminal-text);margin:0">${this.escapeHtml(this.description)}</p></div>` : ''}
        ${this.creator || this.website ? `
          <div class="result-block" style="margin-top:0.75rem">
            <label>HIP-766 Metadata</label>
            ${this.creator ? `<p style="font-size:0.82rem;color:var(--terminal-text);margin:0">Creator: ${this.escapeHtml(this.creator)}</p>` : ''}
            ${this.website ? `<p style="font-size:0.82rem;color:var(--terminal-text);margin:0">Website: ${this.escapeHtml(this.website)}</p>` : ''}
            ${this.discussion ? `<p style="font-size:0.82rem;color:var(--terminal-text);margin:0">Discussion: ${this.escapeHtml(this.discussion)}</p>` : ''}
            ${this.whitepaper ? `<p style="font-size:0.82rem;color:var(--terminal-text);margin:0">Whitepaper: ${this.escapeHtml(this.whitepaper)}</p>` : ''}
          </div>
        ` : ''}
        ${hip766Images.length > 0 ? `
          <div class="result-block" style="margin-top:0.75rem">
            <label>Images (${hip766Images.length}/3)</label>
            <p style="font-size:0.82rem;color:var(--terminal-text);margin:0">${this.logoPreview ? '✓ Logo' : '✗ Logo'} &nbsp; ${this.bannerPreview ? '✓ Banner' : '✗ Banner'} &nbsp; ${this.featuredImagePreview ? '✓ Featured' : '✗ Featured'}</p>
          </div>
        ` : ''}
        ${hip766Socials.length > 0 ? `
          <div class="result-block" style="margin-top:0.75rem">
            <label>Socials (${hip766Socials.length})</label>
            ${hip766Socials.map(s => `<p style="font-size:0.82rem;color:var(--terminal-text);margin:0">${this.escapeHtml(s.label)}: ${this.escapeHtml(s.url)}</p>`).join('')}
          </div>
        ` : ''}
        ${this.royaltiesEnabled ? `
          <div class="result-block" style="margin-top:0.75rem">
            <label>Royalties (${totalRoyalty}% total)</label>
            ${this.royaltyEntries.map(e => `<p style="font-size:0.82rem;color:var(--terminal-text);margin:0">${e.wallet || '—'}: ${e.percentage}%</p>`).join('')}
            ${this.tradeFeeEnabled ? `<p style="font-size:0.82rem;color:var(--warning-yellow);margin:0.25rem 0 0">⚠ Fallback fee: ${this.tradeFeeAmount} HBAR</p>` : ''}
          </div>
        ` : ''}
        <div class="result-block" style="margin-top:0.75rem">
          <label>Keys (set to treasury)</label>
          <p style="font-size:0.82rem;color:var(--terminal-text);margin:0">${[
            this.keyAdmin ? 'Admin ✓' : '',
            this.keySupply ? 'Supply ✓' : '',
            this.keyMetadata ? 'Metadata ✓' : '',
            this.keyFreeze ? 'Freeze ✓' : '',
            this.keyWipe ? 'Wipe ✓' : '',
            this.keyPause ? 'Pause ✓' : '',
            this.keyFeeSchedule ? 'Fee Schedule ✓' : '',
          ].filter(Boolean).join(' &nbsp; ') || 'None'}</p>
        </div>
        <div class="result-block" style="margin-top:0.5rem">
          <label style="font-size:0.75rem;opacity:0.6">Standard: HIP-766 NFT Collection Metadata</label>
        </div>
      </div>`;
  }

  // --- SUCCESS ---
  private static renderSuccessPanel(): string {
    return `
      <div class="art-gen-section">
        <h3 class="section-title">◆ Collection Created ✓</h3>
        <div class="back-link" id="cc-back"><span class="back-arrow">←</span><span>Back to Home</span></div>
        <div class="preview-info">
          <div class="info-row"><span>Token ID</span><span class="status-value">${this.tokenId}</span></div>
          <div class="info-row"><span>Name</span><span class="status-value">${this.collectionName}</span></div>
          <div class="info-row"><span>Symbol</span><span class="status-value">${this.symbol}</span></div>
          <div class="info-row"><span>Max Supply</span><span class="status-value">${this.maxSupply.toLocaleString()}</span></div>
        </div>
        <button class="terminal-button" id="cc-new" style="margin-top:1rem">CREATE ANOTHER COLLECTION</button>
      </div>`;
  }

  private static renderSuccessDetails(): string {
    const network = WalletConnectService.getState().network?.toLowerCase() || 'mainnet';
    return `
      <div class="cc-right-content">
        <h4 class="section-title" style="font-size:0.95rem">🎉 Success!</h4>
        <div class="result-block">
          <label>Token ID</label>
          <code class="cid-value" style="font-size:1.1rem">${this.tokenId}</code>
        </div>
        <div class="result-block" style="margin-top:0.75rem">
          <label>View on HashScan</label>
          <a class="cid-link" href="https://hashscan.io/${network}/token/${this.tokenId}" target="_blank" rel="noopener">https://hashscan.io/${network}/token/${this.tokenId}</a>
        </div>
        <div class="result-block" style="margin-top:0.75rem">
          <label>Next Steps</label>
          <p style="font-size:0.82rem;color:var(--terminal-text);margin:0">1. Save your Token ID: <strong>${this.tokenId}</strong></p>
          <p style="font-size:0.82rem;color:var(--terminal-text);margin:0">2. Prepare your metadata CIDs</p>
          <p style="font-size:0.82rem;color:var(--terminal-text);margin:0">3. Use the Mint NFTs tool to mint</p>
        </div>
      </div>`;
  }

  private static canCreate(): boolean {
    if (!this.collectionName.trim()) return false;
    if (!this.symbol.trim()) return false;
    if (!this.maxSupply || this.maxSupply < 1) return false;
    const ws = WalletConnectService.getState();
    if (!ws.connected) return false;
    if (this.royaltiesEnabled) {
      for (const entry of this.royaltyEntries) {
        if (!entry.wallet.trim()) return false;
        if (entry.percentage <= 0 || entry.percentage > 100) return false;
      }
    }
    return true;
  }

  private static escapeHtml(s: string): string {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  private static refresh(): void {
    // Preserve scroll position of the left panel across re-renders
    const leftPanel = document.querySelector('.art-gen-left');
    const scrollTop = leftPanel?.scrollTop ?? 0;

    const app = document.querySelector<HTMLDivElement>('#app')!;
    app.innerHTML = this.render();
    this.init();

    // Restore scroll position
    const newLeftPanel = document.querySelector('.art-gen-left');
    if (newLeftPanel) newLeftPanel.scrollTop = scrollTop;
  }

  private static resetForm(): void {
    this.collectionName = '';
    this.symbol = '';
    this.maxSupply = 10000;
    this.description = '';
    this.creator = '';

    this.website = '';
    this.discussion = '';
    this.whitepaper = '';
    this.logoFile = null;
    this.logoPreview = null;
    this.bannerFile = null;
    this.bannerPreview = null;
    this.featuredImageFile = null;
    this.featuredImagePreview = null;
    this.socialsEnabled = false;
    this.socialEntries = [{ label: 'Discord', url: '', info: '' }];
    this.royaltiesEnabled = false;
    this.royaltyEntries = [{ wallet: '', percentage: 5 }];
    this.tradeFeeEnabled = false;
    this.tradeFeeAmount = 1;
    this.keyAdmin = true;
    this.keySupply = true;
    this.keyMetadata = true;
    this.keyFreeze = false;
    this.keyWipe = false;
    this.keyPause = false;
    this.keyFeeSchedule = false;
    this.step = 'form';
    this.loading = false;
    this.error = null;
    this.statusMessage = '';
    this.tokenId = null;
  }

  // --- INIT: wire up event listeners ---
  static init(): void {
    // Back button
    document.getElementById('cc-back')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('navigate-to-tool', { detail: { toolId: 'home' } }));
    });

    // Text inputs — sync to state on change
    const nameInput = document.getElementById('cc-name') as HTMLInputElement;
    const symbolInput = document.getElementById('cc-symbol') as HTMLInputElement;
    const supplyInput = document.getElementById('cc-supply') as HTMLInputElement;
    const descInput = document.getElementById('cc-desc') as HTMLTextAreaElement;

    nameInput?.addEventListener('input', () => { this.collectionName = nameInput.value; this.refreshPreview(); });
    symbolInput?.addEventListener('input', () => { this.symbol = symbolInput.value; this.refreshPreview(); });
    supplyInput?.addEventListener('input', () => { this.maxSupply = parseInt(supplyInput.value) || 0; this.refreshPreview(); });
    descInput?.addEventListener('input', () => { this.description = descInput.value; this.refreshPreview(); });

    // HIP-766 text inputs
    const creatorInput = document.getElementById('cc-creator') as HTMLInputElement;
    const websiteInput = document.getElementById('cc-website') as HTMLInputElement;
    const discussionInput = document.getElementById('cc-discussion') as HTMLInputElement;
    const whitepaperInput = document.getElementById('cc-whitepaper') as HTMLInputElement;


    creatorInput?.addEventListener('input', () => { this.creator = creatorInput.value; this.refreshPreview(); });
    websiteInput?.addEventListener('input', () => { this.website = websiteInput.value; this.refreshPreview(); });
    discussionInput?.addEventListener('input', () => { this.discussion = discussionInput.value; this.refreshPreview(); });
    whitepaperInput?.addEventListener('input', () => { this.whitepaper = whitepaperInput.value; this.refreshPreview(); });


    // HIP-766 image uploads — logo, banner, featuredImage
    this.initImageUpload('logo', (file, preview) => { this.logoFile = file; this.logoPreview = preview; });
    this.initImageUpload('banner', (file, preview) => { this.bannerFile = file; this.bannerPreview = preview; });
    this.initImageUpload('featuredImage', (file, preview) => { this.featuredImageFile = file; this.featuredImagePreview = preview; });

    // Image remove buttons (all three use data-key attribute)
    document.querySelectorAll('.cc-image-remove').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const key = (e.target as HTMLElement).dataset.key;
        if (key === 'logo') { this.logoFile = null; this.logoPreview = null; }
        if (key === 'banner') { this.bannerFile = null; this.bannerPreview = null; }
        if (key === 'featuredImage') { this.featuredImageFile = null; this.featuredImagePreview = null; }
        this.refresh();
      });
    });

    // Socials toggle
    document.getElementById('cc-socials-toggle')?.addEventListener('change', (e) => {
      this.socialsEnabled = (e.target as HTMLInputElement).checked;
      this.refresh();
    });

    // Social inputs
    document.querySelectorAll('.cc-social-label').forEach(el => {
      el.addEventListener('change', (e) => {
        const idx = parseInt((e.target as HTMLElement).dataset.index || '0');
        this.socialEntries[idx].label = (e.target as HTMLSelectElement).value;
        this.refreshPreview();
      });
    });
    document.querySelectorAll('.cc-social-url').forEach(el => {
      el.addEventListener('input', (e) => {
        const idx = parseInt((e.target as HTMLElement).dataset.index || '0');
        this.socialEntries[idx].url = (e.target as HTMLInputElement).value;
        this.refreshPreview();
      });
    });
    document.querySelectorAll('.cc-social-info').forEach(el => {
      el.addEventListener('input', (e) => {
        const idx = parseInt((e.target as HTMLElement).dataset.index || '0');
        this.socialEntries[idx].info = (e.target as HTMLInputElement).value;
      });
    });

    // Add social
    document.getElementById('cc-add-social')?.addEventListener('click', () => {
      this.socialEntries.push({ label: 'Twitter', url: '', info: '' });
      this.refresh();
    });

    // Remove social
    document.querySelectorAll('.cc-social-remove').forEach(el => {
      el.addEventListener('click', (e) => {
        const idx = parseInt((e.target as HTMLElement).dataset.index || '0');
        this.socialEntries.splice(idx, 1);
        this.refresh();
      });
    });

    // Royalties toggle
    document.getElementById('cc-royalties-toggle')?.addEventListener('change', (e) => {
      this.royaltiesEnabled = (e.target as HTMLInputElement).checked;
      if (!this.royaltiesEnabled) { this.tradeFeeEnabled = false; }
      this.refresh();
    });

    // Royalty wallet/pct inputs
    document.querySelectorAll('.cc-royalty-wallet').forEach(el => {
      el.addEventListener('input', (e) => {
        const idx = parseInt((e.target as HTMLElement).dataset.index || '0');
        this.royaltyEntries[idx].wallet = (e.target as HTMLInputElement).value;
        this.refreshPreview();
      });
    });
    document.querySelectorAll('.cc-royalty-pct').forEach(el => {
      el.addEventListener('input', (e) => {
        const idx = parseInt((e.target as HTMLElement).dataset.index || '0');
        this.royaltyEntries[idx].percentage = parseFloat((e.target as HTMLInputElement).value) || 0;
        this.refreshPreview();
      });
    });

    // Add royalty wallet
    document.getElementById('cc-add-royalty')?.addEventListener('click', () => {
      this.royaltyEntries.push({ wallet: '', percentage: 5 });
      this.refresh();
    });

    // Remove royalty wallet
    document.querySelectorAll('.cc-royalty-remove').forEach(el => {
      el.addEventListener('click', (e) => {
        const idx = parseInt((e.target as HTMLElement).dataset.index || '0');
        this.royaltyEntries.splice(idx, 1);
        this.refresh();
      });
    });

    // Trade fee toggle
    document.getElementById('cc-trade-fee-toggle')?.addEventListener('change', (e) => {
      this.tradeFeeEnabled = (e.target as HTMLInputElement).checked;
      this.refresh();
    });

    // Trade fee amount
    document.getElementById('cc-trade-fee-amount')?.addEventListener('input', (e) => {
      this.tradeFeeAmount = parseFloat((e.target as HTMLInputElement).value) || 0;
      this.refreshPreview();
    });

    // Key checkboxes
    document.querySelectorAll('.cc-key-checkbox').forEach(el => {
      el.addEventListener('change', (e) => {
        const keyId = (e.target as HTMLElement).dataset.key;
        const checked = (e.target as HTMLInputElement).checked;
        switch (keyId) {
          case 'admin': this.keyAdmin = checked; break;
          case 'supply': this.keySupply = checked; break;
          case 'metadata': this.keyMetadata = checked; break;
          case 'freeze': this.keyFreeze = checked; break;
          case 'wipe': this.keyWipe = checked; break;
          case 'pause': this.keyPause = checked; break;
          case 'feeSchedule': this.keyFeeSchedule = checked; break;
        }
        this.refreshPreview();
      });
    });

    // Create button
    document.getElementById('cc-create-btn')?.addEventListener('click', () => { this.createCollection(); });

    // Dismiss error
    document.getElementById('cc-dismiss-error')?.addEventListener('click', () => { this.error = null; this.refresh(); });

    // New collection button (from success screen)
    document.getElementById('cc-new')?.addEventListener('click', () => { this.resetForm(); this.refresh(); });
  }

  // Helper: wire up a file input zone for an image key
  private static initImageUpload(key: string, setter: (file: File | null, preview: string | null) => void): void {
    const zone = document.getElementById(`cc-${key}-zone`);
    const input = document.getElementById(`cc-${key}-input`) as HTMLInputElement;
    zone?.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (!target.classList.contains('cc-image-remove')) input?.click();
    });
    input?.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = () => { setter(file, reader.result as string); this.refresh(); };
        reader.readAsDataURL(file);
      }
    });
  }

  // Refresh only the right panel (preview) without full re-render
  private static refreshPreview(): void {
    const rightPanel = document.querySelector('.art-gen-right');
    if (rightPanel && this.step === 'form') {
      rightPanel.innerHTML = this.renderPreview();
    }
    // Also update create button disabled state
    const btn = document.getElementById('cc-create-btn') as HTMLButtonElement;
    if (btn) btn.disabled = !this.canCreate();
  }

  // --- TRANSACTION LOGIC ---
  private static async createCollection(): Promise<void> {
    if (!this.canCreate()) return;
    this.loading = true;
    this.error = null;
    this.statusMessage = 'Preparing transaction...';
    this.refresh();

    try {
      const ws = WalletConnectService.getState();
      if (!ws.connected || !ws.accountId) throw new Error('Wallet not connected');
      const accountId = ws.accountId;

      // 1. Fetch treasury public key from mirror node
      this.statusMessage = 'Fetching account public key...';
      this.refresh();
      const pubKey = await this.fetchPublicKey(accountId);

      // 2. If any HIP-766 metadata provided, pin to IPFS
      let metadataBytes: Uint8Array | null = null;
      const hasMetadata = this.description || this.creator ||
        this.website || this.discussion || this.whitepaper ||
        this.logoFile || this.bannerFile || this.featuredImageFile ||
        (this.socialsEnabled && this.socialEntries.some(s => s.url.trim()));
      if (hasMetadata) {
        this.statusMessage = 'Pinning HIP-766 metadata to IPFS...';
        this.refresh();
        metadataBytes = await this.pinMetadata();
      }

      // 3. Build the TokenCreateTransaction
      this.statusMessage = 'Building transaction...';
      this.refresh();

      const tx = new TokenCreateTransaction()
        .setTokenName(this.collectionName.trim())
        .setTokenSymbol(this.symbol.trim())
        .setTokenType(TokenType.NonFungibleUnique)
        .setSupplyType(TokenSupplyType.Finite)
        .setMaxSupply(this.maxSupply)
        .setDecimals(0)
        .setInitialSupply(0)
        .setTreasuryAccountId(AccountId.fromString(accountId));

      // Conditionally set keys based on user selection
      if (this.keyAdmin) tx.setAdminKey(pubKey);
      if (this.keySupply) tx.setSupplyKey(pubKey);
      if (this.keyMetadata) tx.setMetadataKey(pubKey);
      if (this.keyFreeze) tx.setFreezeKey(pubKey);
      if (this.keyWipe) tx.setWipeKey(pubKey);
      if (this.keyPause) tx.setPauseKey(pubKey);
      if (this.keyFeeSchedule) tx.setFeeScheduleKey(pubKey);

      // Add collection metadata if available
      if (metadataBytes) {
        tx.setMetadata(metadataBytes);
      }

      // Add royalty fees
      if (this.royaltiesEnabled && this.royaltyEntries.length > 0) {
        const fees = this.royaltyEntries.map(entry => {
          const fee = new CustomRoyaltyFee()
            .setNumerator(Math.round(entry.percentage * 100))
            .setDenominator(10000)
            .setFeeCollectorAccountId(AccountId.fromString(entry.wallet.trim()));

          if (this.tradeFeeEnabled && this.tradeFeeAmount > 0) {
            fee.setFallbackFee(
              new CustomFixedFee().setHbarAmount(new Hbar(this.tradeFeeAmount))
            );
          }
          return fee;
        });
        tx.setCustomFees(fees);
      }

      // 4. Freeze transaction with a Hedera Client (provides node account IDs),
      //    then execute via WalletConnect signer (sends SignAndExecuteTransaction to wallet).
      //    The DAppSigner internally uses Client.forName() for freezing, so we mirror that pattern.
      this.statusMessage = 'Waiting for wallet approval...';
      this.refresh();

      const signer = WalletConnectService.getSigner(accountId);
      const acctId = AccountId.fromString(accountId);
      tx.setTransactionId(TransactionId.generate(acctId));
      tx.freezeWith(Client.forMainnet());
      const txResponse = await tx.executeWithSigner(signer);

      this.statusMessage = 'Getting receipt...';
      this.refresh();

      // Try to get receipt — some wallet connectors return it differently
      let tokenId: string | null = null;
      if (txResponse && typeof (txResponse as any).getReceiptWithSigner === 'function') {
        const receipt = await (txResponse as any).getReceiptWithSigner(signer);
        tokenId = receipt?.tokenId?.toString() || null;
      }

      // If we couldn't get receipt via signer, try via transactionId on mirror node
      if (!tokenId && txResponse?.transactionId) {
        this.statusMessage = 'Confirming on network...';
        this.refresh();
        tokenId = await this.pollForTokenId(txResponse.transactionId.toString());
      }

      if (!tokenId) {
        // Transaction went through but we couldn't get the token ID automatically
        tokenId = 'Check HashScan for Token ID';
      }

      this.tokenId = tokenId;
      this.step = 'success';
      this.loading = false;
      this.statusMessage = `Collection created: ${tokenId}`;
      this.refresh();
    } catch (err: any) {
      console.error('Create collection error:', err);
      this.loading = false;
      this.error = err.message || 'Failed to create collection';
      this.statusMessage = '';
      this.refresh();
    }
  }

  // Fetch the account's public key from mirror node
  private static async fetchPublicKey(accountId: string): Promise<PublicKey> {
    const res = await fetch(`${MIRROR_NODE_URL}/api/v1/accounts/${accountId}`);
    if (!res.ok) throw new Error(`Failed to fetch account info for ${accountId}`);
    const data = await res.json();
    if (!data.key?.key) throw new Error('Could not find public key for account');
    return PublicKey.fromString(data.key.key);
  }

  // Pin HIP-766 collection metadata via backend
  private static async pinMetadata(): Promise<Uint8Array> {
    const formData = new FormData();

    // Images
    if (this.logoFile) formData.append('logo', this.logoFile);
    if (this.bannerFile) formData.append('banner', this.bannerFile);
    if (this.featuredImageFile) formData.append('featuredImage', this.featuredImageFile);

    // Text fields
    if (this.collectionName) formData.append('collectionName', this.collectionName); // for Pinata label only
    if (this.description) formData.append('description', this.description);
    if (this.creator) formData.append('creator', this.creator);

    if (this.website) formData.append('website', this.website);
    if (this.discussion) formData.append('discussion', this.discussion);
    if (this.whitepaper) formData.append('whitepaper', this.whitepaper);

    // Socials — send as JSON string
    if (this.socialsEnabled) {
      const validSocials = this.socialEntries
        .filter(s => s.url.trim())
        .map(s => ({ url: s.url.trim(), label: s.label, ...(s.info.trim() ? { info: s.info.trim() } : {}) }));
      if (validSocials.length > 0) {
        formData.append('socials', JSON.stringify(validSocials));
      }
    }

    const res = await fetch(`${API_BASE}/api/pin-collection-metadata`, {
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

  // Poll mirror node for the token ID after transaction
  private static async pollForTokenId(txId: string): Promise<string | null> {
    const formattedId = txId.replace('@', '-').replace('.', '-');
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 3000));
      try {
        const res = await fetch(`${MIRROR_NODE_URL}/api/v1/transactions/${formattedId}`);
        if (res.ok) {
          const data = await res.json();
          const tx = data.transactions?.[0];
          if (tx?.entity_id) return tx.entity_id;
        }
      } catch { /* retry */ }
    }
    return null;
  }
}

