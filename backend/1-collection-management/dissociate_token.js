#!/usr/bin/env node
/**
 * Dissociate Token from Account
 * 
 * Removes a token association from an account (removes from wallet view)
 * Useful after deleting a collection to clean up wallet display
 */

require('dotenv').config();
const {
    Client,
    PrivateKey,
    TokenDissociateTransaction,
} = require('@hashgraph/sdk');

// ============================================================================
// CONFIGURATION
// ============================================================================
const NETWORK = process.env.NETWORK || 'testnet';
const ACCOUNT_ID = process.env.ACCOUNT_ID || process.env.TREASURY_ID;
const ACCOUNT_PK = process.env.ACCOUNT_PK || process.env.TREASURY_PK;
const TOKEN_ID_TO_DISSOCIATE = process.env.TOKEN_ID_TO_DISSOCIATE;

// ============================================================================
// VALIDATION
// ============================================================================
if (!ACCOUNT_ID || !ACCOUNT_PK || !TOKEN_ID_TO_DISSOCIATE) {
    console.error('❌ ERROR: Missing required environment variables');
    console.error('   Required: ACCOUNT_ID (or TREASURY_ID), ACCOUNT_PK (or TREASURY_PK), TOKEN_ID_TO_DISSOCIATE');
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

const privateKey = PrivateKey.fromStringED25519(ACCOUNT_PK);
client.setOperator(ACCOUNT_ID, privateKey);

// ============================================================================
// MAIN FUNCTION
// ============================================================================
async function dissociateToken() {
    console.log('='.repeat(70));
    console.log('🔌 DISSOCIATING TOKEN FROM ACCOUNT');
    console.log('='.repeat(70));
    console.log();
    console.log(`🌐 Network: ${NETWORK.toUpperCase()}`);
    console.log(`🎫 Token ID: ${TOKEN_ID_TO_DISSOCIATE}`);
    console.log(`📍 Account: ${ACCOUNT_ID}`);
    console.log();
    console.log('💡 This will remove the token from your wallet view.');
    console.log('   The token must be deleted first, or you must have 0 balance.');
    console.log();
    console.log('⏳ Dissociating token...');
    
    try {
        const dissociateTx = new TokenDissociateTransaction()
            .setAccountId(ACCOUNT_ID)
            .setTokenIds([TOKEN_ID_TO_DISSOCIATE]);
        
        const txResponse = await dissociateTx.execute(client);
        const receipt = await txResponse.getReceipt(client);
        
        console.log();
        console.log('='.repeat(70));
        console.log('✅ TOKEN DISSOCIATED SUCCESSFULLY!');
        console.log('='.repeat(70));
        console.log();
        console.log(`🎫 Token ID: ${TOKEN_ID_TO_DISSOCIATE}`);
        console.log(`📝 Status: ${receipt.status.toString()}`);
        console.log(`🔗 Transaction: https://hashscan.io/${NETWORK}/transaction/${txResponse.transactionId.toString()}`);
        console.log();
        console.log('💡 The token should now be removed from your wallet view.');
        console.log('   You may need to refresh your wallet (1-2 minutes).');
        console.log();
        
    } catch (error) {
        console.error();
        console.error('❌ ERROR dissociating token:');
        console.error(error.message);
        
        if (error.message.includes('TRANSACTION_REQUIRES_ZERO_TOKEN_BALANCES')) {
            console.error('💡 TIP: You must have 0 balance of this token to dissociate.');
            console.error('   Transfer or burn all NFTs first.');
        } else if (error.message.includes('TOKEN_NOT_ASSOCIATED_TO_ACCOUNT')) {
            console.error('💡 TIP: This token is not associated with the account.');
        }
        
        process.exit(1);
    }
}

dissociateToken().then(() => process.exit(0));

