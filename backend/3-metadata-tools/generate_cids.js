#!/usr/bin/env node
/**
 * Generate CID CSV from Directory CID
 *
 * Creates a CSV file with metadata CIDs for minting
 * Useful when you have a directory CID and want to generate individual paths
 *
 * Format: {base_cid}/{serial}.json
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

// ============================================================================
// CONFIGURATION
// ============================================================================
const BASE_IPFS_CID = process.env.BASE_IPFS_CID;
const TOTAL_NFTS = parseInt(process.env.TOTAL_NFTS || '100');
const OUTPUT_FILE = process.env.OUTPUT_FILE || 'cids.csv';
const USE_IPFS_PREFIX = process.env.USE_IPFS_PREFIX === 'true';

// ============================================================================
// VALIDATION
// ============================================================================
if (!BASE_IPFS_CID) {
    console.error('❌ ERROR: Missing BASE_IPFS_CID');
    console.error('   Required: BASE_IPFS_CID (the directory CID from IPFS)');
    console.error('   Optional: TOTAL_NFTS (default: 100), OUTPUT_FILE (default: cids.csv)');
    console.error('   Optional: USE_IPFS_PREFIX (true/false, default: false)');
    console.error();
    console.error('Example:');
    console.error('   BASE_IPFS_CID=bafybeiabc123... TOTAL_NFTS=5000 node generate_cids.js');
    process.exit(1);
}

console.log('=' .repeat(70));
console.log('📋 GENERATING CID CSV FOR MINTING');
console.log('=' .repeat(70));
console.log();
console.log(`📁 Base CID: ${BASE_IPFS_CID}`);
console.log(`📊 Total NFTs: ${TOTAL_NFTS}`);
console.log(`💾 Output File: ${OUTPUT_FILE}`);
console.log(`🔗 IPFS Prefix: ${USE_IPFS_PREFIX ? 'Yes (ipfs://)' : 'No'}`);
console.log();

// Generate CIDs
console.log('⏳ Generating CIDs...');
const cids = [];
cids.push('serial,metadata'); // CSV header

for (let serial = 1; serial <= TOTAL_NFTS; serial++) {
    const prefix = USE_IPFS_PREFIX ? 'ipfs://' : '';
    const cid = `${prefix}${BASE_IPFS_CID}/${serial}.json`;
    cids.push(`${serial},${cid}`);

    // Progress indicator
    if (serial % 500 === 0 || serial === TOTAL_NFTS) {
        console.log(`✅ Generated ${serial}/${TOTAL_NFTS} CIDs...`);
    }
}

// Write to CSV file
const outputPath = path.join(process.cwd(), OUTPUT_FILE);
fs.writeFileSync(outputPath, cids.join('\n'));

console.log();
console.log('=' .repeat(70));
console.log('✅ CID GENERATION COMPLETE!');
console.log('=' .repeat(70));
console.log();
console.log(`📁 File created: ${outputPath}`);
console.log(`📊 Total entries: ${TOTAL_NFTS}`);
console.log();
console.log('📋 Sample CIDs:');
const prefix = USE_IPFS_PREFIX ? 'ipfs://' : '';
console.log(`   Serial 1: ${prefix}${BASE_IPFS_CID}/1.json`);
if (TOTAL_NFTS >= 100) {
    const mid = Math.floor(TOTAL_NFTS / 2);
    console.log(`   Serial ${mid}: ${prefix}${BASE_IPFS_CID}/${mid}.json`);
}
console.log(`   Serial ${TOTAL_NFTS}: ${prefix}${BASE_IPFS_CID}/${TOTAL_NFTS}.json`);
console.log();
console.log('💡 Next Steps:');
console.log(`   1. Review the CSV file: ${OUTPUT_FILE}`);
console.log('   2. Use mint_nfts.js to mint NFTs with these CIDs');
console.log();
console.log('✨ Ready for minting!');
console.log();

