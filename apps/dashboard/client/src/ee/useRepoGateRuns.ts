/**
 * Latest gate run per PR for a repo (EE only). Drives the PR view: resolving a
 * `?pr=N` URL to its head SHA (re-keys the spec/contracts tabs) and conclusion
 * (the chrome's PR label). Returns [] for OSS / before the repo name resolves.
 */

import { useEffect, useState } from 'react';
import type { GithubRunSummary, GithubRunsResponse } from '@truecourse/shared';
import { getServerUrl } from '@/lib/server-url';

export function useRepoGateRuns(repoFullName: string | undefined): GithubRunSummary[] {
  const [runs, setRuns] = useState<GithubRunSummary[]>([]);

  useEffect(() => {
    if (!repoFullName) {
      setRuns([]);
      return;
    }
    let cancelled = false;
    fetch(`${getServerUrl()}/api/ee/github/repos/${repoFullName}/runs`, { credentials: 'include' })
      .then((r) => (r.ok ? (r.json() as Promise<GithubRunsResponse>) : { runs: [] }))
      .then((d) => {
        if (cancelled) return;
        // Runs come newest-first; keep the latest run (snapshot) per PR.
        const byPr = new Map<number, GithubRunSummary>();
        for (const run of d.runs) if (!byPr.has(run.prNumber)) byPr.set(run.prNumber, run);
        setRuns([...byPr.values()]);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [repoFullName]);

  return runs;
}
