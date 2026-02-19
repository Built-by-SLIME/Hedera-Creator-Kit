# 🎨 NFT Art Generator API

Complete API server for generating NFT collections with automatic IPFS upload via Pinata.

## Features

- ✅ **Preview System**: Generate 10 random NFTs before committing (up to 10 times)
- ✅ **Automatic IPFS Upload**: Images and metadata automatically uploaded to Pinata
- ✅ **HIP-412 Compliant**: Generates Hedera-compatible NFT metadata
- ✅ **Session Tracking**: Prevents abuse with preview limits
- ✅ **Batch Processing**: Handles large collections efficiently
- ✅ **Automatic Cleanup**: Temp files cleaned up after generation

## Quick Start

### 1. Install Dependencies

```bash
cd backend
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and add your Pinata credentials:

```bash
cp .env.example .env
```

Edit `.env`:
```env
# API Server
API_PORT=3001

# Pinata IPFS
PINATA_API_KEY=your_pinata_api_key
PINATA_API_SECRET=your_pinata_secret_key
```

### 3. Start the Server

```bash
npm run dev
```

Server will start on `http://localhost:3001`

## API Endpoints

### Preview Collection

**POST** `/api/preview-collection`

Generate 10 random NFTs for preview (max 10 times per session).

**Request:**
- `zipFile`: Multipart file upload (ZIP containing trait folders)
- `config`: JSON configuration

**Config Format:**
```json
{
  "collectionName": "My Collection",
  "collectionDescription": "A unique NFT collection",
  "collectionSize": 1000,
  "traitOrder": ["Background", "Body", "Eyes", "Mouth"],
  "imageWidth": 1000,
  "imageHeight": 1000,
  "imageFormat": "png",
  "imageQuality": 100,
  "sessionId": "optional-session-id"
}
```

**Response:**
```json
{
  "success": true,
  "sessionId": "session-xxx",
  "previews": [
    {
      "id": 1,
      "image": "data:image/png;base64,...",
      "metadata": {
        "name": "My Collection #1",
        "description": "...",
        "image": "ipfs://PLACEHOLDER_CID/1.png",
        "attributes": [...]
      }
    }
  ],
  "previewCount": 1,
  "previewsRemaining": 9
}
```

### Generate Full Collection

**POST** `/api/generate-collection`

Generate full collection and upload to IPFS.

**Request:**
- `zipFile`: Multipart file upload (ZIP containing trait folders)
- `config`: JSON configuration (same as preview)

**Response:**
```json
{
  "success": true,
  "images_cid": "QmXxx...",
  "metadata_cid": "QmYyy...",
  "download_urls": {
    "images": "https://gateway.pinata.cloud/ipfs/QmXxx...",
    "metadata": "https://gateway.pinata.cloud/ipfs/QmYyy..."
  },
  "mint_ready": true,
  "token_uris": [
    "ipfs://QmYyy.../1.json",
    "ipfs://QmYyy.../2.json"
  ],
  "collection_info": {
    "name": "My Collection",
    "description": "...",
    "total_nfts": 1000
  }
}
```

## ZIP File Structure

Your ZIP file should contain folders for each trait layer:

```
collection.zip
├── Background/
│   ├── Blue.png
│   ├── Red.png
│   └── Green.png
├── Body/
│   ├── Circle.png
│   ├── Square.png
│   └── Triangle.png
├── Eyes/
│   ├── Happy.png
│   ├── Sad.png
│   └── Angry.png
└── Mouth/
    ├── Smile.png
    └── Frown.png
```

## Trait Order

The `traitOrder` array determines layering:
- First item = bottom layer
- Last item = top layer

Example: `["Background", "Body", "Eyes", "Mouth"]`

## Preview Limits

- **10 previews per session** (10 NFTs each = 100 total previews)
- Sessions expire after 1 hour of inactivity
- Prevents abuse while allowing thorough testing

## Error Handling

All endpoints return consistent error format:

```json
{
  "success": false,
  "error": "Error message here"
}
```

Common errors:
- `No ZIP file uploaded` - Missing file in request
- `Preview limit reached` - Exceeded 10 preview generations
- `Pinata API credentials not configured` - Missing .env variables
- `Failed to generate NFT collection` - Generation error

## Development

### Run in Development Mode

```bash
npm run dev
```

### Build TypeScript

```bash
npm run build-generator
```

## Production Deployment

1. Set environment variables
2. Build the project
3. Use a process manager (PM2, systemd)
4. Set up reverse proxy (nginx)
5. Enable HTTPS

## Support

For issues or questions, check the main project README or open an issue.

