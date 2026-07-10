/**
 * Loads the guard drifts view's run data: the last run (`guard/latest`), the run
 * history (`guard/history`), and — when the user picks an older run from the
 * history — that run's snapshot (`guard/runs/:runId`, fetched once and cached).
 * `run` is whichever run is currently selected (the latest by default), and it's
 * the single source the summary panel and the drift list read.
 */

import { useCallback, useEffect, useState } from 'react';
import type { GuardGatePending, GuardHistoryEntry, GuardLatest } from '@truecourse/shared';
import * as api from '@/lib/api';

export interface GuardRunsState {
  /** The most recent run (the default selection); null until a run exists. */
  latest: GuardLatest | null;
  /** Append-only run summaries, newest first is a display concern of the panel. */
  history: GuardHistoryEntry[];
  /** The currently-displayed run (latest, or a selected older snapshot). */
  run: GuardLatest | null;
  /** The displayed run's id, for highlighting the history row. */
  selectedRunId: string | null;
  /** When viewing a PR head (`ref`) with no run yet, the in-flight gate (queued/
   *  running) if any — the view shows a "gate hasn't run at this commit" card
   *  instead of baseline data. Null in the repo view or when nothing is in flight. */
  pending: GuardGatePending | null;
  selectRun: (runId: string | null) => void;
  loading: boolean;
  error: string | null;
}

export function useGuardRuns(
  repoId: string | undefined,
  enabled: boolean,
  reloadKey = 0,
  ref?: string,
): GuardRunsState {
  const [latest, setLatest] = useState<GuardLatest | null>(null);
  const [pending, setPending] = useState<GuardGatePending | null>(null);
  const [history, setHistory] = useState<GuardHistoryEntry[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [cache, setCache] = useState<Record<string, GuardLatest>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!repoId || !enabled) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    // `ref` (a PR head) scopes the run to that commit; the response carries the
    // pending gate (if any) so the view never shows baseline data under a PR.
    // The run HISTORY is repo-level (baseline runs) — under a PR ref it is not
    // fetched at all, so a baseline run can never be listed or selected there.
    Promise.all([
      api.getGuardLatest(repoId, ref),
      ref ? Promise.resolve({ runs: [] }) : api.getGuardHistory(repoId),
    ])
      .then(([{ latest: l, pending: p }, h]) => {
        if (cancelled) return;
        setLatest(l);
        setPending(p);
        setHistory(h.runs);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load guard runs');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repoId, enabled, reloadKey, ref]);

  const selectRun = useCallback(
    (runId: string | null) => {
      // null or the latest run id → show the already-loaded latest.
      if (runId == null || runId === latest?.run.runId) {
        setSelectedRunId(null);
        return;
      }
      setSelectedRunId(runId);
      if (!cache[runId] && repoId) {
        void api
          .getGuardRun(repoId, runId)
          .then((run) => run && setCache((prev) => ({ ...prev, [runId]: run })))
          .catch(() => {
            /* fall back to latest below; a missing run is not fatal to the view */
          });
      }
    },
    [latest, cache, repoId],
  );

  const run = selectedRunId == null ? latest : cache[selectedRunId] ?? latest;

  return {
    latest,
    history,
    run,
    selectedRunId: run?.run.runId ?? null,
    pending,
    selectRun,
    loading,
    error,
  };
}
