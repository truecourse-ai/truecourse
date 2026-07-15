/**
 * PR guard-scope model — the pure (no React) resolution of what a `?pr=N` guard
 * view may read, extracted from RepoPage so the leak-prevention logic is
 * testable on its own (the ee-lens pattern).
 *
 * A PR-scoped guard view keys every read to the PR's head SHA. Until that SHA is
 * known the view must HOLD: a ref-less guard fetch answers with repo-BASELINE
 * data, which must never render under a PR header (and no guard decision may be
 * written against it).
 */

export type PrGuardScope =
  /** No PR in view — baseline (repo) guard reads are the correct ones. */
  | { state: 'repo'; ref: undefined }
  /** PR in view, gate-runs fetch still in flight — hold all guard reads. */
  | { state: 'loading'; ref: undefined }
  /** PR in view, runs fetch settled, no gate run recorded — explicit empty state. */
  | { state: 'no-run'; ref: undefined }
  /** PR in view with a known head SHA — guard reads key to it. */
  | { state: 'resolved'; ref: string };

/**
 * Whether guard reads AND guard-decision writes (dismiss/undismiss) may run in
 * this scope. False while a PR scope is unresolved: the only data on screen
 * then would be the baseline's, and no decision may be written against it.
 */
export function guardReadsEnabled(scope: PrGuardScope): boolean {
  return scope.state === 'repo' || scope.state === 'resolved';
}

export function resolvePrGuardScope(args: {
  /** The `?pr=N` number, or null outside a PR view. */
  prNumber: number | null;
  /** The PR's latest gate run head SHA, when one is recorded. */
  headSha: string | undefined;
  /** Whether the gate-runs fetch has settled (useRepoGateRuns.loaded). */
  gateRunsLoaded: boolean;
}): PrGuardScope {
  if (args.prNumber == null) return { state: 'repo', ref: undefined };
  if (args.headSha) return { state: 'resolved', ref: args.headSha };
  return args.gateRunsLoaded ? { state: 'no-run', ref: undefined } : { state: 'loading', ref: undefined };
}
