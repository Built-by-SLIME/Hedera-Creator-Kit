#!/usr/bin/env node
/**
 * Clean NFT Metadata and Upload to Pinata
 *
 * Removes Solana/Metaplex-specific fields that cause wallet display issues on Hedera
 * Uploads each file individually to Pinata to get unique CIDs
 * Generates a CSV file with serial numbers and CIDs for minting
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const axios = require('axios');

// ============================================================================
// CONFIGURATION
// ============================================================================
const PINATA_API_KEY = process.env.PINATA_API_KEY;
const PINATA_API_SECRET = process.env.PINATA_API_SECRET;

const METADATA_DIR = process.env.METADATA_DIR || './metadata';
const OUTPUT_CSV = process.env.OUTPUT_CSV || './cids.csv';
const BATCH_DELAY = parseInt(process.env.UPLOAD_DELAY_MS || '500'); // ms between uploads

// ============================================================================
// VALIDATION
// ============================================================================
if (!PINATA_API_KEY || !PINATA_API_SECRET) {
    console.error('❌ ERROR: Missing Pinata API credentials');
    console.error('   Required: PINATA_API_KEY, PINATA_API_SECRET');
    console.error('   Optional: METADATA_DIR, OUTPUT_CSV, UPLOAD_DELAY_MS');
    process.exit(1);
}

if (!fs.existsSync(METADATA_DIR)) {
    console.error(`❌ ERROR: Metadata directory not found: ${METADATA_DIR}`);
    process.exit(1);
}

// Track progress
let uploaded = 0;
let failed = 0;
const cidMapping = [];

/**
 * Clean metadata by removing Solana-specific fields
 */
function cleanMetadata(metadata) {
    const cleaned = {
        name: metadata.name,
        description: metadata.description,
        image: metadata.image,
        attributes: metadata.attributes
    };
    
    // Only include external_url if it exists and is not empty
    if (metadata.external_url && metadata.external_url.trim()) {
        cleaned.external_url = metadata.external_url;
    }
    
    return cleaned;
}

/**
 * Upload a single JSON file to Pinata
 */
async function uploadToPinata(serial, jsonContent) {
    try {
        const formData = new FormData();
        
        // Add the JSON content as a buffer
        formData.append('file', Buffer.from(JSON.stringify(jsonContent, null, 2)), {
            filename: `${serial}.json`,
            contentType: 'application/json'
        });
        
        // Add metadata for Pinata
        const pinataMetadata = JSON.stringify({
            name: `NFT Metadata #${serial}`
        });
        formData.append('pinataMetadata', pinataMetadata);
        
        const response = await axios.post(
            'https://api.pinata.cloud/pinning/pinFileToIPFS',
            formData,
            {
                headers: {
                    ...formData.getHeaders(),
                    'pinata_api_key': PINATA_API_KEY,
                    'pinata_secret_api_key': PINATA_API_SECRET
                }
            }
        );
        
        return response.data.IpfsHash;
    } catch (error) {
        throw new Error(`Upload failed: ${error.message}`);
    }
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================
async function processAllMetadata() {
    console.log('=' .repeat(70));
    console.log('🧹 NFT METADATA CLEANUP & UPLOAD TO PINATA');
    console.log('=' .repeat(70));
    console.log();
    console.log(`📁 Source Directory: ${METADATA_DIR}`);
    console.log(`📄 Output CSV: ${OUTPUT_CSV}`);
    console.log(`⏱️  Upload Delay: ${BATCH_DELAY}ms between files`);
    console.log();
    console.log('🧹 Cleaning: Removing Solana/Metaplex-specific fields');
    console.log('   - "compiler" field');
    console.log('   - "properties" object (including "files" array)');
    console.log('   - "type" field');
    console.log();
    console.log('☁️  Uploading: Each metadata file individually to Pinata');
    console.log();

    // Get all JSON files
    const files = fs.readdirSync(METADATA_DIR).filter(f => f.endsWith('.json')).sort((a, b) => {
        return parseInt(a.replace('.json', '')) - parseInt(b.replace('.json', ''));
    });

    const totalFiles = files.length;
    console.log(`📊 Found ${totalFiles} metadata files`);
    console.log(`⏳ Estimated time: ${Math.ceil(totalFiles * BATCH_DELAY / 1000 / 60)} minutes`);
    console.log();

    // Track progress
    let uploaded = 0;
    let failed = 0;
    const cidMapping = [];

    for (let i = 0; i < files.length; i++) {
        const filename = files[i];
        const serial = parseInt(filename.replace('.json', ''));
        const metadataPath = path.join(METADATA_DIR, filename);
        
        try {
            // Read original metadata
            const rawData = fs.readFileSync(metadataPath, 'utf8');
            const originalMetadata = JSON.parse(rawData);
            
            // Clean metadata
            const cleanedMetadata = cleanMetadata(originalMetadata);
            
            // Upload to Pinata
            const cid = await uploadToPinata(serial, cleanedMetadata);
            
            // Store mapping
            cidMapping.push({
                serial,
                cid: `ipfs://${cid}`
            });
            
            uploaded++;

            // Progress update every 50 NFTs
            if ((i + 1) % 50 === 0 || (i + 1) === totalFiles) {
                const percent = (((i + 1) / totalFiles) * 100).toFixed(1);
                console.log(`✅ Progress: ${i + 1}/${totalFiles} (${percent}%) - Latest CID: ${cid}`);
            }
            
            // Delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
            
        } catch (error) {
            failed++;
            console.error(`❌ Error processing #${serial}: ${error.message}`);
            
            // Store failed entry
            cidMapping.push({
                serial,
                cid: 'FAILED'
            });
        }
    }
    
    // Write CSV
    console.log();
    console.log('💾 Writing CSV file...');
    const csvLines = ['serial,metadata'];
    cidMapping.forEach(entry => {
        if (entry.cid !== 'FAILED') {
            csvLines.push(`${entry.serial},${entry.cid}`);
        }
    });
    fs.writeFileSync(OUTPUT_CSV, csvLines.join('\n'));
    
    // Summary
    console.log();
    console.log('=' .repeat(70));
    console.log('✅ UPLOAD COMPLETE!');
    console.log('=' .repeat(70));
    console.log();
    console.log(`✅ Successfully uploaded: ${uploaded} NFTs`);
    console.log(`❌ Failed: ${failed} NFTs`);
    console.log(`📁 Output file: ${OUTPUT_CSV}`);
    console.log();

    if (cidMapping.length > 0) {
        console.log('📋 Sample CIDs:');
        console.log(`   First: ${cidMapping[0]?.cid}`);
        if (cidMapping.length > 1) {
            console.log(`   Last: ${cidMapping[cidMapping.length - 1]?.cid}`);
        }
        console.log();
    }

    console.log('💡 Next Steps:');
    console.log(`   1. Review the CSV file: ${OUTPUT_CSV}`);
    console.log('   2. Use mint_nfts.js to mint NFTs with these CIDs');
    console.log();
}

// ============================================================================
// RUN THE SCRIPT
// ============================================================================
processAllMetadata()
    .then(() => {
        console.log('✨ Ready for minting!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('❌ Fatal error:', error);
        process.exit(1);
    });

