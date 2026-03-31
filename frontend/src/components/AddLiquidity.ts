/**
 * Add Liquidity Component
 * Adds liquidity to SaucerSwap V1 HBAR/Token pools via ContractExecuteTransaction + WalletConnect
 */
import WalletConnectService from '../services/WalletConnectService'
import { MIRROR_NODE_URL, SAUCER_V1_ROUTER, WHBAR_TOKEN_ID, SAUCERSWAP_API_KEY, SAUCERSWAP_API_URL, getHederaClient } from '../config'
import {
  ContractExecuteTransaction,
  ContractFunctionParameters,
  AccountAllowanceApproveTransaction,
  AccountUpdateTransaction,
  TokenAssociateTransaction,
  ContractId,
  TokenId,
  AccountId,
  Hbar,
  TransactionId,
} from '@hashgraph/sdk'

type LiquidityStep = 'token-input' | 'pool-selection' | 'new-pool-input' | 'liquidity-form' | 'processing' | 'success';

interface PoolInfo {
  id: number;
  contractId: string;
  tokenA: { id: string; symbol: string; decimals: number; priceUsd?: number };
  tokenB: { id: string; symbol: string; decimals: number; priceUsd?: number };
  tokenReserveA: string;
  tokenReserveB: string;
  lpToken: { id: string; symbol: string };
}

export class AddLiquidity {
  // Form state
  private static tokenIdInput = '';
  private static tokenValidated = false;
  private static tokenInfo: { tokenId: string; name: string; symbol: string; decimals: number; hasCustomFees: boolean; priceUsd?: number } | null = null;
  private static tokenError: string | null = null;

  // Pool selection
  private static availablePools: PoolInfo[] = [];
  private static selectedPool: PoolInfo | null = null;

  // Second token (for new pool creation)
  private static tokenBType: 'hbar' | 'hts' = 'hbar'; // Default to HBAR
  private static tokenBIdInput = '';
  private static tokenBValidated = false;
  private static tokenBInfo: { tokenId: string; name: string; symbol: string; decimals: number; hasCustomFees: boolean; priceUsd?: number } | null = null;
  private static tokenBError: string | null = null;

  // Pricing
  private static hbarPriceUsd: number = 0;

  // Pool creation fee
  private static poolCreationFeeTinybar: number = 0;

  // Amounts
  private static tokenAmount = '';
  private static hbarAmount = '';
  private static slippage = 1.5; // percent

  // UI state
  private static step: LiquidityStep = 'token-input';
  private static loading = false;
  private static error: string | null = null;
  private static statusMessage = '';

  // Result
  private static txId: string | null = null;

  // --- RENDER ---
  static render(): string {
    return `<div class="terminal-window">${this.renderChrome()}${this.renderContent()}${this.renderStatusBar()}</div>`;
  }

  private static renderChrome(): string {
    return `<div class="window-chrome"><div class="window-controls"><div class="window-dot close"></div><div class="window-dot minimize"></div><div class="window-dot maximize"></div></div><div class="window-title">hedera-creator-kit — add liquidity</div></div>`;
  }

  private static renderStatusBar(): string {
    const ws = WalletConnectService.getState();
    const walletInfo = ws.connected ? `${ws.accountId} | ${ws.hbarBalance || '0'} ℏ` : 'Not Connected';
    return `<div class="status-bar"><div class="status-left"><div class="status-item"><div class="status-indicator"></div><span>${walletInfo}</span></div></div><div class="status-center"><span class="status-highlight">${this.statusMessage}</span></div><div class="status-right"><div class="status-item"><span>Add Liquidity</span></div></div></div>`;
  }

  private static renderContent(): string {
    return `<div class="terminal-content"><div class="art-gen-layout"><div class="art-gen-left">${this.renderLeftPanel()}</div><div class="art-gen-right">${this.renderRightPanel()}</div></div></div>`;
  }

  private static renderLeftPanel(): string {
    if (this.loading) {
      return `<div class="art-gen-section"><h3 class="section-title">◆ Adding Liquidity</h3><div class="loading-state"><div class="spinner"></div><p>${this.statusMessage || 'Processing...'}</p></div></div>`;
    }
    switch (this.step) {
      case 'token-input': return this.renderTokenInput();
      case 'pool-selection': return this.renderPoolSelection();
      case 'new-pool-input': return this.renderNewPoolInput();
      case 'liquidity-form': return this.renderLiquidityForm();
      case 'success': return this.renderSuccessPanel();
      default: return '';
    }
  }

  private static renderRightPanel(): string {
    if (this.loading) {
      return `<div class="loading-state"><div class="spinner"></div><p>${this.statusMessage || 'Processing...'}</p></div>`;
    }
    if (this.error) {
      return `<div class="cc-right-content"><div class="error-state"><p class="error-message">⚠ ${this.error}</p><button class="terminal-button" id="al-dismiss-error" style="margin-top:1rem">DISMISS</button></div></div>`;
    }
    switch (this.step) {
      case 'token-input': return this.renderTokenPreview();
      case 'pool-selection': return this.renderPoolSelectionPreview();
      case 'new-pool-input': return this.renderNewPoolPreview();
      case 'liquidity-form': return this.renderLiquidityPreview();
      case 'success': return this.renderSuccessDetails();
      default: return '';
    }
  }

  // --- TOKEN INPUT STEP ---
  private static renderTokenInput(): string {
    const tokenValid = this.tokenValidated && this.tokenInfo;
    return `
      <div class="art-gen-section">
        <h3 class="section-title">◆ Add Liquidity — SaucerSwap V1</h3>
        <div class="back-link" id="al-back"><span class="back-arrow">←</span><span>Back</span></div>

        <div style="margin:0.75rem 0;padding:0.6rem 0.8rem;background:rgba(100,180,255,0.08);border:1px solid rgba(100,180,255,0.25);border-radius:6px">
          <p style="font-size:0.78rem;color:#64b4ff;margin:0 0 0.35rem">◆ <strong>SaucerSwap V1</strong> — Add liquidity to token pairs. You will receive LP tokens representing your share of the pool.</p>
          <p style="font-size:0.78rem;color:#f0a040;margin:0">⚠ <strong>Tokens with custom fees</strong> may behave unexpectedly on DEXes. Proceed with caution if your token has fractional or fixed fees.</p>
        </div>

        <div class="filter-divider"></div>

        <div class="input-group">
          <label for="al-token-id">Token ID *</label>
          <div class="input-row" style="gap:0.5rem">
            <input type="text" id="al-token-id" class="token-input" placeholder="0.0.xxxxx" value="${this.escapeHtml(this.tokenIdInput)}" style="flex:1" />
            <button class="terminal-button" id="al-validate" style="white-space:nowrap">${this.loading ? '...' : 'VALIDATE'}</button>
          </div>
          ${this.tokenError ? `<p style="font-size:0.78rem;color:#ff6b6b;margin:0.35rem 0 0">${this.tokenError}</p>` : ''}
          ${tokenValid ? `<p style="font-size:0.78rem;color:#6bff9e;margin:0.35rem 0 0">✓ ${this.tokenInfo!.name} (${this.tokenInfo!.symbol}) — ${this.tokenInfo!.decimals} decimals</p>` : ''}
        </div>
      </div>`;
  }

  // --- POOL SELECTION STEP ---
  private static renderPoolSelection(): string {
    return `
      <div class="art-gen-section">
        <h3 class="section-title">◆ Select Pool</h3>
        <div class="back-link" id="al-back-to-token"><span class="back-arrow">←</span><span>Back</span></div>

        <div style="margin:0.75rem 0;padding:0.6rem 0.8rem;background:rgba(100,180,255,0.08);border:1px solid rgba(100,180,255,0.25);border-radius:6px">
          <p style="font-size:0.78rem;color:#64b4ff;margin:0">Token: <strong>${this.tokenInfo?.name} (${this.tokenInfo?.symbol})</strong></p>
        </div>

        <div class="filter-divider"></div>

        <p style="font-size:0.82rem;color:var(--terminal-text);opacity:0.7;margin:0 0 1rem">
          ${this.availablePools.length > 0
            ? `Found ${this.availablePools.length} existing pool${this.availablePools.length === 1 ? '' : 's'}. Select a pool from the right panel to add liquidity, or create a new pool below.`
            : 'No existing pools found for this token. Create a new pool below.'}
        </p>

        <button class="terminal-button" id="al-create-new-pool" style="width:100%">+ CREATE NEW POOL</button>
      </div>`;
  }

