/**
 * Breadcrumb-style title row shown above tabbed viewers (file
 * explorer, spec corpus, IL contracts). Path segments separated by
 * "/" with the last segment emphasized. Optional `icon` and `trailing`
 * slots let callers add an inline icon or right-aligned actions while
 * keeping every viewer visually aligned.
 */

import type { ReactNode } from 'react';

interface FileBreadcrumbProps {
  filePath: string;
  icon?: ReactNode;
  trailing?: ReactNode;
}

export function FileBreadcrumb({ filePath, icon, trailing }: FileBreadcrumbProps) {
  const parts = filePath.split('/');
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-3 py-2">
      {icon && <div className="shrink-0 text-muted-foreground">{icon}</div>}
      <div className="flex flex-1 items-center gap-1 overflow-hidden text-sm">
        {parts.map((part, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <span className="text-muted-foreground">/</span>}
            <span
              className={
                i === parts.length - 1
                  ? 'font-medium text-foreground'
                  : 'text-muted-foreground'
              }
            >
              {part}
            </span>
          </span>
        ))}
      </div>
      {trailing && <div className="shrink-0">{trailing}</div>}
    </div>
  );
}
