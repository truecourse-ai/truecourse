// PREVIEW (UI mock, fake data): delete when the one-product dashboard lands. See docs/ONE_PRODUCT_PLAN.md §3.5.
// Copied from the agentic branch's apps/dashboard/client/src/components/spec/SpecSourceDetail.tsx; delete with the preview.
/**
 * The selected web source, as the Sources page's two remaining panes: the PAGES
 * panel (the site's identity + actions on top, then every page the last fetch
 * snapshotted and every link it passed over, as one shared {@link EntityList})
 * and the MAIN pane previewing the selected page's markdown.
 *
 * The registry (not the corpus) is the truth about what a fetch wrote, so this
 * reads `GET /spec/sources/:id` and lists pages even before the first scan.
 * Previewing never leaves the page: before a scan the Coverage tree has no row
 * for the snapshot, so the preview header offers the Coverage jump only once
 * the corpus actually knows the ref (`inCorpus`); until then it says what would
 * put it there.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowUpRight,
  ExternalLink,
  FileText,
  Loader2,
  X,
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { CHIP_CLASS } from '@/preview/ui/bits';
import { CollapsibleAside } from '@/preview/ui/collapsible-aside';
import { EntityList, type EntityListGroup } from '@/preview/ui/entity-list';
import { HoverPopover } from '@/preview/ui/hover-popover';
import type { GuardTabsState } from '@/preview/vendor/hooks/useGuardTabs';
import * as api from '@/preview/vendor/lib/api';
import type { SpecSourceDetailView, SpecSourceDoc, SpecSourceSkip, SpecSourceView } from '@/preview/vendor/lib/api';
import { formatGuardTime } from '@/preview/vendor/lib/guard-drifts';
import { pageCount, SKIP_REASON } from '@/preview/vendor/lib/spec-web-source';
import { SpecDocViewer } from '@/preview/vendor/components/spec/SpecDocViewer';
import { SpecProgressSteps } from '@/preview/vendor/components/spec/SpecProgressPopup';
import type { AnalysisProgress } from '@/preview/vendor/hooks/useSocket';

const TAG = CHIP_CLASS;

/** One pages-panel row: a snapshotted page (selectable) or a passed-over link. */
type PageItem = { kind: 'doc'; doc: SpecSourceDoc } | { kind: 'skip'; skip: SpecSourceSkip };

const itemId = (item: PageItem): string =>
  item.kind === 'doc' ? item.doc.ref : `skip:${item.skip.url}:${item.skip.reason}`;

