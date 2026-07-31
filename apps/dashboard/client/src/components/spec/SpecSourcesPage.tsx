/**
 * The SOURCES page — the documentation sites this repo reads its spec from when
 * the spec isn't its own markdown (`truecourse spec source`).
 *
 * It is a page, not a sidebar group: managing a site is its own job. One row per
 * registered site carrying everything the list level should answer — where it
 * came from (its llms.txt, linked out), what the last fetch produced, when it
 * ran — plus the two site-level actions, Refresh and Remove. Selecting a row
 * opens its detail INSIDE the row, at full page width: the pages it snapshotted
 * (each one click from its markdown, previewed in place beside the list) and the
 * links it passed over, with reasons. The selection is URL-synced as
 * `?gsrc=<sourceId>`, so a row is a link a teammate can be sent.
 *
 * Reading a page stays HERE. The corpus is read only once something is actually
 * previewed, and only to answer one question: does the Coverage tree have a row
 * for this ref? Yes → the preview offers the jump; no (nothing scanned yet, or
 * the page arrived after the last scan) → it says what would put it there,
 * rather than sending the user to a doc no list beside it contains.
 *
 * Adding is the header's primary action; with nothing registered yet the add
 * form IS the page — one empty state with the form under it, front and center.
 *
 * Every mutation streams over `spec:progress` (the page's shared popup renders
 * the checklist and its counters) and ends with `spec:complete { kind:
 * 'sources' }`, which the repo page turns into a bumped `reloadKey` here. The
 * page also re-reads the registry itself the moment an action lands, so the list
 * is never a socket round-trip behind the button that changed it.
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertCircle, ExternalLink, Globe, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { HoverPopover } from '@/components/ui/hover-popover';
import { useGuardView } from '@/hooks/useGuardView';
import { useSpecSources } from '@/hooks/useSpecSources';
import * as api from '@/lib/api';
import type { SpecSourceView } from '@/lib/api';
import { formatGuardTime } from '@/lib/guard-drifts';
import { corpusHasDoc, pageCount } from '@/lib/spec-web-source';
import { useSpecCorpus } from './SpecCorpusView';
import { SpecSourceAddForm } from './SpecSourceAddForm';
import { SpecSourceDetail } from './SpecSourceDetail';

/** The DOM anchor a `?gsrc=` deep link scrolls to — one per source row. */
const rowId = (sourceId: string): string => `tc-source-row-${sourceId}`;

export function SpecSourcesPage({ repoId, reloadKey = 0 }: { repoId: string; reloadKey?: number }) {
  const { sources, error, refetch } = useSpecSources(repoId, true, reloadKey);
  const [params, setParams] = useSearchParams();
  const selected = params.get('gsrc');
  const [adding, setAdding] = useState(false);
  /** The source whose action is in flight — every button is disabled while set. */
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ source: string; message: string } | null>(null);
  /** Bumped per source after a refresh so its open detail re-reads. */
  const [detailKeys, setDetailKeys] = useState<Record<string, number>>({});
  /** The page previewed in place, by its corpus ref — the open row's, always. */
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

  // A preview belongs to the open row — changing rows closes it.
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

  // A deep link (or a freshly added site) can be below the fold — land ON its row.
  useEffect(() => {
    if (!selected) return;
    document.getElementById(rowId(selected))?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [selected, sources]);

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
    return <EmptyState icon={Globe} title="Sources unavailable" body={error ?? 'The source registry could not be read.'} />;
  }

  // Nothing registered: ONE empty state, with the add flow right under it — the
  // page's whole job at this point is registering the first site.
  if (sources.length === 0 && !error) {
    return (
      <div className="h-full overflow-y-auto">
        <Header onAdd={null} />
        <div className="mx-auto w-full max-w-xl px-6 py-12">
          <EmptyState
            icon={Globe}
            title="No documentation sites"
            body="Register a site by its llms.txt and its pages become spec docs in this repo — read by Coverage, guard generate and the CLI alike."
          />
          <div className="mt-6">
            <SpecSourceAddForm repoId={repoId} onAdded={added} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <Header onAdd={adding ? null : () => setAdding(true)} />
      <div className="space-y-3 px-4 pb-8 pt-3">
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {adding && (
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="mb-2 flex items-center gap-2">
              <Plus className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold text-foreground">Add a documentation site</span>
            </div>
            <SpecSourceAddForm repoId={repoId} onAdded={added} onCancel={() => setAdding(false)} />
          </div>
        )}

        {sources.map((source) => (
          <SourceRow
            key={source.id}
            repoId={repoId}
            source={source}
            selected={selected === source.id}
            busy={busy}
            detailKey={detailKeys[source.id] ?? 0}
            error={actionError?.source === source.id ? actionError.message : null}
            previewRef={selected === source.id ? previewRef : null}
            inCorpus={inCorpus}
            onSelect={() => select(selected === source.id ? null : source.id)}
            onRefresh={() => void refresh(source.id)}
            onRemove={() => void remove(source.id)}
            onPreview={preview}
            onOpenDoc={openSpecDoc}
          />
        ))}
      </div>
    </div>
  );
}

