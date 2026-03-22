# Hedera Creator Toolkit

A cyberpunk-themed dashboard for creating and managing NFT collections on Hedera Hashgraph.

## 🎨 Features

### Active Tools
- ✅ **Art Generator** - Generate NFT collections with automatic IPFS upload
- ✅ **Create Collection** - Create NFT collections with custom royalties
- ✅ **Mint NFTs** - Batch mint up to 10 NFTs per transaction
- ✅ **Create Token** - Create a new fungible token
- ✅ **Update Token** - Update fungible token Icon/Metadata
- ✅ **Add Liquidity** - Create and add to liquidity pools
- ✅ **Burn NFTs** - Permanently burn tokens from collections
- ✅ **Airdrop Tool** - Distribute tokens & NFTs to multiple wallets
- ✅ **Snapshot Tool** - Capture holder accounts for any token
- ✅ **Token Swap** - Migrate holders between tokens
- ✅ **Token Viewer** - Viewer details of any token on Hedera (keys, holders, etc.).
- ✅ **Domain Registration** - Register .hedera, .slime, .gib, .tigers, & .buds domains

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm run install:all
```

### 2. Configure Backend
```bash
cd backend
cp .env.example .env
# Edit .env with your Hedera credentials and Pinata API keys
```

### 3. Run Servers

**Terminal 1 - Backend API (for Art Generator):**
```bash
cd backend
npm run dev
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
```

Open http://localhost:5173

## 🎨 Art Generator Setup

For detailed Art Generator setup and usage, see [ART_GENERATOR_SETUP.md](./ART_GENERATOR_SETUP.md)

**Quick Setup:**
1. Get Pinata API credentials from [pinata.cloud](https://pinata.cloud)
2. Add to `backend/.env`:
   ```env
   PINATA_API_KEY=your_key
   PINATA_API_SECRET=your_secret
   ```
3. Start backend API: `cd backend && npm run dev`
4. Start frontend: `cd frontend && npm run dev`
5. Navigate to Art Generator in the dashboard

## 📁 Project Structure

```
hedera-creator-toolkit/
├── frontend/              # TypeScript + Vite UI
│   ├── src/
│   │   ├── components/   # UI components
│   │   ├── styles/       # Cyberpunk theme
│   │   └── main.ts       # Entry point
│   └── package.json
├── backend/              # Node.js scripts
│   ├── 1-collection-management/
│   ├── 2-nft-minting/
│   ├── 3-metadata-tools/
│   ├── 4-utilities/
│   └── package.json
└── package.json          # Root workspace
```

## 🎨 Theme

- **Brand Color:** `#00ff40` (Slime Green)
- **Aesthetic:** Cyberpunk/Hacker Terminal
- **Font:** JetBrains Mono

## 🔧 Tech Stack

- **Frontend:** TypeScript + Vite
- **Backend:** Node.js + Hedera SDK
- **Deployment:** Railway/Render ready

---

## 📖 Backend Scripts Documentation

### Collection Management
- Create NFT collections with custom royalties
- Update collection names and metadata
- Delete collections and burn NFTs
- Query token information
- Dissociate tokens from wallets

### NFT Minting
- Batch mint NFTs (up to 10 per transaction)
- Resume minting from specific NFT if interrupted
- Configurable delays to avoid rate limiting
- Progress tracking and error handling

### Metadata Tools
- Clean Solana/Metaplex metadata for Hedera compatibility
- Upload images and metadata to Pinata IPFS
- Generate CID CSV files for minting
- Support for both individual and directory CIDs

### Utilities
- Query Hedera Mirror Node REST API
- Check latest minted NFTs
- Verify collection status

---

## 📦 Prerequisites

### Required
- **Node.js** v16 or higher
- **npm** or **yarn**
- **Hedera Account** (testnet or mainnet)
  - Get testnet account: https://portal.hedera.com/
  - Get mainnet account: Create via wallet (HashPack, Blade, etc.)
- **Pinata Account** (for IPFS uploads)
  - Sign up: https://pinata.cloud
  - Get API keys from dashboard

### Optional
- **Python 3.7+** (for Python-based IPFS upload scripts)
- **python-dotenv** package: `pip install python-dotenv requests`

---

## 🚀 Installation

1. **Clone or download this toolkit**
   ```bash
   cd hedera-toolkit
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your credentials
   ```

4. **Verify installation**
   ```bash
   npm run get-info
   # Should show usage instructions
   ```

---

## ⚙️ Configuration

### 1. Create `.env` file

Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

### 2. Set Required Variables

