import { Request, Response } from 'express';
import { createHash, randomBytes } from 'crypto';
import { pool } from '../db';

const ADMIN_WALLET = process.env.BACKEND_ACCOUNT_ID || process.env.TREASURY_ID;

function isAuthorized(req: Request): boolean {
  const secret = process.env.DRIP_SECRET;
  const auth = req.headers.authorization;
  const createdBy = req.body?.createdBy || req.query?.createdBy;
  return (!!secret && auth === `Bearer ${secret}`) || (!!ADMIN_WALLET && createdBy === ADMIN_WALLET);
}

/**
 * GET /api/admin/api-keys
 * List all issued API keys. Protected by DRIP_SECRET or admin wallet.
 * Query: { createdBy: string }
 */
export async function listApiKeys(req: Request, res: Response): Promise<void> {
  if (!isAuthorized(req)) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }
  try {
    const result = await pool.query(
      `SELECT id, account_id, name, scopes, is_active, created_at, revoked_at, last_used_at
       FROM api_keys ORDER BY created_at DESC`
    );
    res.json({ success: true, keys: result.rows });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * DELETE /api/admin/api-keys/:id
 * Revoke an API key by ID. Protected by DRIP_SECRET or admin wallet.
 * Body: { createdBy: string }
 */
export async function revokeApiKey(req: Request, res: Response): Promise<void> {
  if (!isAuthorized(req)) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }
  try {
    const { id } = req.params;
    const result = await pool.query(
      `UPDATE api_keys SET is_active = false, revoked_at = NOW()
       WHERE id = $1 RETURNING id, account_id, name`,
      [id]
    );
    if (result.rowCount === 0) {
      res.status(404).json({ success: false, error: 'API key not found' });
      return;
    }
    res.json({ success: true, revoked: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * POST /api/admin/api-keys
 * Generates a new API key for a project. Protected by DRIP_SECRET env var.
 * Body: { accountId, name?, scopes? }
 * Response: { success, apiKey: '<raw-key-one-time-only>', account_id, name }
 */
export async function generateApiKey(req: Request, res: Response): Promise<void> {
  if (!isAuthorized(req)) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
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
