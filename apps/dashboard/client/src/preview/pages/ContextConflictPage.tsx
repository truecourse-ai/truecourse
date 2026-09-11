/**
 * One conflict of Context: the two sections that disagree, side by side, with
 * the resolver the corpus has always had — pointed at the WORKSPACE corpus and
 * the workspace decisions, because a conflict is settled once and the verdict
 * rides into every repository that reads the documents.
 *
 * No repository is named anywhere on this page, and none is read: a conflict
 * has no coverage of its own.
 */

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { GitMerge } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { useContextSignal } from '@/preview/shell/use-context';
import { ContextFrame } from './ContextFrame';
import { CONFLICTS_BASE } from './context-hrefs';
import { conflictRows, useWorkspaceCorpus } from './ConflictsPage';
import { CorpusItemPane } from './CorpusItemPane';
import { createWorkspaceContextSource } from './context-spec-source';

export default function ContextConflictPage({ conflictId }: { conflictId: string }) {
  const signal = useContextSignal();
  const { data, loaded } = useWorkspaceCorpus(signal);
  const row = conflictRows(data).find((conflict) => conflict.id === conflictId);
  // One source for the life of the page: the pane refetches through it.
  const source = useMemo(() => createWorkspaceContextSource(), []);

  if (!row) {
    return (
      <ContextFrame
        section="conflicts"
        signal={signal}
        crumbs={[{ label: 'Conflicts', to: CONFLICTS_BASE }, { label: loaded ? 'No such conflict' : 'Loading…' }]}
      >
        {loaded && (
          <EmptyState
            icon={GitMerge}
            title="No such conflict"
            body={
              <>
                Nothing of this workspace's corpus is at that address.{' '}
                <Link to={CONFLICTS_BASE} className="text-primary hover:underline">
                  Open Conflicts
                </Link>
                .
              </>
            }
          />
        )}
      </ContextFrame>
    );
  }

  return (
    <ContextFrame
      section="conflicts"
      signal={signal}
      crumbs={[{ label: 'Conflicts', to: CONFLICTS_BASE }, { label: row.title }]}
    >
      <CorpusItemPane repoId="" source={source} itemId={row.id} backTo={CONFLICTS_BASE} />
    </ContextFrame>
  );
}
