/**
 * ONE-TIME Makeup Drip — April 21, 2026
 *
 * Sends missed SLIME rewards to 60 accounts that were skipped during the
 * April 21 automated cron due to the April 14 manual trigger timing issue.
 *
 * Safe to run once. Does NOT touch existing staking logic.
 * Delete this file after use.
 *
 * Required env vars (already set in Railway):
 *   BACKEND_ACCOUNT_ID or TREASURY_ID  — operator account
 *   BACKEND_PRIVATE_KEY or TREASURY_PK — operator private key
 *   DATABASE_URL                        — postgres connection string
 */

'use strict';

const { Client, AccountId, PrivateKey, TransferTransaction, TokenId } = require('@hashgraph/sdk');
const { Pool } = require('pg');
require('dotenv').config();

// ── Config ────────────────────────────────────────────────────────────────────
const PROGRAM_ID    = '8345ebe8-978a-493d-8fbd-86ebcb4c7266';
const REWARD_TOKEN  = '0.0.10294707';   // $SLIME reward token
const TREASURY_ID   = '0.0.9463056';    // SLIME treasury
const DECIMALS      = 8;                // reward token decimals
const OPERATOR_ID   = process.env.BACKEND_ACCOUNT_ID || process.env.TREASURY_ID;
const OPERATOR_KEY  = process.env.BACKEND_PRIVATE_KEY || process.env.TREASURY_PK;

// ── Accounts owed (from DB query — April 14 credits not paid on April 21) ────
const MAKEUPS = [
  { account: '0.0.9278114',   serials: 160, slime: 11200 },
  { account: '0.0.10261541',  serials: 63,  slime: 4410  },
  { account: '0.0.7689965',   serials: 56,  slime: 3920  },
  { account: '0.0.10022142',  serials: 42,  slime: 2940  },
  { account: '0.0.8267043',   serials: 32,  slime: 2240  },
  { account: '0.0.7716723',   serials: 30,  slime: 2100  },
  { account: '0.0.9839675',   serials: 24,  slime: 1680  },
  { account: '0.0.2151958',   serials: 24,  slime: 1680  },
  { account: '0.0.8128261',   serials: 21,  slime: 1470  },
  { account: '0.0.10416623',  serials: 20,  slime: 1400  },
  { account: '0.0.8575949',   serials: 20,  slime: 1400  },
  { account: '0.0.9601762',   serials: 19,  slime: 1330  },
  { account: '0.0.3034619',   serials: 18,  slime: 1260  },
  { account: '0.0.6863053',   serials: 16,  slime: 1120  },
  { account: '0.0.9935406',   serials: 16,  slime: 1120  },
  { account: '0.0.9206155',   serials: 11,  slime: 770   },
  { account: '0.0.2208114',   serials: 11,  slime: 770   },
  { account: '0.0.2104123',   serials: 10,  slime: 700   },
  { account: '0.0.8148901',   serials: 10,  slime: 700   },
  { account: '0.0.8576477',   serials: 10,  slime: 700   },
  { account: '0.0.1498096',   serials: 9,   slime: 630   },
  { account: '0.0.8267927',   serials: 6,   slime: 420   },
  { account: '0.0.10375194',  serials: 6,   slime: 420   },
  { account: '0.0.700278',    serials: 4,   slime: 280   },
  { account: '0.0.6418235',   serials: 4,   slime: 280   },
  { account: '0.0.10308572',  serials: 4,   slime: 280   },
  { account: '0.0.1421971',   serials: 4,   slime: 280   },
  { account: '0.0.8426856',   serials: 4,   slime: 280   },
  { account: '0.0.706113',    serials: 3,   slime: 210   },
  { account: '0.0.857520',    serials: 3,   slime: 210   },
  { account: '0.0.1320188',   serials: 3,   slime: 210   },
  { account: '0.0.8041796',   serials: 3,   slime: 210   },
  { account: '0.0.9275746',   serials: 3,   slime: 210   },
  { account: '0.0.8182572',   serials: 3,   slime: 210   },
  { account: '0.0.4596910',   serials: 2,   slime: 140   },
  { account: '0.0.9656742',   serials: 2,   slime: 140   },
  { account: '0.0.2148853',   serials: 2,   slime: 140   },
  { account: '0.0.4318004',   serials: 2,   slime: 140   },
  { account: '0.0.875021',    serials: 2,   slime: 140   },
  { account: '0.0.689034',    serials: 2,   slime: 140   },
  { account: '0.0.8062484',   serials: 2,   slime: 140   },
  { account: '0.0.8581828',   serials: 2,   slime: 140   },
  { account: '0.0.9374032',   serials: 2,   slime: 140   },
  { account: '0.0.1106087',   serials: 2,   slime: 140   },
  { account: '0.0.2209527',   serials: 1,   slime: 70    },
  { account: '0.0.3915640',   serials: 1,   slime: 70    },
  { account: '0.0.1471318',   serials: 1,   slime: 70    },
  { account: '0.0.10295442',  serials: 1,   slime: 70    },
  { account: '0.0.4649512',   serials: 1,   slime: 70    },
  { account: '0.0.1098804',   serials: 1,   slime: 70    },
  { account: '0.0.10433396',  serials: 1,   slime: 70    },
  { account: '0.0.7893913',   serials: 1,   slime: 70    },
  { account: '0.0.7861616',   serials: 1,   slime: 70    },
  { account: '0.0.4596897',   serials: 1,   slime: 70    },
  { account: '0.0.10255900',  serials: 1,   slime: 70    },
  { account: '0.0.8412942',   serials: 1,   slime: 70    },
  { account: '0.0.1338227',   serials: 1,   slime: 70    },
  { account: '0.0.1285385',   serials: 1,   slime: 70    },
  { account: '0.0.9316549',   serials: 1,   slime: 70    },
  { account: '0.0.6280558',   serials: 1,   slime: 70    },
];


// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!OPERATOR_ID || !OPERATOR_KEY) {
    console.error('ERROR: Missing BACKEND_ACCOUNT_ID/TREASURY_ID or BACKEND_PRIVATE_KEY/TREASURY_PK');
    process.exit(1);
  }

  const client = Client.forMainnet();
  client.setOperator(AccountId.fromString(OPERATOR_ID), PrivateKey.fromString(OPERATOR_KEY));

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('railway') ? { rejectUnauthorized: false } : false,
  });

  const total = MAKEUPS.reduce((sum, m) => sum + m.slime, 0);
  console.log('═══════════════════════════════════════════════════════════');
  console.log('SLIME Makeup Drip — April 21, 2026');
  console.log(`Accounts: ${MAKEUPS.length} | Total SLIME: ${total}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  let success = 0, failed = 0;

  for (const { account, serials, slime } of MAKEUPS) {
    const rawAmount = slime * Math.pow(10, DECIMALS);
    try {
      const tx = new TransferTransaction()
        .addApprovedTokenTransfer(TokenId.fromString(REWARD_TOKEN), TREASURY_ID, -rawAmount)
        .addApprovedTokenTransfer(TokenId.fromString(REWARD_TOKEN), account, rawAmount)
        .setTransactionMemo('makeup-drip-2026-04-21');

      const frozen  = tx.freezeWith(client);
      const signed  = await frozen.sign(PrivateKey.fromString(OPERATOR_KEY));
      const resp    = await signed.execute(client);
      await resp.getReceipt(client);
      const txId = resp.transactionId.toString();

      await pool.query(
        `INSERT INTO staking_distributions (program_id, account_id, amount, units_held, tx_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [PROGRAM_ID, account, slime, serials, txId]
      );

      console.log(`✓ [${account}] Sent ${slime} SLIME (${serials} NFTs) — tx: ${txId}`);
      success++;
    } catch (err) {
      console.error(`✗ [${account}] FAILED: ${err.message}`);
      failed++;
    }
  }

  await pool.end();
  client.close();

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`DONE — Success: ${success} | Failed: ${failed}`);
  console.log('═══════════════════════════════════════════════════════════');

  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
