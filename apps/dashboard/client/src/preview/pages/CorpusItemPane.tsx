/**
 * One item of the corpus, pinned: a document painted by section status (a
 * section opening its claims and the tests that prove them), or a conflict with
 * its resolver. The SAME coverage page everywhere an item opens — Context does
 * not draw a second one of its own.
 *
 * Which corpus it reads is the caller's: a DOCUMENT is read through one
 * repository (its slice of the workspace corpus, and its coverage), a CONFLICT
 * through the workspace corpus itself, because a conflict is a property of the
 * workspace's documents and is settled once. That is the `source` prop; the
 * `repoId` is only ever the repository a document's coverage is joined from,
 * and is empty for a conflict, which has none.
 *
 * Another item opened from inside the pane (a conflict's side, a section's
 * document) opens as its own Context page.
 */

import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { SpecSourceProvider, type SpecSource } from '@/components/spec/spec-source';
import { useSpecCorpus } from '@/preview/vendor/components/spec/SpecCorpusView';
import { GuardCoveragePage } from '@/preview/vendor/components/guard/GuardCoveragePage';
import { useGuardClaims } from '@/preview/vendor/hooks/useGuardClaims';
import {
  useGuardCoverageTabs,
  type GuardCoverageTabsState,
} from '@/preview/vendor/hooks/useGuardCoverageTabs';
import { guardUntestableEntries } from '@/preview/vendor/lib/guard-claims';
import { useGuardStaleness } from '@/hooks/useGuardStaleness';
import { useGuardTabJump } from '@/preview/repo/tab-jump';
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
  // A test's name on a section is a door into that repository's Tests tab.
  useGuardTabJump(repoId);
  const navigate = useNavigate();
  const corpus = useSpecCorpus(repoId, true);
  // The claim corpus is a repository's: a conflict has none, and asks for none.
  const claims = useGuardClaims(repoId, Boolean(repoId));
  const urlTabs = useGuardCoverageTabs(repoId);
  const { staleness } = useGuardStaleness(repoId || undefined);
  const untestable = useMemo(() => guardUntestableEntries(claims.view), [claims.view]);

  // The page IS the item: its tab is open and pinned; the within-item section
  // and claim keep riding the URL as they always did.
  const tabs = useMemo<GuardCoverageTabsState>(
    () => ({
      ...urlTabs,
      activeId: itemId,
      openTabs: [{ id: itemId, pinned: true }],
      open: (id) => {
        if (id === itemId) return;
        navigate(id.startsWith('overlap::') ? conflictHref(id) : docHref(id, repoId || undefined));
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
      claims={claims.view}
      untestable={untestable}
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
