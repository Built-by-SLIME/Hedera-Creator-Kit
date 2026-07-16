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
  AccountAllowanceAdjustTransaction,
  AccountId,
  TokenId,
  TransactionId,
} from '@hashgraph/sdk'

type StakingStep = 'form' | 'allowance' | 'success'
type StakeType   = 'NFT' | 'FT'
type Frequency   = '1d' | '7d' | '30d' | '90d' | '180d' | '365d'
type TierType    = 'range' | 'specific'

interface TierConfigItem {
  name?: string
  type: TierType
  range?: { start: number; end: number }
  serials?: number[]
  reward_rate_per_day: number
}

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
  tier_config?: TierConfigItem[] | null
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
  private static tieredRewardsEnabled = false
  private static tiers: TierConfigItem[] = []

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

  // ─── Inline edit state ────────────────────────────────────
  private static editingProgramId: string | null = null
  private static editName = ''
  private static editDescription = ''
  private static editRewardRatePerDay = ''
  private static editFrequency: Frequency = '7d'
  private static editMinStakeAmount = '0'
  private static editTieredRewardsEnabled = false
  private static editTiers: TierConfigItem[] = []

  // ─── Allowance state ──────────────────────────────────────
  private static allowances: Record<string, { remaining: number | null; granted: number | null; loading: boolean }> = {}
  private static toppingUpProgramId: string | null = null
  private static topUpAmount = ''
  private static topUpLoading = false



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
          <label>Treasury Account <span style="opacity:0.5;font-size:0.75rem">(holds reward token supply)</span></label>
          <div style="padding:0.5rem 0.75rem;background:rgba(0,255,64,0.06);border:1px solid rgba(0,255,64,0.2);border-radius:6px;font-size:0.85rem;font-family:inherit">
            ${ws.accountId || '—'}
          </div>
          <p style="font-size:0.75rem;color:var(--terminal-text);opacity:0.5;margin:0.3rem 0 0">
            Must be your connected wallet — allowance is signed by this account.
          </p>
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

        ${!isFT ? this.renderTierSection() : ''}

        <div class="filter-divider"></div>

        <button class="terminal-button" id="stk-submit" style="width:100%;margin-top:0.5rem"
          ${!ws.connected ? 'disabled title="Connect wallet first"' : ''}>
          NEXT: GRANT ALLOWANCE →
        </button>
        ${!ws.connected ? '<p style="font-size:0.75rem;color:#ff6b6b;margin:0.4rem 0 0;text-align:center">⚠ Connect your wallet to continue</p>' : ''}
      </div>`
  }

  // ─── TIER BUILDER ─────────────────────────────────────────

  private static renderTierSection(): string {
    return `
      <div class="input-group" style="margin-top:0.75rem">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.4rem">
          <label style="margin:0">Tiered Rewards by Serial</label>
          <button class="terminal-button ${this.tieredRewardsEnabled ? '' : 'secondary'}" id="stk-toggle-tiers" style="font-size:0.72rem;padding:0.25rem 0.5rem">
            ${this.tieredRewardsEnabled ? 'DISABLE TIERS' : 'ENABLE TIERS'}
          </button>
        </div>
        ${this.tieredRewardsEnabled ? `
          <p style="font-size:0.75rem;opacity:0.6;margin:0 0 0.5rem">
            Serials matching a tier earn that tier's rate. Serials not in any tier earn the default Daily Reward Rate.
          </p>
          <div id="stk-tier-list">
            ${this.renderTierBuilder(this.tiers, 'stk-tier')}
          </div>
          <button class="terminal-button secondary" id="stk-add-tier" style="width:100%;margin-top:0.5rem;font-size:0.75rem">+ ADD TIER</button>
        ` : `
          <p style="font-size:0.75rem;opacity:0.5;margin:0">Enable to set different reward rates for specific serials or serial ranges.</p>
        `}
      </div>`
  }

  private static renderTierSummary(tiers: TierConfigItem[]): string {
    const items = tiers.map(t => {
      const label = t.name || (t.type === 'range' ? `Range ${t.range!.start}-${t.range!.end}` : `${t.serials!.length} serial(s)`)
      return `<li style="margin:0.15rem 0">${this.escapeHtml(label)}: ${t.reward_rate_per_day}/day</li>`
    }).join('')
    return `<ul style="font-size:0.72rem;opacity:0.65;margin:0 0 0.3rem 1rem;padding:0">${items}</ul>`
  }

  private static renderTierBuilder(tiers: TierConfigItem[], prefix: string): string {
    if (tiers.length === 0) {
      return `<p style="font-size:0.78rem;opacity:0.6;margin:0 0 0.5rem">No tiers added yet. Click “Add Tier” to define serial-specific reward rates.</p>`
    }
    const rows = tiers.map((t, i) => this.renderTierRow(t, i, prefix)).join('')
    return `<div style="display:flex;flex-direction:column;gap:0.6rem">${rows}</div>`
  }

  private static renderTierRow(tier: TierConfigItem, index: number, prefix: string): string {
    const isRange = tier.type === 'range'
    const nameId = `${prefix}-name-${index}`
    const typeId = `${prefix}-type-${index}`
    const startId = `${prefix}-start-${index}`
    const endId = `${prefix}-end-${index}`
    const serialsId = `${prefix}-serials-${index}`
    const rateId = `${prefix}-rate-${index}`
    return `
      <div class="tier-row" data-tier-index="${index}" style="padding:0.6rem;background:rgba(255,255,255,0.04);border:1px solid var(--border-color);border-radius:6px">
        <div style="display:flex;gap:0.4rem;align-items:center;margin-bottom:0.4rem">
          <input type="text" id="${nameId}" class="token-input" data-field="name" value="${this.escapeHtml(tier.name || '')}" placeholder="Tier name (optional)" style="flex:1;font-size:0.8rem" />
          <button class="terminal-button secondary" data-tier-action="remove" style="font-size:0.65rem;padding:0.2rem 0.4rem">✕</button>
        </div>
        <div style="display:flex;gap:0.4rem;align-items:center;margin-bottom:0.4rem;flex-wrap:wrap">
          <select id="${typeId}" class="token-input" data-field="type" style="font-size:0.8rem;background:var(--terminal-bg);color:var(--terminal-text);border:1px solid var(--border-color)">
            <option value="range" ${isRange ? 'selected' : ''}>Range</option>
            <option value="specific" ${!isRange ? 'selected' : ''}>Specific Serials</option>
          </select>
          ${isRange ? `
            <input type="number" id="${startId}" class="token-input" data-field="start" placeholder="Start" min="0" value="${tier.range?.start ?? ''}" style="width:80px;font-size:0.8rem" />
            <span style="font-size:0.8rem">-</span>
            <input type="number" id="${endId}" class="token-input" data-field="end" placeholder="End" min="0" value="${tier.range?.end ?? ''}" style="width:80px;font-size:0.8rem" />
          ` : `
            <textarea id="${serialsId}" class="token-input" data-field="serials" placeholder="e.g. 1, 20, 420" style="flex:1;min-height:2.5rem;font-size:0.8rem">${this.escapeHtml(this.formatSerialsInput(tier.serials))}</textarea>
          `}
        </div>
        <div style="display:flex;gap:0.4rem;align-items:center">
          <input type="number" id="${rateId}" class="token-input" data-field="rate" placeholder="Daily rate" step="any" min="0" value="${tier.reward_rate_per_day}" style="flex:1;font-size:0.8rem" />
          <span style="font-size:0.75rem;opacity:0.7">/ day</span>
          <button class="terminal-button secondary" data-tier-action="up" style="font-size:0.65rem;padding:0.2rem 0.4rem">↑</button>
          <button class="terminal-button secondary" data-tier-action="down" style="font-size:0.65rem;padding:0.2rem 0.4rem">↓</button>
        </div>
      </div>`
  }

  private static parseSerialsInput(value: string): number[] {
    return value.split(/[,\n]+/)
      .map(s => s.replace(/#/g, '').trim())
      .filter(s => s.length > 0)
      .map(s => parseInt(s, 10))
      .filter(n => !isNaN(n) && n >= 0)
  }

  private static formatSerialsInput(serials?: number[]): string {
    return (serials || []).join(', ')
  }

  private static handleTierFieldChange(index: number, field: string, value: string, isEdit: boolean): void {
    const tiers = isEdit ? this.editTiers : this.tiers
    const tier = tiers[index]
    if (!tier) return

    if (field === 'name') {
      tier.name = value.trim() || undefined
    } else if (field === 'type') {
      tier.type = value as TierType
      if (tier.type === 'range') {
        tier.range = { start: 1, end: 100 }
        tier.serials = undefined
      } else {
        tier.serials = []
        tier.range = undefined
      }
      this.refresh()
    } else if (field === 'start') {
      if (!tier.range) tier.range = { start: 0, end: 0 }
      tier.range.start = parseInt(value, 10) || 0
    } else if (field === 'end') {
      if (!tier.range) tier.range = { start: 0, end: 0 }
      tier.range.end = parseInt(value, 10) || 0
    } else if (field === 'serials') {
      tier.serials = this.parseSerialsInput(value)
    } else if (field === 'rate') {
      tier.reward_rate_per_day = parseFloat(value) || 0
    }
  }

  private static validateTiers(tiers: TierConfigItem[]): { valid: boolean; error?: string } {
    if (tiers.length === 0) {
      return { valid: false, error: 'At least one tier is required when tiered rewards are enabled.' }
    }
    for (let i = 0; i < tiers.length; i++) {
      const t = tiers[i]
      if (t.type === 'range') {
        if (!t.range || !Number.isInteger(t.range.start) || !Number.isInteger(t.range.end) || t.range.start < 0 || t.range.end < t.range.start) {
          return { valid: false, error: `Tier ${i + 1} has an invalid serial range.` }
        }
      } else {
        if (!t.serials || t.serials.length === 0) {
          return { valid: false, error: `Tier ${i + 1} has no specific serials.` }
        }
      }
      if (isNaN(t.reward_rate_per_day) || t.reward_rate_per_day < 0) {
        return { valid: false, error: `Tier ${i + 1} rate must be 0 or greater.` }
      }
    }
    return { valid: true }
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
          ${this.tieredRewardsEnabled && this.stakeType === 'NFT' ? `
            <p style="font-size:0.8rem;margin:0 0 0.3rem"><strong>Default Rate:</strong> ${this.rewardRatePerDay || 0} tokens / NFT / day</p>
            <p style="font-size:0.8rem;margin:0 0 0.3rem"><strong>Tiers:</strong> ${this.tiers.length} configured</p>
          ` : `
            <p style="font-size:0.8rem;margin:0 0 0.3rem"><strong>Rate:</strong> ${this.rewardRatePerDay} tokens / ${this.stakeType === 'NFT' ? 'NFT' : 'unit'} / day → ~${perDistrib} per distribution</p>
          `}
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
      if (this.editingProgramId === p.id) {
        return this.renderProgramEditCard(p)
      }

      const nextDrip = p.last_distributed_at
        ? new Date(new Date(p.last_distributed_at).getTime() + FREQUENCY_DAYS[p.frequency] * 86400000).toLocaleDateString()
        : 'On first drip run'
      const statusColor = p.status === 'active' ? 'var(--accent-green)' : p.status === 'paused' ? '#ffa500' : '#ff6b6b'
      const allowance = this.allowances[p.id]
      const allowanceText = allowance?.loading
        ? 'Loading allowance...'
        : allowance?.remaining != null
          ? `Allowance: ${allowance.remaining.toLocaleString(undefined, { maximumFractionDigits: 6 })} remaining`
          : 'Allowance: unknown'
      const isToppingUp = this.toppingUpProgramId === p.id
      return `
        <div class="program-card" style="margin-bottom:1rem;padding:0.8rem;border:1px solid var(--border-color);border-radius:6px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.4rem">
            <strong style="font-size:0.9rem">${this.escapeHtml(p.name)}</strong>
            <span style="font-size:0.75rem;color:${statusColor};text-transform:uppercase">${p.status}</span>
          </div>
          <p style="font-size:0.77rem;opacity:0.65;margin:0 0 0.3rem">${p.stake_token_type} · Stake: ${p.stake_token_id}</p>
          <p style="font-size:0.77rem;opacity:0.65;margin:0 0 0.3rem">Reward: ${p.reward_token_id} · ${FREQUENCY_LABELS[p.frequency]}</p>
          ${p.tier_config && p.tier_config.length > 0 && p.stake_token_type === 'NFT'
            ? `<p style="font-size:0.77rem;opacity:0.65;margin:0 0 0.3rem">Default: ${p.reward_rate_per_day}/day · ${p.tier_config.length} tier(s) · Next drip: ${nextDrip}</p>${this.renderTierSummary(p.tier_config)}`
            : `<p style="font-size:0.77rem;opacity:0.65;margin:0 0 0.3rem">Rate: ${p.reward_rate_per_day}/day · Next drip: ${nextDrip}</p>`}
          <p style="font-size:0.77rem;opacity:0.65;margin:0 0 0.3rem">${allowanceText}</p>
          ${!p.allowance_granted ? '<p style="font-size:0.75rem;color:#ff6b6b;margin:0 0 0.3rem">⚠ Allowance not yet granted</p>' : ''}
          <div style="display:flex;align-items:center;gap:0.4rem;margin:0.4rem 0 0.2rem;background:rgba(0,0,0,0.2);border-radius:4px;padding:0.3rem 0.5rem">
            <span style="font-size:0.7rem;opacity:0.5;white-space:nowrap">Program ID:</span>
            <code style="font-size:0.7rem;color:var(--accent-green);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.id}</code>
            <button class="terminal-button secondary" data-action="copy-id" data-id="${p.id}" style="font-size:0.65rem;padding:0.15rem 0.4rem;white-space:nowrap">Copy</button>
          </div>
          ${isToppingUp ? `
            <div style="margin-top:0.5rem;padding:0.5rem;background:rgba(0,255,64,0.06);border:1px solid rgba(0,255,64,0.2);border-radius:6px">
              <div class="input-group" style="margin-bottom:0.4rem">
                <label style="font-size:0.75rem">Add Allowance (whole reward tokens)</label>
                <input type="number" id="stk-top-up-amount" class="token-input" step="any" min="0" placeholder="e.g. 10000" value="${this.escapeHtml(this.topUpAmount)}" style="font-size:0.85rem" />
              </div>
              <div style="display:flex;gap:0.4rem;flex-wrap:wrap">
                <button class="terminal-button" style="font-size:0.72rem;padding:0.3rem 0.6rem" data-action="submit-top-up" data-id="${p.id}" ${this.topUpLoading ? 'disabled' : ''}>
                  ${this.topUpLoading ? 'SIGNING...' : 'SIGN ALLOWANCE'}
                </button>
                <button class="terminal-button secondary" style="font-size:0.72rem;padding:0.3rem 0.6rem" data-action="cancel-top-up" ${this.topUpLoading ? 'disabled' : ''}>CANCEL</button>
              </div>
            </div>
          ` : `
            <div style="display:flex;gap:0.4rem;margin-top:0.4rem;flex-wrap:wrap">
              <button class="terminal-button secondary" style="font-size:0.72rem;padding:0.3rem 0.6rem"
                data-action="toggle-status" data-id="${p.id}" data-status="${p.status === 'active' ? 'paused' : 'active'}">
                ${p.status === 'active' ? 'PAUSE' : 'RESUME'}
              </button>
              <button class="terminal-button secondary" style="font-size:0.72rem;padding:0.3rem 0.6rem"
                data-action="edit-program" data-id="${p.id}">EDIT</button>
              <button class="terminal-button secondary" style="font-size:0.72rem;padding:0.3rem 0.6rem"
                data-action="top-up" data-id="${p.id}">TOP UP</button>
              <button class="terminal-button secondary" style="font-size:0.72rem;padding:0.3rem 0.6rem;color:#ff6b6b;border-color:#ff6b6b"
                data-action="delete-program" data-id="${p.id}">DELETE</button>
            </div>
          `}
        </div>`
    }).join('')

    return `<div class="cc-right-content"><h3 class="section-title">◆ Your Staking Programs</h3>${cards}</div>`
  }

  private static renderProgramEditCard(p: StakingProgram): string {
    const freqOptions = (Object.keys(FREQUENCY_LABELS) as Frequency[]).map(f =>
      `<option value="${f}" ${this.editFrequency === f ? 'selected' : ''}>${FREQUENCY_LABELS[f]}</option>`
    ).join('')

    return `
      <div class="program-card" style="margin-bottom:1rem;padding:0.8rem;border:1px solid var(--accent-green);border-radius:6px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.6rem">
          <strong style="font-size:0.9rem;color:var(--accent-green)">Edit Program</strong>
        </div>

        <div class="input-group" style="margin-bottom:0.5rem">
          <label style="font-size:0.75rem">Name</label>
          <input type="text" id="stk-edit-name" class="token-input" value="${this.escapeHtml(this.editName)}" style="font-size:0.85rem" />
        </div>

        <div class="input-group" style="margin-bottom:0.5rem">
          <label style="font-size:0.75rem">Description</label>
          <input type="text" id="stk-edit-description" class="token-input" value="${this.escapeHtml(this.editDescription)}" style="font-size:0.85rem" />
        </div>

        <div class="input-group" style="margin-bottom:0.5rem">
          <label style="font-size:0.75rem">${this.editTieredRewardsEnabled ? 'Default Daily Reward Rate' : 'Daily Reward Rate'}</label>
          <input type="number" id="stk-edit-rate" class="token-input" step="any" min="0" value="${this.escapeHtml(this.editRewardRatePerDay)}" style="font-size:0.85rem" />
        </div>

        <div class="input-group" style="margin-bottom:0.5rem">
          <label style="font-size:0.75rem">Distribution Frequency</label>
          <select id="stk-edit-frequency" class="token-input" style="background:var(--terminal-bg);color:var(--terminal-text);border:1px solid var(--border-color);padding:0.4rem;font-size:0.85rem">
            ${freqOptions}
          </select>
        </div>

        <div class="input-group" style="margin-bottom:0.6rem">
          <label style="font-size:0.75rem">Minimum Holdings</label>
          <input type="number" id="stk-edit-min-stake" class="token-input" min="0" value="${this.escapeHtml(this.editMinStakeAmount)}" style="font-size:0.85rem" />
        </div>

        ${this.editTieredRewardsEnabled ? `
          <div class="input-group" style="margin-bottom:0.6rem">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.4rem">
              <label style="margin:0;font-size:0.75rem">Tiers</label>
              <button class="terminal-button secondary" id="stk-edit-add-tier" style="font-size:0.65rem;padding:0.2rem 0.4rem">+ ADD TIER</button>
            </div>
            <div id="stk-edit-tier-list">
              ${this.renderTierBuilder(this.editTiers, 'stk-edit-tier')}
            </div>
          </div>
        ` : ''}

        <div style="padding:0.5rem;background:rgba(0,0,0,0.2);border-radius:4px;margin-bottom:0.6rem">
          <p style="font-size:0.7rem;opacity:0.6;margin:0">Locked: Stake ${p.stake_token_id} (${p.stake_token_type}) · Reward ${p.reward_token_id} · Treasury ${p.treasury_account_id}</p>
        </div>

        <div style="display:flex;gap:0.4rem;flex-wrap:wrap">
          <button class="terminal-button" style="font-size:0.72rem;padding:0.3rem 0.6rem" data-action="save-edit" data-id="${p.id}">SAVE</button>
          <button class="terminal-button secondary" style="font-size:0.72rem;padding:0.3rem 0.6rem" data-action="cancel-edit">CANCEL</button>
        </div>
      </div>`
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
    this.tieredRewardsEnabled = false
    this.tiers = []
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
    this.editingProgramId = null
    this.editName = ''
    this.editDescription = ''
    this.editRewardRatePerDay = ''
    this.editFrequency = '7d'
    this.editMinStakeAmount = '0'
    this.editTieredRewardsEnabled = false
    this.editTiers = []
    this.allowances = {}
    this.toppingUpProgramId = null
    this.topUpAmount = ''
    this.topUpLoading = false
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
    document.getElementById('stk-type-ft')?.addEventListener('click', () => {
      this.stakeType = 'FT'
      this.tieredRewardsEnabled = false
      this.refresh()
    })
    document.getElementById('stk-type-nft')?.addEventListener('click', () => { this.stakeType = 'NFT'; this.refresh() })

    // Tiered rewards toggle
    document.getElementById('stk-toggle-tiers')?.addEventListener('click', () => {
      this.tieredRewardsEnabled = !this.tieredRewardsEnabled
      if (this.tieredRewardsEnabled && this.tiers.length === 0) {
        this.tiers.push({ type: 'range', range: { start: 1, end: 100 }, reward_rate_per_day: 0 })
      }
      this.refresh()
    })
    document.getElementById('stk-add-tier')?.addEventListener('click', () => {
      this.tiers.push({ type: 'range', range: { start: 1, end: 100 }, reward_rate_per_day: 0 })
      this.refresh()
    })
    const tierList = document.getElementById('stk-tier-list')
    tierList?.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-tier-action]') as HTMLElement
      if (!btn) return
      const row = btn.closest('[data-tier-index]') as HTMLElement
      const idx = parseInt(row?.dataset.tierIndex || '0')
      const action = btn.dataset.tierAction
      if (action === 'remove') this.tiers.splice(idx, 1)
      if (action === 'up' && idx > 0) [this.tiers[idx - 1], this.tiers[idx]] = [this.tiers[idx], this.tiers[idx - 1]]
      if (action === 'down' && idx < this.tiers.length - 1) [this.tiers[idx], this.tiers[idx + 1]] = [this.tiers[idx + 1], this.tiers[idx]]
      this.refresh()
    })
    tierList?.addEventListener('input', (e) => {
      const el = e.target as HTMLInputElement | HTMLTextAreaElement
      const row = el.closest('[data-tier-index]') as HTMLElement
      if (!row) return
      const idx = parseInt(row.dataset.tierIndex || '0')
      const field = el.dataset.field
      if (field) this.handleTierFieldChange(idx, field, el.value, false)
    })
    tierList?.addEventListener('change', (e) => {
      const el = e.target as HTMLSelectElement
      const row = el.closest('[data-tier-index]') as HTMLElement
      if (!row) return
      const idx = parseInt(row.dataset.tierIndex || '0')
      const field = el.dataset.field
      if (field) this.handleTierFieldChange(idx, field, el.value, false)
    })

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

    // Program card delegation (single listener on the stable right panel)
    this.attachProgramCardListeners()

    // Inline edit input bindings (only present when editing)
    const editName = document.getElementById('stk-edit-name') as HTMLInputElement | null
    editName?.addEventListener('input', () => { this.editName = editName.value })
    const editDesc = document.getElementById('stk-edit-description') as HTMLInputElement | null
    editDesc?.addEventListener('input', () => { this.editDescription = editDesc.value })
    const editRate = document.getElementById('stk-edit-rate') as HTMLInputElement | null
    editRate?.addEventListener('input', () => { this.editRewardRatePerDay = editRate.value })
    const editFreq = document.getElementById('stk-edit-frequency') as HTMLSelectElement | null
    editFreq?.addEventListener('change', () => { this.editFrequency = editFreq.value as Frequency })
    const editMin = document.getElementById('stk-edit-min-stake') as HTMLInputElement | null
    editMin?.addEventListener('input', () => { this.editMinStakeAmount = editMin.value })

    // Edit-mode tier builder
    document.getElementById('stk-edit-add-tier')?.addEventListener('click', () => {
      this.editTiers.push({ type: 'range', range: { start: 1, end: 100 }, reward_rate_per_day: 0 })
      this.refresh()
    })
    const editTierList = document.getElementById('stk-edit-tier-list')
    editTierList?.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-tier-action]') as HTMLElement
      if (!btn) return
      const row = btn.closest('[data-tier-index]') as HTMLElement
      const idx = parseInt(row?.dataset.tierIndex || '0')
      const action = btn.dataset.tierAction
      if (action === 'remove') this.editTiers.splice(idx, 1)
      if (action === 'up' && idx > 0) [this.editTiers[idx - 1], this.editTiers[idx]] = [this.editTiers[idx], this.editTiers[idx - 1]]
      if (action === 'down' && idx < this.editTiers.length - 1) [this.editTiers[idx], this.editTiers[idx + 1]] = [this.editTiers[idx + 1], this.editTiers[idx]]
      this.refresh()
    })
    editTierList?.addEventListener('input', (e) => {
      const el = e.target as HTMLInputElement | HTMLTextAreaElement
      const row = el.closest('[data-tier-index]') as HTMLElement
      if (!row) return
      const idx = parseInt(row.dataset.tierIndex || '0')
      const field = el.dataset.field
      if (field) this.handleTierFieldChange(idx, field, el.value, true)
    })
    editTierList?.addEventListener('change', (e) => {
      const el = e.target as HTMLSelectElement
      const row = el.closest('[data-tier-index]') as HTMLElement
      if (!row) return
      const idx = parseInt(row.dataset.tierIndex || '0')
      const field = el.dataset.field
      if (field) this.handleTierFieldChange(idx, field, el.value, true)
    })

    // Top-up input binding
    const topUpInput = document.getElementById('stk-top-up-amount') as HTMLInputElement | null
    topUpInput?.addEventListener('input', () => { this.topUpAmount = topUpInput.value })



    if (ws.connected) this.loadPrograms()
  }

  // ─── BUSINESS LOGIC ───────────────────────────────────────

  private static handleSubmitForm(): void {
    const ws = WalletConnectService.getState()
    if (!ws.connected || !ws.accountId) { this.error = 'Connect your wallet first.'; this.refresh(); return }
    if (!this.programName.trim()) { this.error = 'Program name is required.'; this.refresh(); return }
    if (!this.stakeTokenId.trim()) { this.error = 'Stake Token ID is required.'; this.refresh(); return }
    if (!this.rewardTokenId.trim()) { this.error = 'Reward Token ID is required.'; this.refresh(); return }
    // Always use the connected wallet as treasury
    this.treasuryAccountId = ws.accountId!

    if (this.tieredRewardsEnabled) {
      if (this.stakeType !== 'NFT') {
        this.error = 'Tiered rewards are only available for NFT programs.'; this.refresh(); return
      }
      const tierValidation = this.validateTiers(this.tiers)
      if (!tierValidation.valid) { this.error = tierValidation.error || 'Invalid tiers'; this.refresh(); return }
      if (parseFloat(this.rewardRatePerDay) < 0) {
        this.error = 'Default daily reward rate cannot be negative.'; this.refresh(); return
      }
    } else {
      if (!this.rewardRatePerDay || parseFloat(this.rewardRatePerDay) <= 0) {
        this.error = 'Daily reward rate must be greater than 0.'; this.refresh(); return
      }
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
          tierConfig:         this.tieredRewardsEnabled && this.stakeType === 'NFT' ? this.tiers : null,
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

  private static attachProgramCardListeners(): void {
    document.querySelector('.art-gen-right')?.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-action]') as HTMLElement
      if (!btn) return
      const action = btn.dataset.action, id = btn.dataset.id!
      if (action === 'toggle-status') {
        this.handleToggleStatus(id, btn.dataset.status as 'active' | 'paused')
      } else if (action === 'edit-program') {
        this.startEdit(id)
      } else if (action === 'save-edit') {
        this.saveEdit(id)
      } else if (action === 'cancel-edit') {
        this.editingProgramId = null; this.refresh()
      } else if (action === 'top-up') {
        this.startTopUp(id)
      } else if (action === 'cancel-top-up') {
        this.cancelTopUp()
      } else if (action === 'submit-top-up') {
        this.submitTopUp(id)
      } else if (action === 'delete-program') {
        this._pendingDeleteId = id; this.showConfirmModal = true; this.refresh()
      }
    })
  }

  private static renderProgramPanel(): void {
    const right = document.querySelector('.art-gen-right')
    if (!right) return
    // Don't clobber the edit form while the user is actively editing.
    // Allowance/state updates continue in the background and will render
    // once the user exits edit mode.
    if (this.editingProgramId) return
    right.innerHTML = this.renderRight()
  }

  private static async loadPrograms(): Promise<void> {
    const ws = WalletConnectService.getState()
    if (!ws.connected) return
    this.loadingPrograms = true
    try {
      const res = await fetch(`${API_BASE_URL}/api/staking-programs?createdBy=${ws.accountId}`)
      const data = await res.json()
      if (data.success) {
        this.programs = data.programs
        this.programs.forEach(p => {
          this.allowances[p.id] = { remaining: null, granted: null, loading: true }
        })
      }
    } catch (err) {
      console.error('loadPrograms error:', err)
    } finally {
      this.loadingPrograms = false
      this.renderProgramPanel()
      // Fetch allowances in the background without blocking the program list.
      this.fetchAllAllowances().catch(err => console.error('fetchAllAllowances error:', err))
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

  private static startEdit(id: string): void {
    const p = this.programs.find(prog => prog.id === id)
    if (!p) return
    this.editingProgramId = id
    this.editName = p.name
    this.editDescription = p.description || ''
    this.editRewardRatePerDay = String(p.reward_rate_per_day)
    this.editFrequency = p.frequency
    this.editMinStakeAmount = String(p.min_stake_amount)
    const hasTiers = p.stake_token_type === 'NFT' && Array.isArray(p.tier_config) && p.tier_config.length > 0
    this.editTieredRewardsEnabled = hasTiers
    this.editTiers = hasTiers ? JSON.parse(JSON.stringify(p.tier_config)) : []
    this.refresh()
  }

  private static async saveEdit(id: string): Promise<void> {
    const ws = WalletConnectService.getState()
    if (!ws.connected || !ws.accountId) { this.error = 'Connect your wallet first.'; this.refresh(); return }

    // Read the live DOM values as the source of truth. This protects the save
    // from any background re-renders that may have detached the input listeners.
    const nameInput = document.getElementById('stk-edit-name') as HTMLInputElement | null
    const descInput = document.getElementById('stk-edit-description') as HTMLInputElement | null
    const rateInput = document.getElementById('stk-edit-rate') as HTMLInputElement | null
    const freqInput = document.getElementById('stk-edit-frequency') as HTMLSelectElement | null
    const minInput = document.getElementById('stk-edit-min-stake') as HTMLInputElement | null

    const name = (nameInput?.value ?? this.editName).trim()
    const description = (descInput?.value ?? this.editDescription).trim() || null
    const rate = parseFloat(rateInput?.value ?? this.editRewardRatePerDay)
    const minStake = parseInt(minInput?.value ?? this.editMinStakeAmount) || 0
    const frequency = (freqInput?.value as Frequency) ?? this.editFrequency

    if (!name) { this.error = 'Program name is required.'; this.refresh(); return }
    if (isNaN(rate) || rate < 0) { this.error = 'Daily reward rate must be 0 or greater.'; this.refresh(); return }
    if (minStake < 0) { this.error = 'Minimum holdings cannot be negative.'; this.refresh(); return }

    if (this.editTieredRewardsEnabled) {
      const tierValidation = this.validateTiers(this.editTiers)
      if (!tierValidation.valid) { this.error = tierValidation.error || 'Invalid tiers'; this.refresh(); return }
    }

    try {
      const res = await fetch(`${API_BASE_URL}/api/staking-programs/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          createdBy: ws.accountId,
          name,
          description,
          rewardRatePerDay: rate,
          minStakeAmount: minStake,
          frequency,
          tierConfig: this.editTieredRewardsEnabled ? this.editTiers : undefined,
        }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error || 'Failed to update program')

      const idx = this.programs.findIndex(p => p.id === id)
      if (idx >= 0) this.programs[idx] = data.program
      this.editingProgramId = null
      this.refresh()
      // Refresh allowance immediately so the UI reflects current state right away.
      await this.fetchAllowance(id).catch(err => console.error('fetchAllowance after save error:', err))
    } catch (err: any) {
      this.error = err.message || 'Failed to update program'; this.refresh()
    }
  }

  private static async getTokenDecimals(tokenId: string): Promise<number> {
    try {
      const res = await fetch(`${MIRROR_NODE_URL}/api/v1/tokens/${tokenId.trim()}`)
      if (!res.ok) return 0
      const data = await res.json() as { decimals?: string }
      return parseInt(data.decimals ?? '0')
    } catch {
      return 0
    }
  }

  private static async fetchAllAllowances(): Promise<void> {
    await Promise.all(this.programs.map(p => this.fetchAllowance(p.id)))
  }

  private static async fetchAllowance(id: string): Promise<void> {
    const ws = WalletConnectService.getState()
    if (!ws.connected || !ws.accountId) return
    this.allowances[id] = { ...this.allowances[id], loading: true }
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10000)
      const res = await fetch(`${API_BASE_URL}/api/staking-programs/${id}/allowance?createdBy=${ws.accountId}`, { signal: controller.signal })
      clearTimeout(timeout)
      const data = await res.json()
      if (data.success) {
        this.allowances[id] = {
          remaining: data.allowance_remaining,
          granted: data.allowance_granted,
          loading: false,
        }
      } else {
        this.allowances[id] = { remaining: null, granted: null, loading: false }
      }
    } catch {
      this.allowances[id] = { remaining: null, granted: null, loading: false }
    }
    this.renderProgramPanel()
  }

  private static startTopUp(id: string): void {
    this.toppingUpProgramId = id
    this.topUpAmount = ''
    this.topUpLoading = false
    this.refresh()
  }

  private static cancelTopUp(): void {
    this.toppingUpProgramId = null
    this.topUpAmount = ''
    this.topUpLoading = false
    this.refresh()
  }

  private static async submitTopUp(id: string): Promise<void> {
    const ws = WalletConnectService.getState()
    if (!ws.connected || !ws.accountId) { this.error = 'Connect your wallet first.'; this.refresh(); return }

    const amount = parseFloat(this.topUpAmount)
    if (isNaN(amount) || amount <= 0) { this.error = 'Please enter a valid amount to add.'; this.refresh(); return }

    const p = this.programs.find(prog => prog.id === id)
    if (!p) return

    this.topUpLoading = true
    this.error = null
    this.refresh()

    try {
      const signer = WalletConnectService.getSigner(ws.accountId)
      const acctId = AccountId.fromString(ws.accountId)
      const operatorId = AccountId.fromString(BACKEND_MINTER_ACCOUNT)
      const decimals = await this.getTokenDecimals(p.reward_token_id)
      const rawAmount = Math.floor(amount * Math.pow(10, decimals))

      const adjustTx = new AccountAllowanceAdjustTransaction()
        .grantTokenAllowance(TokenId.fromString(p.reward_token_id), acctId, operatorId, rawAmount)
        .setTransactionId(TransactionId.generate(acctId))
      adjustTx.freezeWith(getHederaClient())
      await adjustTx.executeWithSigner(signer)

      this.topUpAmount = ''
      this.toppingUpProgramId = null
      this.topUpLoading = false
      this.statusMessage = 'Allowance topped up'
      await this.fetchAllowance(id)
      this.renderProgramPanel()
      this.statusMessage = ''
    } catch (err: any) {
      this.topUpLoading = false
      this.error = err.message || 'Failed to top up allowance'
      this.refresh()
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

