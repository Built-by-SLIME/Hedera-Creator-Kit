import { Request, Response } from 'express';
import path from 'path';
import fs from 'fs-extra';
import AdmZip from 'adm-zip';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import FormData from 'form-data';
import { NFTGenerator } from '../../5-art-generator/nftGenerator';
import { GeneratorConfig, RarityConfig } from '../../5-art-generator/types';
import { BACKEND_ROOT } from '../server';

interface GenerateRequest {
  config: {
    collectionName: string;
    collectionDescription: string;
    collectionSize: number;
    traitOrder: string[];
    imageWidth?: number;
    imageHeight?: number;
    imageFormat?: 'png' | 'jpg' | 'webp';
    imageQuality?: number;
    rarity?: RarityConfig;
  };
}

async function uploadToPinata(folderPath: string, folderName: string): Promise<string> {
  const PINATA_API_KEY = process.env.PINATA_API_KEY;
  const PINATA_API_SECRET = process.env.PINATA_API_SECRET;

  if (!PINATA_API_KEY || !PINATA_API_SECRET) {
    throw new Error('Pinata API credentials not configured');
  }

  const formData = new FormData();
  
  // Add all files from folder
  const files = await fs.readdir(folderPath);
  for (const file of files) {
    const filePath = path.join(folderPath, file);
    const stat = await fs.stat(filePath);
    
    if (stat.isFile()) {
      formData.append('file', fs.createReadStream(filePath), {
        filepath: file
      });
    }
  }

  // Add metadata
  const metadata = JSON.stringify({
    name: folderName
  });
  formData.append('pinataMetadata', metadata);

  const options = JSON.stringify({
    wrapWithDirectory: true
  });
  formData.append('pinataOptions', options);

  try {
    const response = await axios.post(
      'https://api.pinata.cloud/pinning/pinFileToIPFS',
      formData,
      {
        maxBodyLength: Infinity,
        headers: {
          'Content-Type': `multipart/form-data; boundary=${formData.getBoundary()}`,
          'pinata_api_key': PINATA_API_KEY,
          'pinata_secret_api_key': PINATA_API_SECRET
        }
      }
    );

    return response.data.IpfsHash;
  } catch (error: any) {
    console.error('Pinata upload error:', error.response?.data || error.message);
    throw new Error(`Failed to upload to Pinata: ${error.message}`);
  }
}

async function updateMetadataWithCID(metadataDir: string, imagesCID: string): Promise<void> {
  const files = await fs.readdir(metadataDir);
  
  for (const file of files) {
    if (file.endsWith('.json')) {
      const filePath = path.join(metadataDir, file);
      const metadata = await fs.readJSON(filePath);
      
      // Update image field with real IPFS CID
      const filename = path.basename(file, '.json') + '.png';
      metadata.image = `ipfs://${imagesCID}/${filename}`;
      
      await fs.writeJSON(filePath, metadata, { spaces: 2 });
    }
  }
}

export async function generateCollection(req: Request, res: Response) {
  let tempDir: string | null = null;
  
  try {
    // Validate file upload
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No ZIP file uploaded'
      });
    }

    // Parse config
    const configData: GenerateRequest['config'] = JSON.parse(req.body.config || '{}');

    // Create temp directory
    tempDir = path.join(BACKEND_ROOT, 'temp-generation', uuidv4());
    await fs.ensureDir(tempDir);

    const traitsDir = path.join(tempDir, 'traits');
    const outputDir = path.join(tempDir, 'output');
    const metadataDir = path.join(tempDir, 'metadata');

    await fs.ensureDir(traitsDir);
    await fs.ensureDir(outputDir);
    await fs.ensureDir(metadataDir);

    // Extract ZIP
    const zip = new AdmZip(req.file.path);
    zip.extractAllTo(traitsDir, true);
    await fs.remove(req.file.path);

    // Configure generator
    const generatorConfig: GeneratorConfig = {
      traitsDir,
      outputDir,
      metadataDir,
      numNFTs: configData.collectionSize,
      traitOrder: configData.traitOrder,
      collectionName: configData.collectionName,
      collectionDescription: configData.collectionDescription,
      imageWidth: configData.imageWidth || 1000,
      imageHeight: configData.imageHeight || 1000,
      imageFormat: configData.imageFormat || 'png',
      imageQuality: configData.imageQuality || 100
    };

    const rarityConfig: RarityConfig = configData.rarity || {
      specialNFTs: [],
      excludeTraits: {},
      customRules: []
    };

    // Generate full collection
    console.log(`Generating ${configData.collectionSize} NFTs...`);
    const generator = new NFTGenerator(generatorConfig, rarityConfig);
    const result = await generator.generateCollection();

    if (result.failed > 0 && result.successful === 0) {
      throw new Error('Failed to generate NFT collection');
    }

    console.log('Uploading images to Pinata...');
    const imagesCID = await uploadToPinata(outputDir, `${configData.collectionName}-images`);

    console.log('Updating metadata with image CIDs...');
    await updateMetadataWithCID(metadataDir, imagesCID);

    console.log('Uploading metadata to Pinata...');
    const metadataCID = await uploadToPinata(metadataDir, `${configData.collectionName}-metadata`);

    // Generate token URIs
    const tokenURIs: string[] = [];
    for (let i = 1; i <= configData.collectionSize; i++) {
      tokenURIs.push(`ipfs://${metadataCID}/${i}.json`);
    }

    // Clean up temp directory
    await fs.remove(tempDir);

    // Send response
    res.json({
      success: true,
      images_cid: imagesCID,
      metadata_cid: metadataCID,
      download_urls: {
        images: `https://gateway.pinata.cloud/ipfs/${imagesCID}`,
        metadata: `https://gateway.pinata.cloud/ipfs/${metadataCID}`
      },
      mint_ready: true,
      token_uris: tokenURIs,
      collection_info: {
        name: configData.collectionName,
        description: configData.collectionDescription,
        total_nfts: configData.collectionSize
      },
      generation_stats: {
        total: result.totalNFTs,
        successful: result.successful,
        failed: result.failed,
        duration: result.duration
      }
    });

  } catch (error: any) {
    console.error('Collection generation error:', error);

    // Clean up on error
    if (tempDir) {
      await fs.remove(tempDir).catch(console.error);
    }
    if (req.file?.path) {
      await fs.remove(req.file.path).catch(console.error);
    }

    res.status(500).json({
      success: false,
      error: error.message || 'Failed to generate collection'
    });
  }
}

