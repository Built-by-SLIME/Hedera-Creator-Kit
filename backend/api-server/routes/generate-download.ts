import { Request, Response } from 'express';
import path from 'path';
import fs from 'fs-extra';
import AdmZip from 'adm-zip';
import { getJob, updateJob } from '../jobStore';

/**
 * Max uncompressed payload we'll zip up (1.5 GB). Above this, memory pressure
 * on the container gets real; the user should split the collection.
 */
const MAX_ZIP_BYTES = 1.5 * 1024 * 1024 * 1024;

/**
 * GET /api/generate-download/:jobId
 *
 * Packages a completed 'download'-mode generation job into a ZIP
 * (images/ + metadata/) and streams it to the client. The job's output folder
 * is deleted after a successful download — the ZIP is the only copy.
 */
export async function downloadGeneratedZip(req: Request, res: Response) {
  try {
    const { jobId } = req.params;

    if (!jobId) {
      return res.status(400).json({ success: false, error: 'jobId is required' });
    }

    const job = getJob(jobId);

    if (!job) {
      return res.status(404).json({ success: false, error: 'Job not found or expired.' });
    }

    if (job.outputMode !== 'download') {
      return res.status(400).json({ success: false, error: 'This job was not run in download mode.' });
    }

    if (job.status !== 'completed' || !job.outputDir) {
      return res.status(409).json({
        success: false,
        error: job.status === 'failed'
          ? `Generation failed: ${job.error || 'unknown error'}`
          : 'Generation is still in progress. Wait for it to complete before downloading.'
      });
    }

    const imagesDir = path.join(job.outputDir, 'images');
    const metadataDir = path.join(job.outputDir, 'metadata');

    if (!await fs.pathExists(imagesDir) || !await fs.pathExists(metadataDir)) {
      return res.status(410).json({
        success: false,
        error: 'Generated files are no longer available on the server. Please run the generation again.'
      });
    }

    // Size guard before we buffer the archive
    let totalBytes = 0;
    for (const dir of [imagesDir, metadataDir]) {
      for (const f of await fs.readdir(dir)) {
        const stat = await fs.stat(path.join(dir, f));
        totalBytes += stat.size;
      }
    }

    if (totalBytes > MAX_ZIP_BYTES) {
      return res.status(413).json({
        success: false,
        error: `Collection is ${(totalBytes / 1024 / 1024 / 1024).toFixed(1)} GB — too large to package. ` +
               'Generate in smaller batches or use the IPFS pinning mode.'
      });
    }

    const zip = new AdmZip();
    zip.addLocalFolder(imagesDir, 'images');
    zip.addLocalFolder(metadataDir, 'metadata');

    const safeName = (job.result?.collection_info?.name || 'collection').replace(/[^a-z0-9-_]+/gi, '-').toLowerCase();
    const zipPath = path.join(job.outputDir, `${safeName}.zip`);
    zip.writeZip(zipPath);

    const cleanup = async () => {
      await fs.remove(job.outputDir!).catch(() => {});
      updateJob(jobId, { outputDir: undefined });
    };

    res.download(zipPath, `${safeName}.zip`, async (err) => {
      // Always clean up the output folder once the response is closed
      await cleanup();
      if (err && !res.headersSent) {
        console.error(`Download of job ${jobId} failed:`, err);
      }
    });
  } catch (error: any) {
    console.error('Download generated ZIP error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to package the generated collection'
    });
  }
}