  private static renderPoolCard(pool: PoolInfo, idx: number): string {
    const reserveA = parseFloat(pool.tokenReserveA) / Math.pow(10, pool.tokenA.decimals);
    const reserveB = parseFloat(pool.tokenReserveB) / Math.pow(10, pool.tokenB.decimals);

    const liquidityUsd = (pool.tokenA.priceUsd && pool.tokenB.priceUsd)
      ? ((reserveA * pool.tokenA.priceUsd) + (reserveB * pool.tokenB.priceUsd)).toFixed(2)
      : null;

    return `
      <div class="pool-card" data-pool-idx="${idx}" style="margin-bottom:0.75rem;padding:0.75rem;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.1);border-radius:6px;cursor:pointer;transition:all 0.2s" onmouseover="this.style.borderColor='rgba(13,147,115,0.5)'" onmouseout="this.style.borderColor='rgba(255,255,255,0.1)'">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem">
          <h5 style="font-size:0.9rem;color:#6bff9e;margin:0">${pool.tokenA.symbol} / ${pool.tokenB.symbol}</h5>
          ${liquidityUsd ? `<span style="font-size:0.82rem;color:#64b4ff">$${liquidityUsd}</span>` : ''}
        </div>
        <div style="font-size:0.75rem;color:var(--terminal-text);opacity:0.7">
          <div>Pool: ${pool.contractId}</div>
          <div style="margin-top:0.25rem">${reserveA.toLocaleString()} ${pool.tokenA.symbol} + ${reserveB.toLocaleString()} ${pool.tokenB.symbol}</div>
        </div>
        <button class="terminal-button" id="al-select-pool-${idx}" style="margin-top:0.5rem;width:100%;font-size:0.8rem">SELECT POOL</button>
      </div>`;
  }

  // --- NEW POOL INPUT STEP ---
  private static renderNewPoolInput(): string {
    const tokenBValid = this.tokenBValidated && this.tokenBInfo;
    const showHtsInput = this.tokenBType === 'hts';

    return `
      <div class="art-gen-section">
        <h3 class="section-title">◆ Create New Pool</h3>
        <div class="back-link" id="al-back-to-pools"><span class="back-arrow">←</span><span>Back to Pools</span></div>

        <div style="margin:0.75rem 0;padding:0.6rem 0.8rem;background:rgba(100,180,255,0.08);border:1px solid rgba(100,180,255,0.25);border-radius:6px">
          <p style="font-size:0.78rem;color:#64b4ff;margin:0 0 0.35rem">Token A: <strong>${this.tokenInfo?.name} (${this.tokenInfo?.symbol})</strong></p>
          <p style="font-size:0.78rem;color:#f0a040;margin:0">⚠ Pool creation fee: ~$50 in HBAR (one-time fee paid to SaucerSwap)</p>
        </div>

        <div class="filter-divider"></div>

        <div class="input-group">
          <label>Token B Type *</label>
          <div style="display:flex;gap:0.5rem">
            <button class="terminal-button" id="al-select-hbar" style="flex:1;background:${this.tokenBType === 'hbar' ? 'rgba(13,147,115,0.3)' : 'transparent'};border-color:${this.tokenBType === 'hbar' ? '#0d9373' : 'rgba(255,255,255,0.2)'}">HBAR</button>
            <button class="terminal-button" id="al-select-hts" style="flex:1;background:${this.tokenBType === 'hts' ? 'rgba(13,147,115,0.3)' : 'transparent'};border-color:${this.tokenBType === 'hts' ? '#0d9373' : 'rgba(255,255,255,0.2)'}">HTS Token</button>
          </div>
        </div>

        ${showHtsInput ? `
          <div class="input-group">
            <label for="al-token-b-id">Token B ID *</label>
            <div class="input-row" style="gap:0.5rem">
              <input type="text" id="al-token-b-id" class="token-input" placeholder="0.0.xxxxx" value="${this.escapeHtml(this.tokenBIdInput)}" style="flex:1" />
              <button class="terminal-button" id="al-validate-b" style="white-space:nowrap">${this.loading ? '...' : 'VALIDATE'}</button>
            </div>
            ${this.tokenBError ? `<p style="font-size:0.78rem;color:#ff6b6b;margin:0.35rem 0 0">${this.tokenBError}</p>` : ''}
            ${tokenBValid ? `<p style="font-size:0.78rem;color:#6bff9e;margin:0.35rem 0 0">✓ ${this.tokenBInfo!.name} (${this.tokenBInfo!.symbol}) — ${this.tokenBInfo!.decimals} decimals</p>` : ''}
          </div>
        ` : `
          <div style="margin:0.75rem 0;padding:0.6rem 0.8rem;background:rgba(107,255,158,0.08);border:1px solid rgba(107,255,158,0.25);border-radius:6px">
            <p style="font-size:0.78rem;color:#6bff9e;margin:0">✓ Token B: <strong>HBAR (Native Token)</strong></p>
          </div>
          <div class="filter-divider"></div>
          <button class="terminal-button" id="al-confirm-hbar" style="width:100%">CONTINUE WITH HBAR</button>
        `}
      </div>`;
  }

  // --- LIQUIDITY FORM STEP ---
  private static renderLiquidityForm(): string {
    const tokenA = this.selectedPool ? (this.selectedPool.tokenA.id === this.tokenInfo?.tokenId ? this.selectedPool.tokenA : this.selectedPool.tokenB) : this.tokenInfo;
    const tokenB = this.selectedPool ? (this.selectedPool.tokenA.id === this.tokenInfo?.tokenId ? this.selectedPool.tokenB : this.selectedPool.tokenA) : this.tokenBInfo;

    if (!tokenA || !tokenB) return '';

    const canSubmit = this.tokenAmount && this.hbarAmount && parseFloat(this.tokenAmount) > 0 && parseFloat(this.hbarAmount) > 0;

    // For existing pools: compute the current ratio for display and enforce read-only Token B.
    // Reserves from SaucerSwap API are in each token's smallest units.
    let ratioHtml = '';
    const isExistingPool = !!this.selectedPool;
    if (isExistingPool && this.selectedPool) {
      const isTokenAinPoolA = this.selectedPool.tokenA.id === this.tokenInfo?.tokenId;
      const rawReserveA = parseFloat(isTokenAinPoolA ? this.selectedPool.tokenReserveA : this.selectedPool.tokenReserveB);
      const rawReserveB = parseFloat(isTokenAinPoolA ? this.selectedPool.tokenReserveB : this.selectedPool.tokenReserveA);
      const reserveAHuman = rawReserveA / Math.pow(10, tokenA.decimals);
      const reserveBHuman = rawReserveB / Math.pow(10, tokenB.decimals);
      const ratio = reserveAHuman > 0 ? (reserveBHuman / reserveAHuman) : 0;
      ratioHtml = `<p style="font-size:0.75rem;color:var(--terminal-text);opacity:0.6;margin:0.2rem 0 0">Rate: 1 ${tokenA.symbol} = ${ratio.toFixed(6)} ${tokenB.symbol}</p>`;
    }

    return `
      <div class="art-gen-section">
        <h3 class="section-title">◆ Add Liquidity</h3>
        <div class="back-link" id="al-back-to-pools"><span class="back-arrow">←</span><span>Back to Pools</span></div>

        <div style="margin:0.75rem 0;padding:0.6rem 0.8rem;background:rgba(100,180,255,0.08);border:1px solid rgba(100,180,255,0.25);border-radius:6px">
          <p style="font-size:0.78rem;color:#64b4ff;margin:0">Pool: <strong>${tokenA.symbol} / ${tokenB.symbol}</strong></p>
          ${this.selectedPool ? `<p style="font-size:0.75rem;color:var(--terminal-text);opacity:0.7;margin:0.25rem 0 0">${this.selectedPool.contractId}</p>` : ''}
          ${ratioHtml}
        </div>

        <div class="filter-divider"></div>

        <div class="input-group">
          <label for="al-token-amount">${tokenA.symbol} Amount *</label>
          <input type="number" id="al-token-amount" class="token-input" placeholder="Amount of tokens" value="${this.escapeHtml(this.tokenAmount)}" step="any" min="0" />
        </div>
        <div class="input-group">
          <label for="al-hbar-amount">${tokenB.symbol} Amount${isExistingPool ? ' (auto-calculated from pool ratio)' : ' *'}</label>
          <input type="number" id="al-hbar-amount" class="token-input" placeholder="${isExistingPool ? 'Calculated from pool ratio' : 'Amount of tokens'}" value="${this.escapeHtml(this.hbarAmount)}" step="any" min="0" ${isExistingPool ? 'readonly style="opacity:0.6;cursor:not-allowed"' : ''} />
        </div>
        <div class="input-group">
          <label for="al-slippage">Slippage Tolerance (%)</label>
          <input type="number" id="al-slippage" class="token-input" placeholder="1.5" value="${this.slippage}" step="0.5" min="0.5" max="50" style="width:80px" />
        </div>
        ${canSubmit ? `
          <div class="filter-divider"></div>
          <button class="terminal-button" id="al-submit">⚡ ADD LIQUIDITY</button>
        ` : ''}
      </div>`;
  }


