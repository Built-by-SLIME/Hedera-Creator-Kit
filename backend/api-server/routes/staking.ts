/**
 * Staking Tool — Backend Routes
 *
 * Soft-staking: rewards are calculated from live Mirror Node snapshots of
 * holder wallets. No assets are ever escrowed or locked.
 *
 * Creator flow:
 *  1. Creator configures a staking program (stake token, reward token, rate, frequency).
 *  2. Creator grants an allowance on their reward-token treasury to the operator.
 *  3. Backend records the program; cron runs drips on schedule.
 *
 * Community flow:
 *  1. Community member calls POST /api/staking-programs/:id/register with their accountId.
 *  2. On drip run, backend checks Mirror Node for their holdings and distributes rewards.
 */
import { Request, Response } from 'express';
import {
  Client,
  PrivateKey,
  AccountId,
  TokenId,
  TransferTransaction,
  TransactionId,
  Hbar,
} from '@hashgraph/sdk';
import { pool } from '../db';

const BACKEND_ACCOUNT_ID  = process.env.BACKEND_ACCOUNT_ID || process.env.TREASURY_ID;
const BACKEND_PRIVATE_KEY = process.env.BACKEND_PRIVATE_KEY || process.env.TREASURY_PK;
const MIRROR_NODE_URL     = 'https://mainnet-public.mirrornode.hedera.com';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getOperatorClient(): Client {
  if (!BACKEND_ACCOUNT_ID || !BACKEND_PRIVATE_KEY) throw new Error('Operator not configured');
  const client = Client.forMainnet();
  let pk: PrivateKey;
  try { pk = PrivateKey.fromStringECDSA(BACKEND_PRIVATE_KEY); }
  catch { pk = PrivateKey.fromStringED25519(BACKEND_PRIVATE_KEY); }
  client.setOperator(BACKEND_ACCOUNT_ID, pk);
  return client;
}

function getOperatorKey(): PrivateKey {
  if (!BACKEND_PRIVATE_KEY) throw new Error('Operator key not configured');
  try { return PrivateKey.fromStringECDSA(BACKEND_PRIVATE_KEY); }
  catch { return PrivateKey.fromStringED25519(BACKEND_PRIVATE_KEY); }
}

/** Returns the number of days represented by a frequency string. */
function frequencyDays(freq: string): number {
  const map: Record<string, number> = { '1d': 1, '7d': 7, '30d': 30, '90d': 90, '180d': 180, '365d': 365 };
  return map[freq] ?? 7;
}

/**
 * Returns raw reward amount (in smallest units) as a plain JS number.
 * NOTE: Must stay as `number` (not `bigint`) — the Hedera SDK's Long.fromValue()
 * throws a TypeError on native bigint, causing the transfer to silently fail.
 */
function calcReward(
  unitsHeld: number,
  ratePerDay: number,
  days: number,
  decimals: number,
): number {
  // ratePerDay is expressed in whole reward tokens. Convert to raw units.
  const wholeReward = unitsHeld * ratePerDay * days;
  return Math.floor(wholeReward * Math.pow(10, decimals));
}

/** Fetch NFT serial numbers for an account on a given token (handles pagination). */
async function fetchNftSerials(accountId: string, tokenId: string): Promise<number[]> {
  const serials: number[] = [];
  let url: string | null =
    `${MIRROR_NODE_URL}/api/v1/accounts/${accountId}/nfts?token.id=${tokenId}&limit=100`;
  while (url) {
    const res = await fetch(url);
    if (!res.ok) break;
    const data = await res.json() as { nfts: Array<{ serial_number: number }>; links?: { next?: string } };
    for (const nft of data.nfts || []) {
      serials.push(nft.serial_number);
    }
    url = data.links?.next ? `${MIRROR_NODE_URL}${data.links.next}` : null;
  }
  return serials;
}

/** Fetch total NFT count for an account on a given token (handles pagination). */
async function fetchNftCount(accountId: string, tokenId: string): Promise<number> {
  const serials = await fetchNftSerials(accountId, tokenId);
  return serials.length;
}

/** Fetch fungible token balance (raw units) for an account. */
async function fetchFtBalance(accountId: string, tokenId: string): Promise<bigint> {
  const url = `${MIRROR_NODE_URL}/api/v1/accounts/${accountId}/tokens?token.id=${tokenId}&limit=1`;
  const res = await fetch(url);
  if (!res.ok) return 0n;
  const data = await res.json() as { tokens?: Array<{ balance: number }> };
  return BigInt(data.tokens?.[0]?.balance ?? 0);
}

