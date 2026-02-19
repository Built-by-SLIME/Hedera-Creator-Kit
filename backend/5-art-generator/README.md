# 🎨 NFT Art Generator

Professional-grade generative NFT art engine with advanced rarity controls, special NFT support, and Hedera-compatible metadata generation.

## ✨ Features

- **🖼️ Layer-based Image Composition** - Combine trait layers to create unique NFTs
- **🎲 Advanced Rarity System** - Control trait distribution with precision
- **👑 Special NFTs** - Define 1/1s and bounty NFTs with exact traits
- **📊 Hedera-Compatible Metadata** - Generate HIP-412 compliant metadata
- **⚡ High Performance** - Uses Sharp for fast image processing
- **🔧 Fully Configurable** - JSON-based configuration system
- **📈 Progress Tracking** - Real-time generation progress
- **🎯 TypeScript** - Full type safety and IntelliSense support

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Prepare Your Trait Folders

Create a folder structure like this:

```
traits/
├── Background/
│   ├── Blue.png
│   ├── Red.png
│   └── Green.png
├── Body/
│   ├── Normal.png
│   ├── Muscular.png
│   └── Slim.png
├── Eyes/
│   ├── Happy.png
│   ├── Angry.png
│   └── Surprised.png
└── Mouth/
    ├── Smile.png
    ├── Frown.png
    └── Neutral.png
```

### 3. Create Configuration File

Copy the example config:

```bash
cp config.example.json config.json
```

Edit `config.json` to match your collection:

```json
{
  "generator": {
    "traitsDir": "./traits",
    "outputDir": "./output",
    "metadataDir": "./metadata",
    "numNFTs": 100,
    "collectionName": "My NFT Collection",
    "collectionDescription": "A unique collection",
    "traitOrder": ["Background", "Body", "Eyes", "Mouth"],
    "imageWidth": 1000,
    "imageHeight": 1000,
    "imageFormat": "png",
    "imageQuality": 100
  }
}
```

### 4. Generate Your Collection

```bash
npx ts-node generate.ts
```

## 📖 Configuration Guide

### Basic Configuration

| Field | Type | Description |
|-------|------|-------------|
| `traitsDir` | string | Path to folder containing trait folders |
| `outputDir` | string | Where to save generated images |
| `metadataDir` | string | Where to save metadata JSON files |
| `numNFTs` | number | Total number of NFTs to generate |
| `collectionName` | string | Name of your collection |
| `collectionDescription` | string | Description for metadata |
| `traitOrder` | string[] | Order of trait layers (bottom to top) |
| `imageWidth` | number | Output image width in pixels |
| `imageHeight` | number | Output image height in pixels |
| `imageFormat` | string | Image format: 'png', 'jpg', or 'webp' |
| `imageQuality` | number | Image quality (1-100) |

### Advanced: Rarity Configuration

#### Special NFTs (1/1s)

Define exact traits for specific NFT numbers:

```json
{
  "rarity": {
    "specialNFTs": [
      {
        "nftNumber": 1,
        "traits": {
          "Background": "Legendary",
          "Body": "Golden",
          "Eyes": "Diamond",
          "Mouth": "Smile"
        }
      }
    ]
  }
}
```

#### Exclude Traits

Prevent certain traits from appearing in random generation:

```json
{
  "rarity": {
    "excludeTraits": {
      "Body": ["Golden", "Diamond"],
      "Eyes": ["Laser"]
    }
  }
}
```

#### Custom Rarity Rules

Limit how many NFTs can have a specific trait:

```json
{
  "rarity": {
    "customRules": [
      {
        "traitCategory": "Eyes",
        "traitValue": "Laser",
        "maxCount": 10
      }
    ]
  }
}
```

## 🎯 Example Configurations

See the included example configs:

- `config.example.json` - Basic collection
- `config.brainz.json` - BrainZ collection with special NFT #1
- `config.cringle.json` - Cringle collection with 10 bounty NFTs

## 📝 Output

The generator creates:

1. **Images** - PNG/JPG/WebP files in `outputDir`
2. **Metadata** - JSON files in `metadataDir`
3. **Console Output** - Progress and summary

### Metadata Format

```json
{
  "name": "My Collection #1",
  "description": "A unique collection",
  "image": "ipfs://PLACEHOLDER_CID/1.png",
  "attributes": [
    { "trait_type": "Background", "value": "Blue" },
    { "trait_type": "Body", "value": "Normal" },
    { "trait_type": "Eyes", "value": "Happy" },
    { "trait_type": "Mouth", "value": "Smile" }
  ]
}
```

## 🔧 Programmatic Usage

```typescript
import { NFTGenerator, GeneratorConfig, RarityConfig } from './index';

const config: GeneratorConfig = {
  traitsDir: './traits',
  outputDir: './output',
  metadataDir: './metadata',
  numNFTs: 100,
  collectionName: 'My Collection',
  collectionDescription: 'Description',
  traitOrder: ['Background', 'Body', 'Eyes', 'Mouth']
};

const generator = new NFTGenerator(config);
const summary = await generator.generateCollection();

console.log(`Generated ${summary.successful} NFTs!`);
```

## 📚 API Reference

See `examples/` folder for more usage examples.

## 🐛 Troubleshooting

**Images not generating?**
- Check that trait folders exist and contain PNG/JPG files
- Verify `traitOrder` matches your folder names exactly

**Metadata has wrong image URIs?**
- Update after IPFS upload using `MetadataGenerator.updateImageURIs()`

**Special NFTs not working?**
- Ensure trait values match file names exactly (without extension)

## 📄 License

MIT

