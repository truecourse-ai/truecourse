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

// ---------------------------------------------------------------------------
// Analyze lock — prevents two analyze runs against the same repo at once
// ---------------------------------------------------------------------------

const LOCK_FILENAME = '.analyze.lock';

function lockPath(repoPath: string): string {
  return path.join(repoPath, '.truecourse', LOCK_FILENAME);
}

export class AnalyzeLockError extends Error {
  constructor(repoPath: string, ownerPid: number | null) {
    const who = ownerPid != null ? ` (held by pid ${ownerPid})` : '';
    super(
      `Another analyze is already running for ${repoPath}${who}. ` +
        `If you're sure no analyze is in progress, remove ${lockPath(repoPath)} and retry.`,
    );
    this.name = 'AnalyzeLockError';
  }
}

/**
 * Acquire an exclusive lock for analyze against `repoPath`. `O_EXCL` makes
 * the open fail if the file already exists, so two concurrent CLI or
 * dashboard analyze calls can't both pass this check.
 */
export function acquireAnalyzeLock(repoPath: string): void {
  const file = lockPath(repoPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    const fd = fs.openSync(file, 'wx');
    fs.writeSync(fd, `${process.pid}\n${new Date().toISOString()}\n`);
    fs.closeSync(fd);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      let owner: number | null = null;
      try {
        owner = parseInt(fs.readFileSync(file, 'utf-8').split('\n')[0], 10) || null;
      } catch { /* ignore */ }
      throw new AnalyzeLockError(repoPath, owner);
    }
    throw err;
  }
}

export function releaseAnalyzeLock(repoPath: string): void {
  try {
    fs.unlinkSync(lockPath(repoPath));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}
