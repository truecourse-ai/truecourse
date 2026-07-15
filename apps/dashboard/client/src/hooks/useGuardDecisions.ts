/**
 * Loads the committable guard decisions file (`scenarios/decisions.json`, the
 * dismissed claims) so the Scenarios tab can mark a finding row/detail as already
 * dismissed. Exposes `refetch` so a Dismiss / Un-dismiss action can refresh the
 * derived state immediately (the write route returns the updated file, but a
 * refetch keeps this the single source). Always resolves to a decisions object
 * (the route is 200 with an empty file until anything is dismissed).
 */

import { useCallback, useEffect, useState } from 'react';
import type { GuardDecisions } from '@truecourse/shared';
import * as api from '@/lib/api';

const EMPTY: GuardDecisions = { version: 1, dismissedClaims: [] };

export function useGuardDecisions(
  repoId: string | undefined,
  enabled: boolean,
  reloadKey = 0,
  pr?: number,
) {
  const [decisions, setDecisions] = useState<GuardDecisions>(EMPTY);
  const [localKey, setLocalKey] = useState(0);
  const refetch = useCallback(() => setLocalKey((k) => k + 1), []);

  useEffect(() => {
    if (!repoId || !enabled) return;
    let cancelled = false;
    // With `pr` (EE) the PR's dismissals overlay is merged over the repo row.
    api
      .getGuardDecisions(repoId, pr)
      .then((d) => !cancelled && setDecisions(d))
      .catch(() => !cancelled && setDecisions(EMPTY));
    return () => {
      cancelled = true;
    };
  }, [repoId, enabled, reloadKey, localKey, pr]);

  return { decisions, refetch };
}
