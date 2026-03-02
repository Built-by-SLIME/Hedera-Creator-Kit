import { Request, Response } from 'express';
import {
  Client,
  PrivateKey,
  AccountId,
  TokenId,
  NftId,
  TransferTransaction,
  AccountAllowanceApproveTransaction,
  AccountAllowanceDeleteTransaction,
} from '@hashgraph/sdk';
import { pool } from '../db';

const BACKEND_ACCOUNT_ID = process.env.BACKEND_ACCOUNT_ID || process.env.TREASURY_ID;
const BACKEND_PRIVATE_KEY = process.env.BACKEND_PRIVATE_KEY || process.env.TREASURY_PK;

function getOperatorClient(): Client {
  if (!BACKEND_ACCOUNT_ID || !BACKEND_PRIVATE_KEY) {
    throw new Error('Backend operator account not configured');
  }
  const client = Client.forMainnet();
  let pk: PrivateKey;
  try {
    pk = PrivateKey.fromStringECDSA(BACKEND_PRIVATE_KEY);
  } catch {
    pk = PrivateKey.fromString(BACKEND_PRIVATE_KEY);
  }
  client.setOperator(BACKEND_ACCOUNT_ID, pk);
  return client;
}

// ─── ADMIN: Create swap program ─────────────────────────────────────────────

/**
 * POST /api/swap-programs
 * Creator configures a new swap program.
 */
