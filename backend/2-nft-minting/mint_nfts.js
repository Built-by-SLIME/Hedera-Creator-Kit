#!/usr/bin/env node
/**
 * Mint NFTs to Hedera Collection
 *
 * Batch mints NFTs using metadata CIDs from a CSV file
 * Supports resuming from a specific NFT number if interrupted
 */

require('dotenv').config();
const fs = require('fs');
const csv = require('csv-parser');
const {
    Client,
    PrivateKey,
    TokenMintTransaction,
} = require('@hashgraph/sdk');

// ============================================================================
// CONFIGURATION
// ============================================================================
const NETWORK = process.env.NETWORK || 'testnet';
const TREASURY_ID = process.env.TREASURY_ID;
const TREASURY_PK = process.env.TREASURY_PK;
const TOKEN_ID = process.env.TOKEN_ID;

const CIDS_FILE = process.env.CIDS_FILE || './cids.csv';
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '10'); // NFTs per transaction
const DELAY_BETWEEN_BATCHES = parseInt(process.env.DELAY_MS || '2000'); // milliseconds
const START_FROM = parseInt(process.env.START_FROM || '0'); // Resume from specific NFT

// ============================================================================
// VALIDATION
// ============================================================================
if (!TREASURY_ID || !TREASURY_PK || !TOKEN_ID) {
    console.error('❌ ERROR: Missing required environment variables');
    console.error('   Required: TREASURY_ID, TREASURY_PK, TOKEN_ID');
    console.error('   Optional: CIDS_FILE, BATCH_SIZE, DELAY_MS, START_FROM');
    process.exit(1);
}

if (!fs.existsSync(CIDS_FILE)) {
    console.error(`❌ ERROR: CIDs file not found: ${CIDS_FILE}`);
    console.error('   Run generate_cids.js first!');
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
// HELPER FUNCTIONS
// ============================================================================
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================
async function mintNFTs() {
    console.log('=' .repeat(70));
    console.log('🎨 MINTING NFTs TO HEDERA COLLECTION');
    console.log('=' .repeat(70));
    console.log();
    console.log(`🌐 Network: ${NETWORK.toUpperCase()}`);
    console.log(`🎫 Token ID: ${TOKEN_ID}`);
    console.log(`📍 Treasury: ${TREASURY_ID}`);
    console.log(`📦 Batch Size: ${BATCH_SIZE} NFTs per transaction`);
    console.log(`⏱️  Delay: ${DELAY_BETWEEN_BATCHES}ms between batches`);
    if (START_FROM > 0) {
        console.log(`🔄 Resuming from NFT #${START_FROM + 1}`);
    }
    console.log();

    // Read CIDs from CSV
    const cids = [];
    
    await new Promise((resolve, reject) => {
        fs.createReadStream(CIDS_FILE)
            .pipe(csv())
            .on('data', (row) => {
                cids.push(row.metadata);
            })
            .on('end', resolve)
            .on('error', reject);
    });

    console.log(`📊 Loaded ${cids.length} CIDs from ${CIDS_FILE}`);

    if (START_FROM > 0) {
        console.log(`⏭️  Skipping first ${START_FROM} NFTs (already minted)`);
        console.log(`🔄 Resuming from NFT #${START_FROM + 1}`);
    }

    console.log();
    console.log('⏳ Starting minting process...');
    console.log();

    let totalMinted = START_FROM;
    let batchNumber = Math.floor(START_FROM / BATCH_SIZE);

    // Mint in batches
    for (let i = START_FROM; i < cids.length; i += BATCH_SIZE) {
        batchNumber++;
        const batch = cids.slice(i, i + BATCH_SIZE);
        
        try {
            console.log(`📦 Batch ${batchNumber}: Minting NFTs ${i + 1}-${i + batch.length}...`);
            
            // Create mint transaction
            const mintTx = new TokenMintTransaction()
                .setTokenId(TOKEN_ID)
                .setMetadata(batch.map(cid => Buffer.from(cid)));

            // Execute
            const txResponse = await mintTx.execute(client);
            const receipt = await txResponse.getReceipt(client);
            
            totalMinted += batch.length;
            
            console.log(`   ✅ Success! Minted ${batch.length} NFTs (Total: ${totalMinted}/${cids.length})`);
            console.log(`   📝 Serials: ${receipt.serials.map(s => s.toString()).join(', ')}`);
            
            // Delay between batches to avoid rate limiting
            if (i + BATCH_SIZE < cids.length) {
                await sleep(DELAY_BETWEEN_BATCHES);
            }
            
        } catch (error) {
            console.error(`   ❌ Error minting batch ${batchNumber}:`, error.message);
            console.error(`   Stopping at ${totalMinted} minted NFTs`);
            process.exit(1);
        }
    }

    console.log();
    console.log('=' .repeat(70));
    console.log('✅ MINTING COMPLETE!');
    console.log('=' .repeat(70));
    console.log();
    console.log(`🎫 Token ID: ${TOKEN_ID}`);
    console.log(`📊 Total Minted: ${totalMinted} NFTs`);
    console.log(`🔗 View on HashScan: https://hashscan.io/${NETWORK}/token/${TOKEN_ID}`);
    console.log();
    console.log('💡 TIP: To resume if interrupted, run:');
    console.log(`   START_FROM=${totalMinted} node mint_nfts.js`);
    console.log();
}

// ============================================================================
// RUN THE SCRIPT
// ============================================================================
mintNFTs().then(() => {
    process.exit(0);
}).catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});

