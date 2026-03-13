/**
 * Staking Tool — Admin Configuration
 *
 * Creators set up soft-staking programs here. Community members earn rewards
 * simply by holding the stake token in their own wallet — no locking required.
 *
 * Flow:
 *  1. Creator fills in staking config (stake token, reward token, rate, frequency).
 *  2. Creator grants a fungible token allowance on their treasury so the backend
 *     operator can distribute reward tokens automatically.
 *  3. Program is saved and becomes available via GET /api/staking-programs/public.
 *  4. The backend cron distributes rewards based on live Mirror Node snapshots.
 */
import WalletConnectService from '../services/WalletConnectService'
import { API_BASE_URL, BACKEND_MINTER_ACCOUNT, MIRROR_NODE_URL, getHederaClient } from '../config'
import {
  AccountAllowanceApproveTransaction,
  AccountId,
  TokenId,
  TransactionId,
} from '@hashgraph/sdk'

type StakingStep = 'form' | 'allowance' | 'success'
type StakeType   = 'NFT' | 'FT'
type Frequency   = '1d' | '7d' | '30d' | '90d' | '180d' | '365d'

interface StakingProgram {
  id: string
  name: string
  description: string | null
  stake_token_id: string
  stake_token_type: StakeType
  reward_token_id: string
  treasury_account_id: string
  reward_rate_per_day: number
  min_stake_amount: number
  frequency: Frequency
  total_reward_supply: number | null
  allowance_granted: boolean
  last_distributed_at: string | null
  status: 'active' | 'paused' | 'completed'
  created_at: string
}

const FREQUENCY_LABELS: Record<Frequency, string> = {
  '1d':   'Daily (every 1 day)',
  '7d':   'Weekly (every 7 days)',
  '30d':  'Monthly (every 30 days)',
  '90d':  'Quarterly (every 90 days)',
  '180d': 'Semi-Annual (every 180 days)',
  '365d': 'Annual (every 365 days)',
}

const FREQUENCY_DAYS: Record<Frequency, number> = {
  '1d': 1, '7d': 7, '30d': 30, '90d': 90, '180d': 180, '365d': 365,
}

export class StakingTool {
  // ─── Form state ───────────────────────────────────────────
  private static step: StakingStep = 'form'
  private static stakeType: StakeType = 'FT'
  private static programName    = ''
  private static description    = ''
  private static stakeTokenId   = ''
  private static rewardTokenId  = ''
  private static treasuryAccountId = ''
  private static rewardRatePerDay  = ''
  private static minStakeAmount    = '0'
  private static frequency: Frequency = '7d'
  private static totalRewardSupply = ''

  // ─── Token info (fetched on blur) ─────────────────────────
  private static rewardDecimals: number | null   = null
  private static rewardTotalSupply: string | null = null
  private static rewardTokenName   = ''
  private static rewardCustomFees: unknown        = null

  // ─── Program list ─────────────────────────────────────────
  private static programs: StakingProgram[] = []
  private static loadingPrograms = false

  // ─── Flow state ───────────────────────────────────────────
  private static loading         = false
  private static error: string | null = null
  private static statusMessage   = ''
  private static createdProgramId: string | null = null
  private static showConfirmModal = false
  private static _pendingDeleteId: string | null = null

  // ─── RENDER ───────────────────────────────────────────────

  static render(): string {
    return `
      <div class="terminal-window">
        ${this.renderChrome()}
        ${this.renderContent()}
        ${this.renderStatusBar()}
      </div>
      ${this.showConfirmModal ? this.renderConfirmModal() : ''}
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
        <div class="window-title">hedera-creator-kit — staking tool</div>
      </div>`
  }

  private static renderStatusBar(): string {
    const ws = WalletConnectService.getState()
    const walletInfo = ws.connected ? `${ws.accountId} | ${ws.hbarBalance || '0'} ℏ` : 'Not Connected'
    return `
      <div class="status-bar">
        <div class="status-left"><span class="status-item">${walletInfo}</span></div>
        <div class="status-center"><span class="status-item">${this.statusMessage || 'Built by SLIME'}</span></div>
        <div class="status-right">
          <span class="status-item">HEDERA CREATOR KIT v1.0</span>
          <span class="status-item">MAINNET</span>
        </div>
      </div>`
  }

