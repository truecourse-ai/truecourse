/**
 * The "held" chip — a ready-but-held scenario's badge in the Scenarios inventory
 * and its detail header. Amber-tinted and OUTLINED: a held scenario passed birth
 * but its section didn't settle, so it sits in limbo — neither a healthy committed
 * guard nor a red problem like a finding. The amber reads "waiting", distinct from
 * the findings block's red. Same geometry as GuardStatusBadge / GuardFindingBadge
 * so it sits inline with the status pills.
 */

export function GuardHeldBadge({ className = '', compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded border border-amber-500/40 ${compact ? 'px-1 py-0 text-[9px]' : 'px-1.5 py-0.5 text-[10px]'} font-medium uppercase tracking-wider text-amber-600 dark:text-amber-400 ${className}`}
    >
      held
    </span>
  );
}
