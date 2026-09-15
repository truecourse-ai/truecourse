/**
 * The "workspace" chip — marks a doc that comes from the workspace corpus rather
 * than a repository's own. Shown beside a kept-doc row / conflict side so such a
 * doc reads distinctly from a repo-local one. Absent on repo-local docs (no
 * `layer`). Same geometry
 * as the guard status chips (GuardHeldBadge / GuardFindingBadge) so it sits inline
 * with them.
 */

export function WorkspaceBadge({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded border border-border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground ${className}`}
    >
      workspace
    </span>
  );
}