**Minimum configuration:**
```env
NETWORK=testnet
TREASURY_ID=0.0.YOUR_ACCOUNT_ID
TREASURY_PK=YOUR_PRIVATE_KEY_HERE
```

### 3. Add Pinata Credentials (for IPFS uploads)

```env
PINATA_API_KEY=your_api_key
PINATA_API_SECRET=your_secret_key
```

### 4. Configure Collection Settings (for creating collections)

```env
TOKEN_NAME=My NFT Collection
TOKEN_SYMBOL=MYNFT
MAX_SUPPLY=10000
ROYALTY_ENABLED=true
ROYALTY_PERCENTAGE=5
```

See `.env.example` for all available options.

---

## 📚 Scripts Reference

### 1. Collection Management

#### `create_collection.js`
Creates a new NFT collection on Hedera.

**Usage:**
```bash
npm run create-collection
```

**Required .env variables:**
- `TREASURY_ID`
- `TREASURY_PK`
- `TOKEN_NAME`
- `TOKEN_SYMBOL`
- `MAX_SUPPLY`

**Optional .env variables:**
- `ROYALTY_ENABLED` (true/false)
- `ROYALTY_PERCENTAGE` (1-100)
- `ROYALTY_RECIPIENT`
- `FALLBACK_FEE_HBAR`

**Output:**
- Token ID of created collection
- HashScan link for verification

---

#### `update_collection_name.js`
Updates the name of an existing collection.

**Usage:**
```bash
npm run update-name
```

**Required .env variables:**
- `TOKEN_ID`
- `ADMIN_PRIVATE_KEY`
- `NEW_TOKEN_NAME`

**Important:** Requires admin key to sign the transaction.

---

#### `delete_collection.js`
Permanently deletes a token collection.

**Usage:**
```bash
npm run delete-collection
```

**Required .env variables:**
- `TOKEN_ID_TO_DELETE`
- `TREASURY_PK`

**Warning:** This action cannot be undone!

---

#### `get_token_info.js`
Queries detailed information about a token/collection.

**Usage:**
```bash
npm run get-info
```

**Required .env variables:**
- `TOKEN_ID`

**Output:**
- Token name, symbol, supply
- Keys configuration
- Custom fees/royalties
- Sample NFT metadata

---

#### `dissociate_token.js`
Removes a token association from an account (removes from wallet view).

**Usage:**
```bash
npm run dissociate
```

**Required .env variables:**
- `TOKEN_ID_TO_DISSOCIATE`
- `ACCOUNT_ID` (or `TREASURY_ID`)
- `ACCOUNT_PK` (or `TREASURY_PK`)

**Note:** Account must have 0 balance of the token.

---

### 2. NFT Minting & Burning

#### `mint_nfts.js`
Batch mints NFTs using metadata CIDs from a CSV file.

**Usage:**
```bash
npm run mint
```

**Required .env variables:**
- `TOKEN_ID`
- `TREASURY_PK`
- `CIDS_FILE` (path to CSV file)

**Optional .env variables:**
- `BATCH_SIZE` (default: 10)
- `DELAY_MS` (default: 2000)
- `START_FROM` (default: 0)

**CSV Format:**
```csv
serial,metadata
1,ipfs://QmXXX...
2,ipfs://QmYYY...
```

**Resume minting:**
```bash
START_FROM=1500 npm run mint
```

---

#### `burn_nfts.js`
Burns all NFTs from a collection in batches.

**Usage:**
```bash
npm run burn
```

**Required .env variables:**
- `TOKEN_ID_TO_BURN`
- `TREASURY_PK`

**Optional .env variables:**
- `BURN_BATCH_SIZE` (default: 10)

**Warning:** This permanently destroys NFTs!

---

### 3. Metadata Tools

#### `clean_and_upload_metadata.js`
Cleans metadata (removes Solana-specific fields) and uploads to Pinata.

**Usage:**
```bash
npm run clean-upload
```

**Required .env variables:**
- `PINATA_API_KEY`
- `PINATA_API_SECRET`
- `METADATA_DIR` (directory containing JSON files)

**Optional .env variables:**
- `OUTPUT_CSV` (default: cids.csv)
- `UPLOAD_DELAY_MS` (default: 500)

**What it does:**
1. Reads all JSON files from `METADATA_DIR`
2. Removes Solana-specific fields:
   - `compiler`
   - `properties` (including `files` array)
   - `type`
3. Uploads each cleaned file to Pinata
4. Generates CSV with serial numbers and CIDs

**Output:**
- CSV file with format: `serial,metadata`
- Ready to use with `mint_nfts.js`

---

#### `generate_cids.js`
Generates a CSV file from a directory CID.