export async function createSwapProgram(req: Request, res: Response): Promise<void> {
  try {
    const {
      createdBy,
      name,
      description,
      swapType,
      fromTokenId,
      toTokenId,
      treasuryAccountId,
      rateFrom,
      rateTo,
      totalSupply,
    } = req.body;

    if (!createdBy || !name || !swapType || !fromTokenId || !toTokenId || !treasuryAccountId) {
      res.status(400).json({ success: false, error: 'Missing required fields' });
      return;
    }

    if (!['nft', 'fungible'].includes(swapType)) {
      res.status(400).json({ success: false, error: 'swapType must be "nft" or "fungible"' });
      return;
    }

    const result = await pool.query(
      `INSERT INTO swap_programs
         (created_by, name, description, swap_type, from_token_id, to_token_id,
          treasury_account_id, rate_from, rate_to, total_supply)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        createdBy,
        name,
        description || null,
        swapType,
        fromTokenId,
        toTokenId,
        treasuryAccountId,
        rateFrom || 1,
        rateTo || 1,
        totalSupply || null,
      ]
    );

    res.json({ success: true, program: result.rows[0] });
  } catch (err: any) {
    console.error('createSwapProgram error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

// ─── ADMIN: List swap programs (all, filtered by creator) ───────────────────

/**
 * GET /api/swap-programs?createdBy=0.0.xxxxx
 * Returns all swap programs, optionally filtered by creator account.
 */
export async function listSwapPrograms(req: Request, res: Response): Promise<void> {
  try {
    const { createdBy } = req.query;
    let result;
    if (createdBy) {
      result = await pool.query(
        'SELECT * FROM swap_programs WHERE created_by = $1 ORDER BY created_at DESC',
        [createdBy]
      );
    } else {
      result = await pool.query('SELECT * FROM swap_programs ORDER BY created_at DESC');
    }
    res.json({ success: true, programs: result.rows });
  } catch (err: any) {
    console.error('listSwapPrograms error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

// ─── PUBLIC: List active swap programs (for SLIME dApp) ─────────────────────

/**
 * GET /api/swap-programs/public
 * Returns only active swap programs — called by community-facing dApps.
 */
export async function listPublicSwapPrograms(req: Request, res: Response): Promise<void> {
  try {
    const result = await pool.query(
      `SELECT id, name, description, swap_type, from_token_id, to_token_id,
              treasury_account_id, rate_from, rate_to, total_supply, status, created_at
       FROM swap_programs WHERE status = 'active' ORDER BY created_at DESC`
    );
    res.json({ success: true, programs: result.rows });
  } catch (err: any) {
    console.error('listPublicSwapPrograms error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

// ─── ADMIN: Update swap program status ──────────────────────────────────────

/**
 * PUT /api/swap-programs/:id/status
 * Activate, pause, or complete a swap program.
 */
export async function updateSwapStatus(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { status, createdBy } = req.body;

    if (!['active', 'paused', 'completed'].includes(status)) {
      res.status(400).json({ success: false, error: 'status must be active, paused, or completed' });
      return;
    }

    const result = await pool.query(
      `UPDATE swap_programs
       SET status = $1, updated_at = NOW()
       WHERE id = $2 AND created_by = $3
       RETURNING *`,
      [status, id, createdBy]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ success: false, error: 'Swap program not found or not owned by you' });
      return;
    }

    res.json({ success: true, program: result.rows[0] });
  } catch (err: any) {
    console.error('updateSwapStatus error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

// ─── ADMIN: Delete swap program ──────────────────────────────────────────────

/**
 * DELETE /api/swap-programs/:id
 */
export async function deleteSwapProgram(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { createdBy } = req.body;

    const result = await pool.query(
      'DELETE FROM swap_programs WHERE id = $1 AND created_by = $2 RETURNING id',
      [id, createdBy]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ success: false, error: 'Swap program not found or not owned by you' });
      return;
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error('deleteSwapProgram error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

// ─── PUBLIC: Execute a swap (called by community dApp) ──────────────────────

/**
 * POST /api/swap-programs/:id/execute
 *
 * NFT swap flow:
 *   1. User has already approved their old NFTs to the creator treasury (done client-side).
 *   2. Our operator (granted allowance by creator) transfers new NFTs from treasury to user.
 *   3. Old NFTs are pulled from user to treasury using user's approval.
 *
 * Fungible swap flow:
 *   1. User sends from-tokens to treasury (or approves operator).
 *   2. Operator uses creator's allowance to send to-tokens from treasury to user.
 */
export async function executeSwap(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { userAccountId, serialNumbers, amount } = req.body;

    if (!userAccountId) {
      res.status(400).json({ success: false, error: 'userAccountId is required' });
      return;
    }

    // Load swap program
    const programResult = await pool.query(
      "SELECT * FROM swap_programs WHERE id = $1 AND status = 'active'",
      [id]
    );

    if (programResult.rowCount === 0) {
      res.status(404).json({ success: false, error: 'Swap program not found or not active' });
      return;
    }

    const program = programResult.rows[0];
    const client = getOperatorClient();

    const userAcct = AccountId.fromString(userAccountId);
    const treasuryAcct = AccountId.fromString(program.treasury_account_id);
    const operatorAcct = AccountId.fromString(BACKEND_ACCOUNT_ID!);

    let txId: string | null = null;

    if (program.swap_type === 'nft') {
      if (!serialNumbers || !Array.isArray(serialNumbers) || serialNumbers.length === 0) {
        res.status(400).json({ success: false, error: 'serialNumbers array is required for NFT swaps' });
        return;
      }

      const fromToken = TokenId.fromString(program.from_token_id);
      const toToken = TokenId.fromString(program.to_token_id);

      // Build atomic transfer:
      //   - Move old NFTs from user → treasury (operator uses user's prior allowance)
      //   - Move new NFTs from treasury → user (operator uses creator's prior allowance)
      const transferTx = new TransferTransaction();

      for (const serial of serialNumbers) {
        // Old NFT: user → treasury (approved by user)
        transferTx.addApprovedNftTransfer(new NftId(fromToken, serial), userAcct, treasuryAcct);
        // New NFT: treasury → user (approved by creator for operator)
        transferTx.addApprovedNftTransfer(new NftId(toToken, serial), treasuryAcct, userAcct);
      }

      const frozenTx = await transferTx.freezeWith(client);
      const txResponse = await frozenTx.execute(client);
      const receipt = await txResponse.getReceipt(client);
      txId = txResponse.transactionId.toString();

      // Log the transaction
      await pool.query(
        `INSERT INTO swap_transactions (swap_program_id, user_account_id, serial_numbers, tx_id, status)
         VALUES ($1, $2, $3, $4, 'completed')`,
        [id, userAccountId, serialNumbers, txId]
      );

      res.json({
        success: true,
        txId,
        swapped: serialNumbers.length,
        message: `Successfully swapped ${serialNumbers.length} NFT(s)`,
      });

    } else {
      // Fungible token swap
      if (!amount || amount <= 0) {
        res.status(400).json({ success: false, error: 'amount is required for fungible swaps' });
        return;
      }

      const fromToken = TokenId.fromString(program.from_token_id);
      const toToken = TokenId.fromString(program.to_token_id);

      // Calculate output amount based on rate (rateFrom from-tokens = rateTo to-tokens)
      const outputAmount = BigInt(Math.floor((Number(amount) * Number(program.rate_to)) / Number(program.rate_from)));

      console.log('[executeSwap] fungible swap:', {
        userAccountId,
        fromToken: program.from_token_id,
        toToken: program.to_token_id,
        treasury: program.treasury_account_id,
        amountReceived: amount,
        amountType: typeof amount,
        rateFrom: program.rate_from,
        rateTo: program.rate_to,
        outputAmountCalculated: outputAmount.toString(),
      });

      const transferTx = new TransferTransaction()
        // From-tokens: user → treasury (operator uses user's prior allowance)
        .addApprovedTokenTransfer(fromToken, userAcct, -BigInt(amount))
        .addApprovedTokenTransfer(fromToken, treasuryAcct, BigInt(amount))
        // To-tokens: treasury → user (operator uses creator's prior allowance)
        .addApprovedTokenTransfer(toToken, treasuryAcct, -outputAmount)
        .addApprovedTokenTransfer(toToken, userAcct, outputAmount);

      const frozenTx = await transferTx.freezeWith(client);
      const txResponse = await frozenTx.execute(client);
      await txResponse.getReceipt(client);
      txId = txResponse.transactionId.toString();

      await pool.query(
        `INSERT INTO swap_transactions (swap_program_id, user_account_id, amount, tx_id, status)
         VALUES ($1, $2, $3, $4, 'completed')`,
        [id, userAccountId, amount, txId]
      );

      res.json({
        success: true,
        txId,
        amountIn: amount,
        amountOut: outputAmount.toString(),
        message: `Successfully swapped ${amount} tokens for ${outputAmount} tokens`,
      });
    }
  } catch (err: any) {
    console.error('executeSwap error:', err);

    // Log failed transaction if we have context
    try {
      const { id } = req.params;
      const { userAccountId } = req.body;
      if (id && userAccountId) {
        await pool.query(
          `INSERT INTO swap_transactions (swap_program_id, user_account_id, tx_id, status)
           VALUES ($1, $2, NULL, 'failed')`,
          [id, userAccountId]
        );
      }
    } catch (_) {}

    res.status(500).json({ success: false, error: err.message });
  }
}
