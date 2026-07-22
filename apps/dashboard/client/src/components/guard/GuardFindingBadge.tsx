/**
 * The tool-defect chip — the badge for the quiet birth-finding residue in the
 * Scenarios inventory and the section detail. A birth finding is no longer real
 * drift (that commits as an ordinary failing scenario); it is a weak/undecidable
 * candidate the tool couldn't turn into a guard and re-authors on the next
 * generate. Muted (bordered, no colour) so it never reads as a red run failure.
 * Same geometry as GuardStatusBadge so it sits inline with the status pills.
 */

export function GuardFindingBadge({ className = '', compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded border border-border ${compact ? 'px-1 py-0 text-[9px]' : 'px-1.5 py-0.5 text-[10px]'} font-medium uppercase tracking-wider text-muted-foreground ${className}`}
    >
      tool defect
    </span>
  );
}