  // --- PREVIEW PANELS (right panel) ---
  private static renderTokenPreview(): string {
    if (!this.tokenValidated || !this.tokenInfo) {
      return `<div class="cc-right-content"><h4 class="section-title" style="font-size:0.95rem">Token Info</h4><p style="font-size:0.82rem;color:var(--terminal-text);opacity:0.5">Enter a Token ID and click VALIDATE to see available pools.</p></div>`;
    }

    return `
      <div class="cc-right-content">
        <h4 class="section-title" style="font-size:0.95rem">Token Info</h4>
        <div class="preview-info">
          <div class="info-row"><span>Token</span><span class="status-value">${this.tokenInfo.name} (${this.tokenInfo.symbol})</span></div>
          <div class="info-row"><span>Token ID</span><span class="status-value">${this.tokenInfo.tokenId}</span></div>
          <div class="info-row"><span>Decimals</span><span class="status-value">${this.tokenInfo.decimals}</span></div>
          ${this.tokenInfo.priceUsd ? `<div class="info-row"><span>Price</span><span class="status-value">$${this.tokenInfo.priceUsd.toFixed(6)}</span></div>` : ''}
          ${this.tokenInfo.hasCustomFees ? `<div class="info-row"><span>Custom Fees</span><span class="status-value" style="color:#ff6b6b">⚠ Yes</span></div>` : ''}
        </div>
        <div class="filter-divider"></div>
        <p style="font-size:0.82rem;color:#64b4ff;margin:0">Found ${this.availablePools.length} existing pool${this.availablePools.length === 1 ? '' : 's'} for this token.</p>
      </div>`;
  }

  private static renderPoolSelectionPreview(): string {
    return `
      <div class="cc-right-content" style="display:flex;flex-direction:column;height:100%">
        <h4 class="section-title" style="font-size:0.95rem;margin-bottom:0.75rem">Available Pools (${this.availablePools.length})</h4>

        <div class="preview-info" style="margin-bottom:0.75rem">
          <div class="info-row"><span>Gas Cost (Existing)</span><span class="status-value">~0.0024 HBAR</span></div>
          <div class="info-row"><span>Gas Cost (New Pool)</span><span class="status-value">~0.032 HBAR</span></div>
          <div class="info-row"><span>Pool Creation Fee</span><span class="status-value" style="color:#f0a040">~$50 HBAR</span></div>
        </div>

        <div class="filter-divider" style="margin-bottom:0.75rem"></div>

        ${this.availablePools.length > 0 ? `
          <div style="flex:1;overflow-y:auto;min-height:0">
            ${this.availablePools.map((pool, idx) => this.renderPoolCard(pool, idx)).join('')}
          </div>
        ` : `
          <p style="font-size:0.82rem;color:var(--terminal-text);opacity:0.7;margin:0">No existing pools found for this token.</p>
        `}
      </div>`;
  }

  private static renderNewPoolPreview(): string {
    const showPreview = this.tokenBType === 'hbar' || (this.tokenBValidated && this.tokenBInfo);

    if (!showPreview) {
      return `<div class="cc-right-content"><h4 class="section-title" style="font-size:0.95rem">New Pool</h4><p style="font-size:0.82rem;color:var(--terminal-text);opacity:0.5">Select HBAR or enter an HTS Token ID to create a new pool.</p></div>`;
    }

    const tokenBSymbol = this.tokenBType === 'hbar' ? 'HBAR' : this.tokenBInfo?.symbol;
    const tokenBPrice = this.tokenBType === 'hbar' ? this.hbarPriceUsd : this.tokenBInfo?.priceUsd;

    return `
      <div class="cc-right-content">
        <h4 class="section-title" style="font-size:0.95rem">New Pool Preview</h4>
        <div class="preview-info">
          <div class="info-row"><span>Token A</span><span class="status-value">${this.tokenInfo?.symbol}</span></div>
          <div class="info-row"><span>Token B</span><span class="status-value">${tokenBSymbol}</span></div>
          ${this.tokenInfo?.priceUsd ? `<div class="info-row"><span>${this.tokenInfo.symbol} Price</span><span class="status-value">$${this.tokenInfo.priceUsd.toFixed(6)}</span></div>` : ''}
          ${tokenBPrice ? `<div class="info-row"><span>${tokenBSymbol} Price</span><span class="status-value">$${tokenBPrice.toFixed(6)}</span></div>` : ''}
        </div>
        <div class="filter-divider"></div>
        <div class="preview-info">
          <div class="info-row"><span>Pool Status</span><span class="status-value" style="color:#f0a040">New Pool</span></div>
          <div class="info-row"><span>Gas Cost</span><span class="status-value">~0.032 HBAR</span></div>
          <div class="info-row"><span>Creation Fee</span><span class="status-value" style="color:#f0a040">~$50 HBAR</span></div>
        </div>
      </div>`;
  }

