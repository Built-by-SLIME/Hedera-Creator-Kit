#!/usr/bin/env node
/**
 * Create NFT Collection on Hedera
 * 
 * This script creates a new NFT collection with configurable:
 * - Token name, symbol, max supply
 * - Royalty fees (optional)
 * - Admin, Supply, Metadata keys
 * - Network (mainnet/testnet)
 */

require('dotenv').config();
const {
    Client,
    PrivateKey,
    TokenCreateTransaction,
    TokenType,
    TokenSupplyType,
    CustomRoyaltyFee,
    CustomFixedFee,
    Hbar,
} = require('@hashgraph/sdk');

// ============================================================================
// CONFIGURATION - Set via .env file
// ============================================================================
const NETWORK = process.env.NETWORK || 'testnet';
const TREASURY_ID = process.env.TREASURY_ID;
const TREASURY_PK = process.env.TREASURY_PK;

// Collection Details
const TOKEN_NAME = process.env.TOKEN_NAME || 'My NFT Collection';
const TOKEN_SYMBOL = process.env.TOKEN_SYMBOL || 'MYNFT';
const MAX_SUPPLY = parseInt(process.env.MAX_SUPPLY || '10000');

// Royalty Configuration (optional)
const ROYALTY_ENABLED = process.env.ROYALTY_ENABLED === 'true';
const ROYALTY_PERCENTAGE = parseInt(process.env.ROYALTY_PERCENTAGE || '5');
const ROYALTY_RECIPIENT = process.env.ROYALTY_RECIPIENT || TREASURY_ID;
const FALLBACK_FEE_HBAR = parseInt(process.env.FALLBACK_FEE_HBAR || '5');

// ============================================================================
// VALIDATION
// ============================================================================
if (!TREASURY_ID || !TREASURY_PK) {
    console.error('❌ ERROR: Missing required environment variables');
    console.error('   Required: TREASURY_ID, TREASURY_PK');
    console.error('   Optional: TOKEN_NAME, TOKEN_SYMBOL, MAX_SUPPLY, ROYALTY_ENABLED, ROYALTY_PERCENTAGE');
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

const treasuryKey = PrivateKey.fromStringED25519(TREASURY_PK);
client.setOperator(TREASURY_ID, treasuryKey);

// ============================================================================
// CREATE COLLECTION
// ============================================================================
async function createCollection() {
    console.log('='.repeat(70));
    console.log('🎨 CREATING NFT COLLECTION ON HEDERA');
    console.log('='.repeat(70));
    console.log();
    console.log('📋 Collection Details:');
    console.log(`   Name: ${TOKEN_NAME}`);
    console.log(`   Symbol: ${TOKEN_SYMBOL}`);
    console.log(`   Max Supply: ${MAX_SUPPLY}`);
    console.log(`   Treasury: ${TREASURY_ID}`);
    console.log(`   Network: ${NETWORK.toUpperCase()}`);
    console.log();
    console.log('🔑 Keys Configuration:');
    console.log(`   ✅ Admin Key: Enabled`);
    console.log(`   ✅ Supply Key: Enabled`);
    console.log(`   ✅ Metadata Key: Enabled`);
    console.log();

    if (ROYALTY_ENABLED) {
        console.log('💰 Royalty Configuration:');
        console.log(`   Percentage: ${ROYALTY_PERCENTAGE}%`);
        console.log(`   Recipient: ${ROYALTY_RECIPIENT}`);
        console.log(`   Fallback Fee: ${FALLBACK_FEE_HBAR} HBAR`);
        console.log();
    }

    try {
        console.log('⏳ Creating collection transaction...');

        // Build the transaction
        const tokenCreateTx = new TokenCreateTransaction()
            .setTokenName(TOKEN_NAME)
            .setTokenSymbol(TOKEN_SYMBOL)
            .setTokenType(TokenType.NonFungibleUnique)
            .setSupplyType(TokenSupplyType.Finite)
            .setMaxSupply(MAX_SUPPLY)
            .setDecimals(0)
            .setInitialSupply(0)
            .setTreasuryAccountId(TREASURY_ID)
            .setAdminKey(treasuryKey)
            .setSupplyKey(treasuryKey)
            .setMetadataKey(treasuryKey);

        // Add royalty fees if enabled
        if (ROYALTY_ENABLED) {
            const royaltyFee = new CustomRoyaltyFee()
                .setNumerator(ROYALTY_PERCENTAGE)
                .setDenominator(100)
                .setFeeCollectorAccountId(ROYALTY_RECIPIENT)
                .setFallbackFee(new CustomFixedFee().setHbarAmount(new Hbar(FALLBACK_FEE_HBAR)));

            tokenCreateTx.setCustomFees([royaltyFee]);
        }

        console.log('⏳ Executing transaction...');
        const txResponse = await tokenCreateTx.execute(client);
        const receipt = await txResponse.getReceipt(client);
        const tokenId = receipt.tokenId.toString();

        console.log();
        console.log('='.repeat(70));
        console.log('✅ COLLECTION CREATED SUCCESSFULLY!');
        console.log('='.repeat(70));
        console.log();
        console.log(`🎫 Token ID: ${tokenId}`);
        console.log(`📝 Name: ${TOKEN_NAME}`);
        console.log(`🔤 Symbol: ${TOKEN_SYMBOL}`);
        console.log(`📊 Max Supply: ${MAX_SUPPLY}`);
        console.log(`✅ Status: ${receipt.status.toString()}`);
        console.log();
        console.log('🔗 View on HashScan:');
        console.log(`   https://hashscan.io/${NETWORK}/token/${tokenId}`);
        console.log();
        console.log('💡 Next Steps:');
        console.log('   1. Save the Token ID to your .env file as TOKEN_ID');
        console.log('   2. Prepare your metadata CIDs');
        console.log('   3. Use the minting script to mint NFTs');
        console.log();

    } catch (error) {
        console.error();
        console.error('❌ ERROR creating collection:');
        console.error(error.message);
        process.exit(1);
    }
}

createCollection().then(() => process.exit(0));

