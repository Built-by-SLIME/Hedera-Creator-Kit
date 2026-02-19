import { Request, Response } from 'express';
import path from 'path';
import fs from 'fs-extra';
import { v4 as uuidv4 } from 'uuid';
import { NFTGenerator } from '../../5-art-generator/nftGenerator';
import { GeneratorConfig, RarityConfig } from '../../5-art-generator/types';
import { previewSessions, BACKEND_ROOT } from '../server';

const MAX_PREVIEWS = 5;
const PREVIEW_COUNT = 20;

interface SessionPreviewRequest {
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

/**
 * Preview using already-uploaded session layers (no re-upload needed)
 */
export async function previewFromSession(req: Request, res: Response) {
  let outputDir: string | null = null;

  try {
    const body: SessionPreviewRequest = req.body;

    if (!body.sessionId) {
      return res.status(400).json({ success: false, error: 'sessionId is required' });
    }

    // Find the session directory
    const sessionDir = path.join(BACKEND_ROOT, 'temp-sessions', body.sessionId);

    if (!await fs.pathExists(sessionDir)) {
      return res.status(404).json({ success: false, error: 'Session not found. Please re-upload your ZIP file.' });
    }

    // Read the resolved scan directory from session metadata (saved during upload)
    const sessionMeta = await fs.readJSON(path.join(sessionDir, 'session.json')).catch(() => null);
    const scanDir = sessionMeta?.scanDir || path.join(sessionDir, 'traits');

    // Check preview limit
    const session = previewSessions.get(body.sessionId) || { count: 0, lastAccess: Date.now() };
    if (session.count >= MAX_PREVIEWS) {
      return res.status(429).json({
        success: false,
        error: `Preview limit reached (${MAX_PREVIEWS}). Please generate your full collection or start over.`,
        previewCount: session.count,
        previewsRemaining: 0
      });
    }

    session.count += 1;
    session.lastAccess = Date.now();
    previewSessions.set(body.sessionId, session);

    // Create temp output directory
    const tempId = uuidv4();
    outputDir = path.join(BACKEND_ROOT, 'temp-previews', tempId);
    const metadataDir = path.join(outputDir, 'metadata');
    const imagesDir = path.join(outputDir, 'images');

    await fs.ensureDir(imagesDir);
    await fs.ensureDir(metadataDir);

    // Configure generator
    const generatorConfig: GeneratorConfig = {
      traitsDir: scanDir,
      outputDir: imagesDir,
      metadataDir,
      numNFTs: PREVIEW_COUNT,
      traitOrder: body.config.traitOrder,
      collectionName: body.config.collectionName || 'Preview',
      collectionDescription: body.config.collectionDescription || '',
      imageWidth: body.config.imageWidth,
      imageHeight: body.config.imageHeight,
      imageFormat: body.config.imageFormat || 'png',
      imageQuality: body.config.imageQuality || 100
    };

    const rarityConfig: RarityConfig = body.config.rarity || {};

    // Generate preview NFTs
    const generator = new NFTGenerator(generatorConfig, rarityConfig);
    const result = await generator.generateCollection();

    if (result.failed > 0 && result.successful === 0) {
      throw new Error('Failed to generate preview NFTs');
    }

    // Read generated files and convert to base64
    const previews = [];
    for (let i = 1; i <= PREVIEW_COUNT; i++) {
      const imagePath = path.join(imagesDir, `${i}.${body.config.imageFormat || 'png'}`);
      const metadataPath = path.join(metadataDir, `${i}.json`);

      if (await fs.pathExists(imagePath) && await fs.pathExists(metadataPath)) {
        const imageBuffer = await fs.readFile(imagePath);
        const format = body.config.imageFormat || 'png';
        const imageBase64 = `data:image/${format};base64,${imageBuffer.toString('base64')}`;
        const metadata = await fs.readJSON(metadataPath);
        previews.push({ id: i, image: imageBase64, metadata });
      }
    }

    // Clean up temp output
    await fs.remove(outputDir);

    res.json({
      success: true,
      sessionId: body.sessionId,
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
    console.error('Session preview error:', error);
    if (outputDir) await fs.remove(outputDir).catch(console.error);
    res.status(500).json({ success: false, error: error.message || 'Failed to generate preview' });
  }
}