  private static renderContent(): string {
    return `
      <div class="terminal-content">
        <div class="art-gen-layout">
          <div class="art-gen-left">${this.renderLeft()}</div>
          <div class="art-gen-right">${this.renderRight()}</div>
        </div>
      </div>`
  }

  private static renderLeft(): string {
    if (this.loading) {
      return `
        <div class="art-gen-section">
          <h3 class="section-title">◆ Processing...</h3>
          <div class="loading-state">
            <div class="spinner"></div>
            <p>${this.statusMessage || 'Please wait...'}</p>
          </div>
        </div>`
    }
    if (this.step === 'success') return this.renderSuccess()
    if (this.step === 'allowance') return this.renderAllowanceStep()
    return this.renderForm()
  }

  private static renderRight(): string {
    if (this.error) {
      return `
        <div class="cc-right-content">
          <div class="error-state">
            <p class="error-message">⚠ ${this.error}</p>
            <button class="terminal-button" id="stk-dismiss-error" style="margin-top:1rem">DISMISS</button>
          </div>
        </div>`
    }
    return this.renderProgramList()
  }

  // ─── FORM ─────────────────────────────────────────────────

  private static renderForm(): string {
    const ws = WalletConnectService.getState()
    const isFT = this.stakeType === 'FT'

    const freqOptions = (Object.keys(FREQUENCY_LABELS) as Frequency[]).map(f =>
      `<option value="${f}" ${this.frequency === f ? 'selected' : ''}>${FREQUENCY_LABELS[f]}</option>`
    ).join('')

    const estReward = this.rewardRatePerDay && this.frequency
      ? (parseFloat(this.rewardRatePerDay) * FREQUENCY_DAYS[this.frequency]).toFixed(6)
      : null

    return `
      <div class="art-gen-section">
        <h3 class="section-title">◆ Configure Staking Program</h3>
        <div class="back-link" id="stk-back"><span class="back-arrow">←</span><span>Back</span></div>

        <div style="margin:0.75rem 0;padding:0.6rem 0.8rem;background:rgba(0,255,64,0.06);border:1px solid rgba(0,255,64,0.2);border-radius:6px">
          <p style="font-size:0.78rem;color:var(--accent-green,#00ff40);margin:0 0 0.3rem">◆ <strong>Soft-Staking: No Locking Required</strong></p>
          <p style="font-size:0.77rem;color:var(--terminal-text);opacity:0.7;margin:0">
            Holders earn rewards just by keeping tokens in their wallet — nothing is moved or escrowed.
            Rewards are distributed automatically based on live wallet snapshots.
          </p>
        </div>

        <div class="filter-divider"></div>

        <div class="input-group">
          <label>Stake Asset Type *</label>
          <div style="display:flex;gap:0.5rem">
            <button class="terminal-button ${this.stakeType === 'FT' ? '' : 'secondary'}" id="stk-type-ft" style="flex:1">Fungible Token</button>
            <button class="terminal-button ${this.stakeType === 'NFT' ? '' : 'secondary'}" id="stk-type-nft" style="flex:1">NFT Collection</button>
          </div>
          <p style="font-size:0.75rem;color:var(--terminal-text);opacity:0.5;margin:0.3rem 0 0">
            ${isFT ? 'Reward holders based on their fungible token balance.' : 'Reward holders based on number of NFTs held.'}
          </p>
        </div>

        <div class="input-group">
          <label for="stk-name">Program Name *</label>
          <input type="text" id="stk-name" class="token-input" placeholder="e.g. SLIME Holder Rewards" value="${this.escapeHtml(this.programName)}" />
        </div>
        <div class="input-group">
          <label for="stk-description">Description</label>
          <input type="text" id="stk-description" class="token-input" placeholder="Optional description for holders" value="${this.escapeHtml(this.description)}" />
        </div>

        <div class="filter-divider"></div>

        <div class="input-group">
          <label for="stk-stake-token">Stake Token ID * <span style="opacity:0.5;font-size:0.75rem">(token holders must hold)</span></label>
          <input type="text" id="stk-stake-token" class="token-input" placeholder="0.0.xxxxxxx" value="${this.escapeHtml(this.stakeTokenId)}" />
        </div>
        <div class="input-group">
          <label for="stk-reward-token">Reward Token ID * <span style="opacity:0.5;font-size:0.75rem">(token you distribute)</span></label>
          <input type="text" id="stk-reward-token" class="token-input" placeholder="0.0.xxxxxxx" value="${this.escapeHtml(this.rewardTokenId)}" />
          ${this.rewardDecimals !== null ? `<p style="font-size:0.75rem;color:var(--accent-green);margin:0.3rem 0 0">✓ ${this.rewardTokenName} — ${this.rewardDecimals} decimals</p>` : ''}
          ${this.rewardCustomFees ? this.renderFeeWarning() : ''}
        </div>
        <div class="input-group">
          <label for="stk-treasury">Treasury Account ID * <span style="opacity:0.5;font-size:0.75rem">(holds reward token supply)</span></label>
          <input type="text" id="stk-treasury" class="token-input" placeholder="0.0.xxxxxxx" value="${this.escapeHtml(this.treasuryAccountId)}" />
          ${ws.connected ? `<button class="terminal-button secondary" id="stk-use-wallet" style="margin-top:0.4rem;width:100%;font-size:0.75rem">USE CONNECTED WALLET</button>` : ''}
        </div>

        <div class="filter-divider"></div>

        <div class="input-group">
          <label for="stk-rate">Daily Reward Rate * <span style="opacity:0.5;font-size:0.75rem">(whole reward tokens per ${isFT ? 'whole token held' : 'NFT held'} per day)</span></label>
          <input type="number" id="stk-rate" class="token-input" placeholder="e.g. 0.1" step="any" min="0" value="${this.escapeHtml(this.rewardRatePerDay)}" />
          ${estReward ? `<p style="font-size:0.75rem;color:var(--accent-green);margin:0.3rem 0 0">≈ ${estReward} tokens per ${isFT ? 'unit' : 'NFT'} per distribution</p>` : ''}
        </div>
        <div class="input-group">
          <label for="stk-min-stake">Minimum Holdings <span style="opacity:0.5;font-size:0.75rem">(${isFT ? 'whole tokens' : 'NFTs'} required to qualify)</span></label>
          <input type="number" id="stk-min-stake" class="token-input" placeholder="0" min="0" value="${this.escapeHtml(this.minStakeAmount)}" />
        </div>
        <div class="input-group">
          <label for="stk-frequency">Distribution Frequency *</label>
          <select id="stk-frequency" class="token-input" style="background:var(--terminal-bg);color:var(--terminal-text);border:1px solid var(--border-color);padding:0.5rem">
            ${freqOptions}
          </select>
        </div>
        <div class="input-group">
          <label for="stk-supply">Total Reward Supply <span style="opacity:0.5;font-size:0.75rem">(optional cap in whole tokens)</span></label>
          <input type="number" id="stk-supply" class="token-input" placeholder="Leave blank for unlimited" min="0" value="${this.escapeHtml(this.totalRewardSupply)}" />
        </div>

        <div class="filter-divider"></div>

        <button class="terminal-button" id="stk-submit" style="width:100%;margin-top:0.5rem"
          ${!ws.connected ? 'disabled title="Connect wallet first"' : ''}>
          NEXT: GRANT ALLOWANCE →
        </button>
        ${!ws.connected ? '<p style="font-size:0.75rem;color:#ff6b6b;margin:0.4rem 0 0;text-align:center">⚠ Connect your wallet to continue</p>' : ''}
      </div>`
  }