  private static renderLiquidityPreview(): string {
    const tokenA = this.selectedPool ? (this.selectedPool.tokenA.id === this.tokenInfo?.tokenId ? this.selectedPool.tokenA : this.selectedPool.tokenB) : this.tokenInfo;
    const tokenB = this.selectedPool ? (this.selectedPool.tokenA.id === this.tokenInfo?.tokenId ? this.selectedPool.tokenB : this.selectedPool.tokenA) : this.tokenBInfo;

    if (!tokenA || !tokenB) {
      return `<div class="cc-right-content"><h4 class="section-title" style="font-size:0.95rem">Liquidity Preview</h4><p style="font-size:0.82rem;color:var(--terminal-text);opacity:0.5">Enter amounts to see preview.</p></div>`;
    }
    const tokenAmt = parseFloat(this.tokenAmount) || 0;
    const tokenBAmt = parseFloat(this.hbarAmount) || 0;
    const ratio = tokenAmt > 0 && tokenBAmt > 0 ? (tokenBAmt / tokenAmt).toFixed(6) : '—';

    // Calculate USD values
    const tokenValueUsd = tokenA.priceUsd && tokenAmt > 0 ? (tokenAmt * tokenA.priceUsd).toFixed(2) : null;
    const tokenBValueUsd = tokenB.priceUsd && tokenBAmt > 0 ? (tokenBAmt * tokenB.priceUsd).toFixed(2) : null;
    const totalValueUsd = tokenValueUsd && tokenBValueUsd ? (parseFloat(tokenValueUsd) + parseFloat(tokenBValueUsd)).toFixed(2) : null;

    // Calculate transaction cost estimate
    const isNewPool = !this.selectedPool;
    const gasCost = isNewPool ? 3200000 : 240000; // gas units
    const gasCostHbar = (gasCost * 0.00000001).toFixed(4); // ~0.01 tinybar per gas
    const gasCostUsd = this.hbarPriceUsd ? (parseFloat(gasCostHbar) * this.hbarPriceUsd).toFixed(2) : null;

    return `
      <div class="cc-right-content">
        <h4 class="section-title" style="font-size:0.95rem">Liquidity Preview</h4>
        <div class="preview-info">
          <div class="info-row"><span>Pool</span><span class="status-value">${tokenA.symbol} / ${tokenB.symbol}</span></div>
          ${this.selectedPool ? `<div class="info-row"><span>Pool ID</span><span class="status-value">${this.selectedPool.contractId}</span></div>` : ''}
          <div class="info-row"><span>Status</span><span class="status-value" style="color:${isNewPool ? '#f0a040' : '#6bff9e'}">${isNewPool ? 'New Pool' : 'Existing Pool'}</span></div>
        </div>
        ${tokenA.priceUsd || tokenB.priceUsd ? `
          <div class="filter-divider"></div>
          <div class="preview-info">
            ${tokenA.priceUsd ? `<div class="info-row"><span>${tokenA.symbol} Price</span><span class="status-value">$${tokenA.priceUsd.toFixed(6)}</span></div>` : ''}
            ${tokenB.priceUsd ? `<div class="info-row"><span>${tokenB.symbol} Price</span><span class="status-value">$${tokenB.priceUsd.toFixed(6)}</span></div>` : ''}
          </div>
        ` : ''}
        ${tokenAmt > 0 || tokenBAmt > 0 ? `
          <div class="filter-divider"></div>
          <div class="preview-info">
            <div class="info-row"><span>${tokenA.symbol}</span><span class="status-value">${tokenAmt > 0 ? tokenAmt.toLocaleString() : '—'}${tokenValueUsd ? ` ($${tokenValueUsd})` : ''}</span></div>
            <div class="info-row"><span>${tokenB.symbol}</span><span class="status-value">${tokenBAmt > 0 ? tokenBAmt.toLocaleString() : '—'}${tokenBValueUsd ? ` ($${tokenBValueUsd})` : ''}</span></div>
            ${totalValueUsd ? `<div class="info-row"><span>Total Value</span><span class="status-value" style="color:#6bff9e">$${totalValueUsd}</span></div>` : ''}
            <div class="info-row"><span>Rate</span><span class="status-value">1 ${tokenA.symbol} = ${ratio} ${tokenB.symbol}</span></div>
            <div class="info-row"><span>Slippage</span><span class="status-value">${this.slippage}%</span></div>
          </div>
        ` : ''}
        <div class="filter-divider"></div>
        <div class="preview-info">
          <div class="info-row"><span>Gas Cost</span><span class="status-value">${gasCostHbar} HBAR${gasCostUsd ? ` ($${gasCostUsd})` : ''}</span></div>
          ${isNewPool ? `<div class="info-row"><span>Pool Creation Fee</span><span class="status-value" style="color:#f0a040">~$50 HBAR</span></div>` : ''}
        </div>
      </div>`;
  }

  // --- SUCCESS PANELS ---
  private static renderSuccessPanel(): string {
    return `
      <div class="art-gen-section">
        <h3 class="section-title">◆ Liquidity Added ✓</h3>
        <div class="back-link" id="al-back"><span class="back-arrow">←</span><span>Back to Home</span></div>
        <div class="preview-info">
          <div class="info-row"><span>Token</span><span class="status-value">${this.tokenInfo?.name || '—'} (${this.tokenInfo?.symbol || '—'})</span></div>
          <div class="info-row"><span>${this.tokenInfo?.symbol || 'Token'} Amount</span><span class="status-value">${this.tokenAmount}</span></div>
          <div class="info-row"><span>HBAR Amount</span><span class="status-value">${this.hbarAmount}</span></div>
        </div>
        <button class="terminal-button" id="al-new" style="margin-top:1rem">ADD MORE LIQUIDITY</button>
      </div>`;
  }