/** Fetch reward token decimals from Mirror Node. */
async function fetchTokenDecimals(tokenId: string): Promise<number> {
  const res = await fetch(`${MIRROR_NODE_URL}/api/v1/tokens/${tokenId}`);
  if (!res.ok) return 0;
  const data = await res.json() as { decimals?: string };
  return parseInt(data.decimals ?? '0');
}

/** Fetch custom_fees for a token so we can warn creators about fractional fees. */
async function fetchTokenFees(tokenId: string): Promise<unknown> {
  const res = await fetch(`${MIRROR_NODE_URL}/api/v1/tokens/${tokenId}`);
  if (!res.ok) return null;
  const data = await res.json() as { custom_fees?: unknown };
  return data.custom_fees ?? null;
}

// ─── ADMIN: Create staking program ───────────────────────────────────────────

/**
 * POST /api/staking-programs
 * Creator configures a new soft-staking program.
 * Body: { createdBy, name, description?, stakeTokenId, stakeTokenType,
 *         rewardTokenId, treasuryAccountId, rewardRatePerDay, minStakeAmount?,
 *         frequency, totalRewardSupply? }
 */
export async function createStakingProgram(req: Request, res: Response): Promise<void> {
  try {
    const {
      createdBy, name, description, stakeTokenId, stakeTokenType,
      rewardTokenId, treasuryAccountId, rewardRatePerDay,
      minStakeAmount, frequency, totalRewardSupply,
    } = req.body;

    if (!createdBy || !name || !stakeTokenId || !stakeTokenType || !rewardTokenId ||
        !treasuryAccountId || rewardRatePerDay == null || !frequency) {
      res.status(400).json({ success: false, error: 'Missing required fields' });
      return;
    }
    if (!['NFT', 'FT'].includes(stakeTokenType)) {
      res.status(400).json({ success: false, error: 'stakeTokenType must be "NFT" or "FT"' });
      return;
    }
    const validFrequencies = ['1d', '7d', '30d', '90d', '180d', '365d'];
    if (!validFrequencies.includes(frequency)) {
      res.status(400).json({ success: false, error: `frequency must be one of: ${validFrequencies.join(', ')}` });
      return;
    }

    // Fetch reward token fees so the response can include them for the creator's informed consent
    const customFees = await fetchTokenFees(rewardTokenId);

    const result = await pool.query(
      `INSERT INTO staking_programs
         (created_by, name, description, stake_token_id, stake_token_type,
          reward_token_id, treasury_account_id, reward_rate_per_day,
          min_stake_amount, frequency, total_reward_supply, allowance_granted)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,false)
       RETURNING *`,
      [
        createdBy, name, description || null, stakeTokenId, stakeTokenType,
        rewardTokenId, treasuryAccountId, rewardRatePerDay,
        minStakeAmount || 0, frequency, totalRewardSupply || null,
      ]
    );

    res.json({ success: true, program: result.rows[0], customFees });
  } catch (err: any) {
    console.error('createStakingProgram error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

// ─── ADMIN: Mark allowance granted ───────────────────────────────────────────

/**
 * PUT /api/staking-programs/:id/allowance
 * Called from the frontend after creator successfully signs an allowance tx.
 */
export async function markAllowanceGranted(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { createdBy } = req.body;
    const result = await pool.query(
      `UPDATE staking_programs SET allowance_granted = true, updated_at = NOW()
       WHERE id = $1 AND created_by = $2 RETURNING *`,
      [id, createdBy]
    );
    if (result.rowCount === 0) {
      res.status(404).json({ success: false, error: 'Program not found or not owned by you' });
      return;
    }
    res.json({ success: true, program: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// ─── ADMIN: List programs ─────────────────────────────────────────────────────

/** GET /api/staking-programs?createdBy=0.0.xxxxx */
export async function listStakingPrograms(req: Request, res: Response): Promise<void> {
  try {
    const { createdBy } = req.query;
    const result = createdBy
      ? await pool.query('SELECT * FROM staking_programs WHERE created_by=$1 ORDER BY created_at DESC', [createdBy])
      : await pool.query('SELECT * FROM staking_programs ORDER BY created_at DESC');
    res.json({ success: true, programs: result.rows });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// ─── PUBLIC: Active programs ─────────────────────────────────────────────────

/** GET /api/staking-programs/public */
export async function listPublicStakingPrograms(_req: Request, res: Response): Promise<void> {
  try {
    const result = await pool.query(
      `SELECT id, name, description, stake_token_id, stake_token_type, reward_token_id,
              treasury_account_id, reward_rate_per_day, min_stake_amount, frequency,
              total_reward_supply, last_distributed_at, status, created_at
       FROM staking_programs WHERE status = 'active' ORDER BY created_at DESC`
    );
    res.json({ success: true, programs: result.rows });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// ─── ADMIN: Update status ─────────────────────────────────────────────────────

/** PUT /api/staking-programs/:id/status */
export async function updateStakingStatus(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { status, createdBy } = req.body;
    if (!['active', 'paused', 'completed'].includes(status)) {
      res.status(400).json({ success: false, error: 'status must be active, paused, or completed' });
      return;
    }
    const result = await pool.query(
      `UPDATE staking_programs SET status=$1, updated_at=NOW() WHERE id=$2 AND created_by=$3 RETURNING *`,
      [status, id, createdBy]
    );
    if (result.rowCount === 0) {
      res.status(404).json({ success: false, error: 'Program not found or not owned by you' });
      return;
    }
    res.json({ success: true, program: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// ─── ADMIN: Delete program ────────────────────────────────────────────────────

/** DELETE /api/staking-programs/:id */
export async function deleteStakingProgram(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { createdBy } = req.body;
    const result = await pool.query(
      'DELETE FROM staking_programs WHERE id=$1 AND created_by=$2 RETURNING id',
      [id, createdBy]
    );
    if (result.rowCount === 0) {
      res.status(404).json({ success: false, error: 'Program not found or not owned by you' });
      return;
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// ─── COMMUNITY: Register as participant ──────────────────────────────────────

/**
 * POST /api/staking-programs/:id/register
 * Community member opts into a staking program.
 * The member must have already associated the reward token in their wallet.
 * Body: { accountId }
 */
export async function registerParticipant(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { accountId } = req.body;

    if (!accountId) {
      res.status(400).json({ success: false, error: 'accountId is required' });
      return;
    }

    // Verify program exists and is active
    const progCheck = await pool.query(
      `SELECT id, stake_token_type, stake_token_id, frequency, last_distributed_at FROM staking_programs WHERE id=$1 AND status='active'`, [id]
    );
    if (progCheck.rowCount === 0) {
      res.status(404).json({ success: false, error: 'Staking program not found or not active' });
      return;
    }
    const prog = progCheck.rows[0];

    // PRE-CHECK: For NFT programs, verify user has at least one NEW serial (not already credited)
    if (prog.stake_token_type === 'NFT') {
      const allSerials = await fetchNftSerials(accountId, prog.stake_token_id);

      if (allSerials.length === 0) {
        res.status(400).json({
          success: false,
          error: 'You do not hold any NFTs from this collection. Please acquire at least one NFT to participate.'
        });
        return;
      }

      // Check which serials have already been credited within the current frequency window.
      // Uses credited_at instead of period_start so the check is always accurate regardless
      // of when last_distributed_at was last set.
      const freqDays = frequencyDays(prog.frequency);

      const alreadyCredited = await pool.query(
        `SELECT nft_serial FROM staking_nft_period_credits
         WHERE program_id = $1
           AND credited_at > NOW() - ($2 || ' days')::interval
           AND nft_serial = ANY($3::int[])`,
        [id, freqDays, allSerials]
      );

      const creditedSet = new Set(alreadyCredited.rows.map(r => Number(r.nft_serial)));
      const newSerials = allSerials.filter(s => !creditedSet.has(s));

      console.log(`[register PRE-CHECK] ${accountId}: ${allSerials.length} total NFTs, ${creditedSet.size} already credited in last ${freqDays}d, ${newSerials.length} new`);

      if (newSerials.length === 0) {
        const nextEligible = new Date(Date.now() + freqDays * 24 * 60 * 60 * 1000);
        res.status(400).json({
          success: false,
          error: `All your NFTs have already received rewards for this period. Next distribution: ${nextEligible.toISOString().split('T')[0]}`,
          serials_held: allSerials,
          serials_already_credited: Array.from(creditedSet),
          next_eligible_date: nextEligible.toISOString()
        });
        return;
      }
    }

    // Upsert participant — idempotent
    const result = await pool.query(
      `INSERT INTO staking_participants (program_id, account_id)
       VALUES ($1, $2)
       ON CONFLICT (program_id, account_id) DO UPDATE SET registered_at = staking_participants.registered_at
       RETURNING *`,
      [id, accountId]
    );

    // Trigger an immediate drip for this participant
    let dripResult: { distributed: number; skipped: number; failed: number; errors: string[] } | null = null;
    let dripError: string | null = null;
    try {
      console.log(`[register] Starting immediate drip for ${accountId} in program ${id}`);
      dripResult = await processDrip(id, accountId);
      console.log(`[register] Drip result for ${accountId}:`, JSON.stringify(dripResult));
    } catch (dripErr: any) {
      dripError = dripErr.message;
      console.error(`[register] Immediate drip FAILED for ${accountId}:`, dripErr);
    }

    res.json({
      success: true,
      participant: result.rows[0],
      drip: dripResult
        ? { success: dripResult.distributed > 0, ...dripResult }
        : { success: false, error: dripError ?? 'unknown' },
    });
  } catch (err: any) {
    console.error('registerParticipant error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

// ─── COMMUNITY: List participants ─────────────────────────────────────────────

/** GET /api/staking-programs/:id/participants */
export async function listParticipants(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT account_id, registered_at, last_distributed_at
       FROM staking_participants WHERE program_id=$1 ORDER BY registered_at ASC`,
      [id]
    );
    res.json({ success: true, participants: result.rows, count: result.rowCount });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// ─── ADMIN: Get distribution history ─────────────────────────────────────────

/** GET /api/staking-programs/:id/distributions */
export async function listDistributions(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT account_id, amount, units_held, tx_id, distributed_at
       FROM staking_distributions WHERE program_id=$1 ORDER BY distributed_at DESC LIMIT 200`,
      [id]
    );
    res.json({ success: true, distributions: result.rows });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// ─── DRIP ENGINE ──────────────────────────────────────────────────────────────

/**
 * Core drip logic for a single staking program.
 * Returns a summary of distributions attempted.
 *
 * Flow per participant:
 *  1. Query Mirror Node for holdings (NFT count or FT balance).
 *  2. Skip if below min_stake_amount.
 *  3. Compute reward = units_held × reward_rate_per_day × frequency_days.
 *  4. Build TransferTransaction using addApprovedTokenTransfer (operator spends creator's allowance).
 *  5. Operator signs + submits; record in staking_distributions.
 */
async function processDrip(programId: string, targetAccountId?: string): Promise<{
  distributed: number; skipped: number; failed: number; errors: string[];
}> {
  console.log(`[processDrip] ENTER programId=${programId} targetAccountId=${targetAccountId ?? 'ALL'}`);

  const progResult = await pool.query(`SELECT * FROM staking_programs WHERE id=$1`, [programId]);
  if (progResult.rowCount === 0) throw new Error('Program not found');

  const prog = progResult.rows[0];
  console.log(`[processDrip] program status=${prog.status} allowance_granted=${prog.allowance_granted} treasury=${prog.treasury_account_id}`);
  if (prog.status !== 'active') throw new Error('Program is not active');
  if (!prog.allowance_granted) throw new Error('Allowance not yet granted by creator');

  // Fetch decimals for BOTH tokens separately — they can differ
  const rewardDecimals = await fetchTokenDecimals(prog.reward_token_id);
  const stakeDecimals  = await fetchTokenDecimals(prog.stake_token_id);
  const days = frequencyDays(prog.frequency);
  console.log(`[processDrip] reward_token=${prog.reward_token_id} rewardDecimals=${rewardDecimals} stake_token=${prog.stake_token_id} stakeDecimals=${stakeDecimals} days=${days}`);

  const participants = targetAccountId
    ? await pool.query(
        `SELECT account_id FROM staking_participants WHERE program_id=$1 AND account_id=$2`,
        [programId, targetAccountId]
      )
    : await pool.query(
        `SELECT account_id FROM staking_participants WHERE program_id=$1`,
        [programId]
      );

  const client = getOperatorClient();
  const operatorKey = getOperatorKey();
  const treasuryAcct = AccountId.fromString(prog.treasury_account_id);
  const rewardToken   = TokenId.fromString(prog.reward_token_id);
  const operatorAcct  = AccountId.fromString(BACKEND_ACCOUNT_ID!);

  let distributed = 0, skipped = 0, failed = 0;
  const errors: string[] = [];

  for (const row of participants.rows) {
    const accountId = row.account_id as string;
    try {
      // 1. Fetch holdings
      let unitsHeld: number;
      let newSerials: number[] = [];

      if (prog.stake_token_type === 'NFT') {
        // Fetch all serials currently held
        const allSerials = await fetchNftSerials(accountId, prog.stake_token_id);

        // Check which serials have already been credited within the current frequency window.
        // Uses credited_at for a robust time-window check instead of period_start derived
        // from last_distributed_at (which could shift if the cron clock resets).
        console.log(`[drip] ${accountId}: Checking serials against ${days}d window, program ${programId}`);
        console.log(`[drip] ${accountId}: Serials held: ${JSON.stringify(allSerials)}`);

        const alreadyCredited = await pool.query(
          `SELECT nft_serial FROM staking_nft_period_credits
           WHERE program_id = $1
             AND credited_at > NOW() - ($2 || ' days')::interval
             AND nft_serial = ANY($3::int[])`,
          [programId, days, allSerials]
        );

        console.log(`[drip] ${accountId}: Found ${alreadyCredited.rowCount} serials already credited: ${JSON.stringify(alreadyCredited.rows.map(r => r.nft_serial))}`);

        const creditedSet = new Set(alreadyCredited.rows.map(r => Number(r.nft_serial)));
        newSerials = allSerials.filter(s => !creditedSet.has(s));
        unitsHeld = newSerials.length;

        console.log(`[drip] ${accountId}: ${allSerials.length} total NFTs, ${creditedSet.size} already credited in last ${days}d, ${newSerials.length} new`);
      } else {
        const rawBalance = await fetchFtBalance(accountId, prog.stake_token_id);
        // Use STAKE token decimals to convert raw balance to whole units
        unitsHeld = Number(rawBalance) / Math.pow(10, stakeDecimals);
      }

      // 2. Skip if below minimum
      if (unitsHeld <= 0 || unitsHeld < Number(prog.min_stake_amount)) {
        console.log(`[drip] Skipping ${accountId}: holds ${unitsHeld}, min is ${prog.min_stake_amount}`);
        skipped++;
        continue;
      }

      // 3. Calculate reward (plain number — NOT bigint; SDK's Long.fromValue rejects bigint)
      const rewardRaw = calcReward(unitsHeld, Number(prog.reward_rate_per_day), days, rewardDecimals);
      if (rewardRaw <= 0) { skipped++; continue; }
      console.log(`[drip] ${accountId} holds ${unitsHeld} units → rewardRaw=${rewardRaw} (rewardDecimals=${rewardDecimals})`);

      // 4. Build approved transfer: treasury → participant (operator uses creator's allowance)
      const recipientAcct = AccountId.fromString(accountId);
      const transferTx = new TransferTransaction()
        .addApprovedTokenTransfer(rewardToken, treasuryAcct, -rewardRaw)
        .addTokenTransfer(rewardToken, recipientAcct, rewardRaw)
        .setTransactionId(TransactionId.generate(operatorAcct))
        .setNodeAccountIds([new AccountId(3)])
        .setMaxTransactionFee(new Hbar(2));

      const frozenTx = transferTx.freezeWith(client);
      const signedTx = await frozenTx.sign(operatorKey);
      const txResponse = await signedTx.execute(client);
      await txResponse.getReceipt(client);
      const txId = txResponse.transactionId.toString();

      // 5. Record distribution
      await pool.query(
        `INSERT INTO staking_distributions (program_id, account_id, amount, units_held, tx_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [programId, accountId, rewardRaw / Math.pow(10, rewardDecimals), unitsHeld, txId]
      );
      await pool.query(
        `UPDATE staking_participants SET last_distributed_at=NOW() WHERE program_id=$1 AND account_id=$2`,
        [programId, accountId]
      );

      // 6. For NFT programs: record which serials were credited now.
      // period_start is normalized to today's UTC midnight so the UNIQUE constraint
      // (program_id, nft_serial, period_start) prevents double-inserts within a day.
      if (prog.stake_token_type === 'NFT' && newSerials.length > 0) {
        const todayUtc = new Date().toISOString().split('T')[0] + 'T00:00:00Z';
        for (const serial of newSerials) {
          await pool.query(
            `INSERT INTO staking_nft_period_credits (program_id, nft_serial, period_start)
             VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
            [programId, serial, todayUtc]
          );
        }
        console.log(`[drip] Recorded ${newSerials.length} serials as credited (period_start ${todayUtc})`);
      }

      console.log(`[drip] Sent ${rewardRaw / Math.pow(10, rewardDecimals)} reward to ${accountId} (tx: ${txId})`);
      distributed++;
    } catch (err: any) {
      failed++;
      const msg = `${accountId}: ${err.message}`;
      errors.push(msg);
      console.error(`[drip] Failed for ${accountId}:`, err.message);
    }
  }

  // Only update program's last_distributed_at on a full run (not a single-participant registration drip)
  // If we update it on every registration, the cron will never see the program as "due"
  if (!targetAccountId) {
    await pool.query(
      `UPDATE staking_programs SET last_distributed_at=NOW(), updated_at=NOW() WHERE id=$1`,
      [programId]
    );
  }

  return { distributed, skipped, failed, errors };
}

/**
 * POST /api/staking-programs/:id/drip
 * Manually trigger a drip for a specific program.
 * Protected: only the program creator can trigger it.
 * In production, call this from a Railway Cron job or external scheduler.
 */
export async function triggerDrip(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { createdBy } = req.body;

    // Verify ownership
    const check = await pool.query(
      `SELECT created_by FROM staking_programs WHERE id=$1`, [id]
    );
    if (check.rowCount === 0) { res.status(404).json({ success: false, error: 'Program not found' }); return; }
    if (check.rows[0].created_by !== createdBy) {
      res.status(403).json({ success: false, error: 'Not authorized' }); return;
    }

    const summary = await processDrip(id);
    res.json({ success: true, programId: id, ...summary });
  } catch (err: any) {
    console.error('triggerDrip error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * POST /api/staking-programs/run-all-drips
 * Process ALL overdue active programs (for use by a scheduler/cron).
 * Secured by DRIP_SECRET env var — set this to a long random string and
 * pass it as Bearer token in your cron's Authorization header.
 */
export async function runAllDrips(req: Request, res: Response): Promise<void> {
  const secret = process.env.DRIP_SECRET;
  if (secret) {
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${secret}`) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }
  }

  try {
    // Find active programs that are due for a drip
    const due = await pool.query(`
      SELECT id, frequency, last_distributed_at FROM staking_programs
      WHERE status = 'active' AND allowance_granted = true
        AND (
          last_distributed_at IS NULL
          OR NOW() - last_distributed_at >= (
            CASE frequency
              WHEN '1d'   THEN INTERVAL '1 day'
              WHEN '7d'   THEN INTERVAL '7 days'
              WHEN '30d'  THEN INTERVAL '30 days'
              WHEN '90d'  THEN INTERVAL '90 days'
              WHEN '180d' THEN INTERVAL '180 days'
              WHEN '365d' THEN INTERVAL '365 days'
            END
          )
        )
    `);

    const results: Record<string, unknown> = {};
    for (const row of due.rows) {
      try {
        results[row.id] = await processDrip(row.id);
      } catch (err: any) {
        results[row.id] = { error: err.message };
      }
    }

    res.json({ success: true, processed: due.rowCount, results });
  } catch (err: any) {
    console.error('runAllDrips error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * POST /api/staking-programs/reset-distribution-clock
 * ONE-TIME: Resets last_distributed_at to NULL for SLIME and Degen programs.
 * Secured by DRIP_SECRET.
 */
export async function resetDistributionClock(req: Request, res: Response) {
  const secret = process.env.DRIP_SECRET;
  if (secret) {
    const auth = req.headers['authorization'];
    if (!auth || auth !== `Bearer ${secret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }
  try {
    const result = await pool.query(
      `UPDATE staking_programs SET last_distributed_at = NULL WHERE id = ANY($1::uuid[]) RETURNING id, name, last_distributed_at`,
      [['8345ebe8-978a-493d-8fbd-86ebcb4c7266', 'f92d3051-8325-416e-bbab-c78e98c5b4df']]
    );
    res.json({ success: true, updated: result.rows });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}