  private static renderFeeWarning(): string {
    const fees = this.rewardCustomFees as any
    const hasFractional = fees?.fractional_fees?.length > 0
    const hasFixed = fees?.fixed_fees?.length > 0
    if (!hasFractional && !hasFixed) return ''
    return `
      <div style="margin-top:0.5rem;padding:0.5rem 0.8rem;background:rgba(255,165,0,0.1);border:1px solid rgba(255,165,0,0.4);border-radius:6px">
        <p style="font-size:0.75rem;color:#ffa500;margin:0">
          ⚠ <strong>Custom Fee Detected:</strong>
          ${hasFractional ? `Fractional fee — holders may receive slightly less than the full reward amount (Hedera charges this automatically).` : ''}
          ${hasFixed ? `Fixed fee — a flat amount is charged per transfer.` : ''}
          Treasury account is exempt from fixed fees per Hedera protocol.
        </p>
      </div>`
  }

  // ─── ALLOWANCE STEP ───────────────────────────────────────

  private static renderAllowanceStep(): string {
    const perDistrib = this.rewardRatePerDay
      ? (parseFloat(this.rewardRatePerDay) * FREQUENCY_DAYS[this.frequency]).toFixed(6)
      : '?'

    return `
      <div class="art-gen-section">
        <h3 class="section-title">◆ Grant Token Allowance</h3>
        <div class="back-link" id="stk-back-to-form"><span class="back-arrow">←</span><span>Back to form</span></div>

        <div style="margin:0.75rem 0;padding:0.6rem 0.8rem;background:rgba(0,255,64,0.06);border:1px solid rgba(0,255,64,0.2);border-radius:6px">
          <p style="font-size:0.78rem;color:var(--accent-green);margin:0 0 0.3rem">◆ <strong>Why an allowance?</strong></p>
          <p style="font-size:0.77rem;color:var(--terminal-text);opacity:0.7;margin:0">
            Granting an allowance lets our backend operator automatically distribute reward tokens
            from your treasury on schedule — without ever needing your private key or requiring you to be online.
          </p>
        </div>

        <div class="filter-divider"></div>

        <div style="background:rgba(255,255,255,0.04);border-radius:6px;padding:0.8rem;margin-bottom:1rem">
          <p style="font-size:0.8rem;margin:0 0 0.3rem"><strong>Program:</strong> ${this.escapeHtml(this.programName)}</p>
          <p style="font-size:0.8rem;margin:0 0 0.3rem"><strong>Stake Token:</strong> ${this.escapeHtml(this.stakeTokenId)} (${this.stakeType})</p>
          <p style="font-size:0.8rem;margin:0 0 0.3rem"><strong>Reward Token:</strong> ${this.escapeHtml(this.rewardTokenId)}</p>
          <p style="font-size:0.8rem;margin:0 0 0.3rem"><strong>Rate:</strong> ${this.rewardRatePerDay} tokens / ${this.stakeType === 'NFT' ? 'NFT' : 'unit'} / day → ~${perDistrib} per distribution</p>
          <p style="font-size:0.8rem;margin:0"><strong>Frequency:</strong> ${FREQUENCY_LABELS[this.frequency]}</p>
        </div>

        <div class="input-group">
          <label for="stk-allowance-amount">Allowance Amount * <span style="opacity:0.5;font-size:0.75rem">(whole reward tokens — e.g. your total reward budget)</span></label>
          <input type="number" id="stk-allowance-amount" class="token-input" placeholder="e.g. 100000" step="any" min="0" />
          <p id="stk-raw-conversion" style="font-size:0.75rem;color:var(--accent-green);margin:0.3rem 0 0"></p>
          ${this.rewardTotalSupply !== null && this.rewardDecimals !== null ? `
            <button class="terminal-button secondary" id="stk-use-full-supply" style="margin-top:0.4rem;width:100%;font-size:0.75rem">
              USE FULL SUPPLY (${(Number(this.rewardTotalSupply) / Math.pow(10, this.rewardDecimals)).toLocaleString()})
            </button>` : ''}
        </div>

        <button class="terminal-button" id="stk-grant-allowance" style="width:100%;margin-top:1rem">
          SIGN ALLOWANCE IN WALLET
        </button>
      </div>`
  }

