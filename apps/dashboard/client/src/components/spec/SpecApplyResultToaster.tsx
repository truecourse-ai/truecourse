/**
 * Side effect: surface the latest Spec Apply result as a toast.
 * Success → emerald, partial-failure → amber. Auto-dismiss is handled
 * globally by sonner's default `duration` in App.tsx.
 */

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useSpec } from './SpecContext';

export function SpecApplyResultToaster() {
  const { applyResult } = useSpec();
  const lastShownRef = useRef<unknown>(null);

  useEffect(() => {
    if (!applyResult || applyResult === lastShownRef.current) return;
    lastShownRef.current = applyResult;

    const written = applyResult.materialize?.written ?? 0;
    const failures = applyResult.materialize?.failures ?? [];

    if (failures.length > 0) {
      toast.warning('Applied with failures', {
        description: `Materialized ${written} canonical files · ${failures.length} failure${
          failures.length === 1 ? '' : 's'
        }.`,
      });
    } else {
      toast.success('Applied', {
        description: (
          <>
            Materialized {written} canonical files. Run{' '}
            <span className="font-mono">Generate</span> on the Contracts tab
            to extract IL.
          </>
        ),
      });
    }
  }, [applyResult]);

  return null;
}
