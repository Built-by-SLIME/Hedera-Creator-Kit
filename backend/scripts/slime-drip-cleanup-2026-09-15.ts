/**
 * ONE-TIME incident cleanup — SLIME dust drip of 2026-09-15.
 *
 * What it does (SLIME program 8345ebe8-978a-493d-8fbd-86ebcb4c7266 ONLY):
 *  1. SELECTs today's (2026-09-15 UTC) dust distribution rows + serial credits.
 *  2. Backs them up to slime-dust-backup-2026-09-15.json (always, even in dry-run).
 *  3. EXECUTE mode only:
 *       - DELETE today's staking_nft_period_credits rows (frees the 18 dusted serials)
 *       - DELETE today's staking_distributions rows (they falsely record "70"; chain has the truth)
 *       - UPDATE staking_programs.last_distributed_at back to 2026-09-08T05:12:00Z
 *         (makes the program due again while preserving the Tuesday 05:12 cadence)
 *  4. Re-selects everything to verify.
 *
 * Deliberately NOT touched: the 2026-09-14 registration drip (paid correctly, 7e9 raw on-chain).
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/slime-drip-cleanup-2026-09-15.ts            # DRY RUN (default)
 *   EXECUTE=1 npx ts-node --transpile-only scripts/slime-drip-cleanup-2026-09-15.ts  # REAL
 *
 * Run from the backend/ directory. Loads backend/.env for DATABASE_URL like the API server does.
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { pool } = require('../api-server/db');

const PROGRAM_ID = '8345ebe8-978a-493d-8fbd-86ebcb4c7266';
const INCIDENT_DAY = '2026-09-15T00:00:00Z';
const RESTORE_CLOCK_TO = '2026-09-08T05:12:00Z';
const BACKUP_FILE = path.join(__dirname, 'slime-dust-backup-2026-09-15.json');
const EXECUTE = process.env.EXECUTE === '1';

async function main(): Promise<void> {
  console.log(EXECUTE ? '*** EXECUTE MODE — changes will be applied ***' : 'DRY RUN — no changes will be made');

  // 1. Preview the rows in scope
  const dist = await pool.query(
    `SELECT id, account_id, amount, units_held, tx_id, distributed_at
       FROM staking_distributions
      WHERE program_id = $1 AND distributed_at >= $2
      ORDER BY distributed_at`,
    [PROGRAM_ID, INCIDENT_DAY]
  );
  const credits = await pool.query(
    `SELECT id, nft_serial, period_start, credited_at
       FROM staking_nft_period_credits
      WHERE program_id = $1 AND credited_at >= $2
      ORDER BY nft_serial`,
    [PROGRAM_ID, INCIDENT_DAY]
  );

  console.log(`\nDust distribution rows (expect 18): ${dist.rowCount}`);
  for (const r of dist.rows) {
    console.log(`  ${r.distributed_at.toISOString()}  ${r.account_id}  amt=${r.amount}  units=${r.units_held}`);
  }
  console.log(`\nSerial credit rows (expect ~50): ${credits.rowCount}`);
  console.log(`  serials: ${credits.rows.map((r: any) => r.nft_serial).join(', ')}`);

  // 2. Backup ALWAYS (dry-run too) so we can never lose the record
  fs.writeFileSync(BACKUP_FILE, JSON.stringify({
    backed_up_at: new Date().toISOString(),
    program_id: PROGRAM_ID,
    distributions: dist.rows,
    nft_period_credits: credits.rows,
  }, null, 2));
  console.log(`\nBackup written: ${BACKUP_FILE}`);

  // 3. Show current program clock
  const before = await pool.query(
    `SELECT id, name, status, last_distributed_at FROM staking_programs WHERE id = $1`,
    [PROGRAM_ID]
  );
  console.log(`\nProgram before: last_distributed_at = ${before.rows[0]?.last_distributed_at?.toISOString?.() ?? before.rows[0]?.last_distributed_at}`);

  if (!EXECUTE) {
    console.log('\nDRY RUN complete. Re-run with EXECUTE=1 to apply.');
    await pool.end();
    return;
  }

  // 4. Execute
  const delCredits = await pool.query(
    `DELETE FROM staking_nft_period_credits WHERE program_id = $1 AND credited_at >= $2`,
    [PROGRAM_ID, INCIDENT_DAY]
  );
  console.log(`\nDeleted serial credits: ${delCredits.rowCount}`);

  const delDist = await pool.query(
    `DELETE FROM staking_distributions WHERE program_id = $1 AND distributed_at >= $2`,
    [PROGRAM_ID, INCIDENT_DAY]
  );
  console.log(`Deleted dust distribution rows: ${delDist.rowCount}`);

  const upd = await pool.query(
    `UPDATE staking_programs SET last_distributed_at = $2, updated_at = NOW() WHERE id = $1 RETURNING last_distributed_at`,
    [PROGRAM_ID, RESTORE_CLOCK_TO]
  );
  console.log(`Clock restored to: ${upd.rows[0]?.last_distributed_at?.toISOString?.()}`);

  // 5. Verify
  const afterCredits = await pool.query(
    `SELECT COUNT(*) AS n FROM staking_nft_period_credits WHERE program_id = $1 AND credited_at >= $2`,
    [PROGRAM_ID, INCIDENT_DAY]
  );
  const afterDist = await pool.query(
    `SELECT COUNT(*) AS n FROM staking_distributions WHERE program_id = $1 AND distributed_at >= $2`,
    [PROGRAM_ID, INCIDENT_DAY]
  );
  const after = await pool.query(
    `SELECT last_distributed_at, status FROM staking_programs WHERE id = $1`,
    [PROGRAM_ID]
  );
  console.log(`\nVerify — today's credits remaining: ${afterCredits.rows[0].n} (expect 0)`);
  console.log(`Verify — today's distributions remaining: ${afterDist.rows[0].n} (expect 0)`);
  console.log(`Verify — last_distributed_at: ${after.rows[0]?.last_distributed_at?.toISOString?.()} (expect 2026-09-08T05:12)`);
  console.log(`Verify — status: ${after.rows[0]?.status} (expect active)`);

  await pool.end();
  console.log('\nCleanup complete.');
}

main().catch(async (err) => {
  console.error('Cleanup FAILED:', err.message);
  try { await pool.end(); } catch {}
  process.exit(1);
});
