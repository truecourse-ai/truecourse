/**
 * The "finding" chip — a birth finding's badge in the Scenarios inventory and its
 * detail header. Red-tinted like a problem, but deliberately OUTLINED so it never
 * reads as the solid `fail` run-outcome pill: a finding is a candidate that failed
 * to become a guard (a generation defect or real drift), not a run result. Same
 * geometry as GuardStatusBadge so it sits inline with the status pills.
 */

export function GuardFindingBadge({ className = '', compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded border border-red-500/40 ${compact ? 'px-1 py-0 text-[9px]' : 'px-1.5 py-0.5 text-[10px]'} font-medium uppercase tracking-wider text-red-600 dark:text-red-400 ${className}`}
    >
      finding
    </span>
  );
}
