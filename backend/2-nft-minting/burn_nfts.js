#!/usr/bin/env node
/**
 * Burn NFTs from Collection
 *
 * Burns all NFTs from a collection in batches
 * Useful for cleaning up test collections or removing unwanted NFTs
 */

require('dotenv').config();
const {
    Client,
    PrivateKey,
    TokenBurnTransaction,
    TokenInfoQuery,
} = require('@hashgraph/sdk');

// ============================================================================
// CONFIGURATION
// ============================================================================
const NETWORK = process.env.NETWORK || 'testnet';
const TREASURY_ID = process.env.TREASURY_ID;
const TREASURY_PK = process.env.TREASURY_PK;
const TOKEN_ID_TO_BURN = process.env.TOKEN_ID_TO_BURN;
const BATCH_SIZE = parseInt(process.env.BURN_BATCH_SIZE || '10');

// ============================================================================
// VALIDATION
// ============================================================================
if (!TREASURY_ID || !TREASURY_PK || !TOKEN_ID_TO_BURN) {
    console.error('❌ ERROR: Missing required environment variables');
    console.error('   Required: TREASURY_ID, TREASURY_PK, TOKEN_ID_TO_BURN');
    console.error('   Optional: BURN_BATCH_SIZE (default: 10)');
    process.exit(1);
}

// ============================================================================
// INITIALIZE HEDERA CLIENT
// ============================================================================
let client;
if (NETWORK.toLowerCase() === 'mainnet') {
    client = Client.forMainnet();
} else {
    client = Client.forTestnet();
}

const privateKey = PrivateKey.fromStringED25519(TREASURY_PK);
client.setOperator(TREASURY_ID, privateKey);

// ============================================================================
// MAIN FUNCTION
// ============================================================================
async function burnNFTs() {
    console.log('=' .repeat(70));
    console.log('🔥 BURNING NFTs FROM COLLECTION');
    console.log('=' .repeat(70));
    console.log();
    console.log(`🌐 Network: ${NETWORK.toUpperCase()}`);
    console.log(`🎫 Token ID: ${TOKEN_ID_TO_BURN}`);
    console.log(`📍 Treasury: ${TREASURY_ID}`);
    console.log(`📦 Batch Size: ${BATCH_SIZE} NFTs per transaction`);
    console.log();
    console.log('⚠️  WARNING: This will permanently burn all NFTs in this collection!');
    console.log('   This action CANNOT be undone.');
    console.log();
    console.log('Press Ctrl+C to cancel, or wait 10 seconds to continue...');

    await new Promise(resolve => setTimeout(resolve, 10000));
    console.log();

    try {
        // Get total supply
        console.log('⏳ Checking total supply...');
        const tokenInfo = await new TokenInfoQuery()
            .setTokenId(TOKEN_ID_TO_BURN)
            .execute(client);

        const totalSupply = parseInt(tokenInfo.totalSupply.toString());
        console.log(`📊 Total Supply: ${totalSupply} NFTs`);
        console.log();

        if (totalSupply === 0) {
            console.log('✅ No NFTs to burn - collection is empty');
            return;
        }

        // Burn all serials in batches
        console.log(`🔥 Burning ${totalSupply} NFTs in batches of ${BATCH_SIZE}...`);
        console.log();

        let totalBurned = 0;

        for (let i = 1; i <= totalSupply; i += BATCH_SIZE) {
            const batchEnd = Math.min(i + BATCH_SIZE - 1, totalSupply);
            const serials = [];

            for (let serial = i; serial <= batchEnd; serial++) {
                serials.push(serial);
            }

            console.log(`🔥 Burning serials ${i}-${batchEnd}...`);

            const burnTx = new TokenBurnTransaction()
                .setTokenId(TOKEN_ID_TO_BURN)
                .setSerials(serials);

            const txResponse = await burnTx.execute(client);
            await txResponse.getReceipt(client);

            totalBurned += serials.length;
            console.log(`   ✅ Burned ${serials.length} NFTs (Total: ${totalBurned}/${totalSupply})`);

            // Small delay between batches
            if (i + BATCH_SIZE <= totalSupply) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        console.log();
        console.log('=' .repeat(70));
        console.log('✅ BURN COMPLETE!');
        console.log('=' .repeat(70));
        console.log();
        console.log(`🔥 Burned ${totalBurned} NFTs`);
        console.log(`🎫 Token ID: ${TOKEN_ID_TO_BURN}`);
        console.log(`📊 New Total Supply: 0`);
        console.log();
        console.log('💡 Next Steps:');
        console.log('   1. Delete the collection with delete_collection.js');
        console.log('   2. Dissociate from wallet with dissociate_token.js');
        console.log();

    } catch (error) {
        console.error();
        console.error('❌ ERROR burning NFTs:');
        console.error(error.message);

        if (error.message.includes('INVALID_TOKEN_ID')) {
            console.error('💡 TIP: The token ID is invalid or does not exist.');
        } else if (error.message.includes('INVALID_SIGNATURE')) {
            console.error('💡 TIP: Supply Key is not set correctly or signature is invalid.');
        }

        process.exit(1);
    }
}

// ============================================================================
// RUN THE SCRIPT
// ============================================================================
burnNFTs().then(() => process.exit(0));

