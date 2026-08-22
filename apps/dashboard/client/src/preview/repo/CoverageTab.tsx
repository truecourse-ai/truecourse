// PREVIEW (UI mock, fake data): delete when the one-product dashboard lands. See docs/ONE_PRODUCT_PLAN.md §3.5.

/**
 * Coverage: the landing tab, the agentic coverage overview (sections, claims,
 * flows, tests and surfaces as composition bars, the freshness stamps) over fake
 * data. The corpus itself is the Corpus tab beside it.
 */

import { useMemo } from 'react';
import { SpecSourceProvider } from '@/components/spec/spec-source';
import { PageHeader } from '@/preview/ui/bits';
import { useSpecCorpus } from '@/preview/vendor/components/spec/SpecCorpusView';
import { GuardCoverageOverview } from '@/preview/vendor/components/guard/GuardCoverageOverview';
import { useGuardClaims } from '@/preview/vendor/hooks/useGuardClaims';
import { createPreviewSpecSource } from '@/preview/data/fake-api';
import { stalenessFor } from '@/preview/data/corpus-fixtures';
import type { Repo } from '@/preview/data/types';
import { useGuardTabJump } from './tab-jump';

function CoverageBody({ repo }: { repo: Repo }) {
  useGuardTabJump();
  const corpus = useSpecCorpus(repo.id, true);
  const claims = useGuardClaims(repo.id, true);
  const staleness = useMemo(() => stalenessFor(repo.id), [repo.id]);
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <PageHeader title="Coverage" />
      <div className="min-h-0 flex-1 overflow-auto">
        <GuardCoverageOverview
          repoId={repo.id}
          docsCount={corpus.data?.corpus.docs.length ?? 0}
          claims={claims.view}
          staleness={staleness}
        />
      </div>
    </div>
  );
}

export function CoverageTab({ repo }: { repo: Repo }) {
  const source = useMemo(() => createPreviewSpecSource(repo.id), [repo.id]);
  return (
    <SpecSourceProvider source={source}>
      <CoverageBody repo={repo} />
    </SpecSourceProvider>
  );
}
