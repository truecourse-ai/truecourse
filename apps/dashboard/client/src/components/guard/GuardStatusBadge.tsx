/**
 * A compact status pill for a guard section-coverage status. Reads its label and
 * colour from the shared status metadata so the doc surface, totals strip, and
 * section detail never disagree on how a status looks.
 */

import type { GuardSectionCoverageStatus } from '@truecourse/shared';
import { guardStatusMeta } from '@/lib/guard-status';

export function GuardStatusBadge({
  status,
  className = '',
}: {
  status: GuardSectionCoverageStatus;
  className?: string;
}) {
  const meta = guardStatusMeta(status);
  return (
    <span
      title={meta.hint}
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${meta.badge} ${className}`}
    >
      {meta.label}
    </span>
  );
}
