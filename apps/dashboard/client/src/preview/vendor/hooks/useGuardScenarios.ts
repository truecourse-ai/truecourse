// PREVIEW (UI mock, fake data): delete when the one-product dashboard lands. See docs/ONE_PRODUCT_PLAN.md §3.5.
// Copied from the agentic branch's apps/dashboard/client/src/hooks/useGuardScenarios.ts; delete with the preview.
/**
 * Loads the TEST inventory: the committed tests + recipe card (`guard/scenarios`)
 * joined to the last run's per-test results (`guard/latest`), so each row can show
 * how it last ran and, for failures, reach its evidence. A test no run covered
 * joins to `null` and falls back to the status it was COMMITTED with (guard
 * commits failing tests), see `guardTestStatusView`. The orphaned flag rides the
 * join: the run's `orphaned` outcome is the authoritative source, so the status
 * and the flag can never disagree. Read-only.
 */

import { useEffect, useState } from 'react';
import type {
  GuardRecipeCard,
  GuardScenarioListItem,
  GuardScenarioResult,
} from '@/preview/vendor/shared';
import * as api from '@/preview/vendor/lib/api';

/** One inventory row: the committed scenario joined to its last-run result. */
export interface GuardScenarioRowData extends GuardScenarioListItem {
  /** The last run's result for this id, or null when the run has no outcome for it. */
  lastResult: GuardScenarioResult | null;
}

/** The run the outcomes came from. Internal: the id is what a caller needs (the
 *  evidence fetches address it), and each ROW carries its own result. */
interface GuardLastRun {
  runId: string;
  ranAt: string;
  commit: string | null;
  branch: string | null;
  durationMs: number;
}

export interface GuardScenariosState {
  recipe: GuardRecipeCard | null;
  rows: GuardScenarioRowData[];
  /** The run the outcomes were joined from (for evidence fetches); null when never run. */
  runId: string | null;
  /** The commit the inventory was read at (hosted), under a PR ref this can be
   *  the baseline commit (gate fallback); null on OSS / before load. */
  scenariosCommit: string | null;
  loading: boolean;
  error: string | null;
}

export function useGuardScenarios(
  repoId: string | undefined,
  enabled: boolean,
  reloadKey = 0,
  ref?: string,
): GuardScenariosState {
  const [recipe, setRecipe] = useState<GuardRecipeCard | null>(null);
  const [rows, setRows] = useState<GuardScenarioRowData[]>([]);
  const [lastRun, setLastRun] = useState<GuardLastRun | null>(null);
  const [scenariosCommit, setScenariosCommit] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!repoId || !enabled) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    // `ref` (a PR head) scopes both the committed inventory and the run it joins to.
    Promise.all([api.getGuardScenarios(repoId, ref), api.getGuardLatest(repoId, ref)])
      .then(([inventory, { latest }]) => {
        if (cancelled) return;
        const byId = new Map((latest?.scenarios ?? []).map((s) => [s.id, s]));
        setRecipe(inventory.recipe);
        setRows(inventory.scenarios.map((s) => ({ ...s, lastResult: byId.get(s.id) ?? null })));
        setLastRun(
          latest
            ? {
                runId: latest.run.runId,
                ranAt: latest.run.ranAt,
                commit: latest.run.commit,
                branch: latest.run.branch,
                durationMs: latest.scenarios.reduce((n, s) => n + s.durationMs, 0),
              }
            : null,
        );
        setScenariosCommit(inventory.scenariosCommit ?? null);
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
  }, [repoId, enabled, reloadKey, ref]);

  return { recipe, rows, runId: lastRun?.runId ?? null, scenariosCommit, loading, error };
}