  private static renderSuccessDetails(): string {
    const network = WalletConnectService.getState().network?.toLowerCase() || 'mainnet';
    return `
      <div class="cc-right-content">
        <h4 class="section-title" style="font-size:0.95rem">🎉 Success!</h4>
        <div class="result-block">
          <label>Token</label>
          <code class="cid-value" style="font-size:1.1rem">${this.tokenInfo?.tokenId}</code>
        </div>
        ${this.txId ? `<div class="result-block" style="margin-top:0.75rem"><label>Transaction ID</label><code class="cid-value" style="font-size:0.82rem">${this.txId}</code></div>` : ''}
        <div class="result-block" style="margin-top:0.75rem">
          <label>View on HashScan</label>
          <a class="cid-link" href="https://hashscan.io/${network}/token/${this.tokenInfo?.tokenId}" target="_blank" rel="noopener">https://hashscan.io/${network}/token/${this.tokenInfo?.tokenId}</a>
        </div>
        <div class="result-block" style="margin-top:0.75rem">
          <label>View on SaucerSwap</label>
          <a class="cid-link" href="https://www.saucerswap.finance/liquidity/v1" target="_blank" rel="noopener">SaucerSwap V1 Liquidity</a>
        </div>
        <div class="result-block" style="margin-top:0.75rem">
          <label>Note</label>
          <p style="font-size:0.82rem;color:#64b4ff;margin:0">LP tokens have been sent to your wallet. You can use them to remove liquidity later on SaucerSwap.</p>
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

  static resetForm(): void {
    this.tokenIdInput = '';
    this.tokenValidated = false;
    this.tokenInfo = null;
    this.tokenError = null;
    this.availablePools = [];
    this.selectedPool = null;
    this.tokenBType = 'hbar';
    this.tokenBIdInput = '';
    this.tokenBValidated = false;
    this.tokenBInfo = null;
    this.tokenBError = null;
    this.hbarPriceUsd = 0;
    this.poolCreationFeeTinybar = 0;
    this.tokenAmount = '';
    this.hbarAmount = '';
    this.slippage = 1.5;
    this.step = 'token-input';
    this.loading = false;
    this.error = null;
    this.statusMessage = '';
    this.txId = null;
  }

  public static resetState(): void {
    this.resetForm();
  }

  // --- Convert Hedera ID (0.0.xxxxx) to EVM address ---
  private static toEvmAddress(hederaId: string): string {
    const parts = hederaId.split('.');
    const num = parseInt(parts[2], 10);
    return '0x' + num.toString(16).padStart(40, '0');
  }

  // --- INIT: wire up event listeners ---
  static init(): void {
    // Back buttons
    document.getElementById('al-back')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('navigate-to-tool', { detail: { toolId: 'home' } }));
    });

    document.getElementById('al-back-to-token')?.addEventListener('click', () => {
      this.step = 'token-input';
      this.selectedPool = null;
      this.refresh();
    });

    document.getElementById('al-back-to-pools')?.addEventListener('click', () => {
      this.step = 'pool-selection';
      this.selectedPool = null;
      this.tokenBType = 'hbar';
      this.tokenBIdInput = '';
      this.tokenBValidated = false;
      this.tokenBInfo = null;
      this.tokenBError = null;
      this.refresh();
    });

    // Token ID input
    const tokenInput = document.getElementById('al-token-id') as HTMLInputElement;
    tokenInput?.addEventListener('input', () => { this.tokenIdInput = tokenInput.value; });
    tokenInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.validateToken(); });

    // Validate button
    document.getElementById('al-validate')?.addEventListener('click', () => this.validateToken());

    // Pool selection
    document.getElementById('al-create-new-pool')?.addEventListener('click', () => {
      this.step = 'new-pool-input';
      this.refresh();
    });

    // Pool selection buttons
    this.availablePools.forEach((_, idx) => {
      document.getElementById(`al-select-pool-${idx}`)?.addEventListener('click', () => {
        const pool = this.availablePools[idx];
        this.selectedPool = pool;
        // Populate tokenBInfo from the pool so executeLiquidity (which guards on !tokenBInfo) works.
        // Determine which pool token is "B" — the one that isn't token A.
        const tokenBPool = pool.tokenA.id === this.tokenInfo?.tokenId ? pool.tokenB : pool.tokenA;
        this.tokenBInfo = {
          tokenId: tokenBPool.id,
          name: tokenBPool.symbol,
          symbol: tokenBPool.symbol,
          decimals: tokenBPool.decimals,
          hasCustomFees: false,
        };
        this.tokenBValidated = true;
        this.step = 'liquidity-form';
        this.refresh();
      });
    });

    // Token B type selection (HBAR vs HTS)
    document.getElementById('al-select-hbar')?.addEventListener('click', () => {
      this.tokenBType = 'hbar';
      this.tokenBIdInput = '';
      this.tokenBValidated = false;
      this.tokenBInfo = null;
      this.tokenBError = null;
      this.refresh();
    });

    document.getElementById('al-select-hts')?.addEventListener('click', () => {
      this.tokenBType = 'hts';
      this.tokenBIdInput = '';
      this.tokenBValidated = false;
      this.tokenBInfo = null;
      this.tokenBError = null;
      this.refresh();
    });

    // Confirm HBAR selection
    document.getElementById('al-confirm-hbar')?.addEventListener('click', () => {
      this.confirmHbarSelection();
    });

    // Token B input (for new pool - HTS only)
    const tokenBInput = document.getElementById('al-token-b-id') as HTMLInputElement;
    tokenBInput?.addEventListener('input', () => { this.tokenBIdInput = tokenBInput.value; });
    tokenBInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.validateTokenB(); });

    document.getElementById('al-validate-b')?.addEventListener('click', () => this.validateTokenB());

    // Amount inputs — store on input, refresh on change (blur) to avoid killing the cursor
    const tokenAmtInput = document.getElementById('al-token-amount') as HTMLInputElement;
    const hbarAmtInput = document.getElementById('al-hbar-amount') as HTMLInputElement;

    tokenAmtInput?.addEventListener('input', () => {
      this.tokenAmount = tokenAmtInput.value;
      // For existing pools: Token B is not user-editable — derive it from the pool ratio.
      // Reserves are in each token's smallest units; converting both to human scale gives
      // the ratio needed to ensure the amounts match what the contract enforces.
      if (this.selectedPool && this.tokenInfo) {
        const isTokenAinPoolA = this.selectedPool.tokenA.id === this.tokenInfo.tokenId;
        const rawReserveA = parseFloat(isTokenAinPoolA ? this.selectedPool.tokenReserveA : this.selectedPool.tokenReserveB);
        const rawReserveB = parseFloat(isTokenAinPoolA ? this.selectedPool.tokenReserveB : this.selectedPool.tokenReserveA);
        const decimalsA = isTokenAinPoolA ? this.selectedPool.tokenA.decimals : this.selectedPool.tokenB.decimals;
        const decimalsB = isTokenAinPoolA ? this.selectedPool.tokenB.decimals : this.selectedPool.tokenA.decimals;
        const reserveAHuman = rawReserveA / Math.pow(10, decimalsA);
        const reserveBHuman = rawReserveB / Math.pow(10, decimalsB);
        const tokenAAmount = parseFloat(this.tokenAmount) || 0;
        const tokenBAmount = reserveAHuman > 0 ? tokenAAmount * (reserveBHuman / reserveAHuman) : 0;
        this.hbarAmount = tokenBAmount > 0 ? tokenBAmount.toFixed(Math.min(decimalsB, 8)) : '';
        if (hbarAmtInput) hbarAmtInput.value = this.hbarAmount;
      }
      // For new pools: calculate Token B amount based on USD value ratio (1:1 value)
      else if (!this.selectedPool && this.tokenInfo && this.tokenBInfo) {
        const tokenAAmount = parseFloat(this.tokenAmount) || 0;
        if (tokenAAmount > 0 && this.tokenInfo.priceUsd && this.tokenBInfo.priceUsd) {
          const tokenAValueUsd = tokenAAmount * this.tokenInfo.priceUsd;
          const tokenBAmount = tokenAValueUsd / this.tokenBInfo.priceUsd;
          this.hbarAmount = tokenBAmount.toFixed(Math.min(this.tokenBInfo.decimals, 8));
          if (hbarAmtInput) hbarAmtInput.value = this.hbarAmount;
        }
      }
    });
    tokenAmtInput?.addEventListener('change', () => { this.refresh(); });

    // Token B: read-only for existing pools (ratio-derived), free entry for new pools only
    hbarAmtInput?.addEventListener('input', () => {
      if (!this.selectedPool) {
        this.hbarAmount = hbarAmtInput.value;

        // For new pools: calculate Token A amount based on USD value ratio (1:1 value)
        if (this.tokenInfo && this.tokenBInfo) {
          const tokenBAmount = parseFloat(this.hbarAmount) || 0;
          if (tokenBAmount > 0 && this.tokenInfo.priceUsd && this.tokenBInfo.priceUsd) {
            const tokenBValueUsd = tokenBAmount * this.tokenBInfo.priceUsd;
            const tokenAAmount = tokenBValueUsd / this.tokenInfo.priceUsd;
            this.tokenAmount = tokenAAmount.toFixed(Math.min(this.tokenInfo.decimals, 8));
            if (tokenAmtInput) tokenAmtInput.value = this.tokenAmount;
          }
        }
      }
    });
    hbarAmtInput?.addEventListener('change', () => { if (!this.selectedPool) this.refresh(); });

    const slippageInput = document.getElementById('al-slippage') as HTMLInputElement;
    slippageInput?.addEventListener('input', () => { this.slippage = parseFloat(slippageInput.value) || 1.5; });
    slippageInput?.addEventListener('change', () => { this.refresh(); });

    // Submit button
    document.getElementById('al-submit')?.addEventListener('click', () => { this.executeLiquidity(); });

    // Dismiss error
    document.getElementById('al-dismiss-error')?.addEventListener('click', () => { this.error = null; this.refresh(); });

    // New liquidity button (from success screen)
    document.getElementById('al-new')?.addEventListener('click', () => { this.resetForm(); this.refresh(); });
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
      // Fetch token info from mirror node
      const res = await fetch(`${MIRROR_NODE_URL}/api/v1/tokens/${tokenId}`);
      if (!res.ok) throw new Error(`Token ${tokenId} not found`);
      const data = await res.json();

      if (data.type !== 'FUNGIBLE_COMMON') {
        throw new Error('Only fungible tokens can be added to liquidity pools.');
      }

      const hasCustomFees = (data.custom_fees?.fixed_fees?.length > 0) || (data.custom_fees?.fractional_fees?.length > 0);

      this.tokenInfo = {
        tokenId: data.token_id,
        name: data.name || 'Unnamed',
        symbol: data.symbol || '',
        decimals: parseInt(data.decimals) || 0,
        hasCustomFees,
      };

      // Fetch token price and HBAR price from SaucerSwap API
      try {
        const [tokenPriceRes, hbarPriceRes] = await Promise.all([
          fetch(`${SAUCERSWAP_API_URL}/tokens/${tokenId}`, {
            headers: { 'x-api-key': SAUCERSWAP_API_KEY },
          }),
          fetch(`${SAUCERSWAP_API_URL}/tokens/${WHBAR_TOKEN_ID}`, {
            headers: { 'x-api-key': SAUCERSWAP_API_KEY },
          }),
        ]);

        if (tokenPriceRes.ok) {
          const tokenData = await tokenPriceRes.json();
          this.tokenInfo.priceUsd = tokenData.priceUsd || 0;
        }

        if (hbarPriceRes.ok) {
          const hbarData = await hbarPriceRes.json();
          this.hbarPriceUsd = hbarData.priceUsd || 0;
        }
      } catch {
        // Non-fatal: prices are nice-to-have
      }

      // Fetch all pools containing this token from SaucerSwap REST API
      try {
        const poolsRes = await fetch(`${SAUCERSWAP_API_URL}/pools`, {
          headers: { 'x-api-key': SAUCERSWAP_API_KEY },
        });

        if (poolsRes.ok) {
          const allPools = await poolsRes.json();
          // Filter pools containing this token
          this.availablePools = allPools.filter((p: any) =>
            p.tokenA?.id === tokenId || p.tokenB?.id === tokenId
          ).map((p: any) => ({
            id: p.id,
            contractId: p.contractId,
            tokenA: {
              id: p.tokenA.id,
              symbol: p.tokenA.symbol,
              decimals: p.tokenA.decimals,
              priceUsd: p.tokenA.priceUsd,
            },
            tokenB: {
              id: p.tokenB.id,
              symbol: p.tokenB.symbol,
              decimals: p.tokenB.decimals,
              priceUsd: p.tokenB.priceUsd,
            },
            tokenReserveA: p.tokenReserveA,
            tokenReserveB: p.tokenReserveB,
            lpToken: {
              id: p.lpToken.id,
              symbol: p.lpToken.symbol,
            },
          }));
        }
      } catch {
        // Non-fatal: pool list is optional
      }

      // Calculate pool creation fee in tinybar
      // SaucerSwap V1 pool creation fee is $50 USD (5000 tinycent)
      // Factory contract returns this as 5000 tinycent (1 tinycent = $0.01 USD)
      // We need to convert tinycent to tinybar using current exchange rate
      try {
        const POOL_FEE_TINYCENT = 5000; // $50 USD = 5000 tinycent (from factory contract)

        // Get current HBAR/USD exchange rate from Hedera mirror node
        const exchangeRateRes = await fetch(`${MIRROR_NODE_URL}/api/v1/network/exchangerate`);
        if (exchangeRateRes.ok) {
          const exchangeRateData = await exchangeRateRes.json();
          const currentRate = exchangeRateData.current_rate;
          const centEquivalent = Number(currentRate.cent_equivalent); // cents USD
          const hbarEquivalent = Number(currentRate.hbar_equivalent); // HBAR

          // Use the formula from SaucerSwap documentation:
          // centToHbarRatio = centEquivalent / hbarEquivalent (cents per HBAR)
          // tinybar = tinycent / centToHbarRatio
          const centToHbarRatio = centEquivalent / hbarEquivalent;
          this.poolCreationFeeTinybar = Math.round((POOL_FEE_TINYCENT / centToHbarRatio) * 100_000_000);

          // Debug log removed — fee is always calculated but only spent on new pool creation
        } else {
          console.error('Failed to fetch exchange rate');
          this.poolCreationFeeTinybar = 0;
        }
      } catch (err) {
        console.error('Failed to calculate pool creation fee:', err);
        // Non-fatal: default to 0 if we can't fetch the exchange rate
        this.poolCreationFeeTinybar = 0;
      }

      this.tokenValidated = true;
      this.tokenError = null;

      // Transition to pool selection step
      this.step = 'pool-selection';
    } catch (err: any) {
      this.tokenError = err.message || 'Failed to validate token';
      this.tokenValidated = false;
      this.tokenInfo = null;
      this.availablePools = [];
    }

    this.loading = false;
    this.refresh();
  }

  // --- CONFIRM HBAR SELECTION ---
  private static async confirmHbarSelection(): Promise<void> {
    this.loading = true;
    this.refresh();

    try {
      // Set up HBAR as Token B using WHBAR token ID
      this.tokenBInfo = {
        tokenId: WHBAR_TOKEN_ID,
        name: 'Wrapped HBAR',
        symbol: 'HBAR',
        decimals: 8,
        hasCustomFees: false,
        priceUsd: this.hbarPriceUsd || 0,
      };

      this.tokenBValidated = true;
      this.tokenBError = null;

      // Transition to liquidity form
      this.step = 'liquidity-form';
    } catch (err: any) {
      this.tokenBError = err.message || 'Failed to set up HBAR';
      this.tokenBValidated = false;
      this.tokenBInfo = null;
    }

    this.loading = false;
    this.refresh();
  }

  // --- TOKEN B VALIDATION (for new pool creation - HTS only) ---
  private static async validateTokenB(): Promise<void> {
    const tokenId = this.tokenBIdInput.trim();
    if (!tokenId) {
      this.tokenBError = 'Please enter a Token ID';
      this.refresh();
      return;
    }

    // Check if same as token A
    if (tokenId === this.tokenInfo?.tokenId) {
      this.tokenBError = 'Token B must be different from Token A';
      this.refresh();
      return;
    }

    this.loading = true;
    this.tokenBError = null;
    this.tokenBValidated = false;
    this.tokenBInfo = null;
    this.refresh();

    try {
      // Fetch token info from mirror node
      const res = await fetch(`${MIRROR_NODE_URL}/api/v1/tokens/${tokenId}`);
      if (!res.ok) throw new Error(`Token ${tokenId} not found`);
      const data = await res.json();

      if (data.type !== 'FUNGIBLE_COMMON') {
        throw new Error('Only fungible tokens can be added to liquidity pools.');
      }

      const hasCustomFees = (data.custom_fees?.fixed_fees?.length > 0) || (data.custom_fees?.fractional_fees?.length > 0);

      this.tokenBInfo = {
        tokenId: data.token_id,
        name: data.name || 'Unnamed',
        symbol: data.symbol || '',
        decimals: parseInt(data.decimals) || 0,
        hasCustomFees,
      };

      // Fetch token price from SaucerSwap API
      try {
        const tokenPriceRes = await fetch(`${SAUCERSWAP_API_URL}/tokens/${tokenId}`, {
          headers: { 'x-api-key': SAUCERSWAP_API_KEY },
        });

        if (tokenPriceRes.ok) {
          const tokenData = await tokenPriceRes.json();
          this.tokenBInfo.priceUsd = tokenData.priceUsd || 0;
        }
      } catch {
        // Non-fatal: prices are nice-to-have
      }

      this.tokenBValidated = true;
      this.tokenBError = null;

      // Transition to liquidity form
      this.step = 'liquidity-form';
    } catch (err: any) {
      this.tokenBError = err.message || 'Failed to validate token';
      this.tokenBValidated = false;
      this.tokenBInfo = null;
    }

    this.loading = false;
    this.refresh();
  }

  // --- EXECUTE LIQUIDITY ---
  private static async executeLiquidity(): Promise<void> {
    if (!this.tokenValidated || !this.tokenInfo || !this.tokenBInfo) return;

    const tokenAmt = parseFloat(this.tokenAmount);
    const tokenBAmt = parseFloat(this.hbarAmount);
    if (!tokenAmt || tokenAmt <= 0 || !tokenBAmt || tokenBAmt <= 0) return;

    this.loading = true;
    this.error = null;
    this.statusMessage = 'Preparing liquidity transaction...';
    this.refresh();

    try {
      const ws = WalletConnectService.getState();
      if (!ws.connected || !ws.accountId) throw new Error('Wallet not connected');
      const accountId = ws.accountId;
      const signer = WalletConnectService.getSigner(accountId);
      const acctId = AccountId.fromString(accountId);
      const client = getHederaClient();

      // Determine if this is a new pool or existing pool
      const isNewPool = !this.selectedPool;

      // Determine if this is an HBAR pair or HTS/HTS pair
      const isHbarPair = this.tokenBInfo.tokenId === WHBAR_TOKEN_ID;

      // Convert amounts to smallest units
      const tokenASmallestUnit = Math.round(tokenAmt * Math.pow(10, this.tokenInfo.decimals));
      const tokenBSmallestUnit = Math.round(tokenBAmt * Math.pow(10, this.tokenBInfo.decimals));

      // Pre-flight: verify wallet holds enough Token A
      const tokABalRes = await fetch(`${MIRROR_NODE_URL}/api/v1/accounts/${accountId}/tokens?token.id=${this.tokenInfo.tokenId}`);
      if (tokABalRes.ok) {
        const tokABalData = await tokABalRes.json();
        const tokABal: number = tokABalData.tokens?.[0]?.balance ?? 0;
        if (tokABal < tokenASmallestUnit) {
          const have = (tokABal / Math.pow(10, this.tokenInfo.decimals)).toFixed(this.tokenInfo.decimals);
          const need = (tokenASmallestUnit / Math.pow(10, this.tokenInfo.decimals)).toFixed(this.tokenInfo.decimals);
          throw new Error(`Insufficient ${this.tokenInfo.symbol} balance. Need ${need}, have ${have}.`);
        }
      }

      // Pre-flight: verify wallet holds enough Token B (HTS only — HBAR is covered by the HBAR balance check below)
      if (!isHbarPair) {
        const tokBBalRes = await fetch(`${MIRROR_NODE_URL}/api/v1/accounts/${accountId}/tokens?token.id=${this.tokenBInfo.tokenId}`);
        if (tokBBalRes.ok) {
          const tokBBalData = await tokBBalRes.json();
          const tokBBal: number = tokBBalData.tokens?.[0]?.balance ?? 0;
          if (tokBBal < tokenBSmallestUnit) {
            const have = (tokBBal / Math.pow(10, this.tokenBInfo.decimals)).toFixed(this.tokenBInfo.decimals);
            const need = (tokenBSmallestUnit / Math.pow(10, this.tokenBInfo.decimals)).toFixed(this.tokenBInfo.decimals);
            throw new Error(`Insufficient ${this.tokenBInfo.symbol} balance. Need ${need}, have ${have}.`);
          }
        }
      }

      // Calculate min amounts with slippage
      const slippageFactor = (100 - this.slippage) / 100;
      const amountAMin = Math.round(tokenASmallestUnit * slippageFactor);
      const amountBMin = Math.round(tokenBSmallestUnit * slippageFactor);

      // EVM addresses
      const tokenAEvmAddress = this.toEvmAddress(this.tokenInfo.tokenId);
      const tokenBEvmAddress = this.toEvmAddress(this.tokenBInfo.tokenId);
      // Use the account's canonical EVM address from Mirror Node. Accounts with ECDSA keys
      // have a non-long-zero EVM address (0xdcd9...) — if we pass the long-zero address
      // instead, SaucerSwap's HTS precompile LP token transfer fails with INVALID_ALIAS_KEY.
      // Accounts with ED25519 keys return the long-zero address from Mirror Node, so both
      // key types are handled correctly by this lookup.
      const acctInfoRes = await fetch(`${MIRROR_NODE_URL}/api/v1/accounts/${accountId}`);
      if (!acctInfoRes.ok) throw new Error('Failed to fetch account EVM address from Mirror Node');
      const acctInfo = await acctInfoRes.json();
      const toEvmAddress: string = acctInfo.evm_address;

      // Deadline: 10 minutes from now
      const deadline = Math.floor(Date.now() / 1000) + 600;

      // --- LP Token Association (pre-step) ---
      // Ensures the wallet can receive LP tokens before executing the liquidity transaction.
      if (isNewPool) {
        // For new pools: the LP token is created by the contract during pool creation.
        // We need at least 1 free auto-association slot so the wallet auto-receives it.
        this.statusMessage = 'Checking auto-association slots for LP token...';
        this.refresh();

        const acctInfoRes = await fetch(`${MIRROR_NODE_URL}/api/v1/accounts/${accountId}`);
        if (acctInfoRes.ok) {
          const acctInfo = await acctInfoRes.json();
          const maxAutoAssoc: number = acctInfo.max_automatic_token_associations ?? 0;

          if (maxAutoAssoc !== -1) {
            // Bump by 1 to guarantee a free slot for the new LP token
            this.statusMessage = 'Reserving auto-association slot for LP token — approve in wallet...';
            this.refresh();

            const updateTx = new AccountUpdateTransaction()
              .setAccountId(acctId)
              .setMaxAutomaticTokenAssociations(maxAutoAssoc + 1);
            updateTx.setTransactionId(TransactionId.generate(acctId));
            updateTx.freezeWith(client);
            await updateTx.executeWithSigner(signer);

            await new Promise(r => setTimeout(r, 2000));
          }
        }
      } else if (this.selectedPool?.lpToken?.id) {
        // For existing pools: check if LP token is already associated; associate if not.
        this.statusMessage = 'Checking LP token association...';
        this.refresh();

        const lpTokenId = this.selectedPool.lpToken.id;
        const assocRes = await fetch(`${MIRROR_NODE_URL}/api/v1/accounts/${accountId}/tokens?token.id=${lpTokenId}`);
        const assocData = await assocRes.json();
        const isLpAssociated = assocData.tokens && assocData.tokens.length > 0;

        if (!isLpAssociated) {
          this.statusMessage = 'Associating LP token — approve in wallet...';
          this.refresh();

          const assocTx = new TokenAssociateTransaction()
            .setAccountId(acctId)
            .setTokenIds([TokenId.fromString(lpTokenId)]);
          assocTx.setTransactionId(TransactionId.generate(acctId));
          assocTx.freezeWith(client);
          await assocTx.executeWithSigner(signer);

          await new Promise(r => setTimeout(r, 3000));
        }
      }

      // Step 1: Approve token A allowance for the router
      this.statusMessage = isHbarPair
        ? 'Step 1/2 — Approving Token A allowance...'
        : 'Step 1/3 — Approving Token A allowance...';
      this.refresh();

      const approveTxA = new AccountAllowanceApproveTransaction()
        .approveTokenAllowance(
          TokenId.fromString(this.tokenInfo.tokenId),
          acctId,
          AccountId.fromString(SAUCER_V1_ROUTER),
          Number(tokenASmallestUnit)
        );
      approveTxA.setTransactionId(TransactionId.generate(acctId));
      approveTxA.freezeWith(client);
      const approveResponseA = await approveTxA.executeWithSigner(signer);
      // Wait for consensus — executeWithSigner resolves at wallet approval, not on-chain confirmation.
      // Without this, Token B allowance approval can fire before Token A is confirmed, and the
      // subsequent contract call may proceed without a valid allowance.
      await approveResponseA.getReceipt(client);

      // Step 2: Approve token B allowance (only for HTS/HTS pairs, not HBAR)
      if (!isHbarPair) {
        this.statusMessage = 'Step 2/3 — Approving Token B allowance...';
        this.refresh();

        const approveTxB = new AccountAllowanceApproveTransaction()
          .approveTokenAllowance(
            TokenId.fromString(this.tokenBInfo.tokenId),
            acctId,
            AccountId.fromString(SAUCER_V1_ROUTER),
            Number(tokenBSmallestUnit)
          );
        approveTxB.setTransactionId(TransactionId.generate(acctId));
        approveTxB.freezeWith(client);
        const approveResponseB = await approveTxB.executeWithSigner(signer);
        // Same consensus wait as Token A — ensures allowance is confirmed before the contract call.
        await approveResponseB.getReceipt(client);
      }

      // Guard: for new pools the creation fee is required — if we couldn't fetch it, abort
      if (isNewPool && this.poolCreationFeeTinybar === 0) {
        throw new Error('Could not calculate pool creation fee. Please refresh and try again.');
      }

      // Step 3: Add liquidity
      const stepLabel = isHbarPair ? '2/2' : '3/3';
      this.statusMessage = `Step ${stepLabel} — ${isNewPool ? 'Creating pool & adding' : 'Adding'} liquidity...`;
      this.refresh();

      let functionName: string;
      let params: ContractFunctionParameters;
      let payableTinybar = 0;
      let gasLimit: number;

      if (isHbarPair) {
        // HBAR/Token pair - use addLiquidityETH or addLiquidityETHNewPool
        functionName = isNewPool ? 'addLiquidityETHNewPool' : 'addLiquidityETH';
        // New pool: 15M gas (Hedera mainnet max). Child tx (TOKENASSOCIATE via HTS precompile)
        // was hitting INSUFFICIENT_GAS at 5M — pair deployment + multiple HTS precompile calls
        // exhaust gas before LP token association step. Existing pool: 3.2M per SaucerSwap docs.
        gasLimit = isNewPool ? 15_000_000 : 3_200_000;

        // CRITICAL: For HBAR pairs, the HBAR amount is sent as msg.value (payable amount)
        // For NEW pools: payable amount = HBAR liquidity + pool creation fee
        // For EXISTING pools: payable amount = HBAR liquidity only
        payableTinybar = isNewPool
          ? tokenBSmallestUnit + this.poolCreationFeeTinybar
          : tokenBSmallestUnit;

        console.log('=== HBAR PAIR PARAMETERS ===');
        console.log('Token A (HTS):', this.tokenInfo.tokenId, '→ EVM:', tokenAEvmAddress);
        console.log('Token A amount:', tokenASmallestUnit);
        console.log('Token A min:', amountAMin);
        console.log('HBAR min:', amountBMin);
        console.log('To address:', accountId, '→ EVM:', toEvmAddress);
        console.log('Deadline:', deadline);
        console.log('Payable amount:', payableTinybar, 'tinybar =', payableTinybar / 100_000_000, 'HBAR');

        params = new ContractFunctionParameters()
          .addAddress(tokenAEvmAddress)
          .addUint256(tokenASmallestUnit)
          .addUint256(amountAMin)
          .addUint256(amountBMin)
          .addAddress(toEvmAddress)
          .addUint256(deadline);
      } else {
        // HTS/HTS pair - use addLiquidity or addLiquidityNewPool
        functionName = isNewPool ? 'addLiquidityNewPool' : 'addLiquidity';
        // New pool: 15M gas (Hedera mainnet max). Same INSUFFICIENT_GAS risk as HBAR pair.
        // Existing pool: 3.2M per SaucerSwap docs.
        gasLimit = isNewPool ? 15_000_000 : 3_200_000;

        // For new pools: pool creation fee only
        // For existing pools: no HBAR needed
        payableTinybar = isNewPool ? this.poolCreationFeeTinybar : 0;

        params = new ContractFunctionParameters()
          .addAddress(tokenAEvmAddress)
          .addAddress(tokenBEvmAddress)
          .addUint256(tokenASmallestUnit)
          .addUint256(tokenBSmallestUnit)
          .addUint256(amountAMin)
          .addUint256(amountBMin)
          .addAddress(toEvmAddress)
          .addUint256(deadline);
      }

      // Pre-flight: verify wallet has enough HBAR to cover the payable amount + tx fees.
      // For HTS/HTS new pools the creation fee alone is ~526 HBAR — insufficient balance
      // produces an opaque WalletConnect DAppSigner error (_code: 10 = INSUFFICIENT_PAYER_BALANCE)
      // that completely obscures the actual cause. Catching it here gives a clear message.
      if (payableTinybar > 0) {
        const balRes = await fetch(`${MIRROR_NODE_URL}/api/v1/accounts/${accountId}`);
        if (balRes.ok) {
          const balData = await balRes.json();
          const hbarBalTinybar: number = balData.balance?.balance ?? 0;
          const feeBuffer = 5 * 100_000_000; // 5 HBAR buffer for gas & tx fees
          if (hbarBalTinybar < payableTinybar + feeBuffer) {
            const availableHbar = (hbarBalTinybar / 100_000_000).toFixed(2);
            const requiredHbar = ((payableTinybar + feeBuffer) / 100_000_000).toFixed(2);
            const feeHbar = (this.poolCreationFeeTinybar / 100_000_000).toFixed(2);
            throw new Error(
              `Insufficient HBAR balance. Need ~${requiredHbar} HBAR (includes ~${feeHbar} HBAR pool creation fee + liquidity + fees), have ${availableHbar} HBAR.`
            );
          }
        }
      }

      // Build transaction in the EXACT order shown in SaucerSwap documentation:
      // 1. setPayableAmount FIRST (if needed)
      // 2. setContractId
      // 3. setGas
      // 4. setFunction
      // 5. setTransactionId
      // 6. freezeWith
      const liquidityTx = new ContractExecuteTransaction();

      // CRITICAL: setPayableAmount MUST be called FIRST for WalletConnect to recognize it
      if (payableTinybar > 0) {
        liquidityTx.setPayableAmount(Hbar.fromTinybars(payableTinybar));
      }

      liquidityTx
        .setContractId(ContractId.fromString(SAUCER_V1_ROUTER))
        .setGas(gasLimit)
        .setFunction(functionName, params)
        .setTransactionId(TransactionId.generate(acctId))
        .freezeWith(client);

      this.statusMessage = 'Waiting for wallet approval...';
      this.refresh();

      const txResponse = await liquidityTx.executeWithSigner(signer);

      this.statusMessage = 'Confirming on network...';
      this.refresh();

      // Store transaction ID
      this.txId = txResponse?.transactionId?.toString() || null;

      // Verify transaction result via mirror node
      let txVerified = false;
      if (this.txId) {
        // Convert 0.0.XXXXXX@seconds.nanos → 0.0.XXXXXX-seconds-nanos
        // Only replace the @ and the final dot (before nanos). The 0.0. dots must stay.
        const mirrorTxId = this.txId.replace('@', '-').replace(/\.(\d+)$/, '-$1');
        for (let attempt = 0; attempt < 8; attempt++) {
          await new Promise(r => setTimeout(r, 3000));
          try {
            const verifyRes = await fetch(`${MIRROR_NODE_URL}/api/v1/transactions/${mirrorTxId}`);
            if (verifyRes.ok) {
              const verifyData = await verifyRes.json();
              const txn = verifyData.transactions?.[0];
              if (txn) {
                if (txn.result === 'SUCCESS') {
                  txVerified = true;
                  break;
                } else {
                  throw new Error(`Transaction failed on-chain: ${txn.result}`);
                }
              }
            }
          } catch (verifyErr: any) {
            if (verifyErr.message?.startsWith('Transaction failed')) throw verifyErr;
            // Mirror node might not have the tx yet, keep retrying
          }
        }
      }

      if (!txVerified) {
        throw new Error('Transaction could not be confirmed. Check HashScan for status: ' + (this.txId || 'unknown'));
      }

      this.step = 'success';
      this.loading = false;
      this.statusMessage = `Liquidity added for ${this.tokenInfo.symbol} / HBAR`;
      this.refresh();
    } catch (err: any) {
      console.error('Add liquidity error:', err);
      this.loading = false;

      // Decode opaque WalletConnect DAppSigner errors into human-readable messages.
      // The signer throws: "Error executing transaction or query: {txError, queryError}"
      // where txError.message._code maps to Hedera ResponseCode values.
      let errorMessage = err.message || 'Failed to add liquidity';
      if (errorMessage.includes('Error executing transaction or query:')) {
        try {
          const jsonStr = errorMessage.replace(/^.*?Error executing transaction or query:\s*/, '');
          const parsed = JSON.parse(jsonStr);
          if (parsed?.txError?.message?._code === 10) {
            const feeHbar = (this.poolCreationFeeTinybar / 100_000_000).toFixed(2);
            errorMessage = `Insufficient HBAR balance. Pool creation requires ~${feeHbar} HBAR fee. Add more HBAR to your wallet and try again.`;
          }
        } catch {
          // Parsing failed — keep the original message
        }
      }

      this.error = errorMessage;
      this.statusMessage = '';
      this.refresh();
    }
  }
}