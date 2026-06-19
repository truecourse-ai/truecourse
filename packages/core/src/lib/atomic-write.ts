import fs from 'node:fs';
import path from 'node:path';

/**
 * Write `data` to `targetPath` atomically.
 *
 * `fs.renameSync` is atomic on POSIX when the source and destination are on
 * the same filesystem, so readers of `targetPath` see either the previous
 * content or the new content — never a half-written file. The tmp filename
 * carries pid + timestamp so concurrent writers on the same target don't
 * clobber each other's temp file.
 */
export function atomicWriteJson(targetPath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const tmp = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, targetPath);
}

// The analyze lock moved to `./analyze-lock.ts` (it became a pluggable seam so
// the enterprise edition can use a Postgres advisory lock). Re-exported here for
// back-compat with existing import sites.
export {
  AnalyzeLockError,
  acquireAnalyzeLock,
  releaseAnalyzeLock,
  type AnalyzeLock,
  getAnalyzeLock,
  setAnalyzeLock,
  resetAnalyzeLock,
} from './analyze-lock.js';