**Usage:**
```bash
npm run generate-cids
```

**Required .env variables:**
- `BASE_IPFS_CID` (directory CID from IPFS)
- `TOTAL_NFTS`

**Optional .env variables:**
- `OUTPUT_FILE` (default: cids.csv)
- `USE_IPFS_PREFIX` (true/false)

**Example:**
```bash
BASE_IPFS_CID=bafybeiabc123... TOTAL_NFTS=5000 npm run generate-cids
```

**Output:**
- CSV file with paths: `{base_cid}/1.json`, `{base_cid}/2.json`, etc.

---

#### `upload_images_to_pinata.py`
Python script to upload images to Pinata.

**Usage:**
```bash
python3 3-metadata-tools/upload_images_to_pinata.py
```

**Required .env variables:**
- `PINATA_API_KEY`
- `PINATA_API_SECRET`
- `IMAGE_DIR` (default: images)

**Supported formats:** PNG, JPG, JPEG, GIF, SVG

---

#### `upload_metadata_to_pinata.py`
Python script to upload metadata JSON files to Pinata.

**Usage:**
```bash
python3 3-metadata-tools/upload_metadata_to_pinata.py
```

**Required .env variables:**
- `PINATA_API_KEY`
- `PINATA_API_SECRET`
- `METADATA_DIR` (default: metadata)

---

### 4. Utilities

#### `query_mirror_node.js`
Queries the Hedera Mirror Node REST API.

**Usage:**
```bash
npm run query-mirror
```

**Required .env variables:**
- `TOKEN_ID`

**Output:**
- Token information
- Latest minted NFT
- HashScan link

**Useful for:**
- Checking how many NFTs have been minted
- Verifying metadata CIDs
- Debugging minting issues

---

## 🔄 Common Workflows

### Workflow 1: Create and Mint a New Collection

**Step 1: Prepare your assets**
```bash
# Organize your files
mkdir images metadata
# Add your images to images/
# Add your metadata JSON files to metadata/
```

**Step 2: Upload images to IPFS**
```bash
# Using Python script
python3 3-metadata-tools/upload_images_to_pinata.py
# Note the directory CID
```

**Step 3: Update metadata with image CIDs**
```bash
# Edit your metadata JSON files to include:
# "image": "ipfs://YOUR_IMAGE_CID/1.png"
```

**Step 4: Upload metadata to IPFS**
```bash
# Using JavaScript (cleans Solana fields automatically)
npm run clean-upload

# OR using Python
python3 3-metadata-tools/upload_metadata_to_pinata.py
```

**Step 5: Create the collection**
```bash
# Configure .env
TOKEN_NAME="My NFT Collection"
TOKEN_SYMBOL="MYNFT"
MAX_SUPPLY=5000
ROYALTY_ENABLED=true
ROYALTY_PERCENTAGE=5

# Create collection
npm run create-collection
# Save the TOKEN_ID from output
```

**Step 6: Mint NFTs**
```bash
# Add TOKEN_ID to .env
TOKEN_ID=0.0.YOUR_TOKEN_ID

# Mint all NFTs
npm run mint
```

**Step 7: Verify**
```bash
# Check collection status
npm run get-info

# Or query mirror node
npm run query-mirror
```

---

### Workflow 2: Resume Interrupted Minting

If minting stops (network issue, rate limit, etc.):

**Step 1: Check how many were minted**
```bash
npm run query-mirror
# Look at "Total Supply"
```

**Step 2: Resume from that point**
```bash
START_FROM=1500 npm run mint
```

The script will skip already-minted NFTs and continue from #1501.

---

### Workflow 3: Clean Up Test Collections

**Step 1: Burn all NFTs**
```bash
TOKEN_ID_TO_BURN=0.0.TEST_TOKEN npm run burn
```

**Step 2: Delete the collection**
```bash
TOKEN_ID_TO_DELETE=0.0.TEST_TOKEN npm run delete-collection
```

**Step 3: Remove from wallet**
```bash
TOKEN_ID_TO_DISSOCIATE=0.0.TEST_TOKEN npm run dissociate
```

---

### Workflow 4: Update Collection Name

```bash
# Set variables in .env
TOKEN_ID=0.0.YOUR_TOKEN
NEW_TOKEN_NAME="Updated Name"
ADMIN_PRIVATE_KEY=YOUR_ADMIN_KEY

# Update name
npm run update-name
```

---

## 🐛 Troubleshooting

### Common Issues

#### 1. "Missing required environment variables"
**Solution:** Check your `.env` file has all required variables for that script.

#### 2. "INVALID_SIGNATURE"
**Solution:**
- Verify your private key is correct
- Make sure you're using the admin key for update operations
- Check that the key has permission for the operation

