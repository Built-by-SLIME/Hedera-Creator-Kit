import { Request, Response } from 'express';
import { pool } from '../db';
import { assertProgramOwnership } from '../middleware/auth';
import {
  registerParticipant,
  fetchNftSerials,
  fetchFtBalance,
  fetchTokenDecimals,
  frequencyDays,
  calcReward,
  calcTieredReward,
  type TierConfigItem,
} from './staking';

// ─── External staking API for third-party integrations ──────────────────────

/**
 * GET /api/v1/external/staking-programs
 * Lists all active staking programs belonging to the API key holder.
 */
export async function externalListPrograms(req: Request, res: Response): Promise<void> {
  try {
    if (!req.apiKey) {
      res.status(401).json({ success: false, error: 'API key required' });
      return;
    }
    const result = await pool.query(
      `SELECT id, name, description, stake_token_id, stake_token_type, reward_token_id,
              treasury_account_id, reward_rate_per_day, min_stake_amount, frequency,
              total_reward_supply, last_distributed_at, status, created_at, tier_config
       FROM staking_programs WHERE created_by = $1 AND status = 'active' ORDER BY created_at DESC`,
      [req.apiKey.account_id]
    );
    res.json({ success: true, programs: result.rows });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * GET /api/v1/external/staking-programs/:id
 * Single program details + live stats. Scoped to API key holder's programs.
 */
export async function externalGetProgram(req: Request, res: Response): Promise<void> {
  if (!(await assertProgramOwnership(req, res))) return;
  try {
    const { id } = req.params;
    const progResult = await pool.query(
      `SELECT id, name, description, stake_token_id, stake_token_type, reward_token_id,
              treasury_account_id, reward_rate_per_day, min_stake_amount, frequency,
              total_reward_supply, last_distributed_at, status, created_at, tier_config
       FROM staking_programs WHERE id = $1`,
      [id]
    );
    const [participantCount, totalDistributed] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM staking_participants WHERE program_id = $1', [id]),
      pool.query(
        'SELECT COALESCE(SUM(amount), 0) as total FROM staking_distributions WHERE program_id = $1',
        [id]
      ),
    ]);
    res.json({
      success: true,
      program: progResult.rows[0],
      stats: {
        participantCount: parseInt(participantCount.rows[0].count),
        totalDistributed: parseFloat(totalDistributed.rows[0].total),
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * GET /api/v1/external/staking-programs/:id/position/:accountId
 * Wallet staking position. Scoped to API key holder's programs.
 */
export async function externalGetPosition(req: Request, res: Response): Promise<void> {
  if (!(await assertProgramOwnership(req, res))) return;
  try {
    const { id, accountId } = req.params;
    const progResult = await pool.query(
      `SELECT stake_token_id, stake_token_type, reward_token_id, reward_rate_per_day,
              frequency, min_stake_amount, last_distributed_at, status, tier_config
       FROM staking_programs WHERE id = $1`,
      [id]
    );
    const prog = progResult.rows[0];

    const regResult = await pool.query(
      'SELECT registered_at, last_distributed_at FROM staking_participants WHERE program_id = $1 AND account_id = $2',
      [id, accountId]
    );
    const isRegistered = regResult.rowCount !== null && regResult.rowCount > 0;

    const distResult = await pool.query(
      'SELECT COALESCE(SUM(amount), 0) as total FROM staking_distributions WHERE program_id = $1 AND account_id = $2',
      [id, accountId]
    );
    const totalEarned = parseFloat(distResult.rows[0].total);

    let unitsHeld = 0;
    let serialsHeld: number[] | undefined;
    if (prog.stake_token_type === 'NFT') {
      serialsHeld = await fetchNftSerials(accountId, prog.stake_token_id);
      unitsHeld = serialsHeld.length;
    } else {
      const stakeDecimals = await fetchTokenDecimals(prog.stake_token_id);
      const rawBalance = await fetchFtBalance(accountId, prog.stake_token_id);
      unitsHeld = Number(rawBalance) / Math.pow(10, stakeDecimals);
    }

    const lastDist = regResult.rows[0]?.last_distributed_at || prog.last_distributed_at;
    const days = frequencyDays(prog.frequency);
    const nextDrip = lastDist
      ? new Date(new Date(lastDist).getTime() + days * 86400000)
      : new Date();

    const rewardDecimals = await fetchTokenDecimals(prog.reward_token_id);
    let estRewardRaw = 0;
    if (unitsHeld > 0 && unitsHeld >= Number(prog.min_stake_amount)) {
      if (prog.stake_token_type === 'NFT' && Array.isArray(prog.tier_config) && prog.tier_config.length > 0) {
        const allSerials = serialsHeld || await fetchNftSerials(accountId, prog.stake_token_id);
        estRewardRaw = Math.floor(
          calcTieredReward(allSerials, prog.tier_config as TierConfigItem[], Number(prog.reward_rate_per_day), days).wholeReward *
            Math.pow(10, rewardDecimals)
        );
      } else {
        estRewardRaw = calcReward(unitsHeld, Number(prog.reward_rate_per_day), days, rewardDecimals);
      }
    }
    const estReward = estRewardRaw / Math.pow(10, rewardDecimals);

    res.json({
      success: true,
      accountId,
      programId: id,
      isRegistered,
      registeredAt: regResult.rows[0]?.registered_at || null,
      holdings: {
        unitsHeld,
        serialsHeld: prog.stake_token_type === 'NFT' ? serialsHeld : undefined,
        meetsMinimum: unitsHeld >= Number(prog.min_stake_amount),
      },
      totalEarned,
      nextDripAt: nextDrip.toISOString(),
      estimatedNextReward: estReward,
      program: {
        stakeTokenType: prog.stake_token_type,
        frequency: prog.frequency,
        rewardRatePerDay: prog.reward_rate_per_day,
        minStakeAmount: prog.min_stake_amount,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * GET /api/v1/external/staking-programs/:id/eligibility/:accountId
 * Eligibility check. Scoped to API key holder's programs.
 */
export async function externalGetEligibility(req: Request, res: Response): Promise<void> {
  if (!(await assertProgramOwnership(req, res))) return;
  try {
    const { id, accountId } = req.params;
    const progResult = await pool.query(
      `SELECT stake_token_id, stake_token_type, reward_token_id, reward_rate_per_day,
              frequency, min_stake_amount, status, tier_config
       FROM staking_programs WHERE id = $1`,
      [id]
    );
    const prog = progResult.rows[0];

    const regResult = await pool.query(
      'SELECT 1 FROM staking_participants WHERE program_id = $1 AND account_id = $2',
      [id, accountId]
    );
    const isRegistered = regResult.rowCount !== null && regResult.rowCount > 0;

    let unitsHeld = 0;
    if (prog.stake_token_type === 'NFT') {
      unitsHeld = (await fetchNftSerials(accountId, prog.stake_token_id)).length;
    } else {
      const stakeDecimals = await fetchTokenDecimals(prog.stake_token_id);
      const rawBalance = await fetchFtBalance(accountId, prog.stake_token_id);
      unitsHeld = Number(rawBalance) / Math.pow(10, stakeDecimals);
    }

    const meetsMinimum = unitsHeld >= Number(prog.min_stake_amount);
    const rewardDecimals = await fetchTokenDecimals(prog.reward_token_id);
    const days = frequencyDays(prog.frequency);
    let estRewardRaw = 0;
    if (meetsMinimum) {
      if (prog.stake_token_type === 'NFT' && Array.isArray(prog.tier_config) && prog.tier_config.length > 0) {
        const serials = await fetchNftSerials(accountId, prog.stake_token_id);
        estRewardRaw = Math.floor(
          calcTieredReward(serials, prog.tier_config as TierConfigItem[], Number(prog.reward_rate_per_day), days).wholeReward *
            Math.pow(10, rewardDecimals)
        );
      } else {
        estRewardRaw = calcReward(unitsHeld, Number(prog.reward_rate_per_day), days, rewardDecimals);
      }
    }
    const estReward = estRewardRaw / Math.pow(10, rewardDecimals);

    res.json({
      success: true,
      accountId,
      programId: id,
      isRegistered,
      isEligible: meetsMinimum,
      holdings: unitsHeld,
      estimatedReward: estReward,
      currency: prog.reward_token_id,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * POST /api/v1/external/staking-programs/:id/register
 * Register a wallet and trigger immediate drip. Scoped to API key holder's programs.
 */
export async function externalRegister(req: Request, res: Response): Promise<void> {
  if (!(await assertProgramOwnership(req, res))) return;
  await registerParticipant(req, res);
}

/**
 * GET /api/v1/external/staking-programs/:id/participants
 * Participant list. Scoped to API key holder's programs.
 */
export async function externalListParticipants(req: Request, res: Response): Promise<void> {
  if (!(await assertProgramOwnership(req, res))) return;
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT account_id, registered_at, last_distributed_at
       FROM staking_participants WHERE program_id = $1 ORDER BY registered_at ASC`,
      [id]
    );
    res.json({ success: true, participants: result.rows, count: result.rowCount });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * GET /api/v1/external/staking-programs/:id/distributions
 * Distribution history. Scoped to API key holder's programs.
 */
export async function externalListDistributions(req: Request, res: Response): Promise<void> {
  if (!(await assertProgramOwnership(req, res))) return;
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT account_id, amount, units_held, tx_id, distributed_at, tier_breakdown
       FROM staking_distributions WHERE program_id = $1 ORDER BY distributed_at DESC LIMIT 200`,
      [id]
    );
    res.json({ success: true, distributions: result.rows });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}
