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
  private static tokenBIdInput = '';
  private static tokenBValidated = false;
  private static tokenBInfo: { tokenId: string; name: string; symbol: string; decimals: number; hasCustomFees: boolean; priceUsd?: number } | null = null;
  private static tokenBError: string | null = null;

  // Legacy (will be removed)
  private static poolExists: boolean | null = null;
  private static poolCreationFeeTinybar: number = 0;
  private static hbarPriceUsd: number = 0;

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

        ${this.availablePools.length > 0 ? `
          <h4 style="font-size:0.9rem;color:var(--terminal-text);margin:0 0 0.75rem">Existing Pools (${this.availablePools.length})</h4>
          ${this.availablePools.map((pool, idx) => this.renderPoolCard(pool, idx)).join('')}
          <div class="filter-divider"></div>
        ` : `
          <p style="font-size:0.82rem;color:var(--terminal-text);opacity:0.7;margin:0 0 1rem">No existing pools found for this token.</p>
        `}

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
          <label for="al-token-b-id">Token B ID *</label>
          <div class="input-row" style="gap:0.5rem">
            <input type="text" id="al-token-b-id" class="token-input" placeholder="0.0.xxxxx" value="${this.escapeHtml(this.tokenBIdInput)}" style="flex:1" />
            <button class="terminal-button" id="al-validate-b" style="white-space:nowrap">${this.loading ? '...' : 'VALIDATE'}</button>
          </div>
          ${this.tokenBError ? `<p style="font-size:0.78rem;color:#ff6b6b;margin:0.35rem 0 0">${this.tokenBError}</p>` : ''}
          ${tokenBValid ? `<p style="font-size:0.78rem;color:#6bff9e;margin:0.35rem 0 0">✓ ${this.tokenBInfo!.name} (${this.tokenBInfo!.symbol}) — ${this.tokenBInfo!.decimals} decimals</p>` : ''}
        </div>
      </div>`;
  }

  // --- LIQUIDITY FORM STEP ---
  private static renderLiquidityForm(): string {
    const tokenA = this.selectedPool ? (this.selectedPool.tokenA.id === this.tokenInfo?.tokenId ? this.selectedPool.tokenA : this.selectedPool.tokenB) : this.tokenInfo;
    const tokenB = this.selectedPool ? (this.selectedPool.tokenA.id === this.tokenInfo?.tokenId ? this.selectedPool.tokenB : this.selectedPool.tokenA) : this.tokenBInfo;

    if (!tokenA || !tokenB) return '';

    const canSubmit = this.tokenAmount && this.hbarAmount && parseFloat(this.tokenAmount) > 0 && parseFloat(this.hbarAmount) > 0;

    return `
      <div class="art-gen-section">
        <h3 class="section-title">◆ Add Liquidity</h3>
        <div class="back-link" id="al-back-to-pools"><span class="back-arrow">←</span><span>Back to Pools</span></div>

        <div style="margin:0.75rem 0;padding:0.6rem 0.8rem;background:rgba(100,180,255,0.08);border:1px solid rgba(100,180,255,0.25);border-radius:6px">
          <p style="font-size:0.78rem;color:#64b4ff;margin:0">Pool: <strong>${tokenA.symbol} / ${tokenB.symbol}</strong></p>
          ${this.selectedPool ? `<p style="font-size:0.75rem;color:var(--terminal-text);opacity:0.7;margin:0.25rem 0 0">${this.selectedPool.contractId}</p>` : ''}
        </div>

        <div class="filter-divider"></div>

        <div class="input-group">
          <label for="al-token-amount">${tokenA.symbol} Amount *</label>
          <input type="number" id="al-token-amount" class="token-input" placeholder="Amount of tokens" value="${this.escapeHtml(this.tokenAmount)}" step="any" min="0" />
        </div>
        <div class="input-group">
          <label for="al-hbar-amount">${tokenB.symbol} Amount *</label>
          <input type="number" id="al-hbar-amount" class="token-input" placeholder="Amount of tokens" value="${this.escapeHtml(this.hbarAmount)}" step="any" min="0" />
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
      <div class="cc-right-content">
        <h4 class="section-title" style="font-size:0.95rem">Pool Selection</h4>
        <p style="font-size:0.82rem;color:var(--terminal-text);opacity:0.7">Select an existing pool to add liquidity, or create a new pool.</p>
        <div class="filter-divider"></div>
        <div class="preview-info">
          <div class="info-row"><span>Existing Pools</span><span class="status-value">${this.availablePools.length}</span></div>
          <div class="info-row"><span>Gas Cost (Existing)</span><span class="status-value">~0.0024 HBAR</span></div>
          <div class="info-row"><span>Gas Cost (New Pool)</span><span class="status-value">~0.032 HBAR</span></div>
          <div class="info-row"><span>Pool Creation Fee</span><span class="status-value" style="color:#f0a040">~$50 HBAR</span></div>
        </div>
      </div>`;
  }

  private static renderNewPoolPreview(): string {
    if (!this.tokenBValidated || !this.tokenBInfo) {
      return `<div class="cc-right-content"><h4 class="section-title" style="font-size:0.95rem">New Pool</h4><p style="font-size:0.82rem;color:var(--terminal-text);opacity:0.5">Enter Token B ID to create a new pool.</p></div>`;
    }

    return `
      <div class="cc-right-content">
        <h4 class="section-title" style="font-size:0.95rem">New Pool Preview</h4>
        <div class="preview-info">
          <div class="info-row"><span>Token A</span><span class="status-value">${this.tokenInfo?.symbol}</span></div>
          <div class="info-row"><span>Token B</span><span class="status-value">${this.tokenBInfo.symbol}</span></div>
          ${this.tokenInfo?.priceUsd ? `<div class="info-row"><span>${this.tokenInfo.symbol} Price</span><span class="status-value">$${this.tokenInfo.priceUsd.toFixed(6)}</span></div>` : ''}
          ${this.tokenBInfo.priceUsd ? `<div class="info-row"><span>${this.tokenBInfo.symbol} Price</span><span class="status-value">$${this.tokenBInfo.priceUsd.toFixed(6)}</span></div>` : ''}
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
    this.tokenBIdInput = '';
    this.tokenBValidated = false;
    this.tokenBInfo = null;
    this.tokenBError = null;
    this.poolExists = null;
    this.poolCreationFeeTinybar = 0;
    this.hbarPriceUsd = 0;
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
        this.selectedPool = this.availablePools[idx];
        this.step = 'liquidity-form';
        this.refresh();
      });
    });

    // Token B input (for new pool)
    const tokenBInput = document.getElementById('al-token-b-id') as HTMLInputElement;
    tokenBInput?.addEventListener('input', () => { this.tokenBIdInput = tokenBInput.value; });
    tokenBInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.validateTokenB(); });

    document.getElementById('al-validate-b')?.addEventListener('click', () => this.validateTokenB());

    // Amount inputs — store on input, refresh on change (blur) to avoid killing the cursor
    const tokenAmtInput = document.getElementById('al-token-amount') as HTMLInputElement;
    tokenAmtInput?.addEventListener('input', () => { this.tokenAmount = tokenAmtInput.value; });
    tokenAmtInput?.addEventListener('change', () => { this.refresh(); });

    const hbarAmtInput = document.getElementById('al-hbar-amount') as HTMLInputElement;
    hbarAmtInput?.addEventListener('input', () => { this.hbarAmount = hbarAmtInput.value; });
    hbarAmtInput?.addEventListener('change', () => { this.refresh(); });

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
    this.poolExists = null;
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

          // Legacy: set poolExists for backward compatibility
          this.poolExists = this.availablePools.length > 0;
        } else {
          // Fallback to mirror node contract call if API fails
          const whbarEvm = this.toEvmAddress(WHBAR_TOKEN_ID).slice(2).padStart(64, '0');
          const tokenEvm = this.toEvmAddress(tokenId).slice(2).padStart(64, '0');
          const routerEvm = this.toEvmAddress(SAUCER_V1_ROUTER);

          const factoryRes = await fetch(`${MIRROR_NODE_URL}/api/v1/contracts/call`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: '0xc45a0155', to: routerEvm, estimate: false }),
          });

          if (factoryRes.ok) {
            const factoryData = await factoryRes.json();
            const factoryAddr = '0x' + (factoryData.result || '').slice(-40);
            const getPairData = '0xe6a43905' + whbarEvm + tokenEvm;

            const pairRes = await fetch(`${MIRROR_NODE_URL}/api/v1/contracts/call`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ data: getPairData, to: factoryAddr, estimate: false }),
            });

            if (pairRes.ok) {
              const pairData = await pairRes.json();
              const result = (pairData.result || '').replace(/^0x/, '');
              this.poolExists = result.replace(/0/g, '').length > 0;
            }
          }
        }

        // If pool doesn't exist, fetch pool creation fee from Factory
        if (this.poolExists === false) {
          try {
            const routerEvm = this.toEvmAddress(SAUCER_V1_ROUTER);
            const factoryRes = await fetch(`${MIRROR_NODE_URL}/api/v1/contracts/call`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ data: '0xc45a0155', to: routerEvm, estimate: false }),
            });

            if (factoryRes.ok) {
              const factoryData = await factoryRes.json();
              const factoryAddr = '0x' + (factoryData.result || '').slice(-40);

              const feeRes = await fetch(`${MIRROR_NODE_URL}/api/v1/contracts/call`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data: '0x881a075a', to: factoryAddr, estimate: false }),
              });

              if (feeRes.ok) {
                const feeData = await feeRes.json();
                const tinycent = parseInt((feeData.result || '0x0').replace(/^0x/, ''), 16);

                const rateRes = await fetch(`${MIRROR_NODE_URL}/api/v1/network/exchangerate`);
                if (rateRes.ok) {
                  const rateData = await rateRes.json();
                  const centEquivalent = Number(rateData.current_rate.cent_equivalent);
                  const hbarEquivalent = Number(rateData.current_rate.hbar_equivalent);
                  const centToHbarRatio = centEquivalent / hbarEquivalent;
                  this.poolCreationFeeTinybar = Math.ceil(tinycent / centToHbarRatio);
                }
              }
            }
          } catch {
            // Non-fatal: we'll still show a warning if fee couldn't be fetched
            this.poolCreationFeeTinybar = 0;
          }
        }
      } catch {
        this.poolExists = null;
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

  // --- TOKEN B VALIDATION (for new pool creation) ---
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
    if (!this.tokenValidated || !this.tokenInfo) return;

    const tokenAmt = parseFloat(this.tokenAmount);
    const hbarAmt = parseFloat(this.hbarAmount);
    if (!tokenAmt || tokenAmt <= 0 || !hbarAmt || hbarAmt <= 0) return;

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

      // Convert amounts to smallest units
      const tokenSmallestUnit = Math.round(tokenAmt * Math.pow(10, this.tokenInfo.decimals));
      const hbarTinybar = Math.round(hbarAmt * 1e8); // HBAR has 8 decimals (tinybar)

      // Calculate min amounts with slippage
      const slippageFactor = (100 - this.slippage) / 100;
      const amountTokenMin = Math.round(tokenSmallestUnit * slippageFactor);
      const amountETHMin = Math.round(hbarTinybar * slippageFactor);

      // EVM addresses
      const tokenEvmAddress = this.toEvmAddress(this.tokenInfo.tokenId);
      const toEvmAddress = this.toEvmAddress(accountId);

      // Deadline: 10 minutes from now
      const deadline = Math.floor(Date.now() / 1000) + 600;

      // Step 1: Approve token allowance for the router
      this.statusMessage = 'Step 1/2 — Approving token allowance...';
      this.refresh();

      const approveTx = new AccountAllowanceApproveTransaction()
        .approveTokenAllowance(
          TokenId.fromString(this.tokenInfo.tokenId),
          acctId,
          AccountId.fromString(SAUCER_V1_ROUTER),
          Number(tokenSmallestUnit)
        );
      approveTx.setTransactionId(TransactionId.generate(acctId));
      approveTx.freezeWith(client);
      await approveTx.executeWithSigner(signer);

      // Brief pause between transactions
      await new Promise(r => setTimeout(r, 2000));

      // Step 2: Add liquidity
      // Determine if this is a new pool (only treat explicit false as new pool)
      const isNewPool = this.poolExists === false;
      if (this.poolExists === null) {
        throw new Error('Pool status could not be determined. Please re-validate the token and try again.');
      }

      this.statusMessage = `Step 2/2 — ${isNewPool ? 'Creating pool & adding' : 'Adding'} liquidity...`;
      this.refresh();

      const functionName = isNewPool ? 'addLiquidityETHNewPool' : 'addLiquidityETH';
      const gasLimit = isNewPool ? 3_200_000 : 240_000;

      // For new pools, msg.value must include pool creation fee + HBAR liquidity
      const payableTinybar = isNewPool ? hbarTinybar + this.poolCreationFeeTinybar : hbarTinybar;

      if (isNewPool && this.poolCreationFeeTinybar <= 0) {
        throw new Error('Pool creation fee could not be fetched. Please re-validate the token.');
      }

      const params = new ContractFunctionParameters()
        .addAddress(tokenEvmAddress)
        .addUint256(tokenSmallestUnit)
        .addUint256(amountTokenMin)
        .addUint256(amountETHMin)
        .addAddress(toEvmAddress)
        .addUint256(deadline);

      const liquidityTx = new ContractExecuteTransaction()
        .setContractId(ContractId.fromString(SAUCER_V1_ROUTER))
        .setGas(gasLimit)
        .setPayableAmount(Hbar.fromTinybars(payableTinybar))
        .setFunction(functionName, params);

      liquidityTx.setTransactionId(TransactionId.generate(acctId));
      liquidityTx.freezeWith(client);

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
        const mirrorTxId = this.txId.replace('@', '-').replace(/\./g, '-');
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
      this.error = err.message || 'Failed to add liquidity';
      this.statusMessage = '';
      this.refresh();
    }
  }
}