/**
 * Insert snapshot NFT serials into staking_nft_period_credits table.
 * This marks all currently-held serials as "already paid" for the current period.
 */
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('railway') ? { rejectUnauthorized: false } : false,
});

// Snapshot data from snapshot-via-api.js output
const SNAPSHOT = require('./snapshot-data.json');

// Period start timestamp = when the last drip ran (March 21, 2026 ~1:12 AM EDT = 5:12 UTC)
const PERIOD_START = '2026-03-21T05:12:00Z';

async function main() {
  console.log('Starting snapshot credit insertion...\n');

  let totalInserted = 0;

  for (const [programId, data] of Object.entries(SNAPSHOT)) {
    if (data.error) {
      console.log(`⚠ Skipping ${data.program_name} - error in snapshot: ${data.error}`);
      continue;
    }

    console.log(`\n[${data.program_name}] Processing...`);
    const holdings = data.holdings || [];
    
    let programSerials = [];
    for (const h of holdings) {
      if (h.serials && h.serials.length > 0) {
        programSerials.push(...h.serials);
      }
    }

    if (programSerials.length === 0) {
      console.log(`  No serials to insert`);
      continue;
    }

    console.log(`  Inserting ${programSerials.length} serials...`);

    // Insert in batches of 100 to avoid query size limits
    const batchSize = 100;
    for (let i = 0; i < programSerials.length; i += batchSize) {
      const batch = programSerials.slice(i, i + batchSize);
      const values = batch.map((serial, idx) => {
        const offset = i + idx;
        return `($1, $${offset * 2 + 2}, $${offset * 2 + 3})`;
      }).join(',');

      const params = [programId];
      batch.forEach(serial => {
        params.push(serial, PERIOD_START);
      });

      try {
        const result = await pool.query(
          `INSERT INTO staking_nft_period_credits (program_id, nft_serial, period_start)
           VALUES ${values}
           ON CONFLICT (program_id, nft_serial, period_start) DO NOTHING`,
          params
        );
        totalInserted += result.rowCount || 0;
      } catch (err) {
        console.error(`  ⚠ Error inserting batch starting at index ${i}:`, err.message);
      }
    }

    console.log(`  ✓ Inserted ${programSerials.length} serials for ${data.program_name}`);
  }

  console.log(`\n=== COMPLETE ===`);
  console.log(`Total serials marked as credited: ${totalInserted}`);

  await pool.end();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

