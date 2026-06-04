import { Request, Response } from 'express';
import { createHash, randomBytes } from 'crypto';
import { pool } from '../db';

/**
 * POST /api/admin/api-keys
 * Generates a new API key for a project. Protected by DRIP_SECRET env var.
 * Body: { accountId, name?, scopes? }
 * Response: { success, apiKey: '<raw-key-one-time-only>', account_id, name }
 */
const ADMIN_WALLET = process.env.BACKEND_ACCOUNT_ID || process.env.TREASURY_ID;

export async function generateApiKey(req: Request, res: Response): Promise<void> {
  const secret = process.env.DRIP_SECRET;
  const authHeader = req.headers.authorization;
  const { accountId, name, scopes, createdBy } = req.body;

  // Auth: either DRIP_SECRET bearer token, or admin wallet
  const isSecretAuth = secret && authHeader === `Bearer ${secret}`;
  const isWalletAuth = ADMIN_WALLET && createdBy === ADMIN_WALLET;

  if (!isSecretAuth && !isWalletAuth) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

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
