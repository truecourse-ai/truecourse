// PREVIEW (UI mock, fake data): delete when the one-product dashboard lands. See docs/ONE_PRODUCT_PLAN.md §3.5.

/**
 * One documentation site, as its own page (`/sources/:sourceId`): the
 * breadcrumb back to Sources, then the agentic site detail (`SpecSourceDetail`:
 * the site's pages as a list, the opened page's snapshot beside it, Refresh and
 * Remove), over fake data. Pages are URL tabs (`?page=`), as everywhere.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, Globe, Loader2 } from 'lucide-react';
import { SpecSourceProvider } from '@/components/spec/spec-source';
import { EmptyState } from '@/components/ui/empty-state';
import { SpecSourceDetail } from '@/preview/vendor/components/spec/SpecSourceDetail';
import { useSpecCorpus } from '@/preview/vendor/components/spec/SpecCorpusView';
import { useGuardTabs } from '@/preview/vendor/hooks/useGuardTabs';
import { useGuardView } from '@/preview/vendor/hooks/useGuardView';
import { useSpecSources } from '@/preview/vendor/hooks/useSpecSources';
import * as api from '@/preview/vendor/lib/api';
import { corpusHasDoc } from '@/preview/vendor/lib/spec-web-source';
import { createPreviewSpecSource } from '@/preview/data/fake-api';
import type { Repo } from '@/preview/data/types';
import { useGuardTabJump } from './tab-jump';

function SourceBody({ repo, sourceId }: { repo: Repo; sourceId: string }) {
  useGuardTabJump();
  const navigate = useNavigate();
  const { sources, refetch } = useSpecSources(repo.id, true);
  const site = sources?.find((s) => s.id === sourceId) ?? null;
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const pageTabs = useGuardTabs('page', repo.id);
  const previewRef = pageTabs.activeId;
  const [readCorpus, setReadCorpus] = useState(false);
  const corpus = useSpecCorpus(repo.id, readCorpus);
  const { openSpecDoc } = useGuardView();

  useEffect(() => {
    if (previewRef) setReadCorpus(true);
  }, [previewRef]);

  const inCorpus =
    previewRef === null || corpus.hydrating || corpus.error !== null ? null : corpusHasDoc(corpus.data, previewRef);

  const preview = useCallback(
    (ref: string | null, pinned = false) => {
      if (ref) pageTabs.open(ref, pinned);
      else pageTabs.deselect();
    },
    [pageTabs],
  );

  const refresh = async () => {
    setBusy(sourceId);
    setActionError(null);
    try {
      await api.refreshSpecSources(repo.id, sourceId);
      setReloadKey((k) => k + 1);
      await refetch();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy(sourceId);
    setActionError(null);
    try {
      await api.removeSpecSource(repo.id, sourceId);
      await refetch();
      navigate(`/preview/repos/${repo.id}/sources`);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-6 py-3">
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
          <Link to={`/preview/repos/${repo.id}/sources`} className="shrink-0 font-semibold text-foreground hover:underline">
            Sources
          </Link>
          <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <h1 className="min-w-0 truncate font-semibold text-foreground">{site?.title ?? sourceId}</h1>
        </nav>
      </header>
      <div className="min-h-0 flex-1">
        {site ? (
          <SpecSourceDetail
            repoId={repo.id}
            summary={site}
            busy={busy}
            actionError={actionError}
            onRefresh={() => void refresh()}
            onRemove={() => void remove()}
            reloadKey={reloadKey}
            previewRef={previewRef}
            pageTabs={pageTabs}
            inCorpus={inCorpus}
            onPreview={preview}
            onOpenDoc={openSpecDoc}
          />
        ) : sources === null ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <EmptyState icon={Globe} title="No such site" body="Nothing is registered under that id." />
        )}
      </div>
    </div>
  );
}

export function SourcePage({ repo, sourceId }: { repo: Repo; sourceId: string }) {
  const source = useMemo(() => createPreviewSpecSource(repo.id), [repo.id]);
  return (
    <SpecSourceProvider source={source}>
      <SourceBody repo={repo} sourceId={sourceId} />
    </SpecSourceProvider>
  );
}
