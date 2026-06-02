/**
 * Shared git-repo guard for the spec → contracts → verify track, mirroring
 * the hard requirement `analyze` already enforces. TrueCourse's model is
 * commit-anchored (committable baselines, diff vs HEAD, stashing the committed
 * state), so these commands refuse to run outside a git repository instead of
 * silently producing un-diffable output.
 */

import * as p from "@clack/prompts";
import { isGitRepo, NOT_A_GIT_REPO_MESSAGE } from "@truecourse/core/lib/git";

/**
 * Abort the current CLI command (clean clack message + non-zero exit) when
 * `root` is not a git repository. Call right after `p.intro(...)` so the
 * message renders inside the command's block.
 */
export async function requireGitRepo(root: string): Promise<void> {
  if (await isGitRepo(root)) return;
  p.cancel(NOT_A_GIT_REPO_MESSAGE);
  process.exit(1);
}
