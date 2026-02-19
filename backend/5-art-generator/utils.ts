/**
 * Utility functions for NFT Art Generator
 */

import * as fs from 'fs';
import * as path from 'path';
import { TraitFile, TraitWeight } from './types';

/**
 * Get all image files from a trait folder
 */
export function getTraitFiles(traitsDir: string, traitCategory: string): TraitFile[] {
  const traitPath = path.join(traitsDir, traitCategory);
  
  if (!fs.existsSync(traitPath)) {
    console.warn(`⚠️  Warning: ${traitPath} does not exist`);
    return [];
  }

  const files = fs.readdirSync(traitPath);
  const imageExtensions = ['.png', '.jpg', '.jpeg', '.webp'];
  
  return files
    .filter(file => {
      const ext = path.extname(file).toLowerCase();
      return imageExtensions.includes(ext);
    })
    .map(file => ({
      name: path.parse(file).name,
      path: path.join(traitPath, file),
      extension: path.extname(file).toLowerCase()
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Select a random trait file from available options (supports weighted selection)
 */
export function selectRandomTrait(
  traitFiles: TraitFile[],
  excludeValues?: string[],
  weights?: TraitWeight[],
  traitCategory?: string
): TraitFile | null {
  if (traitFiles.length === 0) {
    return null;
  }

  let availableFiles = traitFiles;

  // Filter out excluded values if provided
  if (excludeValues && excludeValues.length > 0) {
    availableFiles = traitFiles.filter(
      file => !excludeValues.includes(file.name)
    );

    if (availableFiles.length === 0) {
      console.error('❌ No available files after exclusions');
      return null;
    }
  }

  // If weights are provided, use weighted random selection
  if (weights && traitCategory && weights.length > 0) {
    const categoryWeights = weights.filter(w => w.traitCategory === traitCategory);

    if (categoryWeights.length > 0) {
      // Build weight map for available files
      const weightedFiles = availableFiles.map(file => {
        const weightConfig = categoryWeights.find(w => w.traitValue === file.name);
        return {
          file,
          weight: weightConfig ? weightConfig.weight : 1 // default weight of 1
        };
      });

      const totalWeight = weightedFiles.reduce((sum, wf) => sum + wf.weight, 0);
      let random = Math.random() * totalWeight;

      for (const wf of weightedFiles) {
        random -= wf.weight;
        if (random <= 0) {
          return wf.file;
        }
      }

      // Fallback (shouldn't reach here)
      return weightedFiles[weightedFiles.length - 1].file;
    }
  }

  // Uniform random selection (no weights)
  const randomIndex = Math.floor(Math.random() * availableFiles.length);
  return availableFiles[randomIndex];
}

/**
 * Ensure a directory exists, create it if it doesn't
 */
export function ensureDirectoryExists(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Format NFT number with leading zeros
 */
export function formatNFTNumber(num: number, totalNFTs: number): string {
  const digits = totalNFTs.toString().length;
  return num.toString().padStart(digits, '0');
}

/**
 * Validate trait order against available folders
 */
export function validateTraitOrder(traitsDir: string, traitOrder: string[]): {
  valid: boolean;
  missingTraits: string[];
  availableTraits: string[];
} {
  if (!fs.existsSync(traitsDir)) {
    return {
      valid: false,
      missingTraits: traitOrder,
      availableTraits: []
    };
  }

  const availableTraits = fs.readdirSync(traitsDir)
    .filter(item => {
      const itemPath = path.join(traitsDir, item);
      return fs.statSync(itemPath).isDirectory();
    });

  const missingTraits = traitOrder.filter(
    trait => !availableTraits.includes(trait)
  );

  return {
    valid: missingTraits.length === 0,
    missingTraits,
    availableTraits
  };
}

/**
 * Get file size in human-readable format
 */
export function getFileSize(filePath: string): string {
  const stats = fs.statSync(filePath);
  const bytes = stats.size;
  
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

/**
 * Calculate generation progress percentage
 */
export function calculateProgress(current: number, total: number): number {
  return Math.round((current / total) * 100);
}

/**
 * Format duration in milliseconds to human-readable string
 */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