  // ─── SUCCESS ──────────────────────────────────────────────

  private static renderSuccess(): string {
    return `
      <div class="art-gen-section">
        <h3 class="section-title">◆ Staking Program Active</h3>
        <div style="padding:1rem;background:rgba(0,255,64,0.06);border:1px solid rgba(0,255,64,0.3);border-radius:8px;margin-bottom:1rem">
          <p style="color:var(--accent-green);margin:0 0 0.5rem">✓ Program created successfully!</p>
          <p style="font-size:0.8rem;opacity:0.8;margin:0 0 0.3rem">Program ID: <code>${this.createdProgramId}</code></p>
          <p style="font-size:0.8rem;opacity:0.8;margin:0 0 0.3rem">Frequency: ${FREQUENCY_LABELS[this.frequency]}</p>
          <p style="font-size:0.8rem;opacity:0.7;margin:0">
            Allowance is granted. Rewards will be distributed automatically on schedule.<br/>
            Community members register at: <code>POST /api/staking-programs/${this.createdProgramId}/register</code>
          </p>
        </div>
        <div style="padding:0.8rem;background:rgba(255,165,0,0.08);border:1px solid rgba(255,165,0,0.3);border-radius:6px;margin-bottom:1rem">
          <p style="font-size:0.77rem;color:#ffa500;margin:0">
            ⚠ <strong>Schedule drips:</strong> Call <code>POST /api/staking-programs/run-all-drips</code>
            with <code>Authorization: Bearer YOUR_DRIP_SECRET</code> from a Railway Cron job or external scheduler.
          </p>
        </div>
        <button class="terminal-button" id="stk-new" style="width:100%">CREATE ANOTHER PROGRAM</button>
      </div>`
  }

