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

type LiquidityStep = 'form' | 'processing' | 'success';

export class AddLiquidity {
  // Form state
  private static tokenIdInput = '';
  private static tokenValidated = false;
  private static tokenInfo: { tokenId: string; name: string; symbol: string; decimals: number; hasCustomFees: boolean; priceUsd?: number } | null = null;
  private static tokenError: string | null = null;
  private static poolExists: boolean | null = null;
  private static poolCreationFeeTinybar: number = 0;
  private static hbarPriceUsd: number = 0;

  // Amounts
  private static tokenAmount = '';
  private static hbarAmount = '';
  private static slippage = 1.5; // percent

  // UI state
  private static step: LiquidityStep = 'form';
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
      return `<div class="cc-right-content"><div class="error-state"><p class="error-message">⚠ ${this.error}</p><button class="terminal-button" id="al-dismiss-error" style="margin-top:1rem">DISMISS</button></div></div>`;
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
        <h3 class="section-title">◆ Add Liquidity — SaucerSwap V1</h3>
        <div class="back-link" id="al-back"><span class="back-arrow">←</span><span>Back</span></div>

        <div style="margin:0.75rem 0;padding:0.6rem 0.8rem;background:rgba(100,180,255,0.08);border:1px solid rgba(100,180,255,0.25);border-radius:6px">
          <p style="font-size:0.78rem;color:#64b4ff;margin:0 0 0.35rem">◆ <strong>SaucerSwap V1</strong> — Creates an HBAR / Token liquidity pool. You will receive LP tokens representing your share of the pool.</p>
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
          ${tokenValid ? `<p style="font-size:0.78rem;color:#6bff9e;margin:0.35rem 0 0">✓ ${this.tokenInfo!.name} (${this.tokenInfo!.symbol}) — ${this.tokenInfo!.decimals} decimals${this.poolExists ? ' — Pool exists' : ' — New pool will be created'}</p>` : ''}
        </div>

