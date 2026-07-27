/**
 * The guard status pills. Both read the ONE status vocabulary
 * (`lib/guard-flow-status.ts`) and the ONE colour table (`lib/guard-status.ts`),
 * so a status looks and READS the same wherever it appears:
 *
 *  - {@link GuardStatusBadge} — a wire status, for the coverage surfaces;
 *  - {@link GuardFlowStatusChip} — the four-status word a flow, a test, or a
 *    surface row wears, in the list and in the detail alike;
 *  - {@link GuardNotInSpecsChip} — the one NON-status marker, muted, for a flow
 *    the specs no longer derive.
 */

import type { GuardSectionCoverageStatus } from '@truecourse/shared';
import {
  GUARD_FLOW_STATUS_WORD,
  GUARD_NOT_IN_SPECS_LABEL,
  type GuardFlowPlainStatus,
} from '@/lib/guard-flow-status';
import { guardFlowStatusBadge, guardStatusMeta } from '@/lib/guard-status';

const CHIP = 'inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-medium';

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
      className={`${CHIP} uppercase tracking-wider ${meta.badge} ${className}`}
    >
      {meta.label}
    </span>
  );
}

/**
 * The one word a flow / test / surface wears — "Passing", "Failing", "Blocked",
 * "Not generated". `word` overrides it only to name the STAGE a failure came from
 * ("Failing (birth)"); it is never a different status name.
 */
export function GuardFlowStatusChip({
  status,
  word,
  className = '',
}: {
  status: GuardFlowPlainStatus;
  word?: string;
  className?: string;
}) {
  return (
    <span className={`${CHIP} ${guardFlowStatusBadge(status)} ${className}`}>
      {word ?? GUARD_FLOW_STATUS_WORD[status]}
    </span>
  );
}

/**
 * The marker a flow the specs no longer derive wears beside its status chips —
 * the one thing on the row that says "this came from nowhere". Muted on purpose:
 * it is not a status, so it never takes a status colour, and the detail keeps the
 * sentence that explains it.
 */
export function GuardNotInSpecsChip({ className = '' }: { className?: string }) {
  return (
    <span className={`${CHIP} bg-muted text-muted-foreground ${className}`}>{GUARD_NOT_IN_SPECS_LABEL}</span>
  );
}
