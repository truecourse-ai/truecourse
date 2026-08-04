/**
 * The "workspace" chip — marks a spec doc inherited from the workspace Knowledge
 * corpus (folded into a repo's spec before curate). Shown in repo Spec views next
 * to a kept-doc row / conflict side so an inherited doc reads distinctly from a
 * repo-local one. Absent in OSS and on repo-local docs (no `layer`). Same geometry
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
