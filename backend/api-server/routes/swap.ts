import { Request, Response } from 'express';
import {
  Client,
  Hbar,
  PrivateKey,
  AccountId,
  TokenId,
  NftId,
  TransferTransaction,
  Transaction,
  TransactionId,
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
    pk = PrivateKey.fromStringED25519(BACKEND_PRIVATE_KEY);
  }
  client.setOperator(BACKEND_ACCOUNT_ID, pk);
  return client;
}

function getOperatorKey(): PrivateKey {
  if (!BACKEND_PRIVATE_KEY) throw new Error('Backend operator account not configured');
  try {
    return PrivateKey.fromStringECDSA(BACKEND_PRIVATE_KEY);
  } catch {
    return PrivateKey.fromStringED25519(BACKEND_PRIVATE_KEY);
  }
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
export async function listPublicSwapPrograms(_req: Request, res: Response): Promise<void> {
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

// ─── PUBLIC: Prepare a fungible swap (step 1 of 2) ──────────────────────────

/**
 * POST /api/swap-programs/:id/prepare
 *
 * Fungible swap — step 1 of 2.
 *
 * Builds an atomic TransferTransaction and returns the UNSIGNED frozen bytes
 * to the dApp. The operator does NOT sign here — it signs last in /submit
 * after the user's signature has been collected, which avoids wallets
 * stripping pre-existing signatures during their own signing step.
 *
 * The dApp must then:
 *   1. Deserialise the bytes: Transaction.fromBytes(...)
 *   2. Have the user sign-only in their wallet (signer.signTransaction, NOT executeWithSigner)
 *      — the user's signature authorises the FROM-token debit AND the HBAR reimbursement.
 *   3. POST the user-signed bytes to /api/swap-programs/:id/submit
 *
 * Fee responsibility:
 *   Hedera requires the approved SPENDER (operator) to be the TransactionId payer.
 *   The operator nominally pays the network fee, but the transaction includes a small
 *   HBAR transfer (user → operator, ~0.01 HBAR) so the user reimburses the operator.
 *   Net cost to the operator: zero.
 *
 * Body:  { userAccountId: string, amount: string | number }  (amount in raw units)
 * Returns: { success, txBytes, txId, amountIn, amountOut, fromToken, toToken }
 */
export async function prepareSwap(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { userAccountId, amount } = req.body;

    if (!userAccountId || amount == null) {
      res.status(400).json({ success: false, error: 'userAccountId and amount are required' });
      return;
    }

    const programResult = await pool.query(
      "SELECT * FROM swap_programs WHERE id = $1 AND status = 'active'",
      [id]
    );

    if (programResult.rowCount === 0) {
      res.status(404).json({ success: false, error: 'Swap program not found or not active' });
      return;
    }

    const program = programResult.rows[0];

    if (program.swap_type !== 'fungible') {
      res.status(400).json({ success: false, error: '/prepare is only supported for fungible token swaps' });
      return;
    }

    const client = getOperatorClient();

    const userAcct = AccountId.fromString(userAccountId);
    const treasuryAcct = AccountId.fromString(program.treasury_account_id);

    const fromToken = TokenId.fromString(program.from_token_id);
    const toToken = TokenId.fromString(program.to_token_id);

    const rawAmount = BigInt(amount);
    const outputAmount = BigInt(
      Math.floor((Number(rawAmount) * Number(program.rate_to)) / Number(program.rate_from))
    );

    // Hedera protocol requirement: when using addApprovedTokenTransfer, the approved
    // SPENDER must be the TransactionId payer. The operator (0.0.9348822) holds the
    // treasury's token allowance and is therefore the spender — so the operator must
    // be the payer account in the TransactionId.
    //
    // To keep the operator whole, the user reimburses the operator for the network fee
    // via a small HBAR transfer included in this same atomic transaction. The user's
    // wallet signature covers both the FROM-token debit and the HBAR reimbursement.
    //
    // Transaction legs:
    //   1. FROM tokens (user → treasury):   standard transfer, user signs
    //   2. TO tokens (treasury → user):     approved transfer, operator signs (uses allowance)
    //   3. HBAR reimbursement (user → operator): covers the operator's network fee
    const operatorAcct = AccountId.fromString(BACKEND_ACCOUNT_ID!);
    const HBAR_REIMBURSEMENT = new Hbar(0.01); // ~$0.003 — covers typical swap tx fee

    const transferTx = new TransferTransaction()
      .addTokenTransfer(fromToken, userAcct, -rawAmount)
      .addTokenTransfer(fromToken, treasuryAcct, rawAmount)
      .addApprovedTokenTransfer(toToken, treasuryAcct, -outputAmount)
      .addTokenTransfer(toToken, userAcct, outputAmount)
      .addHbarTransfer(userAcct, HBAR_REIMBURSEMENT.negated())
      .addHbarTransfer(operatorAcct, HBAR_REIMBURSEMENT)
      // Operator is the TransactionId payer (Hedera requirement for approved transfers).
      .setTransactionId(TransactionId.generate(operatorAcct))
      // Pin to a single node so the wallet receives exactly one transaction version.
      // Without this, the SDK creates one version per node; the wallet signs only one,
      // and if the backend submits to a different node the signatures won't match.
      .setNodeAccountIds([new AccountId(3)]);

    const frozenTx = transferTx.freezeWith(client);

    // Return unsigned bytes — operator signs LAST in /submit after the user
    // has signed, so wallet signing cannot strip the operator signature.
    const txBytes = Buffer.from(frozenTx.toBytes()).toString('base64');
    const txId = frozenTx.transactionId!.toString();

    res.json({
      success: true,
      txBytes,
      txId,
      amountIn: rawAmount.toString(),
      amountOut: outputAmount.toString(),
      fromToken: program.from_token_id,
      toToken: program.to_token_id,
    });
  } catch (err: any) {
    console.error('prepareSwap error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

// ─── PUBLIC: Submit a signed fungible swap (step 2 of 2) ────────────────────

/**
 * POST /api/swap-programs/:id/submit
 *
 * Fungible swap — step 2 of 2.
 *
 * Receives user-signed transaction bytes from the dApp. The operator signs
 * last here (preserving the user's signature), then submits to Hedera.
 * Signing order: user first (wallet) → operator last (backend) → submit.
 *
 * HBAR fee is nominally charged to the operator (TransactionId payer), but the
 * transaction includes a user→operator reimbursement transfer so the net cost
 * to the operator is zero.
 *
 * Body:  { txBytes: string, userAccountId: string, amount: string | number }
 * Returns: { success, txId }
 */
export async function submitSwap(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { txBytes, userAccountId, amount } = req.body;

    if (!txBytes || !userAccountId) {
      res.status(400).json({ success: false, error: 'txBytes and userAccountId are required' });
      return;
    }

    const txBuf = Buffer.from(txBytes, 'base64');
    const tx = Transaction.fromBytes(txBuf);

    const client = getOperatorClient();
    const operatorPk = getOperatorKey();

    // Operator signs last — user's signature is already in the bytes.
    // This authorises the approved TO-token transfer using the creator's allowance.
    const signedTx = await tx.sign(operatorPk);
    const txResponse = await signedTx.execute(client);
    await txResponse.getReceipt(client);
    const txId = txResponse.transactionId.toString();

    await pool.query(
      `INSERT INTO swap_transactions (swap_program_id, user_account_id, amount, tx_id, status)
       VALUES ($1, $2, $3, $4, 'completed')`,
      [id, userAccountId, amount || null, txId]
    );

    res.json({ success: true, txId });
  } catch (err: any) {
    console.error('submitSwap error:', err);

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

// ─── PUBLIC: Execute a swap — legacy NFT flow ───────────────────────────────

/**
 * POST /api/swap-programs/:id/execute
 *
 * NFT swap flow (operator-executed, requires user pre-approved NFT allowances):
 *   1. User has already approved their old NFT serials to the treasury (done client-side).
 *   2. Operator transfers new NFTs from treasury → user (creator's allowance).
 *   3. Operator transfers old NFTs from user → treasury (user's NFT allowance).
 *
 * Fungible swaps should use /prepare + /submit instead, which does not require
 * a pre-approved user allowance and correctly charges the HBAR fee to the user.
 */
export async function executeSwap(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { userAccountId, serialNumbers } = req.body;

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

    let txId: string | null = null;

    if (program.swap_type === 'nft') {
      if (!serialNumbers || !Array.isArray(serialNumbers) || serialNumbers.length === 0) {
        res.status(400).json({ success: false, error: 'serialNumbers array is required for NFT swaps' });
        return;
      }

      const fromToken = TokenId.fromString(program.from_token_id);
      const toToken = TokenId.fromString(program.to_token_id);

      const transferTx = new TransferTransaction();

      for (const serial of serialNumbers) {
        // Old NFT: user → treasury (approved by user)
        transferTx.addApprovedNftTransfer(new NftId(fromToken, serial), userAcct, treasuryAcct);
        // New NFT: treasury → user (approved by creator for operator)
        transferTx.addApprovedNftTransfer(new NftId(toToken, serial), treasuryAcct, userAcct);
      }

      const frozenTx = transferTx.freezeWith(client);
      const txResponse = await frozenTx.execute(client);
      await txResponse.getReceipt(client);
      txId = txResponse.transactionId.toString();

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
      // Fungible: redirect callers to the /prepare + /submit flow
      res.status(400).json({
        success: false,
        error: 'Fungible swaps must use POST /prepare then POST /submit. See API docs.',
      });
    }
  } catch (err: any) {
    console.error('executeSwap error:', err);

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
