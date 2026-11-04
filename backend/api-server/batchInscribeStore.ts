/**
 * Disk-persisted store for batch inscription jobs.
 *
 * Unlike the in-memory inscription/mint job stores, a batch job can run for
 * hours (a large collection at ~2 min/NFT under mirror lag), so its state
 * lives on disk: temp-inscribe-batch/jobs/<jobId>.json. The per-item
 * `record` fields feed the resumable inscribe() core, and items stuck in
 * 'minting' are reconciled against the mirror node on resume so a crash
 * mid-mint can never duplicate NFTs.
 *
 * Status endpoint reads through to disk, so a returning browser (or a
 * restarted server) always sees the latest state.
 */
import path from 'path';
import fs from 'fs-extra';
import { v4 as uuidv4 } from 'uuid';

export type BatchItemStatus =
  | 'pending'
  | 'inscribing'
  | 'inscribed'
  | 'minting'
  | 'minted'
  | 'failed';

export interface BatchItem {
  /** Source file number from the ZIP (art-gen serial), also the metadata name basis. */
  serial: number;
  image: string;        // filename inside images/
  metadata: string;     // filename inside metadata/
  mime: string;         // sniffed from the image bytes
  sha256: string;       // of the ORIGINAL image (media topic memo)
  chunksTotal: number;
  name: string;         // from the source metadata JSON
  /** Resumable inscribe() record: media/mediaDone/mediaVerified/meta/…/registry. */
  record: Record<string, any>;
  status: BatchItemStatus;
  pointer?: string;
  mediaTopic?: string;
  metaTopic?: string;
  registryTopic?: string;
  mintedSerial?: number;
  error?: string;
}

export interface BatchJob {
  jobId: string;
  status: 'running' | 'completed' | 'failed';
  phase: 'inscribing' | 'minting' | 'done';
  updatable: boolean;
  tokenId: string;
  userAccountId: string;
  dir: string;           // temp-inscribe-batch/<id>/ with images/ + metadata/
  createdAt: number;
  updatedAt: number;
  items: BatchItem[];
  error?: string;
}

const BACKEND_ROOT = __dirname.includes('dist')
  ? path.join(__dirname, '../../..')
  : path.join(__dirname, '../..');

const BASE_DIR = path.join(BACKEND_ROOT, 'temp-inscribe-batch');
const JOBS_DIR = () => path.join(BASE_DIR, 'jobs');

const cache = new Map<string, BatchJob>();

export function batchJobDir(jobId: string): string {
  return path.join(BASE_DIR, jobId);
}

function statePath(jobId: string): string {
  return path.join(JOBS_DIR(), `${jobId}.json`);
}

export async function saveBatchJob(job: BatchJob): Promise<void> {
  job.updatedAt = Date.now();
  cache.set(job.jobId, job);
  await fs.ensureDir(JOBS_DIR());
  const tmp = statePath(job.jobId) + '.tmp';
  await fs.writeJSON(tmp, job);
  await fs.move(tmp, statePath(job.jobId), { overwrite: true });
}

export async function loadBatchJob(jobId: string): Promise<BatchJob | undefined> {
  const cached = cache.get(jobId);
  if (cached) return cached;
  try {
    const job = (await fs.readJSON(statePath(jobId))) as BatchJob;
    cache.set(jobId, job);
    return job;
  } catch {
    return undefined;
  }
}

export function uncacheBatchJob(jobId: string): void {
  cache.delete(jobId);
}

export function newBatchJobId(): string {
  return uuidv4();
}

/** Remove stale prepared-batch folders (state files stay, work dirs go). */
export async function cleanupBatchArtifacts(maxAgeMs: number): Promise<number> {
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  if (!(await fs.pathExists(BASE_DIR))) return 0;
  for (const entry of await fs.readdir(BASE_DIR)) {
    if (entry === 'jobs') continue;
    const dir = path.join(BASE_DIR, entry);
    try {
      const stat = await fs.stat(dir);
      if (stat.isDirectory() && stat.mtimeMs < cutoff) {
        await fs.remove(dir);
        removed++;
      }
    } catch { /* keep going */ }
  }
  // Drop cache entries whose state file is gone
  for (const [id, job] of cache.entries()) {
    if (!(await fs.pathExists(statePath(id)))) cache.delete(id);
    else if (Date.now() - job.createdAt > maxAgeMs) {
      await fs.remove(statePath(id)).catch(() => {});
      cache.delete(id);
      removed++;
    }
  }
  return removed;
}
