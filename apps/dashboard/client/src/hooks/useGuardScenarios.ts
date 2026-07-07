/**
 * Loads the Scenarios-tab inventory: the committed-scenario list + recipe card
 * (`guard/scenarios`) joined to the last run's per-scenario results
 * (`guard/latest`) so each row can show its last-run outcome badge and, for
 * failures, its evidence. A scenario with no run result joins to `null` (the
 * neutral "guarded" treatment). The orphaned flag rides the join: the run's
 * `orphaned` outcome is the authoritative source, so the badge and the flag can
 * never disagree. Read-only.
 */

import { useEffect, useState } from 'react';
import type {
  GuardRecipeCard,
  GuardScenarioListItem,
  GuardScenarioResult,
  GuardSectionCoverageStatus,
} from '@truecourse/shared';
import * as api from '@/lib/api';

/** One inventory row: the committed scenario joined to its last-run result. */
export interface GuardScenarioRowData extends GuardScenarioListItem {
  /** The last run's result for this id, or null when the run has no outcome for it. */
  lastResult: GuardScenarioResult | null;
}

/** The badge status for a row — the last-run outcome, else the neutral "guarded". */
export function guardRowStatus(row: GuardScenarioRowData): GuardSectionCoverageStatus {
  return row.lastResult ? row.lastResult.outcome : 'guarded';
}

export interface GuardScenariosState {
  recipe: GuardRecipeCard | null;
  rows: GuardScenarioRowData[];
  /** The run the outcomes were joined from (for evidence fetches); null when never run. */
  runId: string | null;
  loading: boolean;
  error: string | null;
}

export function useGuardScenarios(repoId: string | undefined, enabled: boolean, reloadKey = 0): GuardScenariosState {
  const [recipe, setRecipe] = useState<GuardRecipeCard | null>(null);
  const [rows, setRows] = useState<GuardScenarioRowData[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!repoId || !enabled) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([api.getGuardScenarios(repoId), api.getGuardLatest(repoId)])
      .then(([inventory, latest]) => {
        if (cancelled) return;
        const byId = new Map((latest?.scenarios ?? []).map((s) => [s.id, s]));
        setRecipe(inventory.recipe);
        setRows(inventory.scenarios.map((s) => ({ ...s, lastResult: byId.get(s.id) ?? null })));
        setRunId(latest?.run.runId ?? null);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load scenarios');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repoId, enabled, reloadKey]);

  return { recipe, rows, runId, loading, error };
}
