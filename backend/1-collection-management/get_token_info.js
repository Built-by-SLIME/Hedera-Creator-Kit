#!/usr/bin/env node
/**
 * Get Token Information from Hedera
 * 
 * Queries detailed information about a token/collection including:
 * - Name, symbol, supply
 * - Keys configuration
 * - Custom fees/royalties
 * - Sample NFT metadata
 */

require('dotenv').config();
const {
    Client,
    PrivateKey,
    TokenInfoQuery,
    TokenNftInfoQuery,
} = require('@hashgraph/sdk');

// ============================================================================
// CONFIGURATION
// ============================================================================
const NETWORK = process.env.NETWORK || 'testnet';
const TOKEN_ID = process.env.TOKEN_ID;
const TREASURY_ID = process.env.TREASURY_ID;
const TREASURY_PK = process.env.TREASURY_PK;

// ============================================================================
// VALIDATION
// ============================================================================
if (!TOKEN_ID) {
    console.error('❌ ERROR: Missing TOKEN_ID in .env file');
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

// Set operator if credentials provided
if (TREASURY_ID && TREASURY_PK) {
    client.setOperator(TREASURY_ID, PrivateKey.fromStringED25519(TREASURY_PK));
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================
async function getTokenInfo() {
    console.log('='.repeat(70));
    console.log('🔍 QUERYING TOKEN INFORMATION');
    console.log('='.repeat(70));
    console.log();
    console.log(`🌐 Network: ${NETWORK.toUpperCase()}`);
    console.log(`🎫 Token ID: ${TOKEN_ID}`);
    console.log();
    
    try {
        console.log('⏳ Fetching token information...');
        
        const tokenInfo = await new TokenInfoQuery()
            .setTokenId(TOKEN_ID)
            .execute(client);
        
        console.log();
        console.log('='.repeat(70));
        console.log('📋 TOKEN INFORMATION');
        console.log('='.repeat(70));
        console.log(`Token ID: ${tokenInfo.tokenId.toString()}`);
        console.log(`Name: ${tokenInfo.name}`);
        console.log(`Symbol: ${tokenInfo.symbol}`);
        console.log(`Token Type: ${tokenInfo.tokenType.toString()}`);
        console.log(`Total Supply: ${tokenInfo.totalSupply.toString()}`);
        console.log(`Max Supply: ${tokenInfo.maxSupply.toString()}`);
        console.log(`Treasury Account: ${tokenInfo.treasuryAccountId.toString()}`);
        console.log(`Decimals: ${tokenInfo.decimals}`);
        console.log();
        
        console.log('🔑 KEYS CONFIGURATION:');
        console.log(`Admin Key: ${tokenInfo.adminKey ? '✅ SET' : '❌ NOT SET'}`);
        console.log(`Supply Key: ${tokenInfo.supplyKey ? '✅ SET' : '❌ NOT SET'}`);
        console.log(`Freeze Key: ${tokenInfo.freezeKey ? '✅ SET' : '❌ NOT SET'}`);
        console.log(`Wipe Key: ${tokenInfo.wipeKey ? '✅ SET' : '❌ NOT SET'}`);
        console.log(`KYC Key: ${tokenInfo.kycKey ? '✅ SET' : '❌ NOT SET'}`);
        console.log(`Pause Key: ${tokenInfo.pauseKey ? '✅ SET' : '❌ NOT SET'}`);
        console.log(`Fee Schedule Key: ${tokenInfo.feeScheduleKey ? '✅ SET' : '❌ NOT SET'}`);
        console.log(`Metadata Key: ${tokenInfo.metadataKey ? '✅ SET' : '❌ NOT SET'}`);
        console.log();
        
        console.log('💰 CUSTOM FEES:');
        if (tokenInfo.customFees && tokenInfo.customFees.length > 0) {
            tokenInfo.customFees.forEach((fee, index) => {
                console.log(`Fee ${index + 1}:`, JSON.stringify(fee, null, 2));
            });
        } else {
            console.log('❌ NO CUSTOM FEES SET');
        }
        console.log();
        
        // Try to get first NFT metadata
        if (parseInt(tokenInfo.totalSupply.toString()) > 0) {
            console.log('='.repeat(70));
            console.log('📄 SAMPLE NFT METADATA (Serial #1)');
            console.log('='.repeat(70));
            
            try {
                const nftInfo = await new TokenNftInfoQuery()
                    .setNftId(`${TOKEN_ID}/1`)
                    .execute(client);

                console.log(`Serial Number: ${nftInfo[0].nftId.serial.toString()}`);
                console.log(`Account ID: ${nftInfo[0].accountId.toString()}`);
                console.log(`Metadata: ${Buffer.from(nftInfo[0].metadata).toString('utf8')}`);
                console.log();
            } catch (error) {
                console.log('Could not fetch NFT #1 metadata:', error.message);
            }
        }
        
        console.log('='.repeat(70));
        console.log('🔗 View on HashScan:');
        console.log(`   https://hashscan.io/${NETWORK}/token/${TOKEN_ID}`);
        console.log('='.repeat(70));
        console.log();
        
    } catch (error) {
        console.error();
        console.error('❌ ERROR querying token:');
        console.error(error.message);
        process.exit(1);
    }
}

getTokenInfo().then(() => process.exit(0));

