#!/usr/bin/env python3
"""
Upload NFT Images to Pinata IPFS

Uploads all images from a directory to Pinata IPFS
Returns the directory CID for use in metadata
"""

import os
import sys
import requests
import json
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# ============================================================================
# CONFIGURATION
# ============================================================================
PINATA_API_KEY = os.getenv("PINATA_API_KEY")
PINATA_API_SECRET = os.getenv("PINATA_API_SECRET")
IMAGE_DIR = os.getenv("IMAGE_DIR", "images")

# Pinata endpoints
PINATA_UPLOAD_URL = "https://api.pinata.cloud/pinning/pinFileToIPFS"

# ============================================================================
# VALIDATION
# ============================================================================
if not PINATA_API_KEY or not PINATA_API_SECRET:
    print("❌ ERROR: Missing Pinata API credentials")
    print("   Required: PINATA_API_KEY, PINATA_API_SECRET in .env file")
    print("   Optional: IMAGE_DIR (default: 'images')")
    sys.exit(1)

if not os.path.exists(IMAGE_DIR):
    print(f"❌ ERROR: Image directory not found: {IMAGE_DIR}")
    sys.exit(1)

def upload_images_to_pinata():
    """Upload all images from output/ folder to Pinata"""
    
    print("=" * 70)
    print("UPLOADING IMAGES TO PINATA")
    print("=" * 70)
    print()
    
    # Get all PNG files
    image_files = sorted([f for f in os.listdir(IMAGE_DIR) if f.endswith('.png')])
    
    if not image_files:
        print(f"❌ No PNG files found in {IMAGE_DIR}/")
        return None
    
    print(f"📁 Found {len(image_files)} images to upload")
    print()
    
    # Prepare headers
    headers = {
        "pinata_api_key": PINATA_API_KEY,
        "pinata_secret_api_key": PINATA_API_SECRET,
    }
    
    # Upload each image
    uploaded_count = 0
    for i, filename in enumerate(image_files, 1):
        filepath = os.path.join(IMAGE_DIR, filename)
        
        try:
            with open(filepath, 'rb') as f:
                files = {'file': (filename, f)}
                response = requests.post(PINATA_UPLOAD_URL, headers=headers, files=files)
            
            if response.status_code == 200:
                data = response.json()
                cid = data['IpfsHash']
                uploaded_count += 1
                print(f"✅ [{i}/{len(image_files)}] {filename} → {cid}")
            else:
                print(f"❌ [{i}/{len(image_files)}] {filename} - Error: {response.text}")
        
        except Exception as e:
            print(f"❌ [{i}/{len(image_files)}] {filename} - Exception: {str(e)}")
    
    print()
    print("=" * 70)
    print(f"✅ UPLOAD COMPLETE: {uploaded_count}/{len(image_files)} images uploaded")
    print("=" * 70)
    print()
    
    if uploaded_count == len(image_files):
        print("🎉 All images successfully uploaded to Pinata!")
        print()
        print("📝 Next steps:")
        print("1. Note the image CID from the first image above")
        print("2. We'll use this to update all metadata files")
        print()
        return True
    else:
        print(f"⚠️  Only {uploaded_count}/{len(image_files)} images uploaded")
        return False

if __name__ == "__main__":
    upload_images_to_pinata()

