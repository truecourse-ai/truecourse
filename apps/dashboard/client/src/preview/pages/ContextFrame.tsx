/**
 * Context's frame: the one-row header ({@link PageHeader}, the platform's), and
 * the side menu of its two sections beside the content.
 *
 * Context is where documentation is sourced, all of it: a source is added here,
 * its documents are curated here, the conflicts between them are settled here,
 * and a repository then LINKS the sources it reads on its own Context tab. The
 * repository console has no corpus of its own any more.
 */

import type { ReactNode } from 'react';
import { PageHeader, SideMenu } from '@/preview/ui/bits';
import { CONFLICTS_BASE, CONTEXT_BASE } from './context-hrefs';

export type ContextSection = 'documents' | 'conflicts';

export function ContextFrame({
  section,
  crumbs = [],
  right,
  children,
}: {
  section: ContextSection;
  /** The trail after "Context", innermost last; the last one is the page's name. */
  crumbs?: { label: string; to?: string }[];
  right?: ReactNode;
  children: ReactNode;
}) {
  const title = crumbs.length > 0 ? crumbs[crumbs.length - 1]!.label : 'Context';
  const trail = [
    ...(crumbs.length > 0 ? [{ label: 'Context', to: CONTEXT_BASE }] : []),
    ...crumbs.slice(0, -1).map((crumb) => ({ label: crumb.label, to: crumb.to ?? CONTEXT_BASE })),
  ];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title={title} crumbs={trail} {...(right ? { right } : {})} />
      <div className="flex min-h-0 flex-1">
        <SideMenu
          label="Context sections"
          activeId={section}
          items={[
            { id: 'documents', label: 'Documents', to: CONTEXT_BASE },
            { id: 'conflicts', label: 'Conflicts', to: CONFLICTS_BASE },
          ]}
        />
        <div className="min-h-0 min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