  // ─── PROGRAM LIST (right panel) ───────────────────────────

  private static renderProgramList(): string {
    const ws = WalletConnectService.getState()
    if (!ws.connected) {
      return `<div class="cc-right-content"><p style="opacity:0.5;font-size:0.85rem;text-align:center;margin-top:2rem">Connect wallet to see your staking programs</p></div>`
    }
    if (this.loadingPrograms) {
      return `<div class="cc-right-content"><div class="loading-state"><div class="spinner"></div><p>Loading programs...</p></div></div>`
    }
    if (this.programs.length === 0) {
      return `<div class="cc-right-content"><p style="opacity:0.5;font-size:0.85rem;text-align:center;margin-top:2rem">No staking programs yet — configure one on the left.</p></div>`
    }

    const cards = this.programs.map(p => {
      const nextDrip = p.last_distributed_at
        ? new Date(new Date(p.last_distributed_at).getTime() + FREQUENCY_DAYS[p.frequency] * 86400000).toLocaleDateString()
        : 'On first drip run'
      const statusColor = p.status === 'active' ? 'var(--accent-green)' : p.status === 'paused' ? '#ffa500' : '#ff6b6b'
      return `
        <div class="program-card" style="margin-bottom:1rem;padding:0.8rem;border:1px solid var(--border-color);border-radius:6px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.4rem">
            <strong style="font-size:0.9rem">${this.escapeHtml(p.name)}</strong>
            <span style="font-size:0.75rem;color:${statusColor};text-transform:uppercase">${p.status}</span>
          </div>
          <p style="font-size:0.77rem;opacity:0.65;margin:0 0 0.3rem">${p.stake_token_type} · Stake: ${p.stake_token_id}</p>
          <p style="font-size:0.77rem;opacity:0.65;margin:0 0 0.3rem">Reward: ${p.reward_token_id} · ${FREQUENCY_LABELS[p.frequency]}</p>
          <p style="font-size:0.77rem;opacity:0.65;margin:0 0 0.3rem">Rate: ${p.reward_rate_per_day}/day · Next drip: ${nextDrip}</p>
          ${!p.allowance_granted ? '<p style="font-size:0.75rem;color:#ff6b6b;margin:0 0 0.3rem">⚠ Allowance not yet granted</p>' : ''}
          <div style="display:flex;gap:0.4rem;margin-top:0.6rem;flex-wrap:wrap">
            <button class="terminal-button secondary" style="font-size:0.72rem;padding:0.3rem 0.6rem"
              data-action="toggle-status" data-id="${p.id}" data-status="${p.status === 'active' ? 'paused' : 'active'}">
              ${p.status === 'active' ? 'PAUSE' : 'RESUME'}
            </button>
            <button class="terminal-button secondary" style="font-size:0.72rem;padding:0.3rem 0.6rem;color:#ff6b6b;border-color:#ff6b6b"
              data-action="delete-program" data-id="${p.id}">DELETE</button>
          </div>
        </div>`
    }).join('')

    return `<div class="cc-right-content"><h3 class="section-title">◆ Your Staking Programs</h3>${cards}</div>`
  }

  private static renderConfirmModal(): string {
    return `
      <div class="modal-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:1000;display:flex;align-items:center;justify-content:center">
        <div style="background:var(--terminal-bg);border:1px solid #ff6b6b;border-radius:8px;padding:2rem;max-width:400px;width:90%">
          <h3 style="color:#ff6b6b;margin:0 0 1rem">⚠ Delete Program?</h3>
          <p style="opacity:0.8;margin:0 0 1.5rem;font-size:0.85rem">
            This will permanently delete the staking program and all participant records. Existing distributions are preserved for auditing.
          </p>
          <div style="display:flex;gap:0.75rem">
            <button class="terminal-button secondary" id="stk-confirm-cancel" style="flex:1">CANCEL</button>
            <button class="terminal-button" id="stk-confirm-delete" style="flex:1;background:#ff6b6b;border-color:#ff6b6b;color:#000">DELETE</button>
          </div>
        </div>
      </div>`
  }

