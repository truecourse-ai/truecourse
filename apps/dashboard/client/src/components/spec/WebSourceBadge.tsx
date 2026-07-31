/**
 * The "web" chip — marks a spec doc snapshotted from a registered llms.txt
 * documentation site (`truecourse spec source add`) rather than written in the
 * repo. Shown next to a doc row / conflict side / viewer header so a fetched page
 * reads distinctly from a repo-local doc. Same geometry as {@link WorkspaceBadge}
 * so the two sit inline together.
 */

import { Globe } from 'lucide-react';
import { HoverPopover } from '@/components/ui/hover-popover';

export function WebSourceBadge({ source, className = '' }: { source?: string; className?: string }) {
  return (
    <HoverPopover
      portal
      side="top"
      content={source ? `Fetched from ${source}` : 'Fetched from an external documentation site'}
    >
      <span
        className={`inline-flex shrink-0 items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground ${className}`}
      >
        <Globe className="h-2.5 w-2.5" />
        web
      </span>
    </HoverPopover>
  );
}
