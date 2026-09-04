/**
 * One document or one conflict, as its own page (`/corpus/doc/:ref`,
 * `/corpus/conflict/:id`): the breadcrumb back to Corpus (the version it was
 * opened in rides `?version=`), then the agentic coverage pane
 * (`GuardCoveragePage`: the document painted by section status with the
 * section and claim details, or the conflict's assessment and verdict), pinned
 * to this one item. A connected repository reads the real corpus, document
 * and staleness; a fixture repository reads its fixtures.
 */

import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { SpecSourceProvider } from '@/components/spec/spec-source';
import { useSpecCorpus } from '@/preview/vendor/components/spec/SpecCorpusView';
import { GuardCoveragePage } from '@/preview/vendor/components/guard/GuardCoveragePage';
import { useGuardClaims } from '@/preview/vendor/hooks/useGuardClaims';
import { useGuardCoverageTabs, type GuardCoverageTabsState } from '@/preview/vendor/hooks/useGuardCoverageTabs';
import { guardUntestableEntries } from '@/preview/vendor/lib/guard-claims';
import { useGuardStaleness } from '@/hooks/useGuardStaleness';
import { stalenessFor } from '@/preview/data/corpus-fixtures';
import type { Repo } from '@/preview/data/types';
import { useGuardTabJump } from './tab-jump';
import { corpusSourceFor } from './CorpusTab';
import { useCoverageVersion } from './CoverageVersions';

function CorpusItemBody({
  repo,
  itemId,
  kind,
  versionQuery,
}: {
  repo: Repo;
  itemId: string;
  kind: 'doc' | 'conflict';
  versionQuery: string;
}) {
  useGuardTabJump();
  const navigate = useNavigate();
  const corpus = useSpecCorpus(repo.id, true);
  // The claim corpus is a fixture-only read for now: the server has no claims
  // route yet, so a connected repository's page paints from the coverage join.
  const claims = useGuardClaims(repo.id, !repo.real);
  const urlTabs = useGuardCoverageTabs(repo.id);
  const realStaleness = useGuardStaleness(repo.real ? repo.id : undefined);
  const staleness = useMemo(
    () => (repo.real ? realStaleness.staleness : stalenessFor(repo.id)),
    [repo.id, repo.real, realStaleness.staleness],
  );
  const untestable = useMemo(() => guardUntestableEntries(claims.view), [claims.view]);

  const base = `/preview/repos/${repo.id}/corpus`;
  // The page IS the item: its tab is open and pinned; opening another item from
  // inside the pane (a conflict's side, a section's doc) navigates to that page;
  // the within-doc section and claim keep riding the URL as they always did.
  const tabs = useMemo<GuardCoverageTabsState>(
    () => ({
      ...urlTabs,
      activeId: itemId,
      openTabs: [{ id: itemId, pinned: true }],
      open: (id) => {
        if (id === itemId) return;
        const target = id.startsWith('overlap::') ? `${base}/conflict/${encodeURIComponent(id)}` : `${base}/doc/${encodeURIComponent(id)}`;
        navigate(`${target}${versionQuery}`);
      },
      close: () => navigate(`${base}${versionQuery}`),
      deselect: () => navigate(`${base}${versionQuery}`),
    }),
    [base, itemId, navigate, urlTabs, versionQuery],
  );

  const title =
    kind === 'doc'
      ? itemId
      : (() => {
          const parts = itemId.split('::');
          return `${parts[2] ?? ''} and ${parts[3] ?? ''}`;
        })();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-6 py-3">
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
          <Link to={`${base}${versionQuery}`} className="shrink-0 font-semibold text-foreground hover:underline">
            Corpus
          </Link>
          <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <h1 className={`min-w-0 truncate font-semibold text-foreground ${kind === 'doc' ? 'font-mono' : ''}`}>{title}</h1>
        </nav>
      </header>
      <div className="min-h-0 flex-1">
        <GuardCoveragePage
          repoId={repo.id}
          corpus={corpus}
          staleness={staleness}
          staleLoaded
          tabs={tabs}
          claims={claims.view}
          untestable={untestable}
        />
      </div>
    </div>
  );
}

export function CorpusPage({ repo, kind, itemId }: { repo: Repo; kind: 'doc' | 'conflict'; itemId: string }) {
  const versions = useCoverageVersion(repo.id);
  const versionId = versions.version?.id ?? null;
  const versionQuery = versions.version && versions.version.parentId ? `?version=${encodeURIComponent(versions.version.id)}` : '';
  // Keyed on the fields the factory reads, not the repo object: the shell rebuilds a
  // running repo's row on every progress tick, and a new source would refetch and
  // re-scroll every open document.
  const source = useMemo(() => corpusSourceFor(repo.id, repo.real, versionId), [repo.id, repo.real, versionId]);
  return (
    <SpecSourceProvider source={source}>
      <CorpusItemBody repo={repo} itemId={itemId} kind={kind} versionQuery={versionQuery} />
    </SpecSourceProvider>
  );
}
