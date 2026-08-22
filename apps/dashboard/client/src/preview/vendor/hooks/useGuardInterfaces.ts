// PREVIEW (UI mock, fake data): delete when the one-product dashboard lands. See docs/ONE_PRODUCT_PLAN.md §3.5.
// Copied from the agentic branch's apps/dashboard/client/src/hooks/useGuardInterfaces.ts; delete with the preview.
/**
 * The Interfaces-tab catalog (`guard/interfaces`). Read-only: the catalog is
 * derived by the engine, not from this tab. Hoisted at page level so the catalog
 * list, the detail pane, and the Flows tab's scenario interfaces all read ONE
 * fetch.
 */

import { useEffect, useState } from 'react';
import type { GuardInterfacesView } from '@/preview/vendor/shared';
import * as api from '@/preview/vendor/lib/api';

export interface GuardInterfacesState {
  view: GuardInterfacesView | null;
  loading: boolean;
  error: string | null;
}

export function useGuardInterfaces(
  repoId: string | undefined,
  enabled: boolean,
  reloadKey = 0,
  ref?: string,
): GuardInterfacesState {
  const [view, setView] = useState<GuardInterfacesView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!repoId || !enabled) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getGuardInterfaces(repoId, ref)
      .then((v) => {
        if (!cancelled) setView(v);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load interfaces');
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
