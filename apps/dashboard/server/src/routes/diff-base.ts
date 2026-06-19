import { readVerifyState } from '@truecourse/core/commands/spec-in-process';

/**
 * The canonical default-branch baseline commit for BL-Drift PR diffs. The gate
 * marks one verify snapshot `isBaseline` when it scans the default branch, and
 * stores the spec / contracts / inferred baselines at that SAME commit — so every
 * PR diff reads its head at `?ref=<headSha>` and its base at this commit.
 *
 * We anchor on the verify baseline because it's the only store with an
 * `isBaseline` filter (`ee/packages/data-store/src/verify-store.ts`); the generic
 * spec `loadLatest` is most-recent, which a PR-head scan pollutes. `null` when no
 * baseline exists yet → callers return an empty diff.
 */
export async function baselineCommit(repoPath: string): Promise<string | null> {
  return (await readVerifyState(repoPath))?.commitHash ?? null;
}
