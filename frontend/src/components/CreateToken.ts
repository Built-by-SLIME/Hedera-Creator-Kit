/**
 * Create Token Component
 * Creates a fungible token on Hedera via TokenCreateTransaction + WalletConnect signing
 */
import WalletConnectService from '../services/WalletConnectService'
import { API_BASE_URL, MIRROR_NODE_URL, getHederaClient } from '../config'
import {
  TokenCreateTransaction,
  TokenType,
  TokenSupplyType,
  CustomFixedFee,
  CustomFractionalFee,
  Hbar,
  AccountId,
  PublicKey,
  TransactionId,
  TokenMintTransaction,
} from '@hashgraph/sdk'

type CreateTokenStep = 'mode-select' | 'form' | 'creating' | 'success' | 'mint-form' | 'minting' | 'mint-success';

export class CreateToken {
  // Form state — required
  private static tokenName = '';
  private static symbol = '';
  private static decimals = 8;
  private static initialSupply = 1000000;

  // Optional
  private static maxSupply = 0; // 0 = infinite
  private static memo = '';

  // Custom fees
  private static customFeesEnabled = false;
  private static feeType: 'fractional' | 'fixed' = 'fractional';
  private static fractionalPercent = 1;
  private static fractionalMin = 0;
  private static fractionalMax = 0;
  private static fixedAmount = 1;
  private static feeCollector = '';

  // Token image
  private static imageFile: File | null = null;
  private static imagePreview: string | null = null;

  // Token keys
  private static keyAdmin = true;
  private static keySupply = true;
  private static keyMetadata = true;
  private static keyFreeze = false;
  private static keyWipe = false;
  private static keyPause = false;
  private static keyFeeSchedule = false;

  // UI state
  private static step: CreateTokenStep = 'mode-select';
  private static loading = false;
  private static error: string | null = null;
  private static statusMessage = '';

  // Result
  private static tokenId: string | null = null;

  // Mint additional supply state
  private static mintTokenId = '';
  private static mintAmount = 0;
  private static mintTokenInfo: {
    name: string;
    symbol: string;
    decimals: number;
    totalSupply: string;
    maxSupply: string;
    supplyKey: string | null;
    treasuryAccountId: string;
  } | null = null;
  private static mintTxId: string | null = null;

  static render(): string {
    return `<div class="terminal-window">${this.renderChrome()}${this.renderContent()}${this.renderStatusBar()}</div>`;
  }

  private static renderChrome(): string {
    return `<div class="window-chrome"><div class="window-controls"><div class="window-dot close"></div><div class="window-dot minimize"></div><div class="window-dot maximize"></div></div><div class="window-title">hedera-creator-kit — create token</div></div>`;
  }

  private static renderStatusBar(): string {
    const ws = WalletConnectService.getState();
    const walletInfo = ws.connected ? `${ws.accountId} | ${ws.hbarBalance || '0'} ℏ` : 'Not Connected';
    return `<div class="status-bar"><div class="status-left"><div class="status-item"><div class="status-indicator"></div><span>${walletInfo}</span></div></div><div class="status-center"><span class="status-highlight">${this.statusMessage}</span></div><div class="status-right"><div class="status-item"><span>Create Token</span></div></div></div>`;
  }

  private static renderContent(): string {
    return `<div class="terminal-content"><div class="art-gen-layout"><div class="art-gen-left">${this.renderLeftPanel()}</div><div class="art-gen-right">${this.renderRightPanel()}</div></div></div>`;
  }

  private static renderLeftPanel(): string {
    if (this.loading) {
      const message = this.step === 'minting' ? 'Minting Tokens' : 'Creating Token';
      return `<div class="art-gen-section"><h3 class="section-title">◆ ${message}</h3><div class="loading-state"><div class="spinner"></div><p>${this.statusMessage || 'Processing...'}</p></div></div>`;
    }
    switch (this.step) {
      case 'mode-select': return this.renderModeSelect();
      case 'form': return this.renderForm();
      case 'success': return this.renderSuccessPanel();
      case 'mint-form': return this.renderMintForm();
      case 'mint-success': return this.renderMintSuccessPanel();
      default: return '';
    }
  }

  private static renderRightPanel(): string {
    if (this.loading) {
      return `<div class="loading-state"><div class="spinner"></div><p>${this.statusMessage || 'Processing...'}</p></div>`;
    }
    if (this.error) {
      return `<div class="cc-right-content"><div class="error-state"><p class="error-message">⚠ ${this.error}</p><button class="terminal-button" id="ct-dismiss-error" style="margin-top:1rem">DISMISS</button></div></div>`;
    }
    switch (this.step) {
      case 'mode-select': return this.renderModeSelectInfo();
      case 'form': return this.renderPreview();
      case 'mint-form': return this.renderMintPreview();
      case 'success': return this.renderSuccessDetails();
      default: return '';
    }
  }

