import { Request, Response } from 'express';
import { getMintJob } from '../mintJobStore';

/**
 * Poll endpoint for an asynchronous batch minting job.
 *
 * Returns the current status, batch progress, minted serial numbers, and any
 * batch errors.
 */
export async function getMintStatus(req: Request, res: Response) {
  try {
    const { jobId } = req.params;

    if (!jobId) {
      return res.status(400).json({ success: false, error: 'jobId is required' });
    }

    const job = getMintJob(jobId);

    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Job not found. It may have expired or the server may have restarted.'
      });
    }

    return res.json({
      success: true,
      jobId: job.jobId,
      status: job.status,
      progress: {
        totalNFTs: job.totalNFTs,
        currentBatch: job.currentBatch,
        totalBatches: job.totalBatches,
        minted: job.serials.length
      },
      serials: job.serials,
      errors: job.errors,
      error: job.error
    });

  } catch (error: any) {
    console.error('Get mint status error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to retrieve mint status'
    });
  }
}
