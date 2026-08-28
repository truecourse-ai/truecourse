/**
 * Ephemeral per-run clones. A connected repository has NO persistent working
 * copy: every run (spec scan today; guard setup/generate/run later) clones the
 * repo into its own directory under `<getGlobalDir()>/run-clones/<workspace>/`,
 * reads or writes what it needs, and deletes the directory when it settles.
 * All durable state lives in Postgres (see ../stores.ts), so the clone is pure
 * input — nothing under this root is ever the source of truth, which is what
 * makes wholesale deletion (and the boot sweep below) safe.
 *
 * The per-workspace level exists for isolation and auditability: a clone of a
 * private repo only ever materializes under its owning workspace's directory,
 * and nothing outside this module ever serves paths from it.
 *
 * Git runs as a child process rather than through simple-git: `simple-git` is a
 * dependency of `@truecourse/core`, not of this package, and core's `getGit`
 * only hands back a client for a path that is ALREADY a repo — which a clone
 * target by definition is not.
 */

import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { createAppError } from '@truecourse/core/lib/errors';
import { getGlobalDir } from '@truecourse/core/config/paths';
import { log } from '@truecourse/core/lib/logger';
import { cloneAuthArgs, cloneUrl } from '@truecourse/github-app';

const execFileAsync = promisify(execFile);

/** Clones can be large; give git plenty of room before we give up on it. */
const CLONE_TIMEOUT_MS = 10 * 60 * 1000;

/** The config key `cloneAuthArgs` sets, and that the fresh clone must not keep. */
const GITHUB_AUTH_HEADER_KEY = 'http.https://github.com/.extraheader';

/** Run-clone dirs older than this are debris from a crashed run. */
const STALE_CLONE_MS = 60 * 60 * 1000;

/** Prefix every per-run clone dir carries, so the sweep deletes nothing else. */
const RUN_CLONE_PREFIX = 'tc-run-';

/**
 * Keep only characters that are safe (and boring) in a directory name.
 * LOWERCASED so two identities differing only in case can't collide with each
 * other's directories on a case-insensitive filesystem.
 */
function sanitizeSegment(segment: string): string {
  return segment
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[.\-]+/, '')
    .slice(0, 64);
}

/**
 * A filesystem-safe directory name for `owner/repo` — `<owner>__<repo>-<hash>`,
 * sanitized. Used wherever per-repo server-side state needs a directory keyed
 * by the repo identity (persistent sessions, run clones). Sanitization is
 * lossy (case-folding, dot/dash stripping, truncation), so the hash of the
 * EXACT full name keeps distinct repos in distinct directories — two repos
 * must never share one: disconnect deletes the directory wholesale.
 */
export function repoDirName(repoFullName: string): string {
  const [owner = '', repo = ''] = repoFullName.split('/');
  const hash = crypto.createHash('sha256').update(repoFullName).digest('hex').slice(0, 8);
  return `${sanitizeSegment(owner) || 'repo'}__${sanitizeSegment(repo) || 'repo'}-${hash}`;
}

/** Root of all per-run clones, one subdirectory per workspace. */
export function getRunClonesDir(): string {
  return path.join(getGlobalDir(), 'run-clones');
}

/**
 * How git is run. The default shells out; tests inject a recorder so the argv
 * a clone is built from can be asserted without touching the network.
 */
export type GitRunner = (args: string[], cwd?: string) => Promise<void>;

const runGit: GitRunner = async (args, cwd) => {
  await execFileAsync('git', args, {
    cwd,
    timeout: CLONE_TIMEOUT_MS,
    maxBuffer: 10 * 1024 * 1024,
    env: {
      ...process.env,
      // Never block on a credential prompt: a private or missing repo must
      // fail fast with git's own message instead of hanging the request.
      GIT_TERMINAL_PROMPT: '0',
      GIT_ASKPASS: 'true',
      GCM_INTERACTIVE: 'never',
    },
  });
};

/** A live ephemeral clone: the tree to run on, and the cleanup that ends it. */
export interface RunClone {
  dir: string;
  /** Delete the clone. Idempotent, never throws. */
  dispose: () => void;
}

/**
 * Shallow-clone a connected repository into a fresh per-run directory under
 * its workspace's run-clones dir. The caller MUST `dispose()` when the run
 * settles, however it settles; the boot sweep only covers crashes.
 *
 * The token rides a `git clone -c http.*.extraheader` flag rather than the
 * URL, so it stays out of the recorded remote, out of git's error output
 * (which quotes the URL), and out of anything that later reads the clone's
 * origin. That flag persists the header into the new repo's config, so it is
 * unset again right after — no credential is left at rest for the run's
 * duration. The unset is best-effort: its only failure mode is the key being
 * absent already, which must not throw away a finished multi-minute clone.
 */
export async function createRunClone(
  repoFullName: string,
  token: string,
  opts: { workspaceOrgId: string; defaultBranch?: string | null; run?: GitRunner },
): Promise<RunClone> {
  const run = opts.run ?? runGit;
  const url = cloneUrl(repoFullName);

  const tenantRoot = path.join(getRunClonesDir(), sanitizeSegment(opts.workspaceOrgId) || 'workspace');
  fs.mkdirSync(tenantRoot, { recursive: true });
  const dir = fs.mkdtempSync(path.join(tenantRoot, RUN_CLONE_PREFIX));

  const dispose = (): void => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort — the boot sweep picks up what a busy file handle blocks
    }
  };

  try {
    await run([
      'clone',
      ...cloneAuthArgs(token),
      '--depth',
      '1',
      '--single-branch',
      ...(opts.defaultBranch ? ['--branch', opts.defaultBranch] : []),
      url,
      dir,
    ]);
    try {
      await run(['config', '--unset-all', GITHUB_AUTH_HEADER_KEY], dir);
    } catch {
      // key absent — nothing at rest to remove
    }
    return { dir, dispose };
  } catch (err) {
    dispose();
    throw createAppError(`Could not clone ${url}: ${gitFailureMessage(err)}`, 502);
  }
}

/**
 * Remove run-clone dirs left behind by a crashed process. Called once at boot;
 * an hour is far longer than any single run, so a live run's clone is never
 * touched.
 */
export function sweepStaleRunClones(now = Date.now()): number {
  let removed = 0;
  for (const tenant of listDirs(getRunClonesDir())) {
    const tenantRoot = path.join(getRunClonesDir(), tenant);
    for (const name of listDirs(tenantRoot)) {
      if (!name.startsWith(RUN_CLONE_PREFIX)) continue;
      const full = path.join(tenantRoot, name);
      try {
        if (now - fs.statSync(full).mtimeMs < STALE_CLONE_MS) continue;
        fs.rmSync(full, { recursive: true, force: true });
        removed += 1;
      } catch {
        // best-effort
      }
    }
  }
  if (removed > 0) log.info(`[run-clone] swept ${removed} stale run clone(s)`);
  return removed;
}

function listDirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

/** The most useful line of a failed `git clone` — its last stderr line. */
function gitFailureMessage(err: unknown): string {
  const stderr = (err as { stderr?: string }).stderr;
  const lines = (stderr ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  return lines[lines.length - 1] ?? (err as Error).message ?? 'git failed';
}
