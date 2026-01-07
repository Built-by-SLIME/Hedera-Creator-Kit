#!/usr/bin/env node
/**
 * Query Hedera Mirror Node
 * 
 * Utility to query the Hedera Mirror Node REST API
 * Useful for checking token info, NFT serials, account balances, etc.
 */

require('dotenv').config();
const axios = require('axios');

// ============================================================================
// CONFIGURATION
// ============================================================================
const NETWORK = process.env.NETWORK || 'testnet';
const TOKEN_ID = process.env.TOKEN_ID;

const MIRROR_NODE_URL = NETWORK.toLowerCase() === 'mainnet'
    ? 'https://mainnet-public.mirrornode.hedera.com'
    : 'https://testnet.mirrornode.hedera.com';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================
async function getTokenInfo(tokenId) {
    const url = `${MIRROR_NODE_URL}/api/v1/tokens/${tokenId}`;
    const response = await axios.get(url);
    return response.data;
}

async function getLatestNFT(tokenId) {
    const url = `${MIRROR_NODE_URL}/api/v1/tokens/${tokenId}/nfts?limit=1&order=desc`;
    const response = await axios.get(url);
    return response.data.nfts[0];
}

async function getNFTsBySerial(tokenId, serialStart, serialEnd) {
    const nfts = [];
    for (let serial = serialStart; serial <= serialEnd; serial++) {
        const url = `${MIRROR_NODE_URL}/api/v1/tokens/${tokenId}/nfts/${serial}`;
        try {
            const response = await axios.get(url);
            nfts.push(response.data);
        } catch (error) {
            console.error(`❌ Error fetching serial ${serial}:`, error.message);
        }
    }
    return nfts;
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================
async function queryMirrorNode() {
    console.log('='.repeat(70));
    console.log('🔍 HEDERA MIRROR NODE QUERY');
    console.log('='.repeat(70));
    console.log();
    console.log(`🌐 Network: ${NETWORK.toUpperCase()}`);
    console.log(`🔗 Mirror Node: ${MIRROR_NODE_URL}`);
    console.log();

    if (!TOKEN_ID) {
        console.log('💡 Usage Examples:');
        console.log();
        console.log('1. Get token info:');
        console.log('   TOKEN_ID=0.0.12345 node query_mirror_node.js');
        console.log();
        console.log('2. Check latest minted NFT:');
        console.log('   TOKEN_ID=0.0.12345 node query_mirror_node.js');
        console.log();
        console.log('📚 Mirror Node API Documentation:');
        console.log('   https://docs.hedera.com/hedera/sdks-and-apis/rest-api');
        console.log();
        return;
    }

    try {
        console.log(`🎫 Querying Token: ${TOKEN_ID}`);
        console.log();

        // Get token info
        console.log('⏳ Fetching token information...');
        const tokenInfo = await getTokenInfo(TOKEN_ID);
        
        console.log();
        console.log('📋 TOKEN INFORMATION:');
        console.log(`   Name: ${tokenInfo.name}`);
        console.log(`   Symbol: ${tokenInfo.symbol}`);
        console.log(`   Type: ${tokenInfo.type}`);
        console.log(`   Total Supply: ${tokenInfo.total_supply}`);
        console.log(`   Max Supply: ${tokenInfo.max_supply || 'Unlimited'}`);
        console.log(`   Treasury: ${tokenInfo.treasury_account_id}`);
        console.log();

        // Get latest NFT
        if (tokenInfo.type === 'NON_FUNGIBLE_UNIQUE' && parseInt(tokenInfo.total_supply) > 0) {
            console.log('⏳ Fetching latest minted NFT...');
            const latestNFT = await getLatestNFT(TOKEN_ID);
            
            console.log();
            console.log('🎨 LATEST NFT:');
            console.log(`   Serial Number: ${latestNFT.serial_number}`);
            console.log(`   Account ID: ${latestNFT.account_id}`);
            console.log(`   Metadata: ${Buffer.from(latestNFT.metadata, 'base64').toString('utf8')}`);
            console.log();
        }

        console.log('='.repeat(70));
        console.log(`🔗 View on HashScan: https://hashscan.io/${NETWORK}/token/${TOKEN_ID}`);
        console.log('='.repeat(70));
        console.log();

    } catch (error) {
        console.error();
        console.error('❌ ERROR querying mirror node:');
        console.error(error.message);
        
        if (error.response) {
            console.error(`Status: ${error.response.status}`);
            console.error(`Data:`, error.response.data);
        }
        
        process.exit(1);
    }
}

queryMirrorNode().then(() => process.exit(0));

