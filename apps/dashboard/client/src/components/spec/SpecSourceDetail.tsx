/**
 * The detail of ONE registered web source, opened inside its row on the Sources
 * page: what the last fetch actually produced.
 *
 * Two halves, both full page width: the pages it snapshotted — each one click
 * from its markdown, PREVIEWED IN PLACE beside the list, and one click from the
 * live page it was fetched from — and the links it passed over, with the reason
 * and the URL. The registry (not the corpus) is the truth about what a fetch
 * wrote, so this reads `GET /spec/sources/:id` and lists pages even before the
 * first scan.
 *
 * Clicking a page never leaves this page: before a scan the Coverage tree has no
 * row for the snapshot, so a jump there would open a doc the list beside it does
 * not contain. The preview header carries that jump instead — but only once the
 * corpus actually knows the ref (`inCorpus`); until then it says what would put
 * it there.
 *
 * The site-level actions (Refresh, Remove) live on the row above, which owns the
 * in-flight state; `reloadKey` is how it tells this pane a refresh landed.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowUpRight, ExternalLink, FileText, Loader2, X } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import * as api from '@/lib/api';
import type { SpecSourceDetailView, SpecSourceSkip } from '@/lib/api';
import { SKIP_REASON } from '@/lib/spec-web-source';
import { SpecDocViewer } from './SpecDocViewer';

const LABEL = 'text-[10px] font-semibold uppercase tracking-wider text-muted-foreground';

export function SpecSourceDetail({
  repoId,
  sourceId,
  reloadKey = 0,
  previewRef,
  inCorpus,
  onPreview,
  onOpenDoc,
}: {
  repoId: string;
  sourceId: string;
  /** Bumped by the row after a refresh — a re-read signal. */
  reloadKey?: number;
  /** The page being previewed in place, by its corpus ref; null = list only. */
  previewRef: string | null;
  /** Whether the corpus knows `previewRef` — null while that is still unknown. */
  inCorpus: boolean | null;
  /** Preview a page here (its ref), or close the preview (null). */
  onPreview: (ref: string | null) => void;
  /** Open the previewed page in the Coverage doc viewer — only once it's in the corpus. */
  onOpenDoc: (ref: string) => void;
}) {
  const [source, setSource] = useState<SpecSourceDetailView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  /** False once unmounted — a request in flight must not touch state after that. */
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

  if (loadError) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>{loadError}</AlertDescription>
      </Alert>
    );
  }

  if (!source) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // The previewed page resolves off the CURRENT listing, so a page dropped by a
  // refresh closes its own preview with nothing to clean up.
  const previewDoc = previewRef ? source.docs.find((d) => d.ref === previewRef) ?? null : null;

  return (
    <div className="space-y-4">
      <div className={previewDoc ? 'flex flex-col gap-3 xl:flex-row' : undefined}>
        <div className={previewDoc ? 'min-w-0 xl:w-80 xl:shrink-0' : undefined}>
          {/* The counts live on the row above — repeating them here as a stat strip
              would say the same thing twice, two lines apart. */}
          <div className={LABEL}>Pages ({source.docs.length})</div>
          {source.docs.length === 0 ? (
            <p className="mt-1 text-[11px] text-muted-foreground">
              The last fetch wrote no page — every link its llms.txt lists was passed over.
            </p>
          ) : (
            <div className="mt-1 max-h-[26rem] overflow-y-auto rounded-md border border-border">
              {source.docs.map((doc) => (
                <div
                  key={doc.ref}
                  role="button"
                  tabIndex={0}
                  aria-pressed={doc.ref === previewRef}
                  onClick={() => onPreview(doc.ref)}
                  className={`group flex w-full cursor-pointer items-center gap-2 border-b border-border/60 px-3 py-1.5 text-left transition-colors last:border-b-0 hover:bg-muted/40 ${
                    doc.ref === previewRef ? 'bg-muted/60' : ''
                  }`}
                >
                  <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-foreground">{doc.title || doc.path}</span>
                    <span className="block truncate text-[10px] text-muted-foreground/70">{doc.path}</span>
                  </span>
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
                </div>
              ))}
            </div>
          )}
        </div>

        {previewDoc && (
          <div className="h-[32rem] min-w-0 flex-1 overflow-hidden rounded-md border border-border bg-card">
            <SpecDocViewer
              repoId={repoId}
              docRef={previewDoc.ref}
              title={previewDoc.title || previewDoc.path}
              sourceTitle={source.title}
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
          </div>
        )}
      </div>

      {source.skipped.length > 0 && (
        <div>
          <div className={LABEL}>Skipped ({source.skipped.length})</div>
          <ul className="mt-1 space-y-1">
            {source.skipped.map((skip) => (
              <SkippedRow key={`${skip.url}:${skip.reason}`} skip={skip} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** One link the fetch wrote no page for: where it points, and why it was passed over. */
function SkippedRow({ skip }: { skip: SpecSourceSkip }) {
  return (
    <li className="text-[11px] text-muted-foreground">
      <a href={skip.url} target="_blank" rel="noreferrer" className="break-all text-primary hover:underline">
        {skip.url}
      </a>{' '}
      — {SKIP_REASON[skip.reason] ?? skip.reason}
      {skip.detail ? ` (${skip.detail})` : ''}
    </li>
  );
}
