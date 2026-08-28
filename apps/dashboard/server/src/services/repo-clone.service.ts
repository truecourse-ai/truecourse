/**
 * The clones the dashboard manages: cloning a repository into a directory it
 * owns, and answering "is this path one of ours?" for the disconnect path.
 *
 * Two ways in — a connected GitHub repo (cloned with an installation token) and
 * a public git URL — and one directory layout: `<getGlobalDir()>/clones/<owner>__<repo>`.
 * Only repos the dashboard cloned land there, and only paths inside that root
 * are ever deleted wholesale — a repo the user registered by local path keeps
 * today's behavior (only `.truecourse/` is removed).
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
import { cloneAuthArgs, cloneUrl } from '@truecourse/scm-github';

const execFileAsync = promisify(execFile);

/** Clones can be large; give git plenty of room before we give up on it. */
const CLONE_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * `https:` is the real one. `file:` is allowed too so a local repository can be
 * connected without the network — the route tests rely on it, and it is handy
 * for local experimentation. Everything else (ssh, git, plain paths) is refused.
 */
const ALLOWED_PROTOCOLS = new Set(['https:', 'file:']);

const URL_HELP = 'Use a public https URL, e.g. https://github.com/owner/repo';

export interface ParsedRemote {
  /** The URL as given (trimmed). This is what git is handed. */
  url: string;
  /** Dedupe identity: lowercased host, no trailing slash, no `.git`. */
  normalized: string;
  owner: string;
  repo: string;
  /** `owner/repo` — the registry display name. */
  displayName: string;
  /** `<owner>__<repo>`, sanitized — the directory name under the clones root. */
  dirName: string;
}

/** Strip a single trailing `.git`, which git URLs carry optionally. */
function stripGitSuffix(segment: string): string {
  return segment.endsWith('.git') ? segment.slice(0, -'.git'.length) : segment;
}

/**
 * Keep only characters that are safe (and boring) in a directory name.
 * LOWERCASED: clone directories live on whatever filesystem the user has, and
 * on a case-insensitive one (macOS default) `Facebook__React` and
 * `facebook__react` are the SAME directory — a case-variant reconnect would
 * `rmSync` the other repo's clone. Lowercasing makes the collision explicit:
 * both variants map to one directory name, so the occupant guard in the
 * connect route sees it and refuses instead of clobbering.
 */
function sanitizeSegment(segment: string): string {
  return segment
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[.\-]+/, '')
    .slice(0, 64);
}

/** The managed directory name for `owner/repo` — `<owner>__<repo>`, sanitized. */
export function cloneDirName(owner: string, repo: string): string {
  return `${sanitizeSegment(owner) || 'repo'}__${sanitizeSegment(repo) || 'repo'}`;
}

/**
 * Parse a repository URL into everything the connect flow needs. Throws a 400
 * AppError with a message the dialog can show verbatim when the URL is not a
 * public https (or file) git URL.
 */
export function parseRemoteUrl(raw: string): ParsedRemote {
  const url = raw.trim();
  if (!url) throw createAppError(`A repository URL is required. ${URL_HELP}`, 400);

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw createAppError(`"${url}" is not a valid URL. ${URL_HELP}`, 400);
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw createAppError(
      `${parsed.protocol.replace(':', '')} URLs are not supported. ${URL_HELP}`,
      400,
    );
  }
  // A URL carrying credentials would be persisted verbatim in the registry.
  // Only public repositories can be connected, so there is nothing to carry.
  if (parsed.username || parsed.password) {
    throw createAppError(
      `Remove the credentials from the URL. Only public repositories can be connected.`,
      400,
    );
  }

  const segments = parsed.pathname
    .split('/')
    .filter(Boolean)
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });

  const last = segments.length > 0 ? stripGitSuffix(segments[segments.length - 1] as string) : '';
  if (!last) {
    throw createAppError(`"${url}" does not point at a repository. ${URL_HELP}`, 400);
  }
  // Nested groups (GitLab subgroups) collapse to the last two segments; a
  // single-segment path falls back to the host as the owner.
  const owner = segments.length > 1 ? (segments[segments.length - 2] as string) : parsed.hostname;

  const dirName = cloneDirName(owner, last);

  return {
    url,
    normalized: normalizeRemoteUrl(url),
    owner,
    repo: last,
    displayName: `${owner}/${last}`,
    dirName,
  };
}

