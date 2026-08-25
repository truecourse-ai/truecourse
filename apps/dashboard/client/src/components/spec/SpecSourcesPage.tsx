/**
 * The SOURCES page — the documentation sites this repo reads its spec from when
 * the spec isn't its own markdown (`truecourse spec source`).
 *
 * The standard left-panel layout, like every other page: the registered sites as
 * the shared {@link EntityList} on the left (Add source is the list's toolbar
 * action), the selected site's detail in the main pane — what the fetch
 * produced and when, the site-level actions (Refresh, Remove), the pages it
 * snapshotted (each one click from its markdown, previewed in place) and the
 * links it passed over, with reasons. The selection is URL-synced as
 * `?gsrc=<sourceId>`, so a site is a link a teammate can be sent.
 *
 * Reading a page stays HERE. The corpus is read only once something is actually
 * previewed, and only to answer one question: does the Coverage tree have a row
 * for this ref? Yes → the preview offers the jump; no (nothing scanned yet, or
 * the page arrived after the last scan) → it says what would put it there,
 * rather than sending the user to a doc no list beside it contains.
 *
 * With nothing registered yet the add form IS the page — one empty state with
 * the form under it, front and center.
 *
 * Every mutation streams over `spec:progress` (the page's shared popup renders
 * the checklist and its counters) and ends with `spec:complete { kind:
 * 'sources' }`, which the repo page turns into a bumped `reloadKey` here. The
 * page also re-reads the registry itself the moment an action lands, so the list
 * is never a socket round-trip behind the button that changed it.
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertCircle, BookOpen, Loader2, Plus } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { CollapsibleAside } from '@/components/ui/collapsible-aside';
import { EntityList } from '@/components/ui/entity-list';
import { useGuardView } from '@/hooks/useGuardView';
import { useSpecSources } from '@/hooks/useSpecSources';
import * as api from '@/lib/api';
import type { SpecSourceView } from '@/lib/api';
import type { AnalysisProgress } from '@/hooks/useSocket';
import { formatGuardTime } from '@/lib/guard-drifts';
import { corpusHasDoc, pageCount } from '@/lib/spec-web-source';
import { useSpecCorpus } from './SpecCorpusView';
import { SpecProgressSteps } from './SpecProgressPopup';
import { SpecSourceAddForm } from './SpecSourceAddForm';
import { SpecSourceDetail } from './SpecSourceDetail';

const TAG = 'rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground';

export function SpecSourcesPage({
  repoId,
  reloadKey = 0,
  progress = null,
}: {
  repoId: string;
  reloadKey?: number;
  /** The live `spec:progress` stream — rendered inside the add dialog, which
   *  sits above the floating popup's z-plane. */
  progress?: AnalysisProgress | null;
}) {
  const { sources, error, refetch } = useSpecSources(repoId, true, reloadKey);
  const [params, setParams] = useSearchParams();
  const selected = params.get('gsrc');
  const [adding, setAdding] = useState(false);
  /** The source whose action is in flight — every button is disabled while set. */
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ source: string; message: string } | null>(null);
  /** Bumped per source after a refresh so its open detail re-reads. */
  const [detailKeys, setDetailKeys] = useState<Record<string, number>>({});
  /** The page previewed in place, by its corpus ref — the open site's, always. */
  const [previewRef, setPreviewRef] = useState<string | null>(null);
  /** Latched by the first preview: no corpus read at all until one is opened. */
  const [readCorpus, setReadCorpus] = useState(false);
  const corpus = useSpecCorpus(repoId, readCorpus);
  // Once a page IS in the corpus, its doc has one home — the Coverage doc viewer.
  const { openSpecDoc } = useGuardView();

  // Membership of the previewed ref: `null` until it can be answered (nothing
  // previewed, the read still in flight, or it failed) — the preview says nothing
  // rather than guessing. A missing corpus is a definite "not a member".
  const inCorpus =
    previewRef === null || corpus.hydrating || corpus.error !== null
      ? null
      : corpusHasDoc(corpus.data, previewRef);

  const preview = useCallback((ref: string | null) => {
    setPreviewRef(ref);
    if (ref) setReadCorpus(true);
  }, []);

  // A preview belongs to the open site — changing sites closes it.
  useEffect(() => setPreviewRef(null), [selected]);

  const select = useCallback(
    (id: string | null) =>
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        if (id) next.set('gsrc', id);
        else next.delete('gsrc');
        return next;
      }),
    [setParams],
  );

  const refresh = async (sourceId: string): Promise<void> => {
    setBusy(sourceId);
    setActionError(null);
    try {
      await api.refreshSpecSources(repoId, sourceId);
      setDetailKeys((k) => ({ ...k, [sourceId]: (k[sourceId] ?? 0) + 1 }));
      await refetch();
    } catch (e) {
      setActionError({ source: sourceId, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (sourceId: string): Promise<void> => {
    setBusy(sourceId);
    setActionError(null);
    try {
      await api.removeSpecSource(repoId, sourceId);
      if (selected === sourceId) select(null);
      await refetch();
    } catch (e) {
      setActionError({ source: sourceId, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const added = async (sourceId: string): Promise<void> => {
    setAdding(false);
    await refetch();
    select(sourceId);
  };

  if (sources === null && !error) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (sources === null) {
    return <EmptyState icon={BookOpen} title="Sources unavailable" body={error ?? 'The source registry could not be read.'} />;
  }

  // Nothing registered: ONE empty state, with the add flow right under it — the
  // page's whole job at this point is registering the first site.
  if (sources.length === 0 && !error) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto w-full max-w-xl px-6 py-12">
          <EmptyState
            icon={BookOpen}
            title="No documentation sites"
            body="Register a site by its llms.txt. Its pages become spec docs in this repo."
          />
          <div className="mt-6">
            <SpecSourceAddForm repoId={repoId} onAdded={added} />
            {progress && (
              <div className="mt-4 rounded-lg border border-border bg-card p-3">
                <SpecProgressSteps progress={progress} />
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const active = sources.find((s) => s.id === selected) ?? null;

  return (
    <div className="flex h-full min-h-0 min-w-0">
      <CollapsibleAside label="Sites" defaultWidth={288}>
        <EntityList<SpecSourceView>
          label="Documentation sites"
          items={sources}
          itemId={(s) => s.id}
          renderRow={(s) => <SourceRowContent source={s} />}
          activeId={selected}
          onOpen={(id) => select(id)}
          noun={{ one: 'site', many: 'sites' }}
          toolbar={
            <Button size="sm" className="w-full" onClick={() => setAdding(true)}>
              <Plus className="h-3.5 w-3.5" />
              Add source
            </Button>
          }
        />
      </CollapsibleAside>

      <div className="flex min-w-0 flex-1 flex-col">
        {error && (
          <div className="px-4 pt-3">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </div>
        )}
        {active ? (
          <SpecSourceDetail
            repoId={repoId}
            summary={active}
            busy={busy}
            actionError={actionError?.source === active.id ? actionError.message : null}
            onRefresh={() => void refresh(active.id)}
            onRemove={() => void remove(active.id)}
            progress={progress}
            reloadKey={detailKeys[active.id] ?? 0}
            previewRef={previewRef}
            inCorpus={inCorpus}
            onPreview={preview}
            onOpenDoc={openSpecDoc}
          />
        ) : (
          <EmptyState
            icon={BookOpen}
            title="Select a documentation site"
            body="Pick a site on the left, or add one."
          />
        )}
      </div>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add a documentation site</DialogTitle>
          </DialogHeader>
          <SpecSourceAddForm repoId={repoId} onAdded={added} onCancel={() => setAdding(false)} />
          {progress && (
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <SpecProgressSteps progress={progress} />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** One site as the list shows it: the name, what the fetch produced, and when. */
function SourceRowContent({ source }: { source: SpecSourceView }) {
  return (
    <div className="flex w-full min-w-0 flex-col gap-1">
      <span className="flex min-w-0 items-center gap-1.5">
        <BookOpen className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate text-[13px] text-foreground">{source.title}</span>
      </span>
      <span className="flex flex-wrap items-center gap-1">
        <span className={TAG}>{pageCount(source.docCount)} kept</span>
        {source.skipped.length > 0 && <span className={TAG}>{source.skipped.length} skipped</span>}
        <span className="text-[10px] text-muted-foreground">fetched {formatGuardTime(source.fetchedAt)}</span>
      </span>
    </div>
  );
}
