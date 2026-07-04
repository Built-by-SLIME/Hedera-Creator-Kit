import { Request, Response } from 'express';
import { getJob } from '../jobStore';

/**
 * Poll endpoint for an asynchronous generation job.
 *
 * Returns the current status, progress counters, and (when finished) the
 * full result or error message.
 */
export async function getGenerationStatus(req: Request, res: Response) {
  try {
    const { jobId } = req.params;

    if (!jobId) {
      return res.status(400).json({ success: false, error: 'jobId is required' });
    }

    const job = getJob(jobId);

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
        total: job.totalNFTs,
        generated: job.generated,
        pinnedImages: job.pinnedImages,
        pinnedMetadata: job.pinnedMetadata
      },
      error: job.error,
      result: job.result
    });

  } catch (error: any) {
    console.error('Get generation status error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to retrieve generation status'
    });
  }
}
