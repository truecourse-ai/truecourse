/**
 * Safe git wrapper. All git operations in the server go through this module.
 *
 * Provides a `getGit()` function that validates the path is a git repository
 * before returning a SimpleGit instance. Throws a clean 400 AppError if not.
 *
 * Also provides `isGitRepo()` for cases where callers want to check without throwing.
 */

import { simpleGit, type SimpleGit, type StatusResult } from 'simple-git';
import { TRUECOURSE_DIR } from '../config/paths.js';
import { createAppError } from './errors.js';

/**
 * Single-sourced message for the "this isn't a git repo" guard. TrueCourse
 * requires a git repository for analyze and the spec → contracts → verify
 * track (commit-anchored baselines, diff, stashing committed state). Reused by
 * `getGit`, the CLI command guards, and the dashboard route guards so the copy
 * stays identical everywhere.
 */
export const NOT_A_GIT_REPO_MESSAGE =
  'The selected folder is not a git repository. Please select a folder that has been initialized with git.';

/**
 * Check if a path is a git repository.
 */
export async function isGitRepo(repoPath: string): Promise<boolean> {
  try {
    return await simpleGit(repoPath).checkIsRepo();
  } catch {
    return false;
  }
}

/**
 * Get a SimpleGit instance for a repo path.
 * Throws a 400 AppError if the path is not a git repository.
 */
export async function getGit(repoPath: string): Promise<SimpleGit> {
  const git = simpleGit(repoPath);
  const isRepo = await isGitRepo(repoPath);
  if (!isRepo) {
    throw createAppError(NOT_A_GIT_REPO_MESSAGE, 400);
  }
  return git;
}

// ---------------------------------------------------------------------------
// Working-tree dirtiness (user changes only)
// ---------------------------------------------------------------------------

/**
 * Does this git-reported path live inside a TrueCourse store directory?
 *
 * Git reports porcelain paths relative to the repository root, so a store can
 * surface as `.truecourse/…` (repo root) or `packages/api/.truecourse/…` (a
 * package analyzed on its own inside a bigger repo), and an untracked
 * directory can arrive collapsed as `.truecourse/`. A `.truecourse` path
 * segment is the marker in every case — `resolveRepoDir` treats any such
 * directory as a TrueCourse store, so nothing else may claim the name.
 */
export function isTruecourseStorePath(filePath: string): boolean {
  return filePath
    .replace(/\\/g, '/')
    .split('/')
    .some((segment) => segment === TRUECOURSE_DIR);
}

/** Working-tree changes that belong to the user, i.e. excluding TrueCourse's own store. */
export interface UserWorkingTreeStatus {
  /** No user changes at all — TrueCourse's own store may still be untracked. */
  isClean: boolean;
  /** Tracked-file changes: modified + staged + deleted + newly added. */
  modifiedCount: number;
  /** Untracked files. */
  untrackedCount: number;
}

/**
 * Reduce a git status to the changes TrueCourse may act on, dropping its own
 * store directory.
 *
 * `<repo>/.truecourse/` is TrueCourse output, not user work: most of it is
 * gitignored by the store's own `.gitignore`, but the directory itself and the
 * committable files in it (`config.json`, `LATEST.json`, `contracts/`, …) are
 * untracked until the team commits them — and analyze creates the directory
 * before it ever looks at the tree. Counting it as dirt would make TrueCourse
 * ask the user to resolve dirt it produced itself.
 */
export function summarizeUserWorkingTree(status: StatusResult): UserWorkingTreeStatus {
  const userPaths = (paths: string[]): number =>
    paths.filter((p) => !isTruecourseStorePath(p)).length;

  return {
    isClean: status.files.every((f) => isTruecourseStorePath(f.path)),
    modifiedCount:
      userPaths(status.modified) +
      userPaths(status.staged) +
      userPaths(status.deleted) +
      userPaths(status.created),
    untrackedCount: userPaths(status.not_added),
  };
}

/** `git status` reduced to the user's own changes — see `summarizeUserWorkingTree`. */
export async function getUserWorkingTreeStatus(git: SimpleGit): Promise<UserWorkingTreeStatus> {
  return summarizeUserWorkingTree(await git.status());
}
