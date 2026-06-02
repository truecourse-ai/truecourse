/**
 * Safe git wrapper. All git operations in the server go through this module.
 *
 * Provides a `getGit()` function that validates the path is a git repository
 * before returning a SimpleGit instance. Throws a clean 400 AppError if not.
 *
 * Also provides `isGitRepo()` for cases where callers want to check without throwing.
 */

import { simpleGit, type SimpleGit } from 'simple-git';
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
