/**
 * Latest gate run per PR for a repo (EE only). Drives the PR view: resolving a
 * `?pr=N` URL to its head SHA (re-keys the spec/contracts tabs) and conclusion
 * (the chrome's PR label). `loaded` says the fetch has SETTLED (success or
 * failure) — until then a `?pr=N` view cannot know the PR's head SHA, so guard
 * reads must hold rather than fall back to the repo baseline. Returns
 * `{ runs: [], loaded: false }` for OSS / before the repo name resolves.
 */

import { useEffect, useState } from 'react';
import type { GithubRunSummary, GithubRunsResponse } from '@truecourse/shared';
import { getServerUrl } from '@/lib/server-url';

export interface RepoGateRunsState {
  runs: GithubRunSummary[];
  /** True once the runs fetch settled (even on failure) for the current repo. */
  loaded: boolean;
}

export function useRepoGateRuns(repoFullName: string | undefined): RepoGateRunsState {
  const [state, setState] = useState<RepoGateRunsState>({ runs: [], loaded: false });

  useEffect(() => {
    setState({ runs: [], loaded: false });
    if (!repoFullName) return;
    let cancelled = false;
    fetch(`${getServerUrl()}/api/ee/github/repos/${repoFullName}/runs`, { credentials: 'include' })
      .then((r) => (r.ok ? (r.json() as Promise<GithubRunsResponse>) : { runs: [] }))
      .then((d) => {
        if (cancelled) return;
        // Runs come newest-first; keep the latest run (snapshot) per PR.
        const byPr = new Map<number, GithubRunSummary>();
        for (const run of d.runs) if (!byPr.has(run.prNumber)) byPr.set(run.prNumber, run);
        setState({ runs: [...byPr.values()], loaded: true });
      })
      .catch(() => {
        // Settled without data: the PR view shows its explicit "no gate run"
        // state rather than hanging on a spinner (and never baseline data).
        if (!cancelled) setState({ runs: [], loaded: true });
      });
    return () => {
      cancelled = true;
    };
  }, [repoFullName]);

  return state;
}
