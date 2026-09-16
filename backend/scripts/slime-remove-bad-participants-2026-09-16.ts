/**
 * ONE-TIME cleanup — SLIME program 8345ebe8-978a-493d-8fbd-86ebcb4c7266.
 *
 * Removes two participant rows that can never be paid (their failures hold the
 * program clock open, causing daily no-op retries):
 *   - 0.0.TEST999    — junk test account (mirror node rejects it; can never receive)
 *   - 0.0.10045916   — has not associated the SLIME reward token (transfers rejected).
 *                      Can re-register after associating; re-registration pays instantly.
 *
 * Then sets last_distributed_at = 2026-09-15T05:12:00Z — the stamp yesterday's
 * successful makeup run would have written — restoring the Tuesday 05:12 UTC cadence.
 *
 * Does NOT touch staking_distributions or staking_nft_period_credits.
 *
 * Usage (from backend/):
 *   railway run --service Postgres -- bash -c 'export DATABASE_URL="${DATABASE_PUBLIC_URL:-$DATABASE_URL}"; npx ts-node --transpile-only scripts/slime-remove-bad-participants-2026-09-16.ts'            # DRY RUN
 *   railway run --service Postgres -- bash -c 'export DATABASE_URL="${DATABASE_PUBLIC_URL:-$DATABASE_URL}"; EXECUTE=1 npx ts-node --transpile-only scripts/slime-remove-bad-participants-2026-09-16.ts'  # REAL
 */
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { pool } = require('../api-server/db');

const PROGRAM_ID = '8345ebe8-978a-493d-8fbd-86ebcb4c7266';
const ACCOUNTS = ['0.0.TEST999', '0.0.10045916'];
const RESTORE_CLOCK_TO = '2026-09-15T05:12:00Z';
const EXECUTE = process.env.EXECUTE === '1';

async function main(): Promise<void> {
  console.log(EXECUTE ? '*** EXECUTE MODE — changes will be applied ***' : 'DRY RUN — no changes will be made');

  const rows = await pool.query(
    `SELECT account_id, registered_at, last_distributed_at
       FROM staking_participants
      WHERE program_id = $1 AND account_id = ANY($2::text[])`,
    [PROGRAM_ID, ACCOUNTS]
  );
  console.log(`\nParticipant rows matching removal list (expect 2): ${rows.rowCount}`);
  for (const r of rows.rows) {
    console.log(`  ${r.account_id}  registered=${r.registered_at?.toISOString?.()}  last_distributed=${r.last_distributed_at?.toISOString?.() ?? 'never'}`);
  }

  const before = await pool.query(
    `SELECT last_distributed_at, status FROM staking_programs WHERE id = $1`,
    [PROGRAM_ID]
  );
  console.log(`\nProgram clock before: ${before.rows[0]?.last_distributed_at?.toISOString?.()}`);

  if (!EXECUTE) {
    console.log('\nDRY RUN complete. Re-run with EXECUTE=1 to apply.');
    await pool.end();
    return;
  }

  const del = await pool.query(
    `DELETE FROM staking_participants WHERE program_id = $1 AND account_id = ANY($2::text[])`,
    [PROGRAM_ID, ACCOUNTS]
  );
  console.log(`\nDeleted participant rows: ${del.rowCount}`);

  const upd = await pool.query(
    `UPDATE staking_programs SET last_distributed_at = $2, updated_at = NOW() WHERE id = $1 RETURNING last_distributed_at`,
    [PROGRAM_ID, RESTORE_CLOCK_TO]
  );
  console.log(`Clock set to: ${upd.rows[0]?.last_distributed_at?.toISOString?.()}`);

  const after = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM staking_participants WHERE program_id = $1) AS participants,
       (SELECT last_distributed_at FROM staking_programs WHERE id = $1) AS clock`,
    [PROGRAM_ID]
  );
  console.log(`\nVerify — participants remaining: ${after.rows[0].participants}`);
  console.log(`Verify — last_distributed_at: ${after.rows[0].clock?.toISOString?.()} (expect 2026-09-15T05:12)`);

  await pool.end();
  console.log('\nCleanup complete.');
}

main().catch(async (err) => {
  console.error('Cleanup FAILED:', err.message);
  try { await pool.end(); } catch {}
  process.exit(1);
});
