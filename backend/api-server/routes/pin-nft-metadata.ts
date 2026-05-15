import { Request, Response } from 'express';
import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';

// Point fluent-ffmpeg at the bundled static binary
if (ffmpegStatic) ffmpeg.setFfmpegPath(ffmpegStatic);

/**
 * Extracts the first frame of an MP4 as a PNG thumbnail.
 * Returns the path to the temp PNG file (caller must delete it).
 */
function extractVideoThumbnail(videoPath: string): Promise<string> {
  const thumbPath = path.join(os.tmpdir(), `thumb-${Date.now()}.png`);
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .outputOptions(['-frames:v 1', '-q:v 2'])
      .output(thumbPath)
      .on('end', () => resolve(thumbPath))
      .on('error', (err: Error) => reject(new Error(`Thumbnail extraction failed: ${err.message}`)))
      .run();
  });
}

/**
 * Pin individual NFT metadata (HIP-412 compliant) to IPFS via Pinata.
 *
 * Accepts multipart/form-data with:
 *   - image       (file, required) – the NFT image OR an MP4 video file
 *                                    (for video NFTs, a thumbnail is auto-extracted from frame 1)
 *   - name        (string, required) – NFT name
 *   - description (string, optional)
 *   - creator     (string, optional)
 *   - attributes  (JSON string, optional) – array of { trait_type, value, display_type? }
 *   - collectionName (string, optional) – used only for Pinata label
 *
 * Returns:
 *   { success, imageCID, metadataCID, tokenURI }
 *   For video NFTs also returns: { videoCID }
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
    const isVideo = imageFile.mimetype === 'video/mp4';

    let imageCID: string;
    let videoCID: string | undefined;

    if (isVideo) {
      // ── VIDEO PATH ────────────────────────────────────────────────────────
      // 1a. Extract first frame as PNG thumbnail
      console.log(`🎬 MP4 detected — extracting thumbnail from frame 1...`);
      const thumbPath = await extractVideoThumbnail(imageFile.path);
      filesToClean.push(thumbPath);

      // 1b. Pin thumbnail to IPFS
      const thumbFormData = new FormData();
      thumbFormData.append('file', fs.createReadStream(thumbPath), {
        filename: `${label.replace(/[^a-zA-Z0-9]/g, '_')}_thumbnail.png`,
      });
      thumbFormData.append('pinataMetadata', JSON.stringify({ name: `${label} - Thumbnail` }));

      const thumbRes = await axios.post(
        'https://api.pinata.cloud/pinning/pinFileToIPFS',
        thumbFormData,
        {
          maxBodyLength: Infinity,
          headers: {
            'Content-Type': `multipart/form-data; boundary=${thumbFormData.getBoundary()}`,
            pinata_api_key: PINATA_API_KEY,
            pinata_secret_api_key: PINATA_API_SECRET,
          },
        }
      );
      imageCID = thumbRes.data.IpfsHash;
      console.log(`📌 Thumbnail pinned: ${imageCID}`);

      // 1c. Pin the MP4 to IPFS
      const videoFormData = new FormData();
      videoFormData.append('file', fs.createReadStream(imageFile.path), {
        filename: imageFile.originalname,
      });
      videoFormData.append('pinataMetadata', JSON.stringify({ name: `${label} - Video` }));

      const videoRes = await axios.post(
        'https://api.pinata.cloud/pinning/pinFileToIPFS',
        videoFormData,
        {
          maxBodyLength: Infinity,
          headers: {
            'Content-Type': `multipart/form-data; boundary=${videoFormData.getBoundary()}`,
            pinata_api_key: PINATA_API_KEY,
            pinata_secret_api_key: PINATA_API_SECRET,
          },
        }
      );
      videoCID = videoRes.data.IpfsHash;
      console.log(`📌 MP4 pinned: ${videoCID}`);
    } else {
      // ── IMAGE PATH (unchanged) ─────────────────────────────────────────────
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
      imageCID = imgRes.data.IpfsHash;
      console.log(`📌 NFT image pinned: ${imageCID}`);
    }

    // 2. Build HIP-412 compliant metadata JSON
    const metadata: Record<string, any> = {
      name,
      image: `ipfs://${imageCID}`,
      type: isVideo ? 'image/png' : imageFile.mimetype,
    };

    if (description) metadata.description = description;
    if (creator) metadata.creator = creator;

    // For video NFTs, add the HIP-412 `files` array with the MP4 as the default file
    if (isVideo && videoCID) {
      metadata.files = [
        {
          uri: `ipfs://${videoCID}`,
          type: 'video/mp4',
          is_default_file: true,
        },
      ];
    }

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

    const responsePayload: Record<string, any> = {
      success: true,
      imageCID,
      metadataCID,
      tokenURI: `ipfs://${metadataCID}`,
    };
    if (videoCID) responsePayload.videoCID = videoCID;

    return res.json(responsePayload);
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

