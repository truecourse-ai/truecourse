/**
 * SpecDocViewer — right-pane viewer for one corpus source doc, rendered as
 * markdown. Opened from the Spec tab's left nav (preview on click, pinned on
 * double-click) the same way canonical/contract files open, URL-synced as
 * `?canonical=<docRef>`.
 */

import { useEffect, useRef, useState } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import * as api from '@/lib/api';
import { DocMarkdown } from './DocMarkdown';

export function SpecDocViewer({
  repoId,
  docRef,
  badge,
  scrollTo,
  highlight,
  tags,
}: {
  repoId: string;
  docRef: string;
  /** Optional role label shown before the doc name (e.g. "Older" / "Newer"). */
  badge?: string;
  /** Scroll the rendered doc to the heading whose text matches this — re-applied
   *  when `nonce` changes so re-clicking the same heading scrolls again. */
  scrollTo?: { heading: string; nonce: number };
  /** Headings to mark in-place as conflicting (amber band + "conflict" tag). */
  highlight?: string[];
  /** The doc's area tags — shown in full in the header (the list caps them). */
  tags?: string[];
}) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getSpecDoc(repoId, docRef)
      .then((r) => !cancelled && setContent(r.content))
      .catch((e) => !cancelled && setError((e as Error).message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [repoId, docRef]);

  // Scroll to a conflicting section: match a rendered heading by text.
  useEffect(() => {
    const wanted = scrollTo?.heading?.trim().toLowerCase();
    if (!wanted || loading || error) return;
    const root = scrollRef.current;
    if (!root) return;
    const headings = [...root.querySelectorAll('h1,h2,h3,h4,h5,h6')];
    const exact = headings.find((el) => el.textContent?.trim().toLowerCase() === wanted);
    const fuzzy = headings.find((el) => el.textContent?.trim().toLowerCase().includes(wanted));
    (exact ?? fuzzy)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [scrollTo, content, loading, error]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-2" title={docRef}>
        <div className="flex items-center gap-2">
          {badge && (
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {badge}
            </span>
          )}
          <span className="truncate text-xs font-medium text-foreground">{docRef}</span>
        </div>
        {tags && tags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {tags.map((t) => (
              <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto px-5 py-4">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : (
          <DocMarkdown source={content ?? ''} highlight={highlight} />
        )}
      </div>
    </div>
  );
}
