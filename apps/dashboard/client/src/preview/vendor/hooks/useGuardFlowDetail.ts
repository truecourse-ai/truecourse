// PREVIEW (UI mock, fake data): delete when the one-product dashboard lands. See docs/ONE_PRODUCT_PLAN.md §3.5.
// Copied from the agentic branch's apps/dashboard/client/src/hooks/useGuardFlowDetail.ts; delete with the preview.
/**
 * One flow's detail (`guard/flows/:flowId`), milestones bound to their live
 * sections, the per-surface scenario rows, gaps, interfaces and findings. Fetched
 * per opened flow tab; `null` detail with no error means the id is gone (404),
 * which the pane renders as an honest "flow not found" rather than a hollow panel.
 */

import { useEffect, useState } from 'react';
import type { GuardFlowDetail } from '@/preview/vendor/shared';
import * as api from '@/preview/vendor/lib/api';

export interface GuardFlowDetailState {
  detail: GuardFlowDetail | null;
  loading: boolean;
  error: string | null;
}

export function useGuardFlowDetail(
  repoId: string | undefined,
  flowId: string | null,
  reloadKey = 0,
  ref?: string,
): GuardFlowDetailState {
  const [detail, setDetail] = useState<GuardFlowDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!repoId || !flowId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDetail(null);
    api
      .getGuardFlow(repoId, flowId, ref)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load flow');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repoId, flowId, reloadKey, ref]);

  return { detail, loading, error };
}
