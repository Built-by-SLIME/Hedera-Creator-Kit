/**
 * Main NFT Generator
 * Orchestrates the entire NFT generation process
 */

import * as path from 'path';
import {
  GeneratorConfig,
  RarityConfig,
  GenerationResult,
  GenerationSummary
} from './types';
import { TraitSelector } from './traitSelector';
import { MetadataGenerator } from './metadataGenerator';
import { compositeImages } from './imageComposer';
import {
  ensureDirectoryExists,
  formatNFTNumber,
  validateTraitOrder,
  calculateProgress,
  formatDuration,
  getFileSize
} from './utils';

export class NFTGenerator {
  private config: GeneratorConfig;
  private rarityConfig: RarityConfig;
  private traitSelector: TraitSelector;
  private metadataGenerator: MetadataGenerator;

  constructor(config: GeneratorConfig, rarityConfig: RarityConfig = {}) {
    this.config = config;
    this.rarityConfig = rarityConfig;

    // Initialize trait selector
    this.traitSelector = new TraitSelector(
      config.traitsDir,
      config.traitOrder,
      rarityConfig
    );

    // Initialize metadata generator
    this.metadataGenerator = new MetadataGenerator({
      collectionName: config.collectionName,
      collectionDescription: config.collectionDescription,
      imageExtension: config.imageFormat || 'png'
    });
  }

  /**
   * Generate a single NFT
   */
  async generateNFT(nftNumber: number): Promise<GenerationResult> {
    try {
      // Select traits for this NFT
      const selectedTraits = this.traitSelector.selectTraits(nftNumber);
      
      if (!selectedTraits) {
        return {
          success: false,
          nftNumber,
          error: 'Failed to select traits'
        };
      }

      // Generate image filename
      const imageFilename = `${nftNumber}.${this.config.imageFormat || 'png'}`;
      const imagePath = path.join(this.config.outputDir, imageFilename);

      // Composite images
      await compositeImages(
        this.config.traitsDir,
        this.config.traitOrder,
        selectedTraits,
        imagePath,
        {
          width: this.config.imageWidth,
          height: this.config.imageHeight,
          format: this.config.imageFormat,
          quality: this.config.imageQuality
        }
      );

      // Generate metadata
      const metadata = this.metadataGenerator.generateMetadata(
        nftNumber,
        selectedTraits,
        this.config.traitOrder
      );

      // Save metadata
      const metadataPath = this.metadataGenerator.saveMetadata(
        nftNumber,
        metadata,
        this.config.metadataDir
      );

      return {
        success: true,
        nftNumber,
        imagePath,
        metadataPath,
        traits: selectedTraits
      };

    } catch (error) {
      return {
        success: false,
        nftNumber,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Generate all NFTs in the collection
   */
  async generateCollection(
    onProgress?: (current: number, total: number, result: GenerationResult) => void
  ): Promise<GenerationSummary> {
    const startTime = Date.now();

    console.log('🎨 NFT Art Generator');
    console.log('='.repeat(60));
    console.log(`Collection: ${this.config.collectionName}`);
    console.log(`Total NFTs: ${this.config.numNFTs}`);
    console.log(`Trait Order: ${this.config.traitOrder.join(' → ')}`);
    console.log('='.repeat(60));
    console.log();

    // Validate configuration
    const validation = validateTraitOrder(this.config.traitsDir, this.config.traitOrder);
    if (!validation.valid) {
      throw new Error(`Missing trait folders: ${validation.missingTraits.join(', ')}`);
    }

    // Ensure output directories exist
    ensureDirectoryExists(this.config.outputDir);
    ensureDirectoryExists(this.config.metadataDir);

    const results: GenerationResult[] = [];
    let successful = 0;
    let failed = 0;

    // Generate each NFT
    for (let i = 1; i <= this.config.numNFTs; i++) {
      const result = await this.generateNFT(i);
      results.push(result);

      if (result.success) {
        successful++;
        const progress = calculateProgress(i, this.config.numNFTs);
        console.log(`✅ [${progress}%] Generated NFT #${i}`);
      } else {
        failed++;
        console.error(`❌ Failed NFT #${i}: ${result.error}`);
      }

      // Call progress callback if provided
      if (onProgress) {
        onProgress(i, this.config.numNFTs, result);
      }
    }

    const duration = Date.now() - startTime;

    console.log();
    console.log('='.repeat(60));
    console.log('✅ Generation Complete!');
    console.log(`   Successful: ${successful}/${this.config.numNFTs}`);
    console.log(`   Failed: ${failed}`);
    console.log(`   Duration: ${formatDuration(duration)}`);
    console.log(`   Images: ${this.config.outputDir}`);
    console.log(`   Metadata: ${this.config.metadataDir}`);
    console.log('='.repeat(60));

    return {
      totalNFTs: this.config.numNFTs,
      successful,
      failed,
      results,
      outputDir: this.config.outputDir,
      metadataDir: this.config.metadataDir,
      duration
    };
  }
}

