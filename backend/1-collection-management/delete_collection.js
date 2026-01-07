#!/usr/bin/env node
/**
 * Delete NFT Collection
 * 
 * Permanently deletes a token collection from Hedera
 * IMPORTANT: This action cannot be undone!
 */

require('dotenv').config();
const {
    Client,
    PrivateKey,
    TokenDeleteTransaction,
} = require('@hashgraph/sdk');

// ============================================================================
// CONFIGURATION
// ============================================================================
const NETWORK = process.env.NETWORK || 'testnet';
const TREASURY_ID = process.env.TREASURY_ID;
const TREASURY_PK = process.env.TREASURY_PK;
const TOKEN_ID_TO_DELETE = process.env.TOKEN_ID_TO_DELETE;

// ============================================================================
// VALIDATION
// ============================================================================
if (!TREASURY_ID || !TREASURY_PK || !TOKEN_ID_TO_DELETE) {
    console.error('❌ ERROR: Missing required environment variables');
    console.error('   Required: TREASURY_ID, TREASURY_PK, TOKEN_ID_TO_DELETE');
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
async function deleteToken() {
    console.log('='.repeat(70));
    console.log('🗑️  DELETING NFT COLLECTION');
    console.log('='.repeat(70));
    console.log();
    console.log(`🌐 Network: ${NETWORK.toUpperCase()}`);
    console.log(`🎫 Token ID to Delete: ${TOKEN_ID_TO_DELETE}`);
    console.log(`📍 Treasury: ${TREASURY_ID}`);
    console.log();
    console.log('⚠️  WARNING: This will permanently delete the token!');
    console.log('   All NFTs in this collection will be burned.');
    console.log('   This action CANNOT be undone.');
    console.log();
    console.log('Press Ctrl+C to cancel, or wait 10 seconds to continue...');
    
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    console.log();
    console.log('⏳ Deleting token...');
    
    try {
        const deleteTx = new TokenDeleteTransaction()
            .setTokenId(TOKEN_ID_TO_DELETE);
        
        const txResponse = await deleteTx.execute(client);
        const receipt = await txResponse.getReceipt(client);
        
        console.log();
        console.log('='.repeat(70));
        console.log('✅ TOKEN DELETED SUCCESSFULLY!');
        console.log('='.repeat(70));
        console.log();
        console.log(`🎫 Deleted Token ID: ${TOKEN_ID_TO_DELETE}`);
        console.log(`📝 Status: ${receipt.status.toString()}`);
        console.log(`🔗 Transaction: https://hashscan.io/${NETWORK}/transaction/${txResponse.transactionId.toString()}`);
        console.log();
        console.log('💡 The token and all NFTs have been permanently deleted.');
        console.log('   To remove from wallet view, use dissociate_token.js');
        console.log();
        
    } catch (error) {
        console.error();
        console.error('❌ ERROR deleting token:');
        console.error(error.message);
        
        if (error.message.includes('TOKEN_WAS_DELETED')) {
            console.error('💡 TIP: This token has already been deleted.');
        } else if (error.message.includes('INVALID_TOKEN_ID')) {
            console.error('💡 TIP: The token ID is invalid or does not exist.');
        }
        
        process.exit(1);
    }
}

deleteToken().then(() => process.exit(0));