export function SpecSourceDetail({
  repoId,
  summary,
  busy,
  actionError,
  onRefresh,
  onRemove,
  progress = null,
  reloadKey = 0,
  previewRef,
  pageTabs,
  inCorpus,
  onPreview,
  onOpenDoc,
}: {
  repoId: string;
  /** The registry row, the panel header's identity and freshness. */
  summary: SpecSourceView;
  /** The source whose action is running, if any, both buttons wait on it. */
  busy: string | null;
  /** A failed Refresh/Remove, reported under the actions. */
  actionError: string | null;
  onRefresh: () => void;
  onRemove: () => void;
  /** The live `spec:progress` stream, shown under the actions while one runs. */
  progress?: AnalysisProgress | null;
  /** Bumped by the page after a refresh, a re-read signal. */
  reloadKey?: number;
  /** The page being previewed in the main pane, by its corpus ref. */
  previewRef: string | null;
  /** The page tabs (the open set, pin state), the strip over the snapshot. */
  pageTabs: GuardTabsState;
  /** Whether the corpus knows `previewRef`, null while that is still unknown. */
  inCorpus: boolean | null;
  /** Preview a page (its ref), or close the preview (null). */
  onPreview: (ref: string | null, pinned?: boolean) => void;
  /** Open the previewed page in the Coverage doc viewer, only once it's in the corpus. */
  onOpenDoc: (ref: string) => void;
}) {
  const sourceId = summary.id;
  const [source, setSource] = useState<SpecSourceDetailView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  /** False once unmounted, a request in flight must not touch state after that. */
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await api.getSpecSource(repoId, sourceId);
      if (!alive.current) return;
      setSource(res.source);
      setLoadError(null);
    } catch (e) {
      if (!alive.current) return;
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [repoId, sourceId]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  // The previewed page resolves off the CURRENT listing, so a page dropped by a
  // refresh closes its own preview with nothing to clean up.
  const previewDoc = previewRef ? source?.docs.find((d) => d.ref === previewRef) ?? null : null;

  const groups: EntityListGroup<PageItem>[] = source
    ? [
        {
          key: 'pages',
          label: 'Pages',
          count: source.docs.length,
          items: source.docs.map((doc): PageItem => ({ kind: 'doc', doc })),
          ...(source.docs.length === 0
            ? {
                hint: 'The last fetch wrote no page.',
              }
            : {}),
        },
        ...(source.skipped.length > 0
          ? [
              {
                key: 'skipped',
                label: 'Skipped',
                count: source.skipped.length,
                hint: 'Links the fetch passed over, with the reason.',
                items: source.skipped.map((skip): PageItem => ({ kind: 'skip', skip })),
              },
            ]
          : []),
      ]
    : [];

  const running = busy === sourceId;
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1">
      <CollapsibleAside label="Source" defaultWidth={320}>
        <div className="shrink-0 border-b border-border bg-card px-3 py-2.5">
          <div className="min-w-0 truncate text-sm font-semibold text-foreground">{summary.title}</div>
          <a
            href={summary.llmsTxtUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-1 block max-w-full truncate text-[11px] text-primary hover:underline"
          >
            {summary.llmsTxtUrl}
          </a>
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <span className={TAG}>{pageCount(summary.docCount)} kept</span>
            {summary.skipped.length > 0 && <span className={TAG}>{summary.skipped.length} skipped</span>}
            <span className="ml-auto text-[11px] text-muted-foreground">{formatGuardTime(summary.fetchedAt)}</span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <HoverPopover content="Refetch the site and reconcile the snapshot" side="bottom" align="start">
              <button
                type="button"
                disabled={busy !== null}
                onClick={onRefresh}
                className="rounded border border-border px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-muted/60 disabled:opacity-50"
              >
                {running ? 'Refreshing' : 'Refresh'}
              </button>
            </HoverPopover>
            <HoverPopover content="Delete the snapshot and unregister the site" side="bottom" align="start">
              <button
                type="button"
                disabled={busy !== null}
                onClick={onRemove}
                className="rounded border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground disabled:opacity-50"
              >
                Remove
              </button>
            </HoverPopover>
          </div>
          {progress && (
            <div className="mt-2 rounded-lg border border-border bg-muted/30 p-2">
              <SpecProgressSteps progress={progress} />
            </div>
          )}
          {actionError && (
            <Alert variant="destructive" className="mt-2">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{actionError}</AlertDescription>
            </Alert>
          )}
        </div>

        <div className="min-h-0 flex-1">
          {loadError ? (
            <div className="px-3 py-3">
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{loadError}</AlertDescription>
              </Alert>
            </div>
          ) : source === null ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <EntityList<PageItem>
              label="Fetched pages"
              groups={groups}
              itemId={itemId}
              renderRow={(item) =>
                item.kind === 'doc' ? <DocRow doc={item.doc} /> : <SkipRow skip={item.skip} />
              }
              rowInteractive={(item) => item.kind === 'doc'}
              activeId={previewRef}
              onOpen={(id, pinned) => onPreview(id, pinned)}
              emptyText="The last fetch wrote no page."
            />
          )}
        </div>
      </CollapsibleAside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {previewDoc ? (
          <SpecDocViewer
            repoId={repoId}
            docRef={previewDoc.ref}
            title={previewDoc.title || previewDoc.path}
            sourceTitle={source?.title}
            url={previewDoc.url}
            actions={
              <>
                {inCorpus === true && (
                  <Button size="sm" variant="outline" onClick={() => onOpenDoc(previewDoc.ref)}>
                    <ArrowUpRight className="h-3.5 w-3.5" />
                    Open in Coverage
                  </Button>
                )}
                {inCorpus === false && (
                  <span className="text-[11px] text-muted-foreground">
                    Run Scan to add this page to the corpus.
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => onPreview(null)}
                  aria-label="Close preview"
                  className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </>
            }
          />
        ) : (
          <EmptyState
            icon={FileText}
            title="Select a page"
            body="Pick a page on the left to read its snapshot."
          />
        )}
      </div>
    </div>
  );
}

/** One snapshotted page: its title and path, the live page one hover away. */
function DocRow({ doc }: { doc: SpecSourceDoc }) {
  return (
    <div className="flex w-full min-w-0 flex-col gap-0.5">
      <span className="flex w-full min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{doc.title || doc.path}</span>
        <a
          href={doc.url}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open ${doc.title || doc.path} on the site`}
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 rounded p-1 text-muted-foreground/70 opacity-0 transition-opacity hover:text-foreground focus:opacity-100 group-hover:opacity-100"
        >
          <ExternalLink className="h-3 w-3" />
        </a>
      </span>
      <span className="block truncate text-[11px] text-muted-foreground">{doc.path}</span>
    </div>
  );
}

/** One link the fetch wrote no page for: where it points, and why it was passed over. */
function SkipRow({ skip }: { skip: SpecSourceSkip }) {
  return (
    <div className="w-full min-w-0 text-[11px] text-muted-foreground">
      <a
        href={skip.url}
        target="_blank"
        rel="noreferrer"
        className="break-all text-primary hover:underline"
      >
        {skip.url}
      </a>{' '}
     , {SKIP_REASON[skip.reason] ?? skip.reason}
      {skip.detail ? ` (${skip.detail})` : ''}
    </div>
  );
}