/** What the page is, and the one action it owns. */
function Header({ onAdd }: { onAdd: (() => void) | null }) {
  return (
    <div className="border-b border-border bg-card px-4 py-3">
      <div className="flex items-center gap-2">
        <Globe className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-foreground">Sources</h2>
        {onAdd && (
          <Button size="sm" className="ml-auto" onClick={onAdd}>
            <Plus className="h-3.5 w-3.5" />
            Add source
          </Button>
        )}
      </div>
      <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
        Documentation sites registered by their llms.txt. Their pages are snapshotted into this repo
        as real spec docs, so the next Scan folds them into the corpus alongside your own markdown.
      </p>
    </div>
  );
}

function SourceRow({
  repoId,
  source,
  selected,
  busy,
  detailKey,
  error,
  previewRef,
  inCorpus,
  onSelect,
  onRefresh,
  onRemove,
  onPreview,
  onOpenDoc,
}: {
  repoId: string;
  source: SpecSourceView;
  selected: boolean;
  /** The source whose action is running, if any — every row's buttons wait on it. */
  busy: string | null;
  detailKey: number;
  error: string | null;
  /** The page previewed inside this row, by its ref; null when none is. */
  previewRef: string | null;
  /** Whether the corpus knows `previewRef` — null while that is still unknown. */
  inCorpus: boolean | null;
  onSelect: () => void;
  onRefresh: () => void;
  onRemove: () => void;
  onPreview: (ref: string | null) => void;
  onOpenDoc: (ref: string) => void;
}) {
  const running = busy === source.id;
  return (
    <div
      id={rowId(source.id)}
      className={`rounded-lg border bg-card transition-colors ${
        selected ? 'border-primary/60' : 'border-border'
      }`}
    >
      {/* A div, not a button: the row carries its own actions and its own links,
          and a button inside a button is invalid. Labelled by the site so its
          accessible name is the site, not every word the row renders. */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={selected}
        aria-label={source.title}
        onClick={onSelect}
        className="w-full cursor-pointer px-3 py-2.5 text-left"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">{source.title}</span>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {pageCount(source.docCount)} kept
          </span>
          {source.skipped.length > 0 && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {source.skipped.length} skipped
            </span>
          )}
          <span className="text-[11px] text-muted-foreground">fetched {formatGuardTime(source.fetchedAt)}</span>
          <div className="ml-auto flex items-center gap-2">
            <HoverPopover content="Refetch the site and reconcile the snapshot" side="bottom" align="end">
              <Button
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={(e) => {
                  e.stopPropagation();
                  onRefresh();
                }}
              >
                {running ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Refresh
              </Button>
            </HoverPopover>
            <HoverPopover content="Delete the snapshot and unregister the site" side="bottom" align="end">
              <Button
                variant="destructive"
                size="sm"
                disabled={busy !== null}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove();
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remove
              </Button>
            </HoverPopover>
          </div>
        </div>
        <a
          href={source.llmsTxtUrl}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="mt-1 inline-flex max-w-full items-center gap-1 truncate text-[11px] text-primary hover:underline"
        >
          <ExternalLink className="h-3 w-3 shrink-0" />
          <span className="truncate">{source.llmsTxtUrl}</span>
        </a>
      </div>

      {error && (
        <div className="px-3 pb-3">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      )}

      {selected && (
        <div className="border-t border-border px-3 py-3">
          <SpecSourceDetail
            repoId={repoId}
            sourceId={source.id}
            reloadKey={detailKey}
            previewRef={previewRef}
            inCorpus={inCorpus}
            onPreview={onPreview}
            onOpenDoc={onOpenDoc}
          />
        </div>
      )}
    </div>
  );
}