  // --- FORM ---
  private static renderForm(): string {
    return `
      <div class="art-gen-section">
        <h3 class="section-title">◆ Create Token</h3>
        <div class="back-link" id="ct-back"><span class="back-arrow">←</span><span>Back</span></div>

        <div class="input-group">
          <label for="ct-name">Token Name *</label>
          <input type="text" id="ct-name" class="token-input" placeholder="My Token" value="${this.escapeHtml(this.tokenName)}" />
        </div>
        <div class="input-row">
          <div class="input-group"><label for="ct-symbol">Symbol *</label><input type="text" id="ct-symbol" class="token-input" placeholder="MTK" value="${this.escapeHtml(this.symbol)}" /></div>
          <div class="input-group"><label for="ct-decimals">Decimals * <span class="cc-field-hint">0–18</span></label><input type="number" id="ct-decimals" class="token-input" min="0" max="18" placeholder="8 = standard" value="${this.decimals}" /></div>
        </div>
        <div class="input-row">
          <div class="input-group"><label for="ct-initial-supply">Initial Supply *</label><input type="number" id="ct-initial-supply" class="token-input" min="1" value="${this.initialSupply}" /></div>
          <div class="input-group"><label for="ct-max-supply">Max Supply</label><input type="number" id="ct-max-supply" class="token-input" min="0" placeholder="0 = infinite" value="${this.maxSupply}" /></div>
        </div>
        <div class="input-group">
          <label for="ct-memo">Memo <span class="cc-field-hint">optional, max 100 chars</span></label>
          <input type="text" id="ct-memo" class="token-input" placeholder="Token memo" maxlength="100" value="${this.escapeHtml(this.memo)}" />
        </div>

        <div class="filter-divider"></div>
        <div class="input-group">
          <label>Token Image <span class="cc-field-hint">displayed in wallets & explorers</span></label>
          <div class="cc-image-upload" id="ct-image-zone">
            ${this.imagePreview
              ? `<img src="${this.imagePreview}" class="cc-image-thumb" /><span class="cc-image-name">${this.imageFile?.name || 'image'}</span><button class="cc-image-remove" id="ct-image-remove">✕</button>`
              : `<span class="cc-image-placeholder">📷 Click to upload</span>`}
            <input type="file" id="ct-image-input" accept="image/*" style="display:none" />
          </div>
        </div>

        <div class="filter-divider"></div>
        ${this.renderCustomFeesSection()}

        <div class="filter-divider"></div>
        ${this.renderKeysSection()}

        <div class="filter-divider"></div>
        <button class="terminal-button" id="ct-create-btn" ${!this.canCreate() ? 'disabled' : ''}>⚡ CREATE TOKEN</button>
      </div>`;
  }

  // --- CUSTOM FEES ---
  private static renderCustomFeesSection(): string {
    const feesContent = this.customFeesEnabled ? `
      <p style="font-size:0.78rem;color:#f0a040;margin:0.5rem 0 0">⚠ Tokens with custom fees may not be compatible with all DEXes (e.g. SaucerSwap)</p>
      <div class="toggle-group" style="margin-top:0.75rem">
        <div class="input-row">
          <button class="terminal-button ${this.feeType === 'fractional' ? '' : 'secondary'}" id="ct-fee-fractional" style="flex:1">Fractional %</button>
          <button class="terminal-button ${this.feeType === 'fixed' ? '' : 'secondary'}" id="ct-fee-fixed" style="flex:1">Fixed HBAR</button>
        </div>
        ${this.feeType === 'fractional' ? `
          <div class="input-row" style="margin-top:0.5rem">
            <div class="input-group"><label for="ct-frac-pct">Percent (%)</label><input type="number" id="ct-frac-pct" class="token-input" min="0" max="100" step="0.01" value="${this.fractionalPercent}" /></div>
            <div class="input-group"><label for="ct-frac-min">Min (units)</label><input type="number" id="ct-frac-min" class="token-input" min="0" value="${this.fractionalMin}" /></div>
            <div class="input-group"><label for="ct-frac-max">Max (units)</label><input type="number" id="ct-frac-max" class="token-input" min="0" placeholder="0 = no max" value="${this.fractionalMax}" /></div>
          </div>
        ` : `
          <div class="input-group" style="margin-top:0.5rem">
            <label for="ct-fixed-amt">Fixed Amount (HBAR)</label>
            <input type="number" id="ct-fixed-amt" class="token-input" min="0" step="0.01" value="${this.fixedAmount}" />
          </div>
        `}
        <div class="input-group" style="margin-top:0.5rem">
          <label for="ct-fee-collector">Fee Collector Account *</label>
          <input type="text" id="ct-fee-collector" class="token-input" placeholder="0.0.xxxxx" value="${this.escapeHtml(this.feeCollector)}" />
        </div>
      </div>
    ` : '';

    return `
      <div class="toggle-group">
        <label class="toggle-label">
          <span>Custom Fees</span>
          <div class="toggle-switch">
            <input type="checkbox" id="ct-fees-toggle" ${this.customFeesEnabled ? 'checked' : ''} />
            <span class="toggle-slider"></span>
          </div>
        </label>
      </div>
      ${feesContent}`;
  }

