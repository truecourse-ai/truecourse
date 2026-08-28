/**
 * The clones the dashboard manages.
 *
 * Connecting a repository through the GitHub App clones it here, into
 * `<getGlobalDir()>/clones/<owner>__<repo>`, and the clone is what every other
 * surface then treats as the repo. Only repos the dashboard cloned live under
 * that root, which is what makes wholesale deletion safe on disconnect — a repo
 * the user registered by local path keeps its source and loses only
 * `.truecourse/` (see repo-removal.service.ts).
 *
 * Git runs as a child process rather than through simple-git: `simple-git` is a
 * dependency of `@truecourse/core`, not of this package, and core's `getGit`
 * only hands back a client for a path that is ALREADY a repo — which a clone
 * target by definition is not.
 */

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { createAppError } from '@truecourse/core/lib/errors';
import { getGlobalDir } from '@truecourse/core/config/paths';
import { getProjectByPath } from '@truecourse/core/config/registry';
import { cloneAuthArgs, cloneUrl, repoWebUrl } from '@truecourse/scm-github';

const execFileAsync = promisify(execFile);

/** Clones can be large; give git plenty of room before we give up on it. */
const CLONE_TIMEOUT_MS = 10 * 60 * 1000;

/** The config key `cloneAuthArgs` sets, and that the fresh clone must not keep. */
const GITHUB_AUTH_HEADER_KEY = 'http.https://github.com/.extraheader';

/**
 * Keep only characters that are safe (and boring) in a directory name.
 * LOWERCASED: clone directories live on whatever filesystem the user has, and
 * on a case-insensitive one (macOS default) `Facebook__React` and
 * `facebook__react` are the SAME directory, so two repos differing only in case
 * must resolve to one name rather than silently clobbering each other's clone.
 */
function sanitizeSegment(segment: string): string {
  return segment
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[.\-]+/, '')
    .slice(0, 64);
}

/**
 * The managed directory name for `owner/repo` — `<owner>__<repo>`, sanitized.
 * Deterministic, so it is also how the clone of a connected repo is FOUND
 * again (see the unlink hook) rather than reconstructed from a URL.
 *
 * Sanitizing is lossy: `acme/.github` and `acme/github` land on one name. That
 * is what `cloneGithubRepo` guards against before it deletes anything.
 */
export function cloneDirName(repoFullName: string): string {
  const [owner = '', repo = ''] = repoFullName.split('/');
  return `${sanitizeSegment(owner) || 'repo'}__${sanitizeSegment(repo) || 'repo'}`;
}

/** Root of the clones the dashboard manages. */
export function getClonesDir(): string {
  return path.join(getGlobalDir(), 'clones');
}

/**
 * Is `repoPath` a directory the dashboard cloned (and may therefore delete)?
 * The clones root itself is not — only entries beneath it.
 */
export function isManagedClonePath(repoPath: string): boolean {
  const root = path.resolve(getClonesDir());
  const target = path.resolve(repoPath);
  return target !== root && target.startsWith(root + path.sep);
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

/**
 * Shallow-clone a connected GitHub repository with an installation token, into
 * its managed directory, and return the path.
 *
 * The token rides a `git clone -c http.*.extraheader` flag rather than the URL,
 * so it stays out of the recorded remote, out of git's error output (which
 * quotes the URL), and out of anything that later reads the clone's origin.
 * That flag persists the header into the new repo's config, so it is unset
 * again before the clone is published — no credential is left at rest in it.
 *
 * Clones into a temp sibling and renames on success, so an interrupted clone
 * never leaves a half-populated directory behind for the registry to point at.
 *
 * A pre-existing target directory is removed first, but only once it is clear
 * nothing else lives there: directory names are sanitized and therefore lossy,
 * so two repositories can want the same one, and clearing it blind would delete
 * another repository's working copy along with its `.truecourse/` data. A
 * directory some OTHER project is registered at is a conflict (409); one no
 * project claims is debris from a failed attempt and goes.
 */
export async function cloneGithubRepo(
  repoFullName: string,
  token: string,
  run: GitRunner = runGit,
): Promise<string> {
  const url = cloneUrl(repoFullName);

  const root = getClonesDir();
  fs.mkdirSync(root, { recursive: true });

  const dirName = cloneDirName(repoFullName);
  const target = path.join(root, dirName);
  if (fs.existsSync(target)) {
    const occupant = await getProjectByPath(target);
    if (occupant && occupant.name !== repoFullName && occupant.remoteUrl !== repoWebUrl(repoFullName)) {
      throw createAppError(
        `Cannot clone ${repoFullName}: ${occupant.name} already occupies ${target}. ` +
          'Disconnect it first.',
        409,
      );
    }
    fs.rmSync(target, { recursive: true, force: true });
  }

  const tmp = path.join(root, `.tmp-${dirName}-${randomUUID().slice(0, 8)}`);
  try {
    await run(['clone', ...cloneAuthArgs(token), '--depth', '1', '--single-branch', url, tmp]);
    await run(['config', '--unset-all', GITHUB_AUTH_HEADER_KEY], tmp);
    fs.renameSync(tmp, target);
    return target;
  } catch (err) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw createAppError(`Could not clone ${url}: ${gitFailureMessage(err)}`, 502);
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
