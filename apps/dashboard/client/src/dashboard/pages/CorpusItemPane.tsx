/**
 * One item of the corpus, pinned: a document as its text, or a conflict with
 * its resolver. The SAME page everywhere an item opens — Context does not draw
 * a second one of its own.
 *
 * Which corpus it reads is the caller's: a DOCUMENT is read through one
 * repository (its slice of the workspace corpus, and its coverage), a CONFLICT
 * through the workspace corpus itself, because a conflict is a property of the
 * workspace's documents and is settled once. That is the `source` prop; the
 * `repoId` is only ever the repository a document's coverage is joined from,
 * and is empty for a conflict, which has none.
 *
 * Another item opened from inside the pane (a conflict's side) opens as its own
 * Context page.
 */

import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { isConflictId } from '@truecourse/shared';
import { SpecSourceProvider, type SpecSource } from '@/components/spec/spec-source';
import { useSpecCorpus } from '@/components/spec/SpecCorpusView';
import { GuardCoveragePage } from '@/components/guard/GuardCoveragePage';
import {
  useGuardCoverageTabs,
  type GuardCoverageTabsState,
} from '@/hooks/useGuardCoverageTabs';
import { useGuardStaleness } from '@/hooks/useGuardStaleness';
import { useGuardTabJump } from '@/dashboard/repo/tab-jump';
import { conflictHref, docHref } from './context-hrefs';

function Pane({
  repoId,
  itemId,
  backTo,
}: {
  repoId: string;
  itemId: string;
  backTo: string;
}) {
  // A flow named inside the pane is a door into that flow's page, read through
  // this repository.
  useGuardTabJump(repoId);
  const navigate = useNavigate();
  const corpus = useSpecCorpus(repoId, true);
  const urlTabs = useGuardCoverageTabs(repoId);
  const { staleness } = useGuardStaleness(repoId || undefined);

  // The page IS the item: its tab is open and pinned.
  const tabs = useMemo<GuardCoverageTabsState>(
    () => ({
      ...urlTabs,
      activeId: itemId,
      openTabs: [{ id: itemId, pinned: true }],
      open: (id) => {
        if (id === itemId) return;
        navigate(isConflictId(id) ? conflictHref(id) : docHref(id, repoId || undefined));
      },
      close: () => navigate(backTo),
      deselect: () => navigate(backTo),
    }),
    [backTo, itemId, navigate, repoId, urlTabs],
  );

  return (
    <GuardCoveragePage
      repoId={repoId}
      corpus={corpus}
      staleness={staleness}
      staleLoaded
      tabs={tabs}
    />
  );
}

export function CorpusItemPane({
  repoId,
  source,
  itemId,
  backTo,
}: {
  /** The repository a document's coverage is read through; '' for a conflict. */
  repoId: string;
  source: SpecSource;
  itemId: string;
  backTo: string;
}) {
  return (
    <SpecSourceProvider source={source}>
      <Pane repoId={repoId} itemId={itemId} backTo={backTo} />
    </SpecSourceProvider>
  );
}
