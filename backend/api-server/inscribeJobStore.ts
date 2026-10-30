/**
 * In-memory store for inscription jobs (same pattern as mintJobStore).
 * Jobs live 24 hours so a returning browser can still fetch the result.
 */

export interface InscribeJob {
  jobId: string;
  status: 'inscribing' | 'completed' | 'failed';
  step: string;
  createdAt: number;
  // media file progress
  chunksTotal: number;
  chunksDone: number;
  // results
  mediaTopic?: string;
  metaTopic?: string;
  registryTopic?: string;
  pointer?: string;
  error?: string;
}

const jobs = new Map<string, InscribeJob>();

export function createInscribeJob(jobId: string, chunksTotal: number): InscribeJob {
  const job: InscribeJob = {
    jobId,
    status: 'inscribing',
    step: 'starting',
    createdAt: Date.now(),
    chunksTotal,
    chunksDone: 0,
  };
  jobs.set(jobId, job);
  return job;
}

export function updateInscribeJob(jobId: string, patch: Partial<InscribeJob>): void {
  const job = jobs.get(jobId);
  if (job) jobs.set(jobId, { ...job, ...patch });
}

export function getInscribeJob(jobId: string): InscribeJob | undefined {
  return jobs.get(jobId);
}

export function cleanupOldInscribeJobs(maxAgeMs: number): number {
  const now = Date.now();
  let removed = 0;
  for (const [id, job] of jobs.entries()) {
    if (now - job.createdAt > maxAgeMs) {
      jobs.delete(id);
      removed++;
    }
  }
  return removed;
}
