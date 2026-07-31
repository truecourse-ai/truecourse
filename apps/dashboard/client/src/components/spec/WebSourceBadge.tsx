/**
 * The "web" chip — marks a spec doc snapshotted from a registered llms.txt
 * documentation site (`truecourse spec source add`) rather than written in the
 * repo. Shown next to a doc row / conflict side / viewer header so a fetched page
 * reads distinctly from a repo-local doc. Same geometry as {@link WorkspaceBadge}
 * so the two sit inline together.
 */

import { Globe } from 'lucide-react';

export function WebSourceBadge({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground ${className}`}
    >
      <Globe className="h-2.5 w-2.5" />
      web
    </span>
  );
}
