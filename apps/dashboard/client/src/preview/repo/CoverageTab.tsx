/**
 * Coverage: the landing tab, the agentic coverage overview (sections, claims,
 * flows, tests and surfaces as composition bars, the freshness stamps). The
 * corpus itself is the Corpus tab beside it.
 *
 * A CONNECTED repository reads what the server stored: the scan's corpus, the
 * generate's claims, the status summary and the staleness signals, all over
 * `/api/repos/<id>/…`, and re-reads them when a scan, a generate or a run of
 * this repository lands on the socket. Before any of those exist it says so,
 * rather than painting zeros. A fixture repository reads its fixtures.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FolderGit2 } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { createRepoSpecSource, SpecSourceProvider } from '@/components/spec/spec-source';
import type { GuardStaleness } from '@/preview/vendor/shared';
import * as api from '@/preview/vendor/lib/api';
import { PageHeader } from '@/preview/ui/bits';
import { useSpecCorpus } from '@/preview/vendor/components/spec/SpecCorpusView';
import { GuardCoverageOverview } from '@/preview/vendor/components/guard/GuardCoverageOverview';
import { useGuardClaims } from '@/preview/vendor/hooks/useGuardClaims';
import { createPreviewSpecSource } from '@/preview/data/fake-api';
import { stalenessFor } from '@/preview/data/corpus-fixtures';
import type { Repo } from '@/preview/data/types';
import { PREVIEW_BASE } from '@/preview/shell/base';
import { useGuardTabJump } from './tab-jump';
import { useGuardRefresh } from './use-guard-refresh';

/** The staleness signals: the server's for a connected repository, the fixture's otherwise. */
function useStaleness(repo: Repo, reloadKey: number): GuardStaleness | null {
  const [real, setReal] = useState<GuardStaleness | null>(null);
  useEffect(() => {
    if (!repo.real) return;
    let cancelled = false;
    api
      .getGuardStaleness(repo.id)
      .then((s) => !cancelled && setReal(s))
      .catch(() => !cancelled && setReal(null));
    return () => {
      cancelled = true;
    };
  }, [repo.id, repo.real, reloadKey]);
  const fixture = useMemo(() => (repo.real ? null : stalenessFor(repo.id)), [repo.id, repo.real]);
  return repo.real ? real : fixture;
}

function CoverageBody({ repo }: { repo: Repo }) {
  useGuardTabJump();
  const reloadKey = useGuardRefresh(repo, ['scan', 'guard-generate', 'guard-run']);
  const corpus = useSpecCorpus(repo.id, true);
  const { refetch } = corpus;
  useEffect(() => {
    if (reloadKey > 0) void refetch();
  }, [reloadKey, refetch]);
  const claims = useGuardClaims(repo.id, true, reloadKey);
  const staleness = useStaleness(repo, reloadKey);

  // A connected repository that has neither a corpus nor a generate nor a run
  // has not started: the honest page is the one that says where to start it.
  if (repo.real && staleness && !staleness.hasCorpus && !staleness.hasGenerated && !staleness.hasRun) {
    return (
      <EmptyState
        icon={FolderGit2}
        title={repo.onboarding ? 'Onboarding has not produced anything yet' : 'Nothing has run on this repository yet'}
        body={
          repo.onboarding ? (
            'The first scan, setup and generation are still running. Watch them in Activity.'
          ) : (
            <>
              Start the first scan from{' '}
              <Link to={`${PREVIEW_BASE}/repos/${repo.id}/activity`} className="text-primary hover:underline">
                Activity
              </Link>
              .
            </>
          )
        }
      />
    );
  }
  if (!staleness) return null;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <PageHeader title="Coverage" />
      <div className="min-h-0 flex-1 overflow-auto">
        <GuardCoverageOverview
          repoId={repo.id}
          docsCount={corpus.data?.corpus.docs.length ?? 0}
          claims={claims.view}
          staleness={staleness}
          reloadKey={reloadKey}
        />
      </div>
    </div>
  );
}

export function CoverageTab({ repo }: { repo: Repo }) {
  const source = useMemo(
    () => (repo.real ? createRepoSpecSource(repo.id) : createPreviewSpecSource(repo.id)),
    [repo.id, repo.real],
  );
  return (
    <SpecSourceProvider source={source}>
      <CoverageBody repo={repo} />
    </SpecSourceProvider>
  );
}
