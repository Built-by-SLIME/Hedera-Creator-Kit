/**
 * Trait selection logic with rarity controls
 */

import { SelectedTraits, RarityConfig, SpecialNFT } from './types';
import { getTraitFiles, selectRandomTrait } from './utils';

export class TraitSelector {
  private traitsDir: string;
  private traitOrder: string[];
  private rarityConfig: RarityConfig;

  constructor(traitsDir: string, traitOrder: string[], rarityConfig: RarityConfig = {}) {
    this.traitsDir = traitsDir;
    this.traitOrder = traitOrder;
    this.rarityConfig = rarityConfig;
  }

  /**
   * Select traits for a specific NFT number
   */
  selectTraits(nftNumber: number): SelectedTraits | null {
    // Check if this is a special NFT with hardcoded traits
    const specialNFT = this.getSpecialNFT(nftNumber);
    if (specialNFT) {
      return this.selectSpecialTraits(specialNFT);
    }

    // Select random traits with rarity rules
    return this.selectRandomTraits(nftNumber);
  }

  /**
   * Get special NFT configuration if exists
   */
  private getSpecialNFT(nftNumber: number): SpecialNFT | undefined {
    return this.rarityConfig.specialNFTs?.find(
      special => special.nftNumber === nftNumber
    );
  }

  /**
   * Select traits for a special NFT (hardcoded)
   */
  private selectSpecialTraits(specialNFT: SpecialNFT): SelectedTraits | null {
    const selectedTraits: SelectedTraits = {};

    for (const traitCategory of this.traitOrder) {
      const traitValue = specialNFT.traits[traitCategory];
      
      if (!traitValue) {
        console.error(`❌ Special NFT missing trait: ${traitCategory}`);
        return null;
      }

      // Verify the trait file exists
      const traitFiles = getTraitFiles(this.traitsDir, traitCategory);
      const matchingFile = traitFiles.find(file => file.name === traitValue);

      if (!matchingFile) {
        console.error(`❌ Special NFT trait not found: ${traitValue} in ${traitCategory}`);
        return null;
      }

      selectedTraits[traitCategory] = traitValue;
    }

    return selectedTraits;
  }

  /**
   * Select random traits with rarity rules, exclusions, and forced pairings
   */
  private selectRandomTraits(nftNumber: number): SelectedTraits | null {
    const selectedTraits: SelectedTraits = {};

    for (const traitCategory of this.traitOrder) {
      // Check if a forced pairing applies based on already-selected traits
      const forcedValue = this.getForcedPairing(traitCategory, selectedTraits);
      if (forcedValue) {
        // Verify the forced trait file exists
        const traitFiles = getTraitFiles(this.traitsDir, traitCategory);
        const matchingFile = traitFiles.find(f => f.name === forcedValue);
        if (matchingFile) {
          selectedTraits[traitCategory] = forcedValue;
          this.updateCustomRuleCounts(traitCategory, forcedValue, nftNumber);
          continue;
        }
        // If forced file doesn't exist, fall through to random selection
      }

      // Get exclusions for this trait category (includes exclusion rules based on already-selected traits)
      const excludeValues = this.getExclusionsForTrait(traitCategory, nftNumber, selectedTraits);

      // Get available trait files
      const traitFiles = getTraitFiles(this.traitsDir, traitCategory);

      if (traitFiles.length === 0) {
        console.error(`❌ No files found in ${traitCategory}`);
        return null;
      }

      // Select random trait (with weights if configured)
      const selectedFile = selectRandomTrait(
        traitFiles,
        excludeValues,
        this.rarityConfig.weights,
        traitCategory
      );

      if (!selectedFile) {
        console.error(`❌ Could not select trait for ${traitCategory}`);
        return null;
      }

      selectedTraits[traitCategory] = selectedFile.name;

      // Update custom rule counts if applicable
      this.updateCustomRuleCounts(traitCategory, selectedFile.name, nftNumber);
    }

    return selectedTraits;
  }

  /**
   * Check if a forced pairing applies for this category based on already-selected traits
   */
  private getForcedPairing(traitCategory: string, selectedTraits: SelectedTraits): string | null {
    if (!this.rarityConfig.forcedPairings) return null;

    for (const pairing of this.rarityConfig.forcedPairings) {
      // If this category is the "then" side of a forced pairing
      if (pairing.thenTrait.category === traitCategory) {
        // Check if the "if" trait was already selected
        const ifCategory = pairing.ifTrait.category;
        if (selectedTraits[ifCategory] === pairing.ifTrait.value) {
          return pairing.thenTrait.value;
        }
      }
    }

    return null;
  }

  /**
   * Get exclusions for a specific trait category
   */
  private getExclusionsForTrait(
    traitCategory: string,
    nftNumber: number,
    selectedTraits: SelectedTraits = {}
  ): string[] {
    const exclusions: string[] = [];

    // Add global exclusions
    if (this.rarityConfig.excludeTraits?.[traitCategory]) {
      exclusions.push(...this.rarityConfig.excludeTraits[traitCategory]);
    }

    // Add custom rule exclusions
    if (this.rarityConfig.customRules) {
      for (const rule of this.rarityConfig.customRules) {
        if (rule.traitCategory === traitCategory) {
          if (rule.assignedNFTs && !rule.assignedNFTs.has(nftNumber)) {
            if (rule.assignedNFTs.size >= rule.maxCount) {
              exclusions.push(rule.traitValue);
            }
          }
        }
      }
    }

    // Add exclusion rules based on already-selected traits
    if (this.rarityConfig.exclusionRules) {
      for (const rule of this.rarityConfig.exclusionRules) {
        // If this category is trait2's category, check if trait1 was already selected
        if (rule.trait2.category === traitCategory) {
          const selectedValue = selectedTraits[rule.trait1.category];
          if (selectedValue === rule.trait1.value) {
            exclusions.push(rule.trait2.value);
          }
        }
        // Also check the reverse direction
        if (rule.trait1.category === traitCategory) {
          const selectedValue = selectedTraits[rule.trait2.category];
          if (selectedValue === rule.trait2.value) {
            exclusions.push(rule.trait1.value);
          }
        }
      }
    }

    return exclusions;
  }

  /**
   * Update custom rule counts when a trait is selected
   */
  private updateCustomRuleCounts(
    traitCategory: string,
    traitValue: string,
    nftNumber: number
  ): void {
    if (!this.rarityConfig.customRules) return;

    for (const rule of this.rarityConfig.customRules) {
      if (rule.traitCategory === traitCategory && rule.traitValue === traitValue) {
        if (!rule.assignedNFTs) {
          rule.assignedNFTs = new Set();
        }
        rule.assignedNFTs.add(nftNumber);
      }
    }
  }

  /**
   * Pre-assign specific traits to specific NFT numbers
   */
  preAssignTraits(assignments: { nftNumber: number; traitCategory: string; traitValue: string }[]): void {
    if (!this.rarityConfig.customRules) {
      this.rarityConfig.customRules = [];
    }

    for (const assignment of assignments) {
      let rule = this.rarityConfig.customRules.find(
        r => r.traitCategory === assignment.traitCategory && r.traitValue === assignment.traitValue
      );

      if (!rule) {
        rule = {
          traitCategory: assignment.traitCategory,
          traitValue: assignment.traitValue,
          maxCount: Infinity,
          assignedNFTs: new Set()
        };
        this.rarityConfig.customRules.push(rule);
      }

      rule.assignedNFTs!.add(assignment.nftNumber);
    }
  }
}

