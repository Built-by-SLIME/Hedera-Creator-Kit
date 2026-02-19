/**
 * NFT Metadata Generator
 * Creates Hedera-compatible metadata JSON files
 */

import * as fs from 'fs';
import * as path from 'path';
import { NFTMetadata, SelectedTraits, TraitAttribute } from './types';

export interface MetadataOptions {
  collectionName: string;
  collectionDescription: string;
  imageBaseURI?: string;
  imageExtension?: string;
  includeEdition?: boolean;
  customAttributes?: TraitAttribute[];
}

export class MetadataGenerator {
  private options: MetadataOptions;

  constructor(options: MetadataOptions) {
    this.options = {
      imageExtension: 'png',
      includeEdition: false,
      ...options
    };
  }

  /**
   * Generate metadata for a single NFT
   */
  generateMetadata(
    nftNumber: number,
    selectedTraits: SelectedTraits,
    traitOrder: string[]
  ): NFTMetadata {
    const { collectionName, collectionDescription, imageBaseURI, imageExtension } = this.options;

    // Build attributes array from selected traits
    const attributes: TraitAttribute[] = traitOrder.map(traitCategory => ({
      trait_type: traitCategory,
      value: selectedTraits[traitCategory]
    }));

    // Add custom attributes if provided
    if (this.options.customAttributes) {
      attributes.push(...this.options.customAttributes);
    }

    // Add edition number if enabled
    if (this.options.includeEdition) {
      attributes.push({
        trait_type: 'Edition',
        value: `#${nftNumber}`
      });
    }

    // Build image URI
    let imageURI: string;
    if (imageBaseURI) {
      // Use provided base URI (e.g., IPFS CID)
      imageURI = `${imageBaseURI}/${nftNumber}.${imageExtension}`;
    } else {
      // Use placeholder that will be updated after IPFS upload
      imageURI = `ipfs://PLACEHOLDER_CID/${nftNumber}.${imageExtension}`;
    }

    return {
      name: `${collectionName} #${nftNumber}`,
      description: collectionDescription,
      image: imageURI,
      attributes
    };
  }

  /**
   * Save metadata to a JSON file
   */
  saveMetadata(
    nftNumber: number,
    metadata: NFTMetadata,
    metadataDir: string
  ): string {
    const filename = `${nftNumber}.json`;
    const filepath = path.join(metadataDir, filename);

    fs.writeFileSync(filepath, JSON.stringify(metadata, null, 2));

    return filepath;
  }

  /**
   * Update image URIs in all metadata files with actual IPFS CID
   */
  updateImageURIs(metadataDir: string, ipfsCID: string, imageExtension: string = 'png'): void {
    const files = fs.readdirSync(metadataDir).filter(file => file.endsWith('.json'));

    let updatedCount = 0;

    for (const file of files) {
      const filepath = path.join(metadataDir, file);
      const metadata = JSON.parse(fs.readFileSync(filepath, 'utf-8')) as NFTMetadata;

      // Extract NFT number from filename
      const nftNumber = path.parse(file).name;

      // Update image URI
      metadata.image = `ipfs://${ipfsCID}/${nftNumber}.${imageExtension}`;

      // Save updated metadata
      fs.writeFileSync(filepath, JSON.stringify(metadata, null, 2));
      updatedCount++;
    }

    console.log(`✅ Updated ${updatedCount} metadata files with IPFS CID: ${ipfsCID}`);
  }

  /**
   * Generate a collection manifest file
   */
  generateCollectionManifest(
    metadataDir: string,
    totalNFTs: number,
    outputPath?: string
  ): void {
    const manifest = {
      name: this.options.collectionName,
      description: this.options.collectionDescription,
      totalSupply: totalNFTs,
      generatedAt: new Date().toISOString(),
      nfts: [] as { number: number; name: string; traits: { [key: string]: string } }[]
    };

    // Read all metadata files
    const files = fs.readdirSync(metadataDir)
      .filter(file => file.endsWith('.json'))
      .sort((a, b) => {
        const numA = parseInt(path.parse(a).name);
        const numB = parseInt(path.parse(b).name);
        return numA - numB;
      });

    for (const file of files) {
      const filepath = path.join(metadataDir, file);
      const metadata = JSON.parse(fs.readFileSync(filepath, 'utf-8')) as NFTMetadata;
      const nftNumber = parseInt(path.parse(file).name);

      const traits: { [key: string]: string } = {};
      metadata.attributes.forEach(attr => {
        traits[attr.trait_type] = attr.value;
      });

      manifest.nfts.push({
        number: nftNumber,
        name: metadata.name,
        traits
      });
    }

    const manifestPath = outputPath || path.join(metadataDir, 'collection_manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    console.log(`✅ Collection manifest saved to: ${manifestPath}`);
  }
}

