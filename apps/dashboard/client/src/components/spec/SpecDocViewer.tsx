/**
 * SpecDocViewer, right-pane viewer for one corpus source doc, rendered as
 * markdown. Opened from the conflict resolver and the Context document pane, by
 * the corpus ref it is handed; the Sources page renders it in place for a
 * fetched page, passing its own header `actions`.
 *
 * Handed a conflict's `sentences`, it finds each in the doc's tree by its key
 * (the words, and the ordinal among repeats of them), marks it in place and
 * scrolls to the first. A sentence the tree no longer holds has changed since
 * the scan, and the pane says so above the doc, with the quote the scan kept;
 * one that sits where the page renders nothing (the frontmatter, a component
 * tag) is pointed at by its line the same way.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Loader2, AlertCircle, EyeOff, ExternalLink } from 'lucide-react';
import { parseDocTree, sentenceKey, type ConflictSideLike } from '@truecourse/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { HoverPopover } from '@/dashboard/ui/hover-popover';
import { DocMarkdown } from '@/components/spec/DocMarkdown';
import { createRepoSpecSource, useSpecSource } from '@/components/spec/spec-source';
import type { SentenceRange } from '@/lib/remark-sentence-marks';

/** A sentence to mark: its key, and the quote the scan kept for when the key no longer resolves. */
export type SentenceMark = Pick<ConflictSideLike, 'sentence' | 'quote'>;

/** What the page cannot mark, and why. */
export interface SentenceNote {
  kind: 'changed' | 'unrendered';
  quote?: string;
  /** 1-based source line of an unrendered sentence. */
  line?: number;
}

/**
 * Where each wanted sentence is in the doc: a range to mark, or a note when the
 * doc no longer holds it or the page does not render where it sits.
 */
export function locateSentences(
  doc: string,
  content: string | null,
  wanted: readonly SentenceMark[],
): { marks: SentenceRange[]; notes: SentenceNote[] } {
  if (content === null || wanted.length === 0) return { marks: [], notes: [] };
  const tree = parseDocTree(doc, content);
  const byKey = new Map(tree.sentences.map((s) => [sentenceKey(s.text, s.repeat), s] as const));
  const marks: SentenceRange[] = [];
  const notes: SentenceNote[] = [];
  for (const w of wanted) {
    const found = byKey.get(w.sentence);
    if (!found) notes.push({ kind: 'changed', quote: w.quote });
    else if (found.kind === 'frontmatter' || found.kind === 'tag') notes.push({ kind: 'unrendered', quote: w.quote ?? found.text, line: found.startLine });
    else marks.push({ key: w.sentence, start: found.start, end: found.end });
  }
  return { marks, notes };
}

const NO_SENTENCES: readonly SentenceMark[] = [];

export function SpecDocViewer({
  repoId,
  docRef,
  title,
  url,
  badge,
  sentences = NO_SENTENCES,
  tags,
  notIncludedReason,
  actions,
}: {
  repoId: string;
  docRef: string;
  /** Workspace only: the ledger's human title for this ref. Falls back to the ref. */
  title?: string;
  /** Deep link to the original doc: the ledger's (workspace) or the fetched page's (web). */
  url?: string | null;
  /** Optional role label shown before the doc name (e.g. "Older" / "Newer"). */
  badge?: string;
  /** The sentences a conflict points at in this doc, marked in place; the first is scrolled to. */
  sentences?: readonly SentenceMark[];
  /** The doc's area tags, shown in full in the header (the list caps them). */
  tags?: string[];
  /** When set, this doc was dropped by the relevance filter, show why, above the content. */
  notIncludedReason?: string;
  /** Header controls at the trailing edge (close, jump-outs), the in-place preview's. */
  actions?: ReactNode;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // A provided (workspace) source wins; otherwise the repo default. Workspace
  // docs re-fetch transiently from their source.
  const ctxSource = useSpecSource();
  const repoSource = useMemo(() => createRepoSpecSource(repoId), [repoId]);
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

  const located = useMemo(() => locateSentences(docRef, content, sentences), [docRef, content, sentences]);

  // Scroll to the first marked sentence once the doc is on the page.
  useEffect(() => {
    if (loading || error || located.marks.length === 0) return;
    scrollRef.current?.querySelector('[data-sentence]')?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [located, loading, error]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-2" title={docRef}>
        <div className="flex items-center gap-2">
          {badge && (
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {badge}
            </span>
          )}
          <span className="truncate text-xs font-medium text-foreground">
            {title ?? docRef}
          </span>
          {url && (
            // The header sits at the top-right of the pane, inside an
            // `overflow-hidden` column, anchor the tooltip below-and-left so it
            // isn't clipped by the pane top or the viewport right edge.
            <HoverPopover content="Open source" side="bottom" align="end">
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
          {actions && <div className="ml-auto flex shrink-0 items-center gap-1.5">{actions}</div>}
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
            <span className="font-medium">Not included in the corpus.</span> {notIncludedReason}, use{' '}
            <span className="font-medium">include</span> in the list to pull it in.
          </span>
        </div>
      )}
      {!loading && !error && located.notes.map((note, i) => (
        <div
          key={i}
          data-testid="sentence-note"
          className="border-b border-amber-500/30 bg-amber-500/5 px-4 py-2 text-[12px] text-amber-800 dark:text-amber-200"
        >
          <span className="font-medium">
            {note.kind === 'changed' ? 'This sentence changed since the scan.' : `This sentence is on line ${note.line}, which the page does not render.`}
          </span>
          {note.quote && <span className="ml-1 italic">“{note.quote}”</span>}
        </div>
      ))}
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
          <DocMarkdown source={content ?? ''} marks={located.marks} />
        )}
      </div>
    </div>
  );
}
