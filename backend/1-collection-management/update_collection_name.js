#!/usr/bin/env node
/**
 * Update NFT Collection Name
 * 
 * IMPORTANT: Requires Admin Key to sign the transaction
 * This script updates the name of an existing NFT collection
 */

require('dotenv').config();
const {
    Client,
    PrivateKey,
    TokenUpdateTransaction,
} = require('@hashgraph/sdk');

// ============================================================================
// CONFIGURATION
// ============================================================================
const NETWORK = process.env.NETWORK || 'testnet';
const TREASURY_ID = process.env.TREASURY_ID;
const TOKEN_ID = process.env.TOKEN_ID;
const ADMIN_PRIVATE_KEY = process.env.ADMIN_PRIVATE_KEY || process.env.TREASURY_PK;
const NEW_TOKEN_NAME = process.env.NEW_TOKEN_NAME;

// ============================================================================
// VALIDATION
// ============================================================================
if (!TREASURY_ID || !TOKEN_ID || !ADMIN_PRIVATE_KEY || !NEW_TOKEN_NAME) {
    console.error('❌ ERROR: Missing required environment variables');
    console.error('   Required: TREASURY_ID, TOKEN_ID, ADMIN_PRIVATE_KEY, NEW_TOKEN_NAME');
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

client.setOperator(TREASURY_ID, PrivateKey.fromStringED25519(ADMIN_PRIVATE_KEY));

// ============================================================================
// MAIN FUNCTION
// ============================================================================
async function updateCollectionName() {
    console.log('='.repeat(70));
    console.log('🔄 UPDATING NFT COLLECTION NAME');
    console.log('='.repeat(70));
    console.log();
    console.log(`🌐 Network: ${NETWORK.toUpperCase()}`);
    console.log(`🎫 Token ID: ${TOKEN_ID}`);
    console.log(`📝 New Name: "${NEW_TOKEN_NAME}"`);
    console.log();
    console.log('⚠️  WARNING: This will update the token name on the hashgraph');
    console.log('   This action cannot be undone.');
    console.log();
    console.log('Press Ctrl+C to cancel, or wait 5 seconds to continue...');
    
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    console.log();
    console.log('⏳ Creating token update transaction...');

    try {
        const tokenUpdateTx = new TokenUpdateTransaction()
            .setTokenId(TOKEN_ID)
            .setTokenName(NEW_TOKEN_NAME);

        console.log('⏳ Freezing transaction...');
        const frozenTx = await tokenUpdateTx.freezeWith(client);

        console.log('⏳ Signing with admin key...');
        const signedTx = await frozenTx.sign(PrivateKey.fromStringED25519(ADMIN_PRIVATE_KEY));

        console.log('⏳ Executing transaction...');
        const txResponse = await signedTx.execute(client);

        console.log('⏳ Getting receipt...');
        const receipt = await txResponse.getReceipt(client);

        console.log();
        console.log('='.repeat(70));
        console.log('✅ TOKEN NAME UPDATED SUCCESSFULLY!');
        console.log('='.repeat(70));
        console.log();
        console.log(`🎫 Token ID: ${TOKEN_ID}`);
        console.log(`📝 New Name: "${NEW_TOKEN_NAME}"`);
        console.log(`✅ Status: ${receipt.status.toString()}`);
        console.log(`🔗 Transaction ID: ${txResponse.transactionId.toString()}`);
        console.log();
        console.log('📋 Verification:');
        console.log(`   View on HashScan: https://hashscan.io/${NETWORK}/token/${TOKEN_ID}`);
        console.log();

    } catch (error) {
        console.error();
        console.error('❌ ERROR updating token name:');
        console.error(error.message);
        
        if (error.message.includes('INVALID_SIGNATURE')) {
            console.error('💡 TIP: The admin key signature is invalid.');
            console.error('   Make sure you\'re using the correct admin private key.');
        } else if (error.message.includes('INVALID_TOKEN_ID')) {
            console.error('💡 TIP: The token ID is invalid or does not exist.');
        }
        
        process.exit(1);
    }
}

updateCollectionName().then(() => process.exit(0));

