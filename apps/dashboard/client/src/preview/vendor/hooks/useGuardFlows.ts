// PREVIEW (UI mock, fake data): delete when the one-product dashboard lands. See docs/ONE_PRODUCT_PLAN.md §3.5.
// Copied from the agentic branch's apps/dashboard/client/src/hooks/useGuardFlows.ts; delete with the preview.
/**
 * The Flows-tab inventory (`guard/flows`), every flow with its per-surface
 * status, buckets, and the recipe card that rides the same envelope. Hoisted at
 * page level (like the scenario inventory before it) so the left panel and the
 * main pane read ONE fetch and the guard reload key refreshes both. Read-only.
 */

import { useEffect, useState } from 'react';
import type { GuardFlowsView } from '@/preview/vendor/shared';
import * as api from '@/preview/vendor/lib/api';

export interface GuardFlowsState {
  view: GuardFlowsView | null;
  loading: boolean;
  error: string | null;
}

export function useGuardFlows(
  repoId: string | undefined,
  enabled: boolean,
  reloadKey = 0,
  ref?: string,
): GuardFlowsState {
  const [view, setView] = useState<GuardFlowsView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!repoId || !enabled) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getGuardFlows(repoId, ref)
      .then((v) => {
        if (!cancelled) setView(v);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load flows');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repoId, enabled, reloadKey, ref]);

  return { view, loading, error };
}