  // ─── RESET & INIT ─────────────────────────────────────────

  static resetState(): void {
    this.step = 'form'
    this.stakeType = 'FT'
    this.programName = ''
    this.description = ''
    this.stakeTokenId = ''
    this.rewardTokenId = ''
    this.treasuryAccountId = ''
    this.rewardRatePerDay = ''
    this.minStakeAmount = '0'
    this.frequency = '7d'
    this.totalRewardSupply = ''
    this.rewardDecimals = null
    this.rewardTotalSupply = null
    this.rewardTokenName = ''
    this.rewardCustomFees = null
    this.programs = []
    this.loadingPrograms = false
    this.loading = false
    this.error = null
    this.statusMessage = ''
    this.createdProgramId = null
    this.showConfirmModal = false
    this._pendingDeleteId = null
  }

  private static refresh(): void {
    const leftPanel = document.querySelector('.art-gen-left')
    const scrollTop = leftPanel?.scrollTop ?? 0
    const app = document.querySelector<HTMLDivElement>('#app')!
    app.innerHTML = this.render()
    this.init()
    const newLeftPanel = document.querySelector('.art-gen-left')
    if (newLeftPanel) newLeftPanel.scrollTop = scrollTop
  }

  static init(): void {
    const ws = WalletConnectService.getState()

    // Navigation
    document.getElementById('stk-back')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('navigate-to-tool', { detail: { toolId: 'home' } }))
    })
    document.getElementById('stk-back-to-form')?.addEventListener('click', () => {
      this.step = 'form'; this.refresh()
    })

    // Stake type toggle
    document.getElementById('stk-type-ft')?.addEventListener('click', () => { this.stakeType = 'FT'; this.refresh() })
    document.getElementById('stk-type-nft')?.addEventListener('click', () => { this.stakeType = 'NFT'; this.refresh() })

    // Form input bindings
    const bind = (id: string, key: string) => {
      const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null
      el?.addEventListener('input', () => { (StakingTool as any)[key] = el.value })
      el?.addEventListener('change', () => { (StakingTool as any)[key] = el.value })
    }
    bind('stk-name',          'programName')
    bind('stk-description',   'description')
    bind('stk-stake-token',   'stakeTokenId')
    bind('stk-reward-token',  'rewardTokenId')
    bind('stk-treasury',      'treasuryAccountId')
    bind('stk-rate',          'rewardRatePerDay')
    bind('stk-min-stake',     'minStakeAmount')
    bind('stk-frequency',     'frequency')
    bind('stk-supply',        'totalRewardSupply')

    // Live rate-to-distribution preview on rate or frequency change
    const refreshRatePreview = () => {
      if (this.rewardRatePerDay && this.frequency) this.refresh()
    }
    document.getElementById('stk-rate')?.addEventListener('blur', refreshRatePreview)
    document.getElementById('stk-frequency')?.addEventListener('change', refreshRatePreview)

    // Fetch reward token info on blur
    document.getElementById('stk-reward-token')?.addEventListener('blur', () => {
      if (this.rewardTokenId.trim()) this.fetchRewardTokenInfo(this.rewardTokenId.trim())
    })

    // Use connected wallet as treasury
    document.getElementById('stk-use-wallet')?.addEventListener('click', () => {
      if (ws.connected && ws.accountId) {
        this.treasuryAccountId = ws.accountId
        const el = document.getElementById('stk-treasury') as HTMLInputElement
        if (el) el.value = ws.accountId
      }
    })

    // Allowance step
    document.getElementById('stk-allowance-amount')?.addEventListener('input', (e) => {
      const val = parseFloat((e.target as HTMLInputElement).value)
      const convEl = document.getElementById('stk-raw-conversion')
      if (!convEl) return
      if (!val || val <= 0 || this.rewardDecimals === null) { convEl.textContent = ''; return }
      const raw = Math.floor(val * Math.pow(10, this.rewardDecimals))
      convEl.textContent = `= ${raw.toLocaleString()} raw units (${this.rewardDecimals} decimals)`
    })
    document.getElementById('stk-use-full-supply')?.addEventListener('click', () => {
      if (this.rewardTotalSupply === null || this.rewardDecimals === null) return
      const human = Number(this.rewardTotalSupply) / Math.pow(10, this.rewardDecimals)
      const el = document.getElementById('stk-allowance-amount') as HTMLInputElement
      if (el) { el.value = human.toString(); el.dispatchEvent(new Event('input')) }
    })

    // Actions
    document.getElementById('stk-submit')?.addEventListener('click', () => this.handleSubmitForm())
    document.getElementById('stk-grant-allowance')?.addEventListener('click', () => this.handleGrantAllowance())
    document.getElementById('stk-new')?.addEventListener('click', () => { this.resetState(); this.refresh() })
    document.getElementById('stk-dismiss-error')?.addEventListener('click', () => { this.error = null; this.refresh() })

    // Confirm modal
    document.getElementById('stk-confirm-cancel')?.addEventListener('click', () => {
      this.showConfirmModal = false; this.refresh()
    })
    document.getElementById('stk-confirm-delete')?.addEventListener('click', () => this.executeDelete())

    // Program card delegation
    document.querySelector('.cc-right-content')?.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-action]') as HTMLElement
      if (!btn) return
      const action = btn.dataset.action, id = btn.dataset.id!
      if (action === 'toggle-status') {
        this.handleToggleStatus(id, btn.dataset.status as 'active' | 'paused')
      } else if (action === 'delete-program') {
        this._pendingDeleteId = id; this.showConfirmModal = true; this.refresh()
      }
    })

    if (ws.connected) this.loadPrograms()
  }

  // ─── BUSINESS LOGIC ───────────────────────────────────────

  private static handleSubmitForm(): void {
    const ws = WalletConnectService.getState()
    if (!ws.connected || !ws.accountId) { this.error = 'Connect your wallet first.'; this.refresh(); return }
    if (!this.programName.trim()) { this.error = 'Program name is required.'; this.refresh(); return }
    if (!this.stakeTokenId.trim()) { this.error = 'Stake Token ID is required.'; this.refresh(); return }
    if (!this.rewardTokenId.trim()) { this.error = 'Reward Token ID is required.'; this.refresh(); return }
    if (!this.treasuryAccountId.trim()) { this.error = 'Treasury Account ID is required.'; this.refresh(); return }
    if (!this.rewardRatePerDay || parseFloat(this.rewardRatePerDay) <= 0) {
      this.error = 'Daily reward rate must be greater than 0.'; this.refresh(); return
    }
    // Fetch token info before proceeding if not already loaded
    if (this.rewardDecimals === null) {
      this.fetchRewardTokenInfo(this.rewardTokenId.trim()).then(() => {
        this.step = 'allowance'; this.refresh()
      })
    } else {
      this.step = 'allowance'; this.refresh()
    }
  }

  private static async handleGrantAllowance(): Promise<void> {
    const ws = WalletConnectService.getState()
    if (!ws.connected || !ws.accountId) return

    const allowanceAmountEl = document.getElementById('stk-allowance-amount') as HTMLInputElement
    const humanAmount = parseFloat(allowanceAmountEl?.value || '0')
    if (!humanAmount || humanAmount <= 0) { this.error = 'Please enter a valid allowance amount.'; this.refresh(); return }

    this.loading = true; this.error = null
    try {
      const accountId   = ws.accountId
      const signer      = WalletConnectService.getSigner(accountId)
      const acctId      = AccountId.fromString(accountId)
      const client      = getHederaClient()
      const operatorId  = AccountId.fromString(BACKEND_MINTER_ACCOUNT)
      const decimals    = this.rewardDecimals ?? 0
      const rawAmount   = Math.floor(humanAmount * Math.pow(10, decimals))

      this.statusMessage = `Approving ${humanAmount.toLocaleString()} token allowance — approve in wallet...`
      this.refresh()

      const approveTx = new AccountAllowanceApproveTransaction()
        .approveTokenAllowance(TokenId.fromString(this.rewardTokenId), acctId, operatorId, rawAmount)
      approveTx.setTransactionId(TransactionId.generate(acctId))
      approveTx.freezeWith(client)
      await approveTx.executeWithSigner(signer)

      // Wait for propagation
      this.statusMessage = 'Allowance confirmed — saving staking program...'
      await new Promise(r => setTimeout(r, 3000))

      // Save program to DB
      const saveRes = await fetch(`${API_BASE_URL}/api/staking-programs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          createdBy:          ws.accountId,
          name:               this.programName.trim(),
          description:        this.description.trim() || null,
          stakeTokenId:       this.stakeTokenId.trim(),
          stakeTokenType:     this.stakeType,
          rewardTokenId:      this.rewardTokenId.trim(),
          treasuryAccountId:  this.treasuryAccountId.trim(),
          rewardRatePerDay:   parseFloat(this.rewardRatePerDay),
          minStakeAmount:     parseInt(this.minStakeAmount) || 0,
          frequency:          this.frequency,
          totalRewardSupply:  this.totalRewardSupply ? parseInt(this.totalRewardSupply) : null,
        }),
      })
      const saveData = await saveRes.json()
      if (!saveData.success) throw new Error(saveData.error || 'Failed to save staking program')

      const programId = saveData.program.id

      // Mark allowance as granted
      await fetch(`${API_BASE_URL}/api/staking-programs/${programId}/allowance`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ createdBy: ws.accountId }),
      })

      this.createdProgramId = programId
      this.loading = false; this.statusMessage = ''; this.step = 'success'
      this.refresh()
    } catch (err: any) {
      console.error('handleGrantAllowance error:', err)
      this.loading = false; this.statusMessage = ''
      this.error = err.message || 'Failed to set up staking program'
      this.refresh()
    }
  }

  private static async loadPrograms(): Promise<void> {
    const ws = WalletConnectService.getState()
    if (!ws.connected) return
    this.loadingPrograms = true
    try {
      const res = await fetch(`${API_BASE_URL}/api/staking-programs?createdBy=${ws.accountId}`)
      const data = await res.json()
      if (data.success) this.programs = data.programs
    } catch (err) {
      console.error('loadPrograms error:', err)
    } finally {
      this.loadingPrograms = false
      const right = document.querySelector('.art-gen-right')
      if (right) {
        right.innerHTML = this.renderRight()
        document.querySelector('.cc-right-content')?.addEventListener('click', (e) => {
          const btn = (e.target as HTMLElement).closest('[data-action]') as HTMLElement
          if (!btn) return
          const action = btn.dataset.action, id = btn.dataset.id!
          if (action === 'toggle-status') {
            this.handleToggleStatus(id, btn.dataset.status as 'active' | 'paused')
          } else if (action === 'delete-program') {
            this._pendingDeleteId = id; this.showConfirmModal = true; this.refresh()
          }
        })
      }
    }
  }

  private static async handleToggleStatus(id: string, newStatus: 'active' | 'paused'): Promise<void> {
    const ws = WalletConnectService.getState()
    try {
      const res = await fetch(`${API_BASE_URL}/api/staking-programs/${id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, createdBy: ws.accountId }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error)
      const prog = this.programs.find(p => p.id === id)
      if (prog) prog.status = newStatus
      this.refresh()
    } catch (err: any) {
      this.error = err.message || 'Failed to update status'; this.refresh()
    }
  }

  private static async executeDelete(): Promise<void> {
    const ws = WalletConnectService.getState()
    const id = this._pendingDeleteId
    this.showConfirmModal = false
    if (!id) return
    try {
      const res = await fetch(`${API_BASE_URL}/api/staking-programs/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ createdBy: ws.accountId }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error)
      this.programs = this.programs.filter(p => p.id !== id)
      this._pendingDeleteId = null; this.refresh()
    } catch (err: any) {
      this.error = err.message || 'Failed to delete program'; this.refresh()
    }
  }

  private static async fetchRewardTokenInfo(tokenId: string): Promise<void> {
    try {
      const res = await fetch(`${MIRROR_NODE_URL}/api/v1/tokens/${tokenId.trim()}`)
      if (!res.ok) throw new Error('not found')
      const data = await res.json()
      this.rewardDecimals = parseInt(data.decimals ?? '0')
      this.rewardTotalSupply = data.total_supply || null
      this.rewardTokenName   = data.name || tokenId
      this.rewardCustomFees  = data.custom_fees ?? null
    } catch {
      this.rewardDecimals = null; this.rewardTotalSupply = null
      this.rewardTokenName = ''; this.rewardCustomFees = null
    }
    this.refresh()
  }

  private static escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }
}