#### 3. "INSUFFICIENT_TX_FEE" or "INSUFFICIENT_ACCOUNT_BALANCE"
**Solution:**
- Add more HBAR to your account
- Minting costs ~0.15 HBAR per NFT
- Collection creation costs ~1-2 HBAR

#### 4. "TOKEN_NOT_ASSOCIATED_TO_ACCOUNT"
**Solution:**
- Associate the token with your account first
- Or use the treasury account that created the token

#### 5. Minting shows `{object object}` in wallets
**Solution:**
- Use `clean_and_upload_metadata.js` to remove Solana-specific fields
- Ensure metadata doesn't have `properties.files` array

#### 6. NFTs show "files" category in wallet
**Solution:**
- Remove the `properties` object from metadata
- Use individual file CIDs, not directory CIDs with paths

#### 7. Rate limiting errors from Pinata
**Solution:**
- Increase `UPLOAD_DELAY_MS` in .env (try 1000 or 2000)
- Upgrade your Pinata plan for higher limits

---

## 💡 Best Practices

### Hedera Best Practices

1. **Test on testnet first**
   - Always test your full workflow on testnet
   - Verify metadata displays correctly in wallets
   - Check royalties are configured properly

2. **Use batch minting**
   - Mint 10 NFTs per transaction (Hedera maximum)
   - Add 2-second delays between batches
   - This is most cost-effective

3. **Set appropriate keys**
   - **Admin Key**: Allows updating token properties
   - **Supply Key**: Required for minting/burning
   - **Metadata Key**: Allows updating NFT metadata
   - **Wipe Key**: Only if you need to remove NFTs from accounts
   - **Freeze/Pause**: Usually not needed for NFT collections

4. **Royalty fees**
   - Hedera REQUIRES a fallback fee when setting royalties
   - Fallback fee only triggers in edge cases (non-HBAR trades)
   - Normal marketplace sales only use the percentage royalty

### Metadata Best Practices

1. **Use individual file CIDs**
   - Upload each metadata file separately to get unique CIDs
   - Don't use directory CIDs with paths (causes wallet issues)

2. **Clean metadata for Hedera**
   - Remove Solana-specific fields (`properties`, `files`, `compiler`)
   - Keep only: `name`, `description`, `image`, `attributes`

3. **Image CIDs**
   - Can use directory CID for images: `ipfs://CID/1.png`
   - Or individual CIDs: `ipfs://CID_FOR_IMAGE_1`

4. **Metadata format**
   ```json
   {
     "name": "NFT #1",
     "description": "Collection description",
     "image": "ipfs://QmXXX.../1.png",
     "attributes": [
       {"trait_type": "Background", "value": "Blue"},
       {"trait_type": "Rarity", "value": "Common"}
     ]
   }
   ```

### IPFS/Pinata Best Practices

1. **Pin your content**
   - Pinata automatically pins uploaded content
   - Verify pins in Pinata dashboard
   - Consider pinning to multiple services for redundancy

2. **Organize your uploads**
   - Use consistent naming: `1.json`, `2.json`, etc.
   - Match serial numbers to metadata files
   - Keep backups of all CIDs

3. **Rate limiting**
   - Free Pinata tier: ~1 request/second
   - Add delays between uploads
   - Monitor your usage in dashboard

### Cost Estimates (Hedera Mainnet)

- **Collection creation**: ~1-2 HBAR
- **NFT minting**: ~0.15 HBAR per NFT
- **Token updates**: ~0.001 HBAR
- **Token deletion**: ~0.001 HBAR

**Example:** Minting 5000 NFTs = ~750 HBAR (~$97 at $0.13/HBAR)

---

## 📖 Additional Resources

### Hedera Documentation
- **Hedera Docs**: https://docs.hedera.com
- **Token Service (HTS)**: https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service
- **Mirror Node API**: https://docs.hedera.com/hedera/sdks-and-apis/rest-api
- **HashScan Explorer**: https://hashscan.io

### IPFS/Pinata
- **Pinata Docs**: https://docs.pinata.cloud
- **IPFS Docs**: https://docs.ipfs.tech

### Community
- **Hedera Discord**: https://hedera.com/discord
- **Hedera Forum**: https://hedera.com/forum

---

## 🤝 Support

If you encounter issues:

1. Check the [Troubleshooting](#troubleshooting) section
2. Verify your `.env` configuration
3. Test on testnet first
4. Check Hedera status: https://status.hedera.com

---

## 📝 License

MIT License - Feel free to use and modify for your projects.

---

**Happy minting! 🚀**


