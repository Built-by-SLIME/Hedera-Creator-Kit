/**
 * Type definitions for NFT Art Generator
 */

export interface TraitFile {
  name: string;
  path: string;
  extension: string;
}

export interface SelectedTraits {
  [traitCategory: string]: string;
}

export interface TraitAttribute {
  trait_type: string;
  value: string;
}

export interface NFTMetadata {
  name: string;
  description: string;
  image: string;
  attributes: TraitAttribute[];
}

export interface GeneratorConfig {
  traitsDir: string;
  outputDir: string;
  metadataDir: string;
  numNFTs: number;
  traitOrder: string[];
  collectionName: string;
  collectionDescription: string;
  imageWidth?: number;
  imageHeight?: number;
  imageFormat?: 'png' | 'jpg' | 'webp';
  imageQuality?: number;
}

export interface SpecialNFT {
  nftNumber: number;
  traits: { [traitCategory: string]: string };
}

export interface TraitWeight {
  traitCategory: string;
  traitValue: string;
  weight: number;
}

export interface ExclusionRule {
  trait1: { category: string; value: string };
  trait2: { category: string; value: string };
}

export interface ForcedPairing {
  ifTrait: { category: string; value: string };
  thenTrait: { category: string; value: string };
}

export interface RarityConfig {
  excludeTraits?: { [traitCategory: string]: string[] };
  specialNFTs?: SpecialNFT[];
  customRules?: {
    traitCategory: string;
    traitValue: string;
    maxCount: number;
    assignedNFTs?: Set<number>;
  }[];
  weights?: TraitWeight[];
  exclusionRules?: ExclusionRule[];
  forcedPairings?: ForcedPairing[];
}

export interface GenerationResult {
  success: boolean;
  nftNumber: number;
  imagePath?: string;
  metadataPath?: string;
  traits?: SelectedTraits;
  error?: string;
}

export interface GenerationSummary {
  totalNFTs: number;
  successful: number;
  failed: number;
  results: GenerationResult[];
  outputDir: string;
  metadataDir: string;
  duration: number;
}

