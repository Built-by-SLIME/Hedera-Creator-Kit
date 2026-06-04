import { Request, Response } from 'express';
import { createHash, randomBytes } from 'crypto';
import { pool } from '../db';

/**
 * POST /api/admin/api-keys
 * Generates a new API key for a project. Protected by DRIP_SECRET env var.
 * Body: { accountId, name?, scopes? }
 * Response: { success, apiKey: '<raw-key-one-time-only>', account_id, name }
 */
export async function generateApiKey(req: Request, res: Response): Promise<void> {
  const secret = process.env.DRIP_SECRET;
  if (secret) {
    const auth = req.headers.authorization;
    if (!auth || auth !== `Bearer ${secret}`) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }
  }

  const { accountId, name, scopes } = req.body;
  if (!accountId) {
    res.status(400).json({ success: false, error: 'accountId is required' });
    return;
  }

  try {
    const rawKey = randomBytes(32).toString('hex');
    const keyHash = createHash('sha256').update(rawKey).digest('hex');

    const result = await pool.query(
      `INSERT INTO api_keys (account_id, key_hash, name, scopes)
       VALUES ($1, $2, $3, $4)
       RETURNING id, account_id, name, scopes, created_at`,
      [
        accountId,
        keyHash,
        name || null,
        scopes && Array.isArray(scopes) ? scopes : ['staking:read', 'staking:write'],
      ]
    );

    res.json({
      success: true,
      apiKey: rawKey,
      key: result.rows[0],
      note: 'This is the ONLY time the raw key is shown. Store it securely.',
    });
  } catch (err: any) {
    console.error('generateApiKey error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}
