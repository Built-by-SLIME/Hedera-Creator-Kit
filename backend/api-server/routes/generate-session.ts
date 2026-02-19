import { Request, Response } from 'express';
import path from 'path';
import fs from 'fs-extra';
import axios from 'axios';
import FormData from 'form-data';
import { v4 as uuidv4 } from 'uuid';
import { NFTGenerator } from '../../5-art-generator/nftGenerator';
import { GeneratorConfig, RarityConfig } from '../../5-art-generator/types';

interface SessionGenerateRequest {
  sessionId: string;
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

async function pinFileToPinata(filePath: string, fileName: string): Promise<string> {
  const PINATA_API_KEY = process.env.PINATA_API_KEY;
  const PINATA_API_SECRET = process.env.PINATA_API_SECRET;

  if (!PINATA_API_KEY || !PINATA_API_SECRET) {
    throw new Error('Pinata API credentials not configured on server');
  }

  const formData = new FormData();
  formData.append('file', fs.createReadStream(filePath), { filename: path.basename(filePath) });
  formData.append('pinataMetadata', JSON.stringify({ name: fileName }));

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
  } catch (err: any) {
    const pinataError = err.response?.data?.error || err.message;
    console.error(`Pinata upload error for ${fileName}: ${pinataError}`);
    throw new Error(`Pinata upload failed for ${fileName}: ${pinataError}`);
  }
}

/**
 * Generate full collection using already-uploaded session layers
 */
export async function generateFromSession(req: Request, res: Response) {
  let outputDir: string | null = null;

  try {
    const body: SessionGenerateRequest = req.body;

    if (!body.sessionId) {
      return res.status(400).json({ success: false, error: 'sessionId is required' });
    }

    const sessionDir = path.join(__dirname, '../../temp-sessions', body.sessionId);

    if (!await fs.pathExists(sessionDir)) {
      return res.status(404).json({ success: false, error: 'Session not found. Please re-upload your ZIP file.' });
    }

    // Read the resolved scan directory from session metadata (saved during upload)
    const sessionMeta = await fs.readJSON(path.join(sessionDir, 'session.json')).catch(() => null);
    const scanDir = sessionMeta?.scanDir || path.join(sessionDir, 'traits');

    // Create output directories
    const tempId = uuidv4();
    outputDir = path.join(__dirname, '../../temp-generation', tempId);
    const imagesDir = path.join(outputDir, 'images');
    const metadataDir = path.join(outputDir, 'metadata');

    await fs.ensureDir(imagesDir);
    await fs.ensureDir(metadataDir);

    const generatorConfig: GeneratorConfig = {
      traitsDir: scanDir,
      outputDir: imagesDir,
      metadataDir,
      numNFTs: body.config.collectionSize,
      traitOrder: body.config.traitOrder,
      collectionName: body.config.collectionName,
      collectionDescription: body.config.collectionDescription,
      imageWidth: body.config.imageWidth,
      imageHeight: body.config.imageHeight,
      imageFormat: body.config.imageFormat || 'png',
      imageQuality: body.config.imageQuality || 100
    };

    const rarityConfig: RarityConfig = body.config.rarity || {};

    console.log(`Generating ${body.config.collectionSize} NFTs...`);
    const generator = new NFTGenerator(generatorConfig, rarityConfig);
    const result = await generator.generateCollection();

    if (result.failed > 0 && result.successful === 0) {
      throw new Error('Failed to generate NFT collection');
    }

    const collectionName = body.config.collectionName || 'Collection';
    const imageFormat = body.config.imageFormat || 'png';
    const totalNFTs = body.config.collectionSize;

    // Pin each image individually
    const nftResults: Array<{ number: number; imageCID: string; metadataCID: string; tokenURI: string }> = [];

    console.log(`Pinning ${totalNFTs} images to IPFS individually...`);
    for (let i = 1; i <= totalNFTs; i++) {
      const imageFile = path.join(imagesDir, `${i}.${imageFormat}`);
      if (!await fs.pathExists(imageFile)) continue;

      const imageCID = await pinFileToPinata(imageFile, `${collectionName} #${i}`);
      console.log(`📌 [${i}/${totalNFTs}] Image pinned: ${imageCID}`);

      // Update metadata with individual image CID
      const metaFile = path.join(metadataDir, `${i}.json`);
      if (await fs.pathExists(metaFile)) {
        const metadata = await fs.readJSON(metaFile);
        metadata.image = `ipfs://${imageCID}`;
        await fs.writeJSON(metaFile, metadata, { spaces: 2 });
      }

      // Pin metadata individually
      const metadataCID = await pinFileToPinata(metaFile, `${collectionName} #${i} Metadata`);
      console.log(`📌 [${i}/${totalNFTs}] Metadata pinned: ${metadataCID}`);

      nftResults.push({
        number: i,
        imageCID,
        metadataCID,
        tokenURI: `ipfs://${metadataCID}`
      });
    }

    console.log(`✅ All ${nftResults.length} NFTs pinned individually!`);

    // Clean up temp output and session
    await fs.remove(outputDir);
    await fs.remove(sessionDir);

    res.json({
      success: true,
      mint_ready: true,
      nfts: nftResults,
      token_uris: nftResults.map(n => n.tokenURI),
      collection_info: {
        name: collectionName,
        description: body.config.collectionDescription,
        total_nfts: totalNFTs
      },
      generation_stats: {
        total: result.totalNFTs,
        successful: result.successful,
        failed: result.failed,
        duration: result.duration
      }
    });

  } catch (error: any) {
    console.error('Session generation error:', error);
    if (outputDir) await fs.remove(outputDir).catch(console.error);
    res.status(500).json({ success: false, error: error.message || 'Failed to generate collection' });
  }
}
