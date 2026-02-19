/**
 * Image composition using Sharp library
 * Handles layering of trait images to create final NFT artwork
 */

import sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';
import { SelectedTraits } from './types';

export interface CompositeOptions {
  width?: number;
  height?: number;
  format?: 'png' | 'jpg' | 'webp';
  quality?: number;
}

/**
 * Load and prepare an image layer
 */
async function loadImageLayer(imagePath: string, options: CompositeOptions): Promise<Buffer> {
  let image = sharp(imagePath);

  // Resize if dimensions are specified
  if (options.width && options.height) {
    image = image.resize(options.width, options.height, {
      fit: 'cover',
      position: 'center'
    });
  }

  // Ensure RGBA for proper alpha compositing
  return await image.ensureAlpha().toBuffer();
}

/**
 * Composite multiple image layers into a single image
 */
export async function compositeImages(
  traitsDir: string,
  traitOrder: string[],
  selectedTraits: SelectedTraits,
  outputPath: string,
  options: CompositeOptions = {}
): Promise<void> {
  const {
    width,
    height,
    format = 'png',
    quality = 100
  } = options;

  try {
    // Build array of layer paths in order
    const layerPaths: string[] = [];
    
    for (const traitCategory of traitOrder) {
      const traitFileName = selectedTraits[traitCategory];
      if (!traitFileName) {
        throw new Error(`Missing trait for category: ${traitCategory}`);
      }

      // Find the actual file (could be .png, .jpg, etc.)
      const traitFolderPath = path.join(traitsDir, traitCategory);
      const files = fs.readdirSync(traitFolderPath);
      const matchingFile = files.find(file => {
        const baseName = path.parse(file).name;
        return baseName === traitFileName || file === traitFileName;
      });

      if (!matchingFile) {
        throw new Error(`Trait file not found: ${traitFileName} in ${traitCategory}`);
      }

      layerPaths.push(path.join(traitFolderPath, matchingFile));
    }

    if (layerPaths.length === 0) {
      throw new Error('No layers to composite');
    }

    // Start with the first layer (usually Background)
    let baseImage = sharp(layerPaths[0]);

    // Apply dimensions if specified
    if (width && height) {
      baseImage = baseImage.resize(width, height, {
        fit: 'cover',
        position: 'center'
      });
    }

    // Get base image metadata to ensure consistent dimensions
    const metadata = await baseImage.metadata();
    const finalWidth = width || metadata.width || 1000;
    const finalHeight = height || metadata.height || 1000;

    // Prepare composite layers (all layers except the first)
    const compositeLayers = [];
    
    for (let i = 1; i < layerPaths.length; i++) {
      const layerBuffer = await loadImageLayer(layerPaths[i], {
        width: finalWidth,
        height: finalHeight
      });
      
      compositeLayers.push({
        input: layerBuffer,
        top: 0,
        left: 0,
        blend: 'over' as const
      });
    }

    // Composite all layers
    let finalImage = baseImage.composite(compositeLayers);

    // Convert to final format
    if (format === 'png') {
      finalImage = finalImage.png({ quality });
    } else if (format === 'jpg') {
      finalImage = finalImage.jpeg({ quality });
    } else if (format === 'webp') {
      finalImage = finalImage.webp({ quality });
    }

    // Save the final image
    await finalImage.toFile(outputPath);

  } catch (error) {
    throw new Error(`Failed to composite images: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get image dimensions from a file
 */
export async function getImageDimensions(imagePath: string): Promise<{ width: number; height: number }> {
  const metadata = await sharp(imagePath).metadata();
  return {
    width: metadata.width || 0,
    height: metadata.height || 0
  };
}

