/**
 * The "workspace" chip — marks a spec doc inherited from the workspace Knowledge
 * corpus (folded into a repo's spec before curate). Shown in repo Spec views next
 * to a kept-doc row / conflict side so an inherited doc reads distinctly from a
 * repo-local one. Absent in OSS and on repo-local docs (no `layer`). Same geometry
 * as the guard status chips (GuardHeldBadge / GuardFindingBadge) so it sits inline
 * with them; a HoverPopover explains the inheritance.
 */

import { Building2 } from 'lucide-react';
import { HoverPopover } from '@/components/ui/hover-popover';

export function WorkspaceBadge({ className = '' }: { className?: string }) {
  return (
    <HoverPopover
      content="Inherited from the workspace Knowledge corpus — shared by every repo in this organization."
      width="narrow"
      side="top"
      align="end"
    >
      <span
        className={`inline-flex shrink-0 items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground ${className}`}
      >
        <Building2 className="h-2.5 w-2.5" />
        workspace
      </span>
    </HoverPopover>
  );
}
