import { Request, Response } from 'express';
import axios from 'axios';
import FormData from 'form-data';

/**
 * Pin a raw metadata JSON object to IPFS via Pinata.
 *
 * Accepts JSON body:
 *   - metadata (object, required) — the full NFT metadata JSON
 *   - label  (string, optional)   — label for Pinata pinning
 *
 * Returns:
 *   { success, metadataCID, tokenURI }
 */
export async function pinMetadataJson(req: Request, res: Response) {
  const PINATA_API_KEY = process.env.PINATA_API_KEY;
  const PINATA_API_SECRET = process.env.PINATA_API_SECRET;

  if (!PINATA_API_KEY || !PINATA_API_SECRET) {
    return res.status(500).json({
      success: false,
      error: 'Pinata API credentials not configured on server',
    });
  }

  try {
    const { metadata, label } = req.body;

    if (!metadata || typeof metadata !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'metadata object is required',
      });
    }

    const name = metadata?.name || label || 'Updated NFT Metadata';

    // Pin metadata JSON to IPFS
    const metaFormData = new FormData();
    const metaBuffer = Buffer.from(JSON.stringify(metadata, null, 2));
    metaFormData.append('file', metaBuffer, {
      filename: `${String(name).replace(/[^a-zA-Z0-9]/g, '_')}.json`,
      contentType: 'application/json',
    });
    metaFormData.append(
      'pinataMetadata',
      JSON.stringify({ name: label || `${name} - Updated Metadata` })
    );

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
    console.log(`📌 Updated metadata pinned: ${metadataCID}`);

    return res.json({
      success: true,
      metadataCID,
      tokenURI: `ipfs://${metadataCID}`,
    });
  } catch (error: any) {
    const detail = error.response?.data
      ? JSON.stringify(error.response.data)
      : error.message;
    console.error('Error pinning metadata JSON:', detail);
    console.error('Full error:', error.stack || error);
    return res.status(500).json({
      success: false,
      error: detail || 'Failed to pin metadata JSON',
    });
  }
}
