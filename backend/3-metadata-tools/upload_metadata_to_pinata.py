#!/usr/bin/env python3
"""
Upload NFT Metadata to Pinata IPFS

Uploads all metadata JSON files to Pinata IPFS individually
Returns CIDs for use in minting
"""

import os
import sys
import json
import requests
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# ============================================================================
# CONFIGURATION
# ============================================================================
PINATA_API_KEY = os.getenv("PINATA_API_KEY")
PINATA_API_SECRET = os.getenv("PINATA_API_SECRET")
METADATA_DIR = os.getenv("METADATA_DIR", "metadata")

# ============================================================================
# VALIDATION
# ============================================================================
if not PINATA_API_KEY or not PINATA_API_SECRET:
    print("❌ ERROR: Missing Pinata API credentials")
    print("   Required: PINATA_API_KEY, PINATA_API_SECRET in .env file")
    print("   Optional: METADATA_DIR (default: 'metadata')")
    sys.exit(1)

# ============================================================================
# PINATA UPLOADER CLASS
# ============================================================================
class PinataUploader:
    def __init__(self, api_key: str, api_secret: str):
        self.api_key = api_key
        self.api_secret = api_secret
        self.base_url = "https://api.pinata.cloud"
    
    def upload_file(self, file_path: str) -> str:
        """Upload a single file to Pinata and return its CID."""
        try:
            with open(file_path, 'rb') as f:
                files = {'file': f}
                headers = {
                    'pinata_api_key': self.api_key,
                    'pinata_secret_api_key': self.api_secret,
                }
                
                response = requests.post(
                    f"{self.base_url}/pinning/pinFileToIPFS",
                    files=files,
                    headers=headers,
                    timeout=30
                )
                
                if response.status_code == 200:
                    return response.json()['IpfsHash']
                else:
                    raise Exception(f"Upload failed: {response.text}")
        except Exception as e:
            raise Exception(f"Error uploading {file_path}: {str(e)}")

# ============================================================================
# MAIN FUNCTION
# ============================================================================
def upload_all_metadata():
    """Upload all metadata JSON files to Pinata."""

    print("=" * 70)
    print("📤 UPLOADING METADATA TO PINATA")
    print("=" * 70)
    print()
    print(f"📁 Metadata Directory: {METADATA_DIR}")
    print()

    # Initialize uploader
    uploader = PinataUploader(PINATA_API_KEY, PINATA_API_SECRET)

    metadata_dir = Path(METADATA_DIR)
    if not metadata_dir.exists():
        print(f"❌ ERROR: Metadata directory not found: {METADATA_DIR}")
        return None

    cid_mapping = {}

    # Upload all JSON files
    print("📤 Uploading metadata files to Pinata...\n")
    
    json_files = sorted(metadata_dir.glob("*.json"))
    total = len(json_files)
    
    for i, json_file in enumerate(json_files, 1):
        try:
            cid = uploader.upload_file(str(json_file))
            nft_number = json_file.stem  # Get filename without extension
            cid_mapping[nft_number] = cid
            
            # Progress indicator
            if i % 10 == 0 or i == 1 or i == total:
                print(f"  [{i}/{total}] {json_file.name} → {cid}")
        except Exception as e:
            print(f"  ❌ Error uploading {json_file.name}: {e}")
            return None
    
    print()
    print("=" * 70)
    print("✅ UPLOAD COMPLETE")
    print("=" * 70)
    print(f"Successfully uploaded {len(cid_mapping)} metadata files")
    print()
    
    # Save mapping to file
    output_file = "metadata_cids_for_minting.json"
    with open(output_file, 'w') as f:
        json.dump(cid_mapping, f, indent=2)
    
    print(f"📄 CID mapping saved to: {output_file}")
    print()
    
    return cid_mapping

if __name__ == "__main__":
    upload_all_metadata()

