/**
 * Loads the last `guard generate` report (`guard/result.json`) for the report
 * sub-view. Returns `null` when nothing was ever generated (404) so the view can
 * render its onboarding empty state rather than erroring.
 */

import { useEffect, useState } from 'react';
import type { GuardGenerateReport } from '@truecourse/shared';
import * as api from '@/lib/api';

export function useGuardReport(repoId: string | undefined, enabled: boolean, reloadKey = 0) {
  const [report, setReport] = useState<GuardGenerateReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!repoId || !enabled) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getGuardReport(repoId)
      .then((r) => !cancelled && setReport(r))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Failed to load guard report'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [repoId, enabled, reloadKey]);

  return { report, loading, error };
}
