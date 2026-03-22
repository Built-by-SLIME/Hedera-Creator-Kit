/**
 * Insert snapshot NFT serials into staking_nft_period_credits table.
 * This marks all currently-held serials as "already paid" for the current period.
 * 
 * This version can be called as an API endpoint.
 */
import { pool } from '../api-server/db';
import { Request, Response } from 'express';

// Snapshot data
const SNAPSHOT = require('./snapshot-data.json');

// Period start timestamp = when the last drip ran (March 21, 2026 ~1:12 AM EDT = 5:12 UTC)
const PERIOD_START = '2026-03-21T05:12:00Z';

export async function insertSnapshotCredits(req: Request, res: Response): Promise<void> {
  const secret = process.env.DRIP_SECRET;
  if (secret) {
    const auth = req.headers['authorization'];
    if (!auth || auth !== `Bearer ${secret}`) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
  }

  try {
    const results: any = {};
    let totalInserted = 0;

    for (const [programId, data] of Object.entries(SNAPSHOT)) {
      const programData = data as any;
      
      if (programData.error) {
        results[programId] = { error: programData.error, skipped: true };
        continue;
      }

      const holdings = programData.holdings || [];
      
      const programSerials: number[] = [];
      for (const h of holdings) {
        if (h.serials && h.serials.length > 0) {
          programSerials.push(...h.serials);
        }
      }

      if (programSerials.length === 0) {
        results[programId] = { program_name: programData.program_name, inserted: 0 };
        continue;
      }

      // Insert in batches of 100
      const batchSize = 100;
      let inserted = 0;
      
      for (let i = 0; i < programSerials.length; i += batchSize) {
        const batch = programSerials.slice(i, i + batchSize);
        const values = batch.map((_, idx) => {
          const offset = idx;
          return `($1, $${offset * 2 + 2}, $${offset * 2 + 3})`;
        }).join(',');

        const params: any[] = [programId];
        batch.forEach(serial => {
          params.push(serial, PERIOD_START);
        });

        const result = await pool.query(
          `INSERT INTO staking_nft_period_credits (program_id, nft_serial, period_start)
           VALUES ${values}
           ON CONFLICT (program_id, nft_serial, period_start) DO NOTHING`,
          params
        );
        inserted += result.rowCount || 0;
      }

      totalInserted += inserted;
      results[programId] = {
        program_name: programData.program_name,
        total_serials: programSerials.length,
        inserted,
      };
    }

    res.json({ success: true, total_inserted: totalInserted, results });
  } catch (err: any) {
    console.error('insertSnapshotCredits error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

