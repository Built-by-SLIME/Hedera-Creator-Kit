import { Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';
import { pool } from '../db';

export interface ApiKeyData {
  id: string;
  account_id: string;
  name: string | null;
  scopes: string[];
  is_active: boolean;
}

declare global {
  namespace Express {
    interface Request {
      apiKey?: ApiKeyData;
    }
  }
}

/**
 * Validates the Authorization: Bearer <api_key> header against the api_keys table.
 * Attaches req.apiKey on success. Returns 401 on failure.
 */
export async function requireApiKey(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'API key required. Pass Authorization: Bearer <key>' });
    return;
  }

  const rawKey = auth.slice(7).trim();
  if (!rawKey) {
    res.status(401).json({ success: false, error: 'API key is empty' });
    return;
  }

  const keyHash = createHash('sha256').update(rawKey).digest('hex');

  try {
    const result = await pool.query(
      `SELECT id, account_id, name, scopes, is_active
       FROM api_keys
       WHERE key_hash = $1
         AND is_active = true
         AND revoked_at IS NULL`,
      [keyHash]
    );

    if (result.rowCount === 0) {
      res.status(401).json({ success: false, error: 'Invalid or revoked API key' });
      return;
    }

    // Update last_used_at (fire-and-forget)
    pool.query('UPDATE api_keys SET last_used_at = NOW() WHERE id = $1', [result.rows[0].id]).catch(() => {});

    req.apiKey = result.rows[0] as ApiKeyData;
    next();
  } catch (err: any) {
    console.error('[requireApiKey] DB error:', err.message);
    res.status(500).json({ success: false, error: 'Internal auth error' });
  }
}

/**
 * Validates API key AND verifies the key holder owns the program.
 * Program ID is read from req.params.id.
 */
export async function requireProgramOwnership(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.apiKey) {
    res.status(401).json({ success: false, error: 'API key required' });
    return;
  }

  const programId = req.params.id;
  if (!programId) {
    res.status(400).json({ success: false, error: 'Program ID required' });
    return;
  }

  try {
    const result = await pool.query(
      'SELECT created_by FROM staking_programs WHERE id = $1',
      [programId]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ success: false, error: 'Program not found' });
      return;
    }

    if (result.rows[0].created_by !== req.apiKey.account_id) {
      res.status(403).json({ success: false, error: 'Not authorized for this program' });
      return;
    }

    next();
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}
