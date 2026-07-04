/**
 * In-memory job store for long-running art generation tasks.
 *
 * Jobs live in process memory. This keeps the implementation simple and avoids
 * adding a database table or external queue for a single toolkit server. If the
 * server restarts, active jobs are lost — callers will receive a 404 for the
 * old jobId and must start a new generation.
 */

export type JobStatus =
  | 'queued'
  | 'generating'
  | 'pinning_images'
  | 'pinning_metadata'
  | 'completed'
  | 'failed';

export interface GenerationResult {
  number: number;
  imageCID: string;
  metadataCID: string;
  tokenURI: string;
}

export interface GenerationJob {
  jobId: string;
  sessionId: string;
  status: JobStatus;
  createdAt: number;
  updatedAt: number;
  totalNFTs: number;
  generated: number;
  pinnedImages: number;
  pinnedMetadata: number;
  error?: string;
  result?: {
    nfts: GenerationResult[];
    token_uris: string[];
    collection_info: {
      name: string;
      description?: string;
      total_nfts: number;
    };
    generation_stats: {
      total: number;
      successful: number;
      failed: number;
      duration: number;
    };
  };
}

const jobs = new Map<string, GenerationJob>();

export function createJob(jobId: string, sessionId: string, totalNFTs: number): GenerationJob {
  const now = Date.now();
  const job: GenerationJob = {
    jobId,
    sessionId,
    status: 'queued',
    createdAt: now,
    updatedAt: now,
    totalNFTs,
    generated: 0,
    pinnedImages: 0,
    pinnedMetadata: 0
  };
  jobs.set(jobId, job);
  return job;
}

export function getJob(jobId: string): GenerationJob | undefined {
  return jobs.get(jobId);
}

export function updateJob(jobId: string, updates: Partial<Omit<GenerationJob, 'jobId' | 'createdAt'>>): GenerationJob | undefined {
  const job = jobs.get(jobId);
  if (!job) return undefined;

  Object.assign(job, updates, { updatedAt: Date.now() });
  return job;
}

export function deleteJob(jobId: string): boolean {
  return jobs.delete(jobId);
}

export function cleanupOldJobs(maxAgeMs: number): number {
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
