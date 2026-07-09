#!/usr/bin/env node
/**
 * Update NFT Metadata (local private-key signing)
 *
 * This script fixes the on-chain metadata URI of a single NFT serial using
 * TokenUpdateNftsTransaction signed locally with the collection metadata key.
 *
 * Use this when your wallet (e.g. HashPack via WalletConnect) does not yet
 * support TokenUpdateNftsTransaction. The private key never leaves this script
 * or your machine.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const axios = require('axios');
const {
  Client,
  PrivateKey,
  TokenId,
  AccountId,
  TransactionId,
  TokenUpdateNftsTransaction,
  Long,
  Hbar,
} = require('@hashgraph/sdk');

// ============================================================================
// CONFIGURATION
// ============================================================================
const NETWORK = (process.env.NETWORK || 'mainnet').toLowerCase();
const ACCOUNT_ID = process.env.ACCOUNT_ID;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const TOKEN_ID = process.env.TOKEN_ID;
const SERIAL = process.env.SERIAL;
const NEW_NAME = process.env.NEW_NAME;

// Backend that provides /api/pin-metadata-json (defaults to the live Railway app)
const API_BASE_URL =
  process.env.API_BASE_URL || 'https://hedera-creator-kit-production.up.railway.app';

const MIRROR_NODE_URL =
  process.env.VALIDATION_CLOUD_MIRROR_URL ||
  (NETWORK === 'mainnet'
    ? 'https://mainnet-public.mirrornode.hedera.com'
    : 'https://testnet.mirrornode.hedera.com');

// ============================================================================
// HELPERS
// ============================================================================
function base64Decode(str) {
  return Buffer.from(str, 'base64').toString('utf8');
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await axios.get(url, { timeout: 15000 });
      return res.data;
    } catch (err) {
      if (i === attempts - 1) throw err;
      await sleep(1000 * (i + 1));
    }
  }
}

async function pinMetadataJson(metadata) {
  const url = `${API_BASE_URL}/api/pin-metadata-json`;
  console.log(`📌 Pinning updated metadata to IPFS via ${url}...`);

  const res = await axios.post(
    url,
    {
      metadata,
      label: `${metadata.name} - Updated Metadata`,
    },
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: 60000,
    }
  );

  if (!res.data?.success) {
    throw new Error(res.data?.error || 'Pinning failed');
  }

  console.log(`✅ Pinned: ${res.data.tokenURI}`);
  return res.data.tokenURI;
}

async function executeUpdate(tokenId, serial, newMetadataUri) {
  console.log(`⛓️  Building TokenUpdateNftsTransaction for ${tokenId} / serial ${serial}...`);

  const client = NETWORK === 'testnet' ? Client.forTestnet() : Client.forMainnet();

  const privateKey = PrivateKey.fromString(PRIVATE_KEY);
  client.setOperator(AccountId.fromString(ACCOUNT_ID), privateKey);

  const updateTx = new TokenUpdateNftsTransaction()
    .setTokenId(TokenId.fromString(tokenId))
    .setSerialNumbers([Long.fromNumber(parseInt(serial, 10))])
    .setMetadata(Buffer.from(newMetadataUri, 'utf8'))
    .setMaxTransactionFee(new Hbar(2));

  const acctId = AccountId.fromString(ACCOUNT_ID);
  const frozenTx = await updateTx
    .setTransactionId(TransactionId.generate(acctId))
    .freezeWith(client);

  console.log(`🔏 Signing and submitting transaction...`);
  const txResponse = await frozenTx.execute(client);
  const txId = txResponse.transactionId.toString();

  console.log(`📤 Submitted: ${txId}`);
  console.log(`🔗 HashScan: https://hashscan.io/${NETWORK}/transaction/${txId.replace('@', '-')}`);

  return txId;
}

async function pollForConfirmation(txId) {
  const formattedId = txId.replace('@', '-');
  const url = `${MIRROR_NODE_URL}/api/v1/transactions/${formattedId}`;

  console.log(`⏳ Waiting for mirror-node confirmation...`);
  for (let i = 0; i < 20; i++) {
    await sleep(3000);
    try {
      const data = await fetchWithRetry(url, 1);
      const tx = data.transactions?.[0];
      if (tx?.result === 'SUCCESS') {
        console.log(`✅ Confirmed on-chain: ${tx.result}`);
        return;
      }
      if (tx?.result && tx.result !== 'SUCCESS') {
        throw new Error(`Transaction failed: ${tx.result}`);
      }
    } catch (err) {
      if (err.message?.includes('Transaction failed')) throw err;
    }
  }

  throw new Error('Timed out waiting for confirmation. Check HashScan for final status.');
}

// ============================================================================
// MAIN
// ============================================================================
async function main() {
  console.log('='.repeat(70));
  console.log('🛠️  UPDATE NFT METADATA (local signing)');
  console.log('='.repeat(70));
  console.log();

  const missing = [];
  if (!ACCOUNT_ID) missing.push('ACCOUNT_ID');
  if (!PRIVATE_KEY) missing.push('PRIVATE_KEY');
  if (!TOKEN_ID) missing.push('TOKEN_ID');
  if (!SERIAL) missing.push('SERIAL');
  if (!NEW_NAME) missing.push('NEW_NAME');

  if (missing.length > 0) {
    console.log('❌ Missing required environment variables:', missing.join(', '));
    console.log();
    console.log('Create a backend/.env file with:');
    console.log('  ACCOUNT_ID=0.0.123456');
    console.log('  PRIVATE_KEY=302e...');
    console.log('  TOKEN_ID=0.0.10622417');
    console.log('  SERIAL=1502');
    console.log('  NEW_NAME=Hedera Cyclops #1502');
    console.log('  NETWORK=mainnet');
    console.log('  API_BASE_URL=https://your-backend.railway.app   # optional');
    console.log();
    console.log('Then run:   node backend/4-utilities/update_nft_metadata.js');
    console.log();
    process.exit(1);
  }

  try {
    console.log(`🌐 Network: ${NETWORK.toUpperCase()}`);
    console.log(`👤 Account: ${ACCOUNT_ID}`);
    console.log(`🎫 Token:   ${TOKEN_ID}`);
    console.log(`#️⃣  Serial:  ${SERIAL}`);
    console.log(`🏷️  New name: ${NEW_NAME}`);
    console.log();

    // 1. Verify token and fetch current metadata
    console.log('⏳ Fetching token info...');
    const tokenInfo = await fetchWithRetry(`${MIRROR_NODE_URL}/api/v1/tokens/${TOKEN_ID}`);
    if (tokenInfo.type !== 'NON_FUNGIBLE_UNIQUE') {
      throw new Error('Token is not an NFT collection');
    }
    if (!tokenInfo.metadata_key) {
      throw new Error('Collection has no metadata key — cannot update metadata');
    }

    // 2. Fetch account key and verify it matches metadata key
    console.log('⏳ Verifying metadata key ownership...');
    const accountInfo = await fetchWithRetry(`${MIRROR_NODE_URL}/api/v1/accounts/${ACCOUNT_ID}`);
    if (accountInfo.key?.key !== tokenInfo.metadata_key.key) {
      throw new Error('ACCOUNT_ID is not the metadata key for this collection');
    }

    // 3. Fetch current NFT metadata URI
    console.log('⏳ Fetching current NFT metadata...');
    const nftInfo = await fetchWithRetry(
      `${MIRROR_NODE_URL}/api/v1/tokens/${TOKEN_ID}/nfts/${SERIAL}`
    );
    const currentUri = base64Decode(nftInfo.metadata);
    console.log(`   Current URI: ${currentUri}`);

    // 4. Fetch current metadata JSON from IPFS
    console.log('⏳ Fetching metadata JSON from IPFS...');
    const metaUrl = currentUri.replace('ipfs://', 'https://ipfs.io/ipfs/');
    const currentMetadata = await fetchWithRetry(metaUrl);

    // 5. Apply the new name (leave all other fields intact)
    const updatedMetadata = { ...currentMetadata, name: NEW_NAME };
    console.log(`   Updated name: ${updatedMetadata.name}`);

    // 6. Pin updated metadata
    const newMetadataUri = await pinMetadataJson(updatedMetadata);

    // 7. Sign and submit the update transaction
    const txId = await executeUpdate(TOKEN_ID, SERIAL, newMetadataUri);

    // 8. Wait for confirmation
    await pollForConfirmation(txId);

    console.log();
    console.log('='.repeat(70));
    console.log('🎉 Metadata update complete');
    console.log(`🔗 View NFT: https://hashscan.io/${NETWORK}/token/${TOKEN_ID}?serial=${SERIAL}`);
    console.log('='.repeat(70));
  } catch (err) {
    console.error();
    console.error('❌ ERROR:', err.message);
    if (err.response?.data) {
      console.error('   Response:', JSON.stringify(err.response.data, null, 2));
    }
    process.exit(1);
  }
}

main().then(() => process.exit(0));
