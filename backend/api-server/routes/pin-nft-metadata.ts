import { Request, Response } from 'express';
import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs-extra';

/**
 * Pin individual NFT metadata (HIP-412 compliant) to IPFS via Pinata.
 *
 * Accepts multipart/form-data with:
 *   - image       (file, required) – the NFT image
 *   - name        (string, required) – NFT name
 *   - description (string, optional)
 *   - creator     (string, optional)
 *   - attributes  (JSON string, optional) – array of { trait_type, value, display_type? }
 *   - collectionName (string, optional) – used only for Pinata label
 *
 * Returns:
 *   { success, imageCID, metadataCID, tokenURI }
 */
export async function pinNftMetadata(req: Request, res: Response) {
  const PINATA_API_KEY = process.env.PINATA_API_KEY;
  const PINATA_API_SECRET = process.env.PINATA_API_SECRET;

  if (!PINATA_API_KEY || !PINATA_API_SECRET) {
    return res.status(500).json({ success: false, error: 'Pinata API credentials not configured on server' });
  }

  const filesToClean: string[] = [];

  try {
    const { name, description, creator, attributes, collectionName } = req.body;
    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    const imageFile = files?.image?.[0];

    if (!imageFile) {
      return res.status(400).json({ success: false, error: 'Image file is required' });
    }
    if (!name) {
      return res.status(400).json({ success: false, error: 'NFT name is required' });
    }

    filesToClean.push(imageFile.path);
    const label = collectionName || name || 'NFT';

    // 1. Pin image to IPFS
    const imgFormData = new FormData();
    imgFormData.append('file', fs.createReadStream(imageFile.path), {
      filename: imageFile.originalname,
    });
    imgFormData.append('pinataMetadata', JSON.stringify({ name: `${label} - Image` }));

    const imgRes = await axios.post(
      'https://api.pinata.cloud/pinning/pinFileToIPFS',
      imgFormData,
      {
        maxBodyLength: Infinity,
        headers: {
          'Content-Type': `multipart/form-data; boundary=${imgFormData.getBoundary()}`,
          pinata_api_key: PINATA_API_KEY,
          pinata_secret_api_key: PINATA_API_SECRET,
        },
      }
    );
    const imageCID = imgRes.data.IpfsHash;
    console.log(`📌 NFT image pinned: ${imageCID}`);

    // 2. Build HIP-412 compliant metadata JSON
    const metadata: Record<string, any> = {
      name,
      image: `ipfs://${imageCID}`,
      type: imageFile.mimetype,
    };

    if (description) metadata.description = description;
    if (creator) metadata.creator = creator;

    // Parse attributes
    if (attributes) {
      try {
        const parsed = JSON.parse(attributes);
        if (Array.isArray(parsed) && parsed.length > 0) {
          metadata.attributes = parsed;
        }
      } catch { /* ignore invalid JSON */ }
    }

    metadata.format = 'HIP412@2.0.0';

    // 3. Pin metadata JSON to IPFS
    const metaFormData = new FormData();
    const metaBuffer = Buffer.from(JSON.stringify(metadata, null, 2));
    metaFormData.append('file', metaBuffer, {
      filename: `${name.replace(/[^a-zA-Z0-9]/g, '_')}.json`,
      contentType: 'application/json',
    });
    metaFormData.append('pinataMetadata', JSON.stringify({ name: `${label} - Metadata` }));

    const metaRes = await axios.post(
      'https://api.pinata.cloud/pinning/pinFileToIPFS',
      metaFormData,
      {
        maxBodyLength: Infinity,
        headers: {
          'Content-Type': `multipart/form-data; boundary=${metaFormData.getBoundary()}`,
          pinata_api_key: PINATA_API_KEY,
          pinata_secret_api_key: PINATA_API_SECRET,
        },
      }
    );

    const metadataCID = metaRes.data.IpfsHash;
    console.log(`📌 NFT metadata pinned: ${metadataCID}`);

    // Clean up temp files
    for (const p of filesToClean) await fs.remove(p).catch(() => {});

    return res.json({
      success: true,
      imageCID,
      metadataCID,
      tokenURI: `ipfs://${metadataCID}`,
    });
  } catch (error: any) {
    const detail = error.response?.data
      ? JSON.stringify(error.response.data)
      : error.message;
    console.error('Error pinning NFT metadata:', detail);
    console.error('Full error:', error.stack || error);
    for (const p of filesToClean) await fs.remove(p).catch(() => {});
    return res.status(500).json({
      success: false,
      error: detail || 'Failed to pin NFT metadata',
    });
  }
}