  // --- KEYS ---
  private static renderKeysSection(): string {
    const keys = [
      { id: 'admin', label: 'Admin Key', hint: 'Update/delete the token', prop: 'keyAdmin' as const },
      { id: 'supply', label: 'Supply Key', hint: 'Mint additional supply', prop: 'keySupply' as const },
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

  // --- RIGHT PANEL: PREVIEW ---
  private static renderPreview(): string {
    const ws = WalletConnectService.getState();
    const treasury = ws.accountId || '—';
    const supplyType = this.maxSupply > 0 ? 'Finite' : 'Infinite';

    const feeInfo = this.customFeesEnabled && this.feeCollector.trim()
      ? (this.feeType === 'fractional'
          ? `Fractional: ${this.fractionalPercent}%${this.fractionalMin ? ` (min ${this.fractionalMin})` : ''}${this.fractionalMax ? ` (max ${this.fractionalMax})` : ''}`
          : `Fixed: ${this.fixedAmount} HBAR`)
      : null;

    return `
      <div class="cc-right-content">
        <h4 class="section-title" style="font-size:0.95rem">Token Preview</h4>
        ${this.imagePreview ? `<div style="text-align:center;margin-bottom:1rem"><img src="${this.imagePreview}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;border:2px solid var(--terminal-purple)" /></div>` : ''}
        <div class="preview-info">
          <div class="info-row"><span>Name</span><span class="status-value">${this.tokenName || '—'}</span></div>
          <div class="info-row"><span>Symbol</span><span class="status-value">${this.symbol || '—'}</span></div>
          <div class="info-row"><span>Decimals</span><span class="status-value">${this.decimals}</span></div>
          <div class="info-row"><span>Initial Supply</span><span class="status-value">${this.initialSupply.toLocaleString()}</span></div>
          <div class="info-row"><span>Max Supply</span><span class="status-value">${this.maxSupply > 0 ? this.maxSupply.toLocaleString() : 'Infinite'}</span></div>
          <div class="info-row"><span>Treasury</span><span class="status-value">${treasury}</span></div>
          <div class="info-row"><span>Token Type</span><span class="status-value">Fungible</span></div>
          <div class="info-row"><span>Supply Type</span><span class="status-value">${supplyType}</span></div>
        </div>
        ${this.memo ? `<div class="result-block" style="margin-top:0.75rem"><label>Memo</label><p style="font-size:0.85rem;color:var(--terminal-text);margin:0">${this.escapeHtml(this.memo)}</p></div>` : ''}
        ${feeInfo ? `
          <div class="result-block" style="margin-top:0.75rem">
            <label>Custom Fee</label>
            <p style="font-size:0.82rem;color:var(--terminal-text);margin:0">${feeInfo}</p>
            <p style="font-size:0.82rem;color:var(--terminal-text);margin:0">Collector: ${this.escapeHtml(this.feeCollector)}</p>
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
          <label style="font-size:0.75rem;opacity:0.6">Hedera Token Service — Fungible Token</label>
        </div>
      </div>`;
  }

  // --- SUCCESS ---
  private static renderSuccessPanel(): string {
    return `
      <div class="art-gen-section">
        <h3 class="section-title">◆ Token Created ✓</h3>
        <div class="back-link" id="ct-back"><span class="back-arrow">←</span><span>Back to Home</span></div>
        <div class="preview-info">
          <div class="info-row"><span>Token ID</span><span class="status-value">${this.tokenId}</span></div>
          <div class="info-row"><span>Name</span><span class="status-value">${this.tokenName}</span></div>
          <div class="info-row"><span>Symbol</span><span class="status-value">${this.symbol}</span></div>
          <div class="info-row"><span>Decimals</span><span class="status-value">${this.decimals}</span></div>
          <div class="info-row"><span>Initial Supply</span><span class="status-value">${this.initialSupply.toLocaleString()}</span></div>
        </div>
        <button class="terminal-button" id="ct-new" style="margin-top:1rem">CREATE ANOTHER TOKEN</button>
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
          <p style="font-size:0.82rem;color:var(--terminal-text);margin:0">2. Share token ID with holders for association</p>
          <p style="font-size:0.82rem;color:var(--terminal-text);margin:0">3. Use the Airdrop tool to distribute</p>
        </div>
      </div>`;
  }

  // --- MODE SELECT ---
  private static renderModeSelect(): string {
    return `
      <div class="art-gen-section">
        <h3 class="section-title">◆ Create Token</h3>
        <div class="back-link" id="ct-back"><span class="back-arrow">←</span><span>Back to Home</span></div>

        <p style="font-size:0.9rem;color:var(--terminal-text);margin:1rem 0">Choose an option:</p>

        <button class="terminal-button" id="ct-mode-create" style="margin-bottom:1rem;width:100%">
          ⚡ CREATE NEW TOKEN
        </button>

        <button class="terminal-button secondary" id="ct-mode-mint" style="width:100%">
          ◆ MINT ADDITIONAL SUPPLY
        </button>
      </div>`;
  }

  private static renderModeSelectInfo(): string {
    return `
      <div class="cc-right-content">
        <h4 class="section-title" style="font-size:0.95rem">Options</h4>

        <div class="result-block">
          <label>Create New Token</label>
          <p style="font-size:0.82rem;color:var(--terminal-text);margin:0">
            Create a brand new fungible token on Hedera with custom supply, decimals, fees, and keys.
          </p>
        </div>

        <div class="result-block" style="margin-top:1rem">
          <label>Mint Additional Supply</label>
          <p style="font-size:0.82rem;color:var(--terminal-text);margin:0">
            Mint more tokens to an existing token you control. Requires you to have the supply key (treasury account).
          </p>
        </div>

        <div class="result-block" style="margin-top:1rem">
          <label style="font-size:0.75rem;opacity:0.6">Hedera Token Service — Fungible Tokens</label>
        </div>
      </div>`;
  }

  // --- MINT FORM ---
  private static renderMintForm(): string {
    const ws = WalletConnectService.getState();
    const canValidate = this.mintTokenId.trim().length > 0;
    const canMint = this.mintTokenInfo && this.mintAmount > 0;

    return `
      <div class="art-gen-section">
        <h3 class="section-title">◆ Mint Additional Supply</h3>
        <div class="back-link" id="ct-mint-back"><span class="back-arrow">←</span><span>Back</span></div>

        <div class="input-group">
          <label for="ct-mint-token-id">Token ID *</label>
          <input
            type="text"
            id="ct-mint-token-id"
            class="token-input"
            placeholder="0.0.xxxxx"
            value="${this.escapeHtml(this.mintTokenId)}"
            ${this.mintTokenInfo ? 'disabled' : ''}
          />
        </div>

        ${!this.mintTokenInfo ? `
          <button
            class="terminal-button"
            id="ct-validate-token"
            ${!canValidate || !ws.connected ? 'disabled' : ''}
            style="margin-top:0.5rem"
          >
            VALIDATE TOKEN
          </button>
        ` : ''}

        ${this.mintTokenInfo ? `
          <div class="filter-divider"></div>

          <div class="preview-info" style="margin-bottom:1rem">
            <div class="info-row"><span>Name</span><span class="status-value">${this.escapeHtml(this.mintTokenInfo.name)}</span></div>
            <div class="info-row"><span>Symbol</span><span class="status-value">${this.escapeHtml(this.mintTokenInfo.symbol)}</span></div>
            <div class="info-row"><span>Decimals</span><span class="status-value">${this.mintTokenInfo.decimals}</span></div>
            <div class="info-row"><span>Current Supply</span><span class="status-value">${(parseInt(this.mintTokenInfo.totalSupply) / Math.pow(10, this.mintTokenInfo.decimals)).toLocaleString()}</span></div>
            <div class="info-row"><span>Max Supply</span><span class="status-value">${this.mintTokenInfo.maxSupply === '0' ? 'Infinite' : (parseInt(this.mintTokenInfo.maxSupply) / Math.pow(10, this.mintTokenInfo.decimals)).toLocaleString()}</span></div>
          </div>

          <div class="input-group">
            <label for="ct-mint-amount">Amount to Mint *</label>
            <input
              type="number"
              id="ct-mint-amount"
              class="token-input"
              min="1"
              placeholder="Enter amount"
              value="${this.mintAmount || ''}"
            />
          </div>

          <button
            class="terminal-button"
            id="ct-execute-mint"
            ${!canMint ? 'disabled' : ''}
            style="margin-top:1rem"
          >
            ⚡ MINT TOKENS
          </button>
        ` : ''}
      </div>`;
  }

  private static renderMintPreview(): string {
    if (!this.mintTokenInfo) {
      return `
        <div class="cc-right-content">
          <h4 class="section-title" style="font-size:0.95rem">Mint Additional Supply</h4>
          <div class="result-block">
            <label>Instructions</label>
            <p style="font-size:0.82rem;color:var(--terminal-text);margin:0">
              1. Enter the Token ID of the token you want to mint more supply for
            </p>
            <p style="font-size:0.82rem;color:var(--terminal-text);margin:0.5rem 0 0">
              2. Click "Validate Token" to fetch token information
            </p>
            <p style="font-size:0.82rem;color:var(--terminal-text);margin:0.5rem 0 0">
              3. Enter the amount to mint and confirm
            </p>
          </div>
          <div class="result-block" style="margin-top:1rem">
            <label>Requirements</label>
            <p style="font-size:0.82rem;color:var(--terminal-text);margin:0">
              • Your wallet must be the treasury account (has supply key)
            </p>
            <p style="font-size:0.82rem;color:var(--terminal-text);margin:0.5rem 0 0">
              • Token must have supply key enabled
            </p>
            <p style="font-size:0.82rem;color:var(--terminal-text);margin:0.5rem 0 0">
              • If finite supply, new total cannot exceed max supply
            </p>
          </div>
        </div>`;
    }

    const currentSupply = parseInt(this.mintTokenInfo.totalSupply) / Math.pow(10, this.mintTokenInfo.decimals);
    const newSupply = currentSupply + this.mintAmount;
    const maxSupply = this.mintTokenInfo.maxSupply === '0' ? 0 : parseInt(this.mintTokenInfo.maxSupply) / Math.pow(10, this.mintTokenInfo.decimals);
    const exceedsMax = maxSupply > 0 && newSupply > maxSupply;

    return `
      <div class="cc-right-content">
        <h4 class="section-title" style="font-size:0.95rem">Mint Preview</h4>

        <div class="preview-info">
          <div class="info-row"><span>Current Supply</span><span class="status-value">${currentSupply.toLocaleString()}</span></div>
          <div class="info-row"><span>Amount to Mint</span><span class="status-value">+${this.mintAmount.toLocaleString()}</span></div>
          <div class="info-row"><span>New Total Supply</span><span class="status-value ${exceedsMax ? 'error' : ''}">${newSupply.toLocaleString()}</span></div>
          ${maxSupply > 0 ? `<div class="info-row"><span>Max Supply</span><span class="status-value">${maxSupply.toLocaleString()}</span></div>` : ''}
        </div>

        ${exceedsMax ? `
          <div class="result-block" style="margin-top:1rem;border-left:3px solid var(--terminal-red)">
            <p style="font-size:0.82rem;color:var(--terminal-red);margin:0">
              ⚠ Error: New supply (${newSupply.toLocaleString()}) would exceed max supply (${maxSupply.toLocaleString()})
            </p>
          </div>
        ` : ''}

        <div class="result-block" style="margin-top:1rem">
          <label style="font-size:0.75rem;opacity:0.6">Hedera Token Service — Token Mint</label>
        </div>
      </div>`;
  }

  private static renderMintSuccessPanel(): string {
    const newSupply = this.mintTokenInfo
      ? (parseInt(this.mintTokenInfo.totalSupply) / Math.pow(10, this.mintTokenInfo.decimals)) + this.mintAmount
      : 0;

    return `
      <div class="art-gen-section">
        <h3 class="section-title">◆ Tokens Minted ✓</h3>
        <div class="back-link" id="ct-back"><span class="back-arrow">←</span><span>Back to Home</span></div>

        <div class="preview-info">
          <div class="info-row"><span>Token ID</span><span class="status-value">${this.mintTokenId}</span></div>
          <div class="info-row"><span>Amount Minted</span><span class="status-value">+${this.mintAmount.toLocaleString()}</span></div>
          <div class="info-row"><span>New Total Supply</span><span class="status-value">${newSupply.toLocaleString()}</span></div>
          <div class="info-row"><span>Transaction ID</span><span class="status-value" style="font-size:0.75rem">${this.mintTxId}</span></div>
        </div>

        <button class="terminal-button" id="ct-mint-more" style="margin-top:1rem">MINT MORE</button>
        <button class="terminal-button secondary" id="ct-new" style="margin-top:0.5rem">CREATE NEW TOKEN</button>
      </div>`;
  }

  // --- VALIDATION ---
  private static canCreate(): boolean {
    if (!this.tokenName.trim()) return false;
    if (!this.symbol.trim()) return false;
    if (this.decimals < 0 || this.decimals > 18) return false;
    if (this.initialSupply < 1) return false;
    const ws = WalletConnectService.getState();
    if (!ws.connected) return false;
    if (this.customFeesEnabled && !this.feeCollector.trim()) return false;
    return true;
  }

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

  private static refreshPreview(): void {
    const rightPanel = document.querySelector('.art-gen-right');
    if (rightPanel && this.step === 'form') {
      rightPanel.innerHTML = this.renderPreview();
    }
    const btn = document.getElementById('ct-create-btn') as HTMLButtonElement;
    if (btn) btn.disabled = !this.canCreate();
  }

  private static refreshMintPreview(): void {
    const rightPanel = document.querySelector('.art-gen-right');
    if (rightPanel && this.step === 'mint-form') {
      rightPanel.innerHTML = this.renderMintPreview();
    }
    const btn = document.getElementById('ct-execute-mint') as HTMLButtonElement;
    if (btn) {
      const canMint = this.mintTokenInfo && this.mintAmount > 0;
      const maxSupply = this.mintTokenInfo?.maxSupply === '0' ? 0 : parseInt(this.mintTokenInfo?.maxSupply || '0') / Math.pow(10, this.mintTokenInfo?.decimals || 0);
      const currentSupply = parseInt(this.mintTokenInfo?.totalSupply || '0') / Math.pow(10, this.mintTokenInfo?.decimals || 0);
      const newSupply = currentSupply + this.mintAmount;
      const exceedsMax = maxSupply > 0 && newSupply > maxSupply;
      btn.disabled = !canMint || exceedsMax;
    }
  }

  static resetForm(): void {
    this.tokenName = '';
    this.symbol = '';
    this.decimals = 8;
    this.initialSupply = 1000000;
    this.maxSupply = 0;
    this.memo = '';
    this.imageFile = null;
    this.imagePreview = null;
    this.customFeesEnabled = false;
    this.feeType = 'fractional';
    this.fractionalPercent = 1;
    this.fractionalMin = 0;
    this.fractionalMax = 0;
    this.fixedAmount = 1;
    this.feeCollector = '';
    this.mintTokenId = '';
    this.mintAmount = 0;
    this.mintTokenInfo = null;
    this.mintTxId = null;
    this.keyAdmin = true;
    this.keySupply = true;
    this.keyMetadata = true;
    this.keyFreeze = false;
    this.keyWipe = false;
    this.keyPause = false;
    this.keyFeeSchedule = false;
    this.step = 'mode-select';
    this.loading = false;
    this.error = null;
    this.statusMessage = '';
    this.tokenId = null;
  }

  // --- INIT: wire up event listeners ---
  static init(): void {
    // Back button
    document.getElementById('ct-back')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('navigate-to-tool', { detail: { toolId: 'home' } }));
    });

    // Mode selection buttons
    document.getElementById('ct-mode-create')?.addEventListener('click', () => {
      this.step = 'form';
      this.refresh();
    });

    document.getElementById('ct-mode-mint')?.addEventListener('click', () => {
      this.step = 'mint-form';
      this.refresh();
    });

    // Mint form back button
    document.getElementById('ct-mint-back')?.addEventListener('click', () => {
      this.mintTokenId = '';
      this.mintAmount = 0;
      this.mintTokenInfo = null;
      this.step = 'mode-select';
      this.refresh();
    });

    // Mint token ID input
    const mintTokenIdInput = document.getElementById('ct-mint-token-id') as HTMLInputElement;
    mintTokenIdInput?.addEventListener('input', () => {
      this.mintTokenId = mintTokenIdInput.value;
      // Update button state
      const validateBtn = document.getElementById('ct-validate-token') as HTMLButtonElement;
      if (validateBtn) {
        const ws = WalletConnectService.getState();
        validateBtn.disabled = !this.mintTokenId.trim() || !ws.connected;
      }
    });

    // Validate token button
    document.getElementById('ct-validate-token')?.addEventListener('click', () => {
      console.log('Validate token button clicked, token ID:', this.mintTokenId);
      this.validateMintToken();
    });

    // Mint amount input
    const mintAmountInput = document.getElementById('ct-mint-amount') as HTMLInputElement;
    mintAmountInput?.addEventListener('input', () => {
      this.mintAmount = parseInt(mintAmountInput.value) || 0;
      this.refreshMintPreview();
    });

    // Execute mint button
    document.getElementById('ct-execute-mint')?.addEventListener('click', () => {
      this.executeMint();
    });

    // Mint more button (from success screen)
    document.getElementById('ct-mint-more')?.addEventListener('click', () => {
      this.mintTokenId = '';
      this.mintAmount = 0;
      this.mintTokenInfo = null;
      this.mintTxId = null;
      this.step = 'mint-form';
      this.refresh();
    });

    // Text inputs
    const nameInput = document.getElementById('ct-name') as HTMLInputElement;
    const symbolInput = document.getElementById('ct-symbol') as HTMLInputElement;
    const decimalsInput = document.getElementById('ct-decimals') as HTMLInputElement;
    const initialSupplyInput = document.getElementById('ct-initial-supply') as HTMLInputElement;
    const maxSupplyInput = document.getElementById('ct-max-supply') as HTMLInputElement;
    const memoInput = document.getElementById('ct-memo') as HTMLInputElement;

    nameInput?.addEventListener('input', () => { this.tokenName = nameInput.value; this.refreshPreview(); });
    symbolInput?.addEventListener('input', () => { this.symbol = symbolInput.value; this.refreshPreview(); });
    decimalsInput?.addEventListener('input', () => { this.decimals = parseInt(decimalsInput.value) || 0; this.refreshPreview(); });
    initialSupplyInput?.addEventListener('input', () => { this.initialSupply = parseInt(initialSupplyInput.value) || 0; this.refreshPreview(); });
    maxSupplyInput?.addEventListener('input', () => { this.maxSupply = parseInt(maxSupplyInput.value) || 0; this.refreshPreview(); });
    memoInput?.addEventListener('input', () => { this.memo = memoInput.value; this.refreshPreview(); });

    // Image upload
    const imageZone = document.getElementById('ct-image-zone');
    const imageInput = document.getElementById('ct-image-input') as HTMLInputElement;
    imageZone?.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.id !== 'ct-image-remove') imageInput?.click();
    });
    imageInput?.addEventListener('change', () => {
      const file = imageInput.files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = () => { this.imageFile = file; this.imagePreview = reader.result as string; this.refresh(); };
        reader.readAsDataURL(file);
      }
    });
    document.getElementById('ct-image-remove')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.imageFile = null;
      this.imagePreview = null;
      this.refresh();
    });

    // Custom fees toggle
    document.getElementById('ct-fees-toggle')?.addEventListener('change', (e) => {
      this.customFeesEnabled = (e.target as HTMLInputElement).checked;
      this.refresh();
    });

    // Fee type buttons
    document.getElementById('ct-fee-fractional')?.addEventListener('click', () => {
      this.feeType = 'fractional';
      this.refresh();
    });
    document.getElementById('ct-fee-fixed')?.addEventListener('click', () => {
      this.feeType = 'fixed';
      this.refresh();
    });

    // Fee inputs
    const fracPct = document.getElementById('ct-frac-pct') as HTMLInputElement;
    const fracMin = document.getElementById('ct-frac-min') as HTMLInputElement;
    const fracMax = document.getElementById('ct-frac-max') as HTMLInputElement;
    const fixedAmt = document.getElementById('ct-fixed-amt') as HTMLInputElement;
    const feeCollector = document.getElementById('ct-fee-collector') as HTMLInputElement;

    fracPct?.addEventListener('input', () => { this.fractionalPercent = parseFloat(fracPct.value) || 0; this.refreshPreview(); });
    fracMin?.addEventListener('input', () => { this.fractionalMin = parseInt(fracMin.value) || 0; this.refreshPreview(); });
    fracMax?.addEventListener('input', () => { this.fractionalMax = parseInt(fracMax.value) || 0; this.refreshPreview(); });
    fixedAmt?.addEventListener('input', () => { this.fixedAmount = parseFloat(fixedAmt.value) || 0; this.refreshPreview(); });
    feeCollector?.addEventListener('input', () => { this.feeCollector = feeCollector.value; this.refreshPreview(); });

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
    document.getElementById('ct-create-btn')?.addEventListener('click', () => { this.createToken(); });

    // Dismiss error
    document.getElementById('ct-dismiss-error')?.addEventListener('click', () => { this.error = null; this.refresh(); });

    // New token button (from success screen)
    document.getElementById('ct-new')?.addEventListener('click', () => { this.resetForm(); this.refresh(); });
  }

  // --- TRANSACTION LOGIC ---
  private static async createToken(): Promise<void> {
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

      // 2. Pin image & metadata to IPFS if image provided
      let metadataBytes: Uint8Array | null = null;
      if (this.imageFile) {
        this.statusMessage = 'Pinning token image to IPFS...';
        this.refresh();
        metadataBytes = await this.pinTokenMetadata();
      }

      // 3. Build the TokenCreateTransaction
      this.statusMessage = 'Building transaction...';
      this.refresh();

      const tx = new TokenCreateTransaction()
        .setTokenName(this.tokenName.trim())
        .setTokenSymbol(this.symbol.trim())
        .setTokenType(TokenType.FungibleCommon)
        .setDecimals(this.decimals)
        .setInitialSupply(this.initialSupply * Math.pow(10, this.decimals))
        .setTreasuryAccountId(AccountId.fromString(accountId));

      if (this.maxSupply > 0) {
        tx.setSupplyType(TokenSupplyType.Finite);
        tx.setMaxSupply(this.maxSupply * Math.pow(10, this.decimals));
      } else {
        tx.setSupplyType(TokenSupplyType.Infinite);
      }

      if (this.memo.trim()) tx.setTokenMemo(this.memo.trim());
      if (metadataBytes) tx.setMetadata(metadataBytes);

      // Conditionally set keys
      if (this.keyAdmin) tx.setAdminKey(pubKey);
      if (this.keySupply) tx.setSupplyKey(pubKey);
      if (this.keyMetadata) tx.setMetadataKey(pubKey);
      if (this.keyFreeze) tx.setFreezeKey(pubKey);
      if (this.keyWipe) tx.setWipeKey(pubKey);
      if (this.keyPause) tx.setPauseKey(pubKey);
      if (this.keyFeeSchedule) tx.setFeeScheduleKey(pubKey);

      // Add custom fees
      if (this.customFeesEnabled && this.feeCollector.trim()) {
        if (this.feeType === 'fractional') {
          const fee = new CustomFractionalFee()
            .setNumerator(Math.round(this.fractionalPercent * 100))
            .setDenominator(10000)
            .setMin(this.fractionalMin)
            .setMax(this.fractionalMax)
            .setFeeCollectorAccountId(AccountId.fromString(this.feeCollector.trim()));
          tx.setCustomFees([fee]);
        } else {
          const fee = new CustomFixedFee()
            .setHbarAmount(new Hbar(this.fixedAmount))
            .setFeeCollectorAccountId(AccountId.fromString(this.feeCollector.trim()));
          tx.setCustomFees([fee]);
        }
      }

      // 3. Freeze & execute via WalletConnect
      this.statusMessage = 'Waiting for wallet approval...';
      this.refresh();

      const signer = WalletConnectService.getSigner(accountId);
      const acctId = AccountId.fromString(accountId);
      tx.setTransactionId(TransactionId.generate(acctId));
      tx.freezeWith(getHederaClient());
      const txResponse = await tx.executeWithSigner(signer);

      this.statusMessage = 'Getting receipt...';
      this.refresh();

      // Try to get receipt
      let tokenId: string | null = null;
      if (txResponse && typeof (txResponse as any).getReceiptWithSigner === 'function') {
        const receipt = await (txResponse as any).getReceiptWithSigner(signer);
        tokenId = receipt?.tokenId?.toString() || null;
      }

      // Fallback: poll mirror node
      if (!tokenId && txResponse?.transactionId) {
        this.statusMessage = 'Confirming on network...';
        this.refresh();
        tokenId = await this.pollForTokenId(txResponse.transactionId.toString());
      }

      if (!tokenId) {
        tokenId = 'Check HashScan for Token ID';
      }

      this.tokenId = tokenId;
      this.step = 'success';
      this.loading = false;
      this.statusMessage = `Token created: ${tokenId}`;
      this.refresh();
    } catch (err: any) {
      console.error('Create token error:', err);
      this.loading = false;
      this.error = err.message || 'Failed to create token';
      this.statusMessage = '';
      this.refresh();
    }
  }

  // Pin token image + metadata to IPFS via backend (reuses collection metadata endpoint)
  private static async pinTokenMetadata(): Promise<Uint8Array> {
    const formData = new FormData();
    if (this.imageFile) formData.append('logo', this.imageFile);
    if (this.tokenName) formData.append('collectionName', this.tokenName);

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

  // Fetch the account's public key from mirror node
  private static async fetchPublicKey(accountId: string): Promise<PublicKey> {
    const res = await fetch(`${MIRROR_NODE_URL}/api/v1/accounts/${accountId}`);
    if (!res.ok) throw new Error(`Failed to fetch account info for ${accountId}`);
    const data = await res.json();
    if (!data.key?.key) throw new Error('Could not find public key for account');
    return PublicKey.fromString(data.key.key);
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

  // --- MINT ADDITIONAL SUPPLY LOGIC ---
  private static async validateMintToken(): Promise<void> {
    console.log('validateMintToken called, token ID:', this.mintTokenId);
    this.loading = true;
    this.error = null;
    this.statusMessage = 'Validating token...';
    this.refresh();

    try {
      const ws = WalletConnectService.getState();
      if (!ws.connected || !ws.accountId) throw new Error('Wallet not connected');

      // Fetch token info from mirror node
      const res = await fetch(`${MIRROR_NODE_URL}/api/v1/tokens/${this.mintTokenId}`);
      if (!res.ok) throw new Error(`Token ${this.mintTokenId} not found`);

      const data = await res.json();

      // Validate it's a fungible token
      if (data.type !== 'FUNGIBLE_COMMON') {
        throw new Error('Only fungible tokens can be minted using this tool. Use the Mint NFTs tool for NFT collections.');
      }

      // Check if token has supply key
      if (!data.supply_key) {
        throw new Error('This token does not have a supply key enabled. Cannot mint additional supply.');
      }

      // Check if connected wallet is the treasury account
      if (data.treasury_account_id !== ws.accountId) {
        throw new Error(`Your wallet (${ws.accountId}) is not the treasury account for this token. Only the treasury account can mint additional supply.`);
      }

      // Store token info
      this.mintTokenInfo = {
        name: data.name || 'Unnamed',
        symbol: data.symbol || '',
        decimals: parseInt(data.decimals) || 0,
        totalSupply: data.total_supply || '0',
        maxSupply: data.max_supply || '0',
        supplyKey: data.supply_key?.key || null,
        treasuryAccountId: data.treasury_account_id,
      };

      this.loading = false;
      this.statusMessage = '';
      this.refresh();
    } catch (err: any) {
      console.error('Validate token error:', err);
      this.loading = false;
      this.error = err.message || 'Failed to validate token';
      this.statusMessage = '';
      this.refresh();
    }
  }

  private static async executeMint(): Promise<void> {
    if (!this.mintTokenInfo || this.mintAmount <= 0) return;

    // Validate against max supply
    const maxSupply = this.mintTokenInfo.maxSupply === '0' ? 0 : parseInt(this.mintTokenInfo.maxSupply);
    const currentSupply = parseInt(this.mintTokenInfo.totalSupply);
    const amountInSmallestUnit = this.mintAmount * Math.pow(10, this.mintTokenInfo.decimals);
    const newSupply = currentSupply + amountInSmallestUnit;

    if (maxSupply > 0 && newSupply > maxSupply) {
      this.error = `Cannot mint ${this.mintAmount.toLocaleString()} tokens. New supply would exceed max supply.`;
      this.refresh();
      return;
    }

    this.loading = true;
    this.error = null;
    this.step = 'minting';
    this.statusMessage = 'Preparing mint transaction...';
    this.refresh();

    try {
      const ws = WalletConnectService.getState();
      if (!ws.connected || !ws.accountId) throw new Error('Wallet not connected');
      const accountId = ws.accountId;

      // Build TokenMintTransaction
      this.statusMessage = 'Building transaction...';
      this.refresh();

      const tx = new TokenMintTransaction()
        .setTokenId(this.mintTokenId)
        .setAmount(amountInSmallestUnit)
        .setTransactionId(TransactionId.generate(AccountId.fromString(accountId)));

      // Freeze & execute via WalletConnect
      this.statusMessage = 'Waiting for wallet approval...';
      this.refresh();

      const signer = WalletConnectService.getSigner(accountId);
      const frozenTx = tx.freezeWith(getHederaClient());
      const txResponse = await frozenTx.executeWithSigner(signer);

      this.statusMessage = 'Getting receipt...';
      this.refresh();

      // Get transaction ID
      const txId = txResponse?.transactionId?.toString() || 'Unknown';
      this.mintTxId = txId;

      // Update total supply for display
      this.mintTokenInfo.totalSupply = newSupply.toString();

      this.step = 'mint-success';
      this.loading = false;
      this.statusMessage = `Minted ${this.mintAmount.toLocaleString()} tokens`;
      this.refresh();
    } catch (err: any) {
      console.error('Mint token error:', err);
      this.loading = false;
      this.step = 'mint-form';
      this.error = err.message || 'Failed to mint tokens';
      this.statusMessage = '';
      this.refresh();
    }
  }
}