        ${tokenValid ? this.renderAmountInputs() : ''}
      </div>`;
  }

  private static renderAmountInputs(): string {
    const canSubmit = this.tokenAmount && this.hbarAmount && parseFloat(this.tokenAmount) > 0 && parseFloat(this.hbarAmount) > 0;
    return `
      <div class="filter-divider"></div>
      <div class="input-group">
        <label for="al-token-amount">${this.tokenInfo!.symbol} Amount *</label>
        <input type="number" id="al-token-amount" class="token-input" placeholder="Amount of tokens" value="${this.escapeHtml(this.tokenAmount)}" step="any" min="0" />
      </div>
      <div class="input-group">
        <label for="al-hbar-amount">HBAR Amount *</label>
        <input type="number" id="al-hbar-amount" class="token-input" placeholder="Amount of HBAR" value="${this.escapeHtml(this.hbarAmount)}" step="any" min="0" />
      </div>
      <div class="input-group">
        <label for="al-slippage">Slippage Tolerance (%)</label>
        <input type="number" id="al-slippage" class="token-input" placeholder="1.5" value="${this.slippage}" step="0.5" min="0.5" max="50" style="width:80px" />
      </div>
      ${canSubmit ? `
        <div class="filter-divider"></div>
        <button class="terminal-button" id="al-submit">⚡ ADD LIQUIDITY</button>
      ` : ''}`;
  }


  // --- PREVIEW (right panel) ---
  private static renderPreview(): string {
    if (!this.tokenValidated || !this.tokenInfo) {
      return `<div class="cc-right-content"><h4 class="section-title" style="font-size:0.95rem">Pool Preview</h4><p style="font-size:0.82rem;color:var(--terminal-text);opacity:0.5">Enter a Token ID and click VALIDATE to see pool details.</p></div>`;
    }
    const tokenAmt = parseFloat(this.tokenAmount) || 0;
    const hbarAmt = parseFloat(this.hbarAmount) || 0;
    const ratio = tokenAmt > 0 && hbarAmt > 0 ? (hbarAmt / tokenAmt).toFixed(6) : '—';

    // Calculate USD values
    const tokenValueUsd = this.tokenInfo.priceUsd && tokenAmt > 0 ? (tokenAmt * this.tokenInfo.priceUsd).toFixed(2) : null;
    const hbarValueUsd = this.hbarPriceUsd && hbarAmt > 0 ? (hbarAmt * this.hbarPriceUsd).toFixed(2) : null;
    const totalValueUsd = tokenValueUsd && hbarValueUsd ? (parseFloat(tokenValueUsd) + parseFloat(hbarValueUsd)).toFixed(2) : null;

    // Calculate transaction cost estimate
    const gasCost = !this.poolExists ? 3200000 : 240000; // gas units
    const gasCostHbar = (gasCost * 0.00000001).toFixed(4); // ~0.01 tinybar per gas
    const gasCostUsd = this.hbarPriceUsd ? (parseFloat(gasCostHbar) * this.hbarPriceUsd).toFixed(2) : null;

    // Pool creation fee in USD
    const poolCreationFeeHbar = this.poolCreationFeeTinybar > 0 ? (this.poolCreationFeeTinybar / 100000000).toFixed(2) : null;
    const poolCreationFeeUsd = poolCreationFeeHbar && this.hbarPriceUsd ? (parseFloat(poolCreationFeeHbar) * this.hbarPriceUsd).toFixed(2) : null;

    return `
      <div class="cc-right-content">
        <h4 class="section-title" style="font-size:0.95rem">Pool Preview</h4>
        <div class="preview-info">
          <div class="info-row"><span>Token</span><span class="status-value">${this.tokenInfo.name} (${this.tokenInfo.symbol})</span></div>
          <div class="info-row"><span>Token ID</span><span class="status-value">${this.tokenInfo.tokenId}</span></div>
          <div class="info-row"><span>Decimals</span><span class="status-value">${this.tokenInfo.decimals}</span></div>
          <div class="info-row"><span>Pool Status</span><span class="status-value" style="color:${this.poolExists ? '#6bff9e' : '#f0a040'}">${this.poolExists ? 'Exists' : 'New Pool'}</span></div>
          ${this.tokenInfo.hasCustomFees ? `<div class="info-row"><span>Custom Fees</span><span class="status-value" style="color:#ff6b6b">⚠ Yes</span></div>` : ''}
        </div>
        ${this.tokenInfo.priceUsd || this.hbarPriceUsd ? `
          <div class="filter-divider"></div>
          <div class="preview-info">
            ${this.tokenInfo.priceUsd ? `<div class="info-row"><span>${this.tokenInfo.symbol} Price</span><span class="status-value">$${this.tokenInfo.priceUsd.toFixed(6)}</span></div>` : ''}
            ${this.hbarPriceUsd ? `<div class="info-row"><span>HBAR Price</span><span class="status-value">$${this.hbarPriceUsd.toFixed(4)}</span></div>` : ''}
          </div>
        ` : ''}
        ${tokenAmt > 0 || hbarAmt > 0 ? `
          <div class="filter-divider"></div>
          <div class="preview-info">
            <div class="info-row"><span>${this.tokenInfo.symbol}</span><span class="status-value">${tokenAmt > 0 ? tokenAmt.toLocaleString() : '—'}${tokenValueUsd ? ` ($${tokenValueUsd})` : ''}</span></div>
            <div class="info-row"><span>HBAR</span><span class="status-value">${hbarAmt > 0 ? hbarAmt.toLocaleString() : '—'}${hbarValueUsd ? ` ($${hbarValueUsd})` : ''}</span></div>
            ${totalValueUsd ? `<div class="info-row"><span>Total Value</span><span class="status-value" style="color:#6bff9e">$${totalValueUsd}</span></div>` : ''}
            <div class="info-row"><span>Rate</span><span class="status-value">1 ${this.tokenInfo.symbol} = ${ratio} HBAR</span></div>
            <div class="info-row"><span>Slippage</span><span class="status-value">${this.slippage}%</span></div>
          </div>
        ` : ''}
        <div class="filter-divider"></div>
        <div class="preview-info">
          <div class="info-row"><span>Gas Cost</span><span class="status-value">${gasCostHbar} HBAR${gasCostUsd ? ` ($${gasCostUsd})` : ''}</span></div>
          ${!this.poolExists && poolCreationFeeHbar ? `<div class="info-row"><span>Pool Creation Fee</span><span class="status-value" style="color:#f0a040">${poolCreationFeeHbar} HBAR${poolCreationFeeUsd ? ` (~$${poolCreationFeeUsd})` : ''}</span></div>` : ''}
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
    this.poolExists = null;
    this.poolCreationFeeTinybar = 0;
    this.tokenAmount = '';
    this.hbarAmount = '';
    this.slippage = 1.5;
    this.step = 'form';
    this.loading = false;
    this.error = null;
    this.statusMessage = '';
    this.txId = null;
  }

  // --- Convert Hedera ID (0.0.xxxxx) to EVM address ---
  private static toEvmAddress(hederaId: string): string {
    const parts = hederaId.split('.');
    const num = parseInt(parts[2], 10);
    return '0x' + num.toString(16).padStart(40, '0');
  }

  // --- INIT: wire up event listeners ---
  static init(): void {
    // Back button
    document.getElementById('al-back')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('navigate-to-tool', { detail: { toolId: 'home' } }));
    });

    // Token ID input
    const tokenInput = document.getElementById('al-token-id') as HTMLInputElement;
    tokenInput?.addEventListener('input', () => { this.tokenIdInput = tokenInput.value; });
    tokenInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.validateToken(); });

    // Validate button
    document.getElementById('al-validate')?.addEventListener('click', () => this.validateToken());

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

      // Check if pool exists via SaucerSwap REST API
      try {
        const poolsRes = await fetch(`${SAUCERSWAP_API_URL}/pools`, {
          headers: { 'x-api-key': SAUCERSWAP_API_KEY },
        });

        if (poolsRes.ok) {
          const pools = await poolsRes.json();
          // Find pool with WHBAR and this token
          const pool = pools.find((p: any) =>
            (p.tokenA === WHBAR_TOKEN_ID && p.tokenB === tokenId) ||
            (p.tokenA === tokenId && p.tokenB === WHBAR_TOKEN_ID)
          );
          this.poolExists = !!pool;
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
    } catch (err: any) {
      this.tokenError = err.message || 'Failed to validate token';
      this.tokenValidated = false;
      this.tokenInfo = null;
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