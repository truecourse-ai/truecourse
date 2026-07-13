import { readLatest } from '@truecourse/core/lib/analysis-store';

/**
 * The canonical default-branch baseline commit for spec/corpus PR diffs. The EE
 * gate's baseline job analyzes the default-branch head and persists it as the
 * repo's LATEST analysis; PR-head analyses are stateless (diff-only) so they
 * never move it. We read that commit as the baseline anchor, so every PR diff
 * reads its head at `?ref=<headSha>` and its base at this commit.
 *
 * The base is derived from the analyze store rather than the working tree, so it
 * resolves for editions with no live checkout (EE). `null` when no baseline
 * analysis exists yet → callers return an empty diff.
 */
export async function baselineCommit(repoPath: string): Promise<string | null> {
  return (await readLatest(repoPath))?.analysis.commitHash ?? null;
}
