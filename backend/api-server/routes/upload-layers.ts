import { Request, Response } from 'express';
import path from 'path';
import fs from 'fs-extra';
import AdmZip from 'adm-zip';
import { v4 as uuidv4 } from 'uuid';

interface LayerInfo {
  name: string;
  traits: {
    name: string;
    filename: string;
    extension: string;
  }[];
}

export async function uploadLayers(req: Request, res: Response) {
  let sessionDir: string | null = null;

  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No ZIP file uploaded'
      });
    }

    // Create a persistent session directory for this upload
    const sessionId = uuidv4();
    sessionDir = path.join(__dirname, '../../temp-sessions', sessionId);
    const traitsDir = path.join(sessionDir, 'traits');

    await fs.ensureDir(traitsDir);

    // Extract ZIP
    const zip = new AdmZip(req.file.path);
    zip.extractAllTo(traitsDir, true);

    // Clean up uploaded ZIP file
    await fs.remove(req.file.path);

    // Scan for layers (folders) and traits (image files within)
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.webp'];
    const layers: LayerInfo[] = [];

    // Debug: log ZIP entries to understand structure
    const zipEntries = zip.getEntries();
    console.log(`📦 ZIP contains ${zipEntries.length} entries`);
    zipEntries.slice(0, 20).forEach(e => console.log(`  → ${e.entryName} (dir: ${e.isDirectory})`));
    if (zipEntries.length > 20) console.log(`  ... and ${zipEntries.length - 20} more`);

    // Check if ZIP has a root folder wrapper (common pattern)
    // Filter out macOS junk files/folders so they don't interfere with structure detection
    const topLevelItems = (await fs.readdir(traitsDir)).filter(i => !i.startsWith('.') && i !== '__MACOSX');
    console.log(`📂 Top-level items in extract dir:`, topLevelItems);
    let scanDir = traitsDir;

    // If there's only one top-level item and it's a directory, use it as the scan root
    if (topLevelItems.length === 1) {
      const singleItem = path.join(traitsDir, topLevelItems[0]);
      const stat = await fs.stat(singleItem);
      if (stat.isDirectory()) {
        scanDir = singleItem;
        console.log(`📂 Unwrapped root folder: ${topLevelItems[0]}`);
      }
    }

    // Track the actual parent directory where trait folders were found
    let resolvedScanDir = scanDir;

    // Recursive function to find the layer folders (folders that contain images)
    async function findLayerFolders(dir: string, depth: number = 0): Promise<void> {
      if (depth > 5) return; // safety limit

      const items = await fs.readdir(dir);
      console.log(`📂 Scanning dir (depth ${depth}): ${path.basename(dir)} → [${items.filter(i => !i.startsWith('.') && i !== '__MACOSX').join(', ')}]`);

      for (const item of items) {
        if (item.startsWith('.') || item === '__MACOSX') continue;

        const itemPath = path.join(dir, item);
        const stat = await fs.stat(itemPath);

        if (stat.isDirectory()) {
          // Check if this folder directly contains image files
          const files = await fs.readdir(itemPath);
          const imageFiles = files.filter(file => {
            if (file.startsWith('.')) return false;
            const ext = path.extname(file).toLowerCase();
            return imageExtensions.includes(ext);
          });

          // Check if it also has subdirectories
          const subDirs = [];
          for (const f of files) {
            if (f.startsWith('.') || f === '__MACOSX') continue;
            const fPath = path.join(itemPath, f);
            const fStat = await fs.stat(fPath);
            if (fStat.isDirectory()) subDirs.push(f);
          }

          console.log(`  📁 ${item}: ${imageFiles.length} images, ${subDirs.length} subdirs`);

          if (imageFiles.length > 0) {
            // This folder contains images — it's a layer/trait category
            // Record the parent dir as the resolved scan directory
            resolvedScanDir = dir;
            const traits = imageFiles
              .map(file => ({
                name: path.parse(file).name,
                filename: file,
                extension: path.extname(file).toLowerCase()
              }))
              .sort((a, b) => a.name.localeCompare(b.name));

            layers.push({ name: item, traits });
          } else if (subDirs.length > 0) {
            // This folder contains more folders — recurse deeper
            await findLayerFolders(itemPath, depth + 1);
          }
        }
      }
    }

    await findLayerFolders(scanDir);

    if (layers.length === 0) {
      await fs.remove(sessionDir);
      return res.status(400).json({
        success: false,
        error: 'No valid trait folders found in ZIP. Expected folders containing PNG/JPG/WEBP images.'
      });
    }

    // Sort layers alphabetically by default (user can reorder in UI)
    layers.sort((a, b) => a.name.localeCompare(b.name));

    // Save session metadata so preview/generate routes know the resolved scan directory
    console.log(`💾 Saving scanDir: ${resolvedScanDir}`);
    await fs.writeJSON(path.join(sessionDir, 'session.json'), { scanDir: resolvedScanDir });

    res.json({
      success: true,
      sessionId,
      traitsDir: resolvedScanDir,
      layers,
      totalLayers: layers.length,
      totalTraits: layers.reduce((sum, l) => sum + l.traits.length, 0)
    });

  } catch (error: any) {
    console.error('Upload layers error:', error);

    if (sessionDir) {
      await fs.remove(sessionDir).catch(console.error);
    }
    if (req.file?.path) {
      await fs.remove(req.file.path).catch(console.error);
    }

    res.status(500).json({
      success: false,
      error: error.message || 'Failed to process ZIP file'
    });
  }
}

