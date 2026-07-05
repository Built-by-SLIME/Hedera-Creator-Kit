/**
 * In-memory job store for long-running batch minting tasks.
 *
 * Jobs live in process memory. If the server restarts, active jobs are lost.
 */

export type MintJobStatus = 'queued' | 'minting' | 'completed' | 'failed';

export interface MintJob {
  jobId: string;
  tokenId: string;
  status: MintJobStatus;
  totalNFTs: number;
  currentBatch: number;
  totalBatches: number;
  serials: number[];
  errors: string[];
  error?: string;
  createdAt: number;
  updatedAt: number;
}

const jobs = new Map<string, MintJob>();

export function createMintJob(
  jobId: string,
  tokenId: string,
  totalNFTs: number,
  totalBatches: number
): MintJob {
  const now = Date.now();
  const job: MintJob = {
    jobId,
    tokenId,
    status: 'queued',
    totalNFTs,
    currentBatch: 0,
    totalBatches,
    serials: [],
    errors: [],
    createdAt: now,
    updatedAt: now
  };
  jobs.set(jobId, job);
  return job;
}

export function getMintJob(jobId: string): MintJob | undefined {
  return jobs.get(jobId);
}

export function updateMintJob(
  jobId: string,
  updates: Partial<Omit<MintJob, 'jobId' | 'createdAt'>>
): MintJob | undefined {
  const job = jobs.get(jobId);
  if (!job) return undefined;

  Object.assign(job, updates, { updatedAt: Date.now() });
  return job;
}

export function deleteMintJob(jobId: string): boolean {
  return jobs.delete(jobId);
}

export function cleanupOldMintJobs(maxAgeMs: number): number {
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  for (const [jobId, job] of jobs.entries()) {
    if (job.createdAt < cutoff) {
      jobs.delete(jobId);
      removed++;
    }
  }
  return removed;
}
