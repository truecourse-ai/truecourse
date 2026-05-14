/**
 * Centered empty-state block used in the left-sidebar panels (Spec,
 * Contracts, Verify, Decisions) when there's no data yet. Standard
 * shape: section icon, bold title, smaller body paragraph. One
 * component so every panel renders the same vertical rhythm,
 * paddings, colours, and typography.
 */

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  body: ReactNode;
}

export function EmptyState({ icon: Icon, title, body }: EmptyStateProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <Icon className="h-8 w-8 text-muted-foreground/60" />
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}
