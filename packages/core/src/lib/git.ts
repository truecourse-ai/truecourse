/**
 * Safe git wrapper. All git operations in the server go through this module.
 *
 * Provides a `getGit()` function that validates the path is a git repository
 * before returning a SimpleGit instance. Throws a clean 400 AppError if not.
 *
 * Also provides `isGitRepo()` for cases where callers want to check without throwing.
 */

import fs from 'node:fs';
import { simpleGit, type SimpleGit } from 'simple-git';
import { createAppError } from './errors.js';
import { TRUECOURSE_DIR } from '../config/paths.js';

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

export interface RunWithStashOptions {
  /**
   * When true, skip stashing entirely and run `fn` against the working tree
   * as-is (e.g. `--no-stash`, diff mode, or a non-git context). The helper
   * touches git only when this is false.
   */
  skipStash: boolean;
  /** Stash message passed to `git stash push -m`. */
  message: string;
  /** Invoked right before the stash is pushed (surface "Stashing…" progress). */
  onStashStart?: () => void;
  /** Invoked right before the stash is popped (surface "Restoring…" progress). */
  onRestoreStart?: () => void;
  /**
   * Invoked when the initial stash attempt throws (git unavailable, etc.). The
   * run still proceeds against the current tree. Callers log in their own voice;
   * omit to swallow silently.
   */
  onStashError?: (error: Error) => void;
  /**
   * Invoked when `git stash pop` fails in the `finally`. The stash entry is left
   * for the user to recover manually. Callers log in their own voice.
   */
  onRestoreError?: (error: Error) => void;
}

/**
 * Run `fn` against the committed state by stashing the dirty working tree first
 * and popping it after — the shared implementation behind `analyze` and
 * `verify`'s full-mode stash.
 *
 * Crucially, the stash **excludes TrueCourse's own `.truecourse/` directory**.
 * That dir holds the tool's inputs (generated contracts) and committable state,
 * not the code under analysis; sweeping it into the stash would delete the very
 * artifacts `verify` then reads (issue #542). The stash is scoped to neutralize
 * uncommitted *code* only.
 *
 * No-ops (runs `fn` directly) when `skipStash`, when the tree is clean, when the
 * repo is a subdirectory of a larger repo (stashing would touch parent-repo
 * files), or when git is unavailable.
 */
export async function runWithStash<T>(
  repoRoot: string,
  options: RunWithStashOptions,
  fn: () => Promise<T>,
): Promise<T> {
  let didStash = false;
  let stashGit: SimpleGit | undefined;

  if (!options.skipStash) {
    try {
      stashGit = await getGit(repoRoot);
      const status = await stashGit.status();
      if (!status.isClean()) {
        const gitRoot = (await stashGit.revparse(['--show-toplevel'])).trim();
        // Skip stashing when the repo path is a subdirectory of a larger repo
        // (e.g. test fixtures inside the main repo) — stashing there would
        // touch unrelated parent-repo files. Compare *canonical* paths:
        // `git --show-toplevel` returns the realpath, so a symlinked repoRoot
        // (e.g. macOS /tmp → /private/tmp, or a symlinked $HOME) must be
        // resolved too — otherwise we'd wrongly treat the real git root as a
        // parent and silently skip the stash. When we do stash, simple-git's
        // baseDir (repoRoot) makes the `.` pathspec resolve to the repo root.
        if (fs.realpathSync(repoRoot) === fs.realpathSync(gitRoot)) {
          options.onStashStart?.();
          const res = await stashGit.stash([
            'push',
            '--include-untracked',
            '-m',
            options.message,
            // Stash everything under the repo root EXCEPT `.truecourse/`, so the
            // tool's own working dir (contracts, specs, baselines) survives.
            '--',
            '.',
            `:(exclude,top)${TRUECOURSE_DIR}`,
          ]);
          // `git stash push` prints "No local changes to save" when the
          // pathspec matched nothing dirty.
          didStash = !res.includes('No local changes');
        }
      }
    } catch (error) {
      options.onStashError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  try {
    return await fn();
  } finally {
    if (didStash && stashGit) {
      options.onRestoreStart?.();
      try {
        await stashGit.stash(['pop']);
      } catch (error) {
        options.onRestoreError?.(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }
}
