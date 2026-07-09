import { Request, Response } from 'express';
import path from 'path';
import fs from 'fs-extra';
import axios from 'axios';
import FormData from 'form-data';
import { v4 as uuidv4 } from 'uuid';
import { NFTGenerator } from '../../5-art-generator/nftGenerator';
import { GeneratorConfig, RarityConfig } from '../../5-art-generator/types';
import {
  createJob,
  updateJob,
  GenerationResult
} from '../jobStore';

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
    startSerialNumber?: number;
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
 * Start a full collection generation as a background job.
 *
 * The HTTP response returns immediately with a jobId. The actual generation
 * and pinning runs asynchronously so proxies/browsers cannot time out the
 * long-running work.
 */
export async function generateFromSession(req: Request, res: Response) {
  try {
    const body: SessionGenerateRequest = req.body;

    if (!body.sessionId) {
      return res.status(400).json({ success: false, error: 'sessionId is required' });
    }

    const sessionDir = path.join(__dirname, '../../temp-sessions', body.sessionId);

    if (!await fs.pathExists(sessionDir)) {
      return res.status(404).json({ success: false, error: 'Session not found. Please re-upload your ZIP file.' });
    }

    const totalNFTs = body.config.collectionSize;
    if (!totalNFTs || totalNFTs < 1) {
      return res.status(400).json({ success: false, error: 'collectionSize must be at least 1' });
    }

    const jobId = uuidv4();
    createJob(jobId, body.sessionId, totalNFTs);

    // Run the long generation/pinning work in the background. Do NOT await.
    runGenerationJob(jobId, body, sessionDir).catch((error) => {
      console.error(`Unhandled error in generation job ${jobId}:`, error);
      updateJob(jobId, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error)
      });
    });

    return res.json({
      success: true,
      jobId,
      status: 'queued',
      message: 'Generation job started. Poll /api/generate-status/:jobId for progress.'
    });

  } catch (error: any) {
    console.error('Failed to start session generation:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to start generation job'
    });
  }
}

/**
 * Background worker: generate images + metadata, pin to Pinata, and update
 * the shared job record as it progresses.
 */
async function runGenerationJob(
  jobId: string,
  body: SessionGenerateRequest,
  sessionDir: string
): Promise<void> {
  let outputDir: string | null = null;

  try {
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
      imageQuality: body.config.imageQuality || 100,
      startSerialNumber: body.config.startSerialNumber ?? 1
    };

    const rarityConfig: RarityConfig = body.config.rarity || {};
    const collectionName = body.config.collectionName || 'Collection';
    const imageFormat = body.config.imageFormat || 'png';
    const totalNFTs = body.config.collectionSize;
    const startSerialNumber = body.config.startSerialNumber ?? 1;
    const endSerialNumber = startSerialNumber + totalNFTs - 1;

    console.log(`[Job ${jobId}] Generating ${totalNFTs} NFTs...`);

    updateJob(jobId, { status: 'generating' });

    const generator = new NFTGenerator(generatorConfig, rarityConfig);
    const result = await generator.generateCollection((current, total) => {
      updateJob(jobId, { generated: current });
      if (current % 50 === 0 || current === total) {
        console.log(`[Job ${jobId}] Generated ${current}/${total}`);
      }
    });

    if (result.failed > 0 && result.successful === 0) {
      throw new Error('Failed to generate NFT collection');
    }

    // Pin each image individually and remember its CID for the result object
    const imageCIDs = new Map<number, string>();

    console.log(`[Job ${jobId}] Pinning ${totalNFTs} images to IPFS individually...`);
    updateJob(jobId, { status: 'pinning_images' });

    for (let serial = startSerialNumber; serial <= endSerialNumber; serial++) {
      const imageFile = path.join(imagesDir, `${serial}.${imageFormat}`);
      if (!await fs.pathExists(imageFile)) continue;

      const imageCID = await pinFileToPinata(imageFile, `${collectionName} #${serial}`);
      imageCIDs.set(serial, imageCID);

      // Update metadata with individual image CID
      const metaFile = path.join(metadataDir, `${serial}.json`);
      if (await fs.pathExists(metaFile)) {
        const metadata = await fs.readJSON(metaFile);
        metadata.image = `ipfs://${imageCID}`;
        await fs.writeJSON(metaFile, metadata, { spaces: 2 });
      }

      updateJob(jobId, { pinnedImages: imageCIDs.size });
      if (imageCIDs.size % 50 === 0 || serial === endSerialNumber) {
        console.log(`[Job ${jobId}] Pinned ${imageCIDs.size}/${totalNFTs} images`);
      }
    }

    // Pin metadata individually
    console.log(`[Job ${jobId}] Pinning ${totalNFTs} metadata files to IPFS individually...`);
    updateJob(jobId, { status: 'pinning_metadata' });

    const nftResults: GenerationResult[] = [];

    for (let serial = startSerialNumber; serial <= endSerialNumber; serial++) {
      const metaFile = path.join(metadataDir, `${serial}.json`);
      if (!await fs.pathExists(metaFile)) continue;

      const metadataCID = await pinFileToPinata(metaFile, `${collectionName} #${serial} Metadata`);

      nftResults.push({
        number: serial,
        imageCID: imageCIDs.get(serial) || '',
        metadataCID,
        tokenURI: `ipfs://${metadataCID}`
      });

      updateJob(jobId, { pinnedMetadata: nftResults.length });
      if (nftResults.length % 50 === 0 || serial === endSerialNumber) {
        console.log(`[Job ${jobId}] Pinned ${nftResults.length}/${totalNFTs} metadata files`);
      }
    }

    console.log(`[Job ${jobId}] ✅ All ${nftResults.length} NFTs pinned individually!`);

    // Clean up temp output and session
    await fs.remove(outputDir);
    await fs.remove(sessionDir);

    updateJob(jobId, {
      status: 'completed',
      result: {
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
      }
    });

  } catch (error: any) {
    console.error(`[Job ${jobId}] Generation error:`, error);
    if (outputDir) await fs.remove(outputDir).catch(console.error);
    updateJob(jobId, {
      status: 'failed',
      error: error.message || 'Failed to generate collection'
    });
  }
}
