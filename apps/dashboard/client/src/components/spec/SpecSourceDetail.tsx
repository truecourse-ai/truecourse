/**
 * The detail of ONE registered web source, opened inside its row on the Sources
 * page: what the last fetch actually produced.
 *
 * Two halves, both full page width: the pages it snapshotted — each one click
 * from its markdown in the Coverage doc viewer, and one click from the live page
 * it was fetched from — and the links it passed over, with the reason and the
 * URL. The registry (not the corpus) is the truth about what a fetch wrote, so
 * this reads `GET /spec/sources/:id` and lists pages even before the first scan.
 *
 * The site-level actions (Refresh, Remove) live on the row above, which owns the
 * in-flight state; `reloadKey` is how it tells this pane a refresh landed.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, ExternalLink, FileText, Loader2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import * as api from '@/lib/api';
import type { SpecSourceDetailView, SpecSourceSkip } from '@/lib/api';
import { SKIP_REASON } from '@/lib/spec-web-source';

const LABEL = 'text-[10px] font-semibold uppercase tracking-wider text-muted-foreground';

export function SpecSourceDetail({
  repoId,
  sourceId,
  reloadKey = 0,
  onOpenDoc,
}: {
  repoId: string;
  sourceId: string;
  /** Bumped by the row after a refresh — a re-read signal. */
  reloadKey?: number;
  /** Open one snapshotted page in the Coverage doc viewer (by its corpus ref). */
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

  return (
    <div className="space-y-4">
      <div>
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
                onClick={() => onOpenDoc(doc.ref)}
                className="group flex w-full cursor-pointer items-center gap-2 border-b border-border/60 px-3 py-1.5 text-left transition-colors last:border-b-0 hover:bg-muted/40"
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
