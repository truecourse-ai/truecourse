/**
 * Analyze lock — prevents two analyze runs against the same repo at once (they
 * would corrupt the shared `LATEST`/history). File-backed by default (an O_EXCL
 * lockfile under the repo's `.truecourse/`, fail-fast); the enterprise edition
 * injects a Postgres `pg_advisory_lock` impl via `setAnalyzeLock`, keyed by the
 * repo IDENTITY rather than a path — so two analyses of the same repo serialize
 * even though each runs on its own throwaway clone (the file lock would sit on a
 * different clone each time and never collide).
 *
 * The key is the storage identity (`project.path`): a filesystem path in OSS, an
 * opaque `owner/repo` in EE. The file impl maps it to a lockfile path; the EE
 * impl hashes it to an advisory-lock id.
 */

import fs from 'node:fs';
import path from 'node:path';

const LOCK_FILENAME = '.analyze.lock';

function lockPath(repoKey: string): string {
  return path.join(repoKey, '.truecourse', LOCK_FILENAME);
}

export class AnalyzeLockError extends Error {
  constructor(repoKey: string, ownerPid: number | null) {
    const who = ownerPid != null ? ` (held by pid ${ownerPid})` : '';
    super(
      `Another analyze is already running for ${repoKey}${who}. ` +
        `If you're sure no analyze is in progress, remove ${lockPath(repoKey)} and retry.`,
    );
    this.name = 'AnalyzeLockError';
  }
}

/** Pluggable analyze lock. File-backed (fail-fast) by default; EE injects Postgres (waits). */
export interface AnalyzeLock {
  /** Hold the lock for `key`. The file impl throws `AnalyzeLockError` on
   *  contention; the EE impl WAITS until the lock is free. */
  acquire(key: string): Promise<void>;
  release(key: string): Promise<void>;
}

class FileAnalyzeLock implements AnalyzeLock {
  async acquire(key: string): Promise<void> {
    const file = lockPath(key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try {
      const fd = fs.openSync(file, 'wx'); // O_EXCL → fails if it already exists
      fs.writeSync(fd, `${process.pid}\n${new Date().toISOString()}\n`);
      fs.closeSync(fd);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
        let owner: number | null = null;
        try {
          owner = parseInt(fs.readFileSync(file, 'utf-8').split('\n')[0], 10) || null;
        } catch {
          /* ignore */
        }
        throw new AnalyzeLockError(key, owner);
      }
      throw err;
    }
  }

  async release(key: string): Promise<void> {
    try {
      fs.unlinkSync(lockPath(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
}

let active: AnalyzeLock = new FileAnalyzeLock();

/** The active analyze lock (file-backed unless EE installed a Postgres one). */
export function getAnalyzeLock(): AnalyzeLock {
  return active;
}
/** Install an analyze lock (e.g. the enterprise `pg_advisory_lock` impl). */
export function setAnalyzeLock(lock: AnalyzeLock): void {
  active = lock;
}
/** Restore the file-backed default (tests). */
export function resetAnalyzeLock(): void {
  active = new FileAnalyzeLock();
}

export const acquireAnalyzeLock = (key: string): Promise<void> => active.acquire(key);
export const releaseAnalyzeLock = (key: string): Promise<void> => active.release(key);
