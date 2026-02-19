import { Request, Response } from 'express';
import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs-extra';

/**
 * Pin HIP-766 compliant collection metadata to IPFS via Pinata.
 *
 * Accepts multipart/form-data with:
 *   - logo          (file, optional) – collection logo image (350×350 recommended)
 *   - banner        (file, optional) – collection banner image (2800×1000 recommended)
 *   - featuredImage (file, optional) – featured image (600×400 recommended)
 *   - description   (string, optional)
 *   - creator       (string, optional)

 *   - website       (string, optional)
 *   - discussion    (string, optional)
 *   - whitepaper    (string, optional)
 *   - socials       (JSON string, optional) – array of { url, label, info? }
 *   - properties    (JSON string, optional) – arbitrary key/value pairs
 *   - collectionName (string, optional) – used only for Pinata label, NOT in metadata
 *
 * Returns:
 *   { success, metadataCID?, metadataURI?, pinnedImages? }
 */
export async function pinCollectionMetadata(req: Request, res: Response) {
  const PINATA_API_KEY = process.env.PINATA_API_KEY;
  const PINATA_API_SECRET = process.env.PINATA_API_SECRET;

  if (!PINATA_API_KEY || !PINATA_API_SECRET) {
    return res.status(500).json({ success: false, error: 'Pinata API credentials not configured on server' });
  }

  const filesToClean: string[] = [];

  try {
    const {
      description, creator,
      website, discussion, whitepaper,
      socials, properties, collectionName,
    } = req.body;

    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    const logoFile = files?.logo?.[0];
    const bannerFile = files?.banner?.[0];
    const featuredImageFile = files?.featuredImage?.[0];

    if (logoFile) filesToClean.push(logoFile.path);
    if (bannerFile) filesToClean.push(bannerFile.path);
    if (featuredImageFile) filesToClean.push(featuredImageFile.path);

    const label = collectionName || 'Collection';

    // Helper: pin a single image file to IPFS, returns CID
    async function pinImage(file: Express.Multer.File, suffix: string): Promise<string> {
      const formData = new FormData();
      formData.append('file', fs.createReadStream(file.path), {
        filename: file.originalname,
      });
      formData.append('pinataMetadata', JSON.stringify({ name: `${label} - ${suffix}` }));

      const pinRes = await axios.post(
        'https://api.pinata.cloud/pinning/pinFileToIPFS',
        formData,
        {
          maxBodyLength: Infinity,
          headers: {
            'Content-Type': `multipart/form-data; boundary=${formData.getBoundary()}`,
            pinata_api_key: PINATA_API_KEY!,
            pinata_secret_api_key: PINATA_API_SECRET!,
          },
        }
      );
      const cid = pinRes.data.IpfsHash;
      console.log(`📌 ${suffix} pinned: ${cid}`);
      return cid;
    }

    // 1. Pin images in parallel
    const [logoCID, bannerCID, featuredCID] = await Promise.all([
      logoFile ? pinImage(logoFile, 'Logo') : Promise.resolve(null),
      bannerFile ? pinImage(bannerFile, 'Banner') : Promise.resolve(null),
      featuredImageFile ? pinImage(featuredImageFile, 'Featured Image') : Promise.resolve(null),
    ]);

    // 2. Build HIP-766 compliant metadata JSON
    const hasAnyData = description || creator ||
      website || discussion || whitepaper || socials || properties ||
      logoCID || bannerCID || featuredCID;

    if (!hasAnyData) {
      return res.json({ success: true, message: 'No metadata to pin' });
    }

    const metadata: Record<string, any> = {};

    // Text fields
    if (description) metadata.description = description;
    if (creator) metadata.creator = creator;

    if (website) metadata.website = website;
    if (discussion) metadata.discussion = discussion;
    if (whitepaper) metadata.whitepaper = whitepaper;

    // Socials — array of { url, label, info? }
    if (socials) {
      try {
        const parsed = JSON.parse(socials);
        if (Array.isArray(parsed) && parsed.length > 0) {
          metadata.socials = parsed;
        }
      } catch { /* ignore invalid JSON */ }
    }

    // Properties — arbitrary JSON object
    if (properties) {
      try {
        const parsed = JSON.parse(properties);
        if (typeof parsed === 'object' && parsed !== null) {
          metadata.properties = parsed;
        }
      } catch { /* ignore invalid JSON */ }
    }

    // Images — HIP-766 uses light/dark variants; we set both to the same CID
    if (logoCID) {
      const logoURI = `ipfs://${logoCID}`;
      const logoMime = logoFile!.mimetype;
      metadata.lightLogo = logoURI;
      metadata.lightLogoType = logoMime;
      metadata.darkLogo = logoURI;
      metadata.darkLogoType = logoMime;
    }
    if (bannerCID) {
      const bannerURI = `ipfs://${bannerCID}`;
      const bannerMime = bannerFile!.mimetype;
      metadata.lightBanner = bannerURI;
      metadata.lightBannerType = bannerMime;
      metadata.darkBanner = bannerURI;
      metadata.darkBannerType = bannerMime;
    }
    if (featuredCID) {
      const featuredURI = `ipfs://${featuredCID}`;
      const featuredMime = featuredImageFile!.mimetype;
      metadata.lightFeaturedImage = featuredURI;
      metadata.lightFeaturedImageType = featuredMime;
      metadata.darkFeaturedImage = featuredURI;
      metadata.darkFeaturedImageType = featuredMime;
    }

    // 3. Pin the metadata JSON
    const metaFormData = new FormData();
    const metaBuffer = Buffer.from(JSON.stringify(metadata, null, 2));
    metaFormData.append('file', metaBuffer, {
      filename: 'collection-metadata.json',
      contentType: 'application/json',
    });
    metaFormData.append('pinataMetadata', JSON.stringify({ name: `${label} - HIP-766 Metadata` }));

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
    console.log(`📌 HIP-766 collection metadata pinned: ${metadataCID}`);

    // Clean up temp files
    for (const p of filesToClean) await fs.remove(p).catch(() => {});

    return res.json({
      success: true,
      metadataCID,
      metadataURI: `ipfs://${metadataCID}`,
      pinnedImages: {
        logo: logoCID || null,
        banner: bannerCID || null,
        featuredImage: featuredCID || null,
      },
    });
  } catch (error: any) {
    const detail = error.response?.data
      ? JSON.stringify(error.response.data)
      : error.message;
    console.error('Error pinning collection metadata:', detail);
    console.error('Full error:', error.stack || error);
    for (const p of filesToClean) await fs.remove(p).catch(() => {});
    return res.status(500).json({
      success: false,
      error: detail || 'Failed to pin collection metadata',
    });
  }
}