/**
 * Dedupe key for a remote: same repository, however it was typed. Host is
 * case-insensitive; a trailing slash and a `.git` suffix are noise. The path
 * itself stays case-sensitive (some hosts care).
 */
export function normalizeRemoteUrl(raw: string): string {
  const trimmed = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return trimmed.replace(/\/+$/, '').toLowerCase();
  }
  const pathname = stripGitSuffix(parsed.pathname.replace(/\/+$/, ''));
  return `${parsed.protocol}//${parsed.host.toLowerCase()}${pathname}`;
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

/** Absolute path a given remote clones to. */
export function getClonePath(remote: ParsedRemote): string {
  return path.join(getClonesDir(), remote.dirName);
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
 * Shallow-clone `url` into `<clones>/<dirName>` and return the path.
 *
 * Clones into a temp sibling and renames on success, so an interrupted clone
 * never leaves a half-populated directory behind for the registry to point at.
 * A pre-existing target directory is removed first — it can only be the debris
 * of an earlier failed attempt, since the caller has already established that
 * no registry entry claims it.
 *
 * `authArgs` are `git clone -c` flags (see `cloneAuthArgs`): they apply to the
 * fetch AND persist into the new repo's config, so `unsetKeys` names the config
 * keys to strip from the temp clone before it is published.
 */
async function cloneManaged(
  url: string,
  dirName: string,
  { authArgs = [], unsetKeys = [] }: { authArgs?: string[]; unsetKeys?: string[] } = {},
  run: GitRunner = runGit,
): Promise<string> {
  const root = getClonesDir();
  fs.mkdirSync(root, { recursive: true });

  const target = path.join(root, dirName);
  fs.rmSync(target, { recursive: true, force: true });

  const tmp = path.join(root, `.tmp-${dirName}-${randomUUID().slice(0, 8)}`);
  try {
    await run(['clone', ...authArgs, '--depth', '1', '--single-branch', url, tmp]);
    for (const key of unsetKeys) {
      await run(['config', '--unset-all', key], tmp);
    }
    fs.renameSync(tmp, target);
    return target;
  } catch (err) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw createAppError(`Could not clone ${url}: ${gitFailureMessage(err)}`, 400);
  }
}

/** The config key `cloneAuthArgs` sets, and that the fresh clone must not keep. */
const GITHUB_AUTH_HEADER_KEY = 'http.https://github.com/.extraheader';

/**
 * Shallow-clone a connected GitHub repository with an installation token.
 *
 * The token rides an `http.*.extraheader` flag rather than the URL, so it stays
 * out of the recorded remote, out of git's error output (which quotes the URL),
 * and out of anything that later reads the clone's origin. The header that flag
 * persists is unset again before the clone is published, so no credential is
 * left at rest in it.
 */
export async function cloneGithubRepo(
  repoFullName: string,
  token: string,
  run: GitRunner = runGit,
): Promise<string> {
  const [owner = '', repo = ''] = repoFullName.split('/');
  return cloneManaged(
    cloneUrl(repoFullName),
    cloneDirName(owner, repo),
    { authArgs: cloneAuthArgs(token), unsetKeys: [GITHUB_AUTH_HEADER_KEY] },
    run,
  );
}

/** Shallow-clone a public `remote` into its managed directory. */
export async function cloneRepository(remote: ParsedRemote): Promise<string> {
  return cloneManaged(remote.url, remote.dirName);
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
