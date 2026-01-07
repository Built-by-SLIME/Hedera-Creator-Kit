# Quick Start Guide

Get started with the Hedera NFT Toolkit in 5 minutes.

## 🚀 Setup (2 minutes)

1. **Install dependencies**
   ```bash
   cd hedera-toolkit
   npm install
   ```

2. **Configure environment**
   ```bash
   cp .env.example .env
   ```

3. **Edit `.env` with your credentials**
   ```env
   NETWORK=testnet
   TREASURY_ID=0.0.YOUR_ACCOUNT_ID
   TREASURY_PK=YOUR_PRIVATE_KEY
   PINATA_API_KEY=your_key
   PINATA_API_SECRET=your_secret
   ```

## 🎯 Your First NFT Collection (3 minutes)

### Step 1: Create a Collection
```bash
# Edit .env
TOKEN_NAME="My First NFT"
TOKEN_SYMBOL="FIRST"
MAX_SUPPLY=100

# Create it
npm run create-collection
```

**Output:** Token ID (save this!)

### Step 2: Prepare Metadata

Create a file `metadata/1.json`:
```json
{
  "name": "NFT #1",
  "description": "My first NFT on Hedera",
  "image": "ipfs://QmYourImageCID",
  "attributes": [
    {"trait_type": "Color", "value": "Blue"}
  ]
}
```

### Step 3: Upload Metadata
```bash
npm run clean-upload
```

**Output:** `cids.csv` file

### Step 4: Mint NFTs
```bash
# Add TOKEN_ID to .env
TOKEN_ID=0.0.YOUR_TOKEN_ID

# Mint!
npm run mint
```

**Done!** 🎉

## 📋 Quick Reference

| Task | Command |
|------|---------|
| Create collection | `npm run create-collection` |
| Mint NFTs | `npm run mint` |
| Check status | `npm run query-mirror` |
| Get token info | `npm run get-info` |
| Upload metadata | `npm run clean-upload` |
| Generate CIDs | `npm run generate-cids` |
| Burn NFTs | `npm run burn` |
| Delete collection | `npm run delete-collection` |

## 🆘 Need Help?

- **Full documentation**: See [README.md](README.md)
- **Troubleshooting**: See [README.md#troubleshooting](README.md#troubleshooting)
- **Common workflows**: See [README.md#common-workflows](README.md#common-workflows)

## 💡 Pro Tips

1. **Always test on testnet first**
   ```env
   NETWORK=testnet
   ```

2. **Resume interrupted minting**
   ```bash
   START_FROM=500 npm run mint
   ```

3. **Check your progress**
   ```bash
   npm run query-mirror
   ```

4. **Clean Solana metadata automatically**
   - Use `npm run clean-upload` instead of manual uploads
   - Removes problematic fields that break wallet display

---

**Ready to dive deeper?** Check out the [full README](README.md) for advanced workflows and best practices.

