/**
 * SpecDocViewer — right-pane viewer for one corpus source doc, rendered as
 * markdown. Opened from the Spec tab's left nav (preview on click, pinned on
 * double-click) the same way spec/contract files open, URL-synced as
 * `?spec=<docRef>`.
 */

import { headingMatchKey } from '@/lib/heading-match';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, AlertCircle, EyeOff, ExternalLink } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { HoverPopover } from '@/components/ui/hover-popover';
import { DocMarkdown } from './DocMarkdown';
import { createRepoSpecSource, useSpecSource } from './spec-source';

export function SpecDocViewer({
  repoId,
  docRef,
  title,
  url,
  commit,
  badge,
  scrollTo,
  highlight,
  highlightPreamble,
  tags,
  notIncludedReason,
}: {
  repoId: string;
  docRef: string;
  /** Workspace only: the ledger's human title for this ref. Falls back to the ref. */
  title?: string;
  /** Workspace only: deep link to the source doc, when the ledger has one. */
  url?: string | null;
  /** EE PR view: read the doc's markdown at this commit (the PR head). */
  commit?: string;
  /** Optional role label shown before the doc name (e.g. "Older" / "Newer"). */
  badge?: string;
  /** Scroll the rendered doc to the heading whose text matches this — re-applied
   *  when `nonce` changes so re-clicking the same heading scrolls again. */
  scrollTo?: { heading: string; nonce: number };
  /** Headings to mark in-place as conflicting (amber band + "conflict" tag). */
  highlight?: string[];
  /** Band the doc's lead (content before the first heading, else the opening
   *  heading's own section) — for null-heading preamble conflicts. */
  highlightPreamble?: boolean;
  /** The doc's area tags — shown in full in the header (the list caps them). */
  tags?: string[];
  /** When set, this doc was dropped by the relevance filter — show why, above the content. */
  notIncludedReason?: string;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // A provided (workspace) source wins; otherwise the repo default reading at the
  // given commit (EE PR view). Workspace docs re-fetch transiently from their source.
  const ctxSource = useSpecSource();
  const repoSource = useMemo(
    () => createRepoSpecSource(repoId, commit ? { ref: commit } : undefined),
    [repoId, commit],
  );
  const source = ctxSource ?? repoSource;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    source
      .getDoc(docRef)
      .then((r) => !cancelled && setContent(r.content))
      .catch((e) => !cancelled && setError((e as Error).message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [source, docRef]);

  // Scroll to a conflicting section: match a rendered heading by text.
  useEffect(() => {
    const wanted = scrollTo?.heading == null ? undefined : headingMatchKey(scrollTo.heading);
    if (!wanted || loading || error) return;
    const root = scrollRef.current;
    if (!root) return;
    const headings = [...root.querySelectorAll('h1,h2,h3,h4,h5,h6')];
    const exact = headings.find((el) => headingMatchKey(el.textContent ?? '') === wanted);
    const fuzzy = headings.find((el) => headingMatchKey(el.textContent ?? '').includes(wanted));
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
          <span className="truncate text-xs font-medium text-foreground">{title ?? docRef}</span>
          {url && (
            <HoverPopover content="Open source" side="top">
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                aria-label="Open source"
                className="shrink-0 rounded p-0.5 text-muted-foreground/70 transition-colors hover:text-foreground"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </HoverPopover>
          )}
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
      {notIncludedReason && (
        <div className="flex items-start gap-2 border-b border-amber-500/30 bg-amber-500/5 px-4 py-2 text-[12px] text-amber-800 dark:text-amber-200">
          <EyeOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            <span className="font-medium">Not included in the corpus.</span> {notIncludedReason} — use{' '}
            <span className="font-medium">include</span> in the list to pull it in.
          </span>
        </div>
      )}
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
          <DocMarkdown source={content ?? ''} highlight={highlight} highlightPreamble={highlightPreamble} />
        )}
      </div>
    </div>
  );
}
