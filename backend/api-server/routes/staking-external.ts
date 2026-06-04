import { Request, Response } from 'express';
import { pool } from '../db';
import {
  registerParticipant,
  listPublicStakingPrograms,
  fetchNftSerials,
  fetchFtBalance,
  fetchTokenDecimals,
  frequencyDays,
  calcReward,
} from './staking';

// ─── External staking API for third-party integrations ──────────────────────

/**
 * GET /api/v1/external/staking-programs/public
 * Lists all active staking programs. Any valid API key grants access.
 * Thin wrapper around the existing listPublicStakingPrograms handler.
 */
export async function externalListPublicPrograms(req: Request, res: Response): Promise<void> {
  await listPublicStakingPrograms(req, res);
}

/**
 * GET /api/v1/external/staking-programs/:id
 * Single program details + live stats (participant count, total distributed).
 */
export async function externalGetProgram(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const progResult = await pool.query(
      `SELECT id, name, description, stake_token_id, stake_token_type, reward_token_id,
              treasury_account_id, reward_rate_per_day, min_stake_amount, frequency,
              total_reward_supply, last_distributed_at, status, created_at
       FROM staking_programs WHERE id = $1`,
      [id]
    );
    if (progResult.rowCount === 0) {
      res.status(404).json({ success: false, error: 'Program not found' });
      return;
    }

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
 * Returns a wallet's live staking position: holdings, total earned,
 * registration status, next drip date, and estimated next reward.
 */
export async function externalGetPosition(req: Request, res: Response): Promise<void> {
  try {
    const { id, accountId } = req.params;

    const progResult = await pool.query(
      `SELECT stake_token_id, stake_token_type, reward_token_id, reward_rate_per_day,
              frequency, min_stake_amount, status
       FROM staking_programs WHERE id = $1`,
      [id]
    );
    if (progResult.rowCount === 0) {
      res.status(404).json({ success: false, error: 'Program not found' });
      return;
    }
    const prog = progResult.rows[0];
    if (prog.status !== 'active') {
      res.status(400).json({ success: false, error: 'Program is not active' });
      return;
    }

    // Registration status
    const regResult = await pool.query(
      'SELECT registered_at, last_distributed_at FROM staking_participants WHERE program_id = $1 AND account_id = $2',
      [id, accountId]
    );
    const isRegistered = regResult.rowCount !== null && regResult.rowCount > 0;

    // Total earned
    const distResult = await pool.query(
      'SELECT COALESCE(SUM(amount), 0) as total FROM staking_distributions WHERE program_id = $1 AND account_id = $2',
      [id, accountId]
    );
    const totalEarned = parseFloat(distResult.rows[0].total);

    // Live holdings
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

    // Next drip date
    const lastDist = regResult.rows[0]?.last_distributed_at || prog.last_distributed_at;
    const days = frequencyDays(prog.frequency);
    const nextDrip = lastDist
      ? new Date(new Date(lastDist).getTime() + days * 86400000)
      : new Date();

    // Estimated next reward
    const rewardDecimals = await fetchTokenDecimals(prog.reward_token_id);
    const estRewardRaw = unitsHeld > 0 && unitsHeld >= Number(prog.min_stake_amount)
      ? calcReward(unitsHeld, Number(prog.reward_rate_per_day), days, rewardDecimals)
      : 0;
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
 * Lightweight eligibility check for a wallet. No registration required.
 */
export async function externalGetEligibility(req: Request, res: Response): Promise<void> {
  try {
    const { id, accountId } = req.params;

    const progResult = await pool.query(
      `SELECT stake_token_id, stake_token_type, reward_token_id, reward_rate_per_day,
              frequency, min_stake_amount, status
       FROM staking_programs WHERE id = $1`,
      [id]
    );
    if (progResult.rowCount === 0) {
      res.status(404).json({ success: false, error: 'Program not found' });
      return;
    }
    const prog = progResult.rows[0];
    if (prog.status !== 'active') {
      res.status(400).json({ success: false, error: 'Program is not active' });
      return;
    }

    // Is registered?
    const regResult = await pool.query(
      'SELECT 1 FROM staking_participants WHERE program_id = $1 AND account_id = $2',
      [id, accountId]
    );
    const isRegistered = regResult.rowCount !== null && regResult.rowCount > 0;

    // Live holdings
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
    const estRewardRaw = meetsMinimum
      ? calcReward(unitsHeld, Number(prog.reward_rate_per_day), days, rewardDecimals)
      : 0;
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
 * Community member registers + immediate drip.
 * Validates API key, then delegates to the existing registerParticipant handler.
 */
export async function externalRegister(req: Request, res: Response): Promise<void> {
  await registerParticipant(req, res);
}

/**
 * GET /api/v1/external/staking-programs/:id/participants
 * Creator-scoped: only the program owner (matching API key account) can access.
 */
export async function externalListParticipants(req: Request, res: Response): Promise<void> {
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
 * Creator-scoped: only the program owner can access.
 */
export async function externalListDistributions(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT account_id, amount, units_held, tx_id, distributed_at
       FROM staking_distributions WHERE program_id = $1 ORDER BY distributed_at DESC LIMIT 200`,
      [id]
    );
    res.json({ success: true, distributions: result.rows });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}
