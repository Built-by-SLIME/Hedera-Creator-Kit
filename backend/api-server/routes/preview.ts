import { Request, Response } from 'express';
import path from 'path';
import fs from 'fs-extra';
import AdmZip from 'adm-zip';
import { v4 as uuidv4 } from 'uuid';
import { NFTGenerator } from '../../5-art-generator/nftGenerator';
import { GeneratorConfig, RarityConfig } from '../../5-art-generator/types';
import { previewSessions } from '../server';

const MAX_PREVIEWS = 5;
const PREVIEW_COUNT = 20;

interface PreviewRequest {
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
    sessionId?: string;
  };
}

export async function previewCollection(req: Request, res: Response) {
  let tempDir: string | null = null;
  
  try {
    // Validate file upload
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No ZIP file uploaded'
      });
    }

    // Parse config from form data
    const configData: PreviewRequest['config'] = JSON.parse(req.body.config || '{}');
    
    // Get or create session ID
    const sessionId = configData.sessionId || uuidv4();
    
    // Check preview limit
    const session = previewSessions.get(sessionId) || { count: 0, lastAccess: Date.now() };
    
    if (session.count >= MAX_PREVIEWS) {
      return res.status(429).json({
        success: false,
        error: `Preview limit reached. Maximum ${MAX_PREVIEWS} preview generations allowed.`,
        previewCount: session.count,
        previewsRemaining: 0
      });
    }

    // Update session
    session.count += 1;
    session.lastAccess = Date.now();
    previewSessions.set(sessionId, session);

    // Create temp directory
    tempDir = path.join(__dirname, '../../temp-previews', uuidv4());
    await fs.ensureDir(tempDir);

    const traitsDir = path.join(tempDir, 'traits');
    const outputDir = path.join(tempDir, 'output');
    const metadataDir = path.join(tempDir, 'metadata');

    await fs.ensureDir(traitsDir);
    await fs.ensureDir(outputDir);
    await fs.ensureDir(metadataDir);

    // Extract ZIP to traits directory
    const zip = new AdmZip(req.file.path);
    zip.extractAllTo(traitsDir, true);

    // Clean up uploaded ZIP
    await fs.remove(req.file.path);

    // Configure generator for preview
    const generatorConfig: GeneratorConfig = {
      traitsDir,
      outputDir,
      metadataDir,
      numNFTs: PREVIEW_COUNT,
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

    // Generate preview NFTs
    const generator = new NFTGenerator(generatorConfig, rarityConfig);
    const result = await generator.generateCollection();

    if (result.failed > 0 && result.successful === 0) {
      throw new Error('Failed to generate preview NFTs');
    }

    // Read generated files and convert to base64
    const previews = [];
    
    for (let i = 1; i <= PREVIEW_COUNT; i++) {
      const imagePath = path.join(outputDir, `${i}.png`);
      const metadataPath = path.join(metadataDir, `${i}.json`);
      
      if (await fs.pathExists(imagePath) && await fs.pathExists(metadataPath)) {
        const imageBuffer = await fs.readFile(imagePath);
        const imageBase64 = `data:image/png;base64,${imageBuffer.toString('base64')}`;
        const metadata = await fs.readJSON(metadataPath);
        
        previews.push({
          id: i,
          image: imageBase64,
          metadata
        });
      }
    }

    // Clean up temp directory
    await fs.remove(tempDir);

    // Send response
    res.json({
      success: true,
      sessionId,
      previews,
      previewCount: session.count,
      previewsRemaining: MAX_PREVIEWS - session.count,
      generationStats: {
        total: result.totalNFTs,
        successful: result.successful,
        failed: result.failed,
        duration: result.duration
      }
    });

  } catch (error: any) {
    console.error('Preview generation error:', error);
    
    // Clean up on error
    if (tempDir) {
      await fs.remove(tempDir).catch(console.error);
    }
    if (req.file?.path) {
      await fs.remove(req.file.path).catch(console.error);
    }

    res.status(500).json({
      success: false,
      error: error.message || 'Failed to generate preview'
    });
  }
}

