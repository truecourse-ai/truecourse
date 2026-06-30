/**
 * Side effect: surface the latest Contracts Generate result as a toast.
 * Success → emerald, validation issues / skipped → amber, failures → red.
 * When there are validation issues the toast shows only the count; the
 * full issue list is displayed persistently in the Contracts panel.
 */

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import type { ContractsGenerateResponse } from '@/lib/api';

interface ContractsGenerateResultToasterProps {
  result: ContractsGenerateResponse | null;
}

export function ContractsGenerateResultToaster({
  result,
}: ContractsGenerateResultToasterProps) {
  const lastShownRef = useRef<unknown>(null);

  useEffect(() => {
    if (!result || result === lastShownRef.current) return;
    lastShownRef.current = result;

    if ('error' in result.il) {
      toast.error('Generate failed', {
        description: result.il.error,
        });
      return;
    }

    if ('skipped' in result.il) {
      // The user dismissing the cost-estimate confirm is not worth a toast — they
      // initiated it. Other skips (e.g. "no corpus") still surface.
      if (result.il.skipped === 'cancelled') return;
      toast.warning('Generate skipped', {
        description: result.il.skipped,
        });
      return;
    }

    const issues = result.il.validationIssues ?? [];
    const written = result.il.written;
    const hardCount = issues.filter((i) => i.severity === 'hard').length;

    if (issues.length === 0) {
      toast.success('Generated', {
        description: `Wrote ${written} TC contract${written === 1 ? '' : 's'}.`,
      });
      return;
    }

    const label = hardCount > 0 ? 'Generated with errors' : 'Generated with warnings';
    const detail =
      hardCount > 0
        ? `${hardCount} error${hardCount === 1 ? '' : 's'} blocked writing — see Contracts panel.`
        : `Wrote ${written} contract${written === 1 ? '' : 's'} · ${issues.length} warning${issues.length === 1 ? '' : 's'} — see Contracts panel.`;
    if (hardCount > 0) {
      toast.error(label, { description: detail });
    } else {
      toast.warning(label, { description: detail });
    }
  }, [result]);

  return null;
}
