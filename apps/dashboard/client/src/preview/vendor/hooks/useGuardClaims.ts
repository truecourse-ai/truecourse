// PREVIEW (UI mock, fake data): delete when the one-product dashboard lands. See docs/ONE_PRODUCT_PLAN.md §3.5.
// Copied from the agentic branch's apps/dashboard/client/src/hooks/useGuardClaims.ts; delete with the preview.
/**
 * The Claims-tab corpus (`guard/claims`), every testable statement the specs
 * make, joined to the flows and scenario steps that prove it. A pure READ: claims
 * are extracted by `guard generate`, so the tab offers no action of its own and
 * the hook has no mutation half. Hoisted at page level so the claim list and the
 * detail pane share ONE fetch.
 */

import { useEffect, useState } from 'react';
import type { GuardClaimsView } from '@/preview/vendor/shared';
import * as api from '@/preview/vendor/lib/api';

export interface GuardClaimsState {
  view: GuardClaimsView | null;
  loading: boolean;
  error: string | null;
}

export function useGuardClaims(
  repoId: string | undefined,
  enabled: boolean,
  reloadKey = 0,
  ref?: string,
): GuardClaimsState {
  const [view, setView] = useState<GuardClaimsView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!repoId || !enabled) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getGuardClaims(repoId, ref)
      .then((v) => {
        if (!cancelled) setView(v);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load claims');
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
