/**
 * The one piece of a conversation that is more than text: the conflict card
 * an outcome can carry, with the verdict row that records a resolution in
 * place.
 *
 * The card is presentational. What it needs to write a verdict comes from
 * {@link ConflictResolveProvider}, which the surface rendering the cards wraps
 * around them, so the card itself knows nothing about the API.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Check } from 'lucide-react';
import { buildCorpusConflicts, resolutionForConflict, type ConflictSideLike } from '@truecourse/shared';
import type { DisplayConflict, KnownDisplayBlock } from '@truecourse/agent-loop';
import { HoverPopover } from '@/dashboard/ui/hover-popover';
import * as api from '@/lib/api';
import type { SpecConflictResolution } from '@/lib/api';
import { sentenceNames } from '@/lib/sentence-names';

/** A conflict's two sides as the shared identity reads them. */
const conflictPointers = (d: DisplayConflict): ConflictSideLike[] => [
  { doc: d.docA, heading: d.anchorA, quote: d.quoteA, sentence: d.sentenceA },
  { doc: d.docB, heading: d.anchorB, quote: d.quoteB, sentence: d.sentenceB },
];

/** A `conflict` display block as the card consumes it. */
export type ChatConflict = Omit<Extract<KnownDisplayBlock, { kind: 'conflict' }>, 'kind'>;

/**
 * What a conflict card needs to RESOLVE its conflict in place: the same verdict
 * API the Coverage conflicts page uses. `resolutions` is the persisted verdict
 * list (null while loading); `coverageHref` deep-links the same conflict there.
 */
interface ConflictResolveCtx {
  resolutions: SpecConflictResolution[] | null;
  resolve: (conflict: DisplayConflict, verdict: 'a' | 'b' | 'dismissed') => Promise<void>;
  undo: (conflict: DisplayConflict) => Promise<void>;
  coverageHref: (conflict: DisplayConflict) => string;
}

const ConflictResolveContext = createContext<ConflictResolveCtx | null>(null);

/** One derived Coverage conflict record: the same shape both pages build. */
type ConflictRecord = ReturnType<typeof buildCorpusConflicts>[number];

/**
 * The side the card's recommendation picks. A card written before the side
 * was recorded names only the doc, which is enough between two docs; inside
 * one doc only the side tells the sentences apart.
 */
function recommendedSide(card: ChatConflict): 'a' | 'b' | undefined {
  const rec = card.recommendation;
  if (rec?.side) return rec.side;
  const conflict = card.conflict;
  if (!rec?.doc || !conflict || conflict.docA === conflict.docB) return undefined;
  return rec.doc === conflict.docA ? 'a' : rec.doc === conflict.docB ? 'b' : undefined;
}

export function ConflictCard({ card }: { card: ChatConflict }) {
  const side = recommendedSide(card);
  const conflict = card.conflict;
  // Inside one doc a quote is the recommended one by its words, not its doc.
  const recommendedQuote = (q: ChatConflict['quotes'][number]): boolean =>
    conflict && conflict.docA === conflict.docB
      ? side !== undefined && q.quote === (side === 'a' ? conflict.quoteA : conflict.quoteB)
      : card.recommendation?.doc === q.doc;
  return (
    <div className="max-w-full overflow-hidden rounded-xl rounded-tl border border-border">
      <div className="px-3 py-2">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-500">
          Disagreement
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-foreground">{card.claim}</p>
      </div>
      {card.quotes.length > 0 && (
        <div className={`grid border-t border-border ${card.quotes.length > 1 ? 'sm:grid-cols-2' : ''}`}>
          {card.quotes.map((q, i) => (
            <div key={i} className={`min-w-0 px-3 py-2 ${i > 0 ? 'border-t border-border sm:border-l sm:border-t-0' : ''}`}>
              <HoverPopover content={q.heading ?? q.doc} width="narrow">
                <div
                  className={`truncate font-mono text-[10px] ${
                    recommendedQuote(q) ? 'text-emerald-600 dark:text-emerald-500' : 'text-muted-foreground'
                  }`}
                >
                  {shortDocRef(q.doc)}
                </div>
              </HoverPopover>
              <pre className="mt-1 overflow-x-auto rounded border border-border/70 bg-background px-2 py-1.5 font-mono text-[11px] text-foreground">
                {q.quote}
              </pre>
            </div>
          ))}
        </div>
      )}
      {card.recommendation && (
        <div className="flex items-baseline gap-2 border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
          <span className="min-w-0">
            {card.recommendation.doc ? (
              <>
                I'd follow <span className="text-foreground">{shortDocRef(card.recommendation.doc)}</span>
                {card.recommendation.rationale && <>: {card.recommendation.rationale}</>}
              </>
            ) : (
              card.recommendation.rationale || 'No clear side to pick.'
            )}
          </span>
          {card.recommendation.confidence && (
            <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/70">
              {card.recommendation.confidence} confidence
            </span>
          )}
        </div>
      )}
      {conflict && <ConflictResolveFooter conflict={conflict} recommended={side} />}
    </div>
  );
}

const VERDICT_BTN =
  'inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1 text-[11px] text-foreground hover:border-sky-500 disabled:opacity-50';

/**
 * The in-place resolution row: the same pick-a-side / dismiss verdicts the
 * Coverage conflicts page records, writing the identical conflict identity to
 * decisions.json, plus the deep link to that page for the full detail. The
 * side the agent recommended carries the same green its quote header does.
 */
function ConflictResolveFooter({
  conflict,
  recommended,
}: {
  conflict: DisplayConflict;
  recommended?: 'a' | 'b';
}) {
  const ctx = useContext(ConflictResolveContext);
  const [busy, setBusy] = useState<'a' | 'b' | 'dismissed' | 'undo' | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!ctx) return null;
  const [nameA, nameB] = conflictSideNames(conflict);
  // Same chrome on every verdict button; the recommended side is marked by a
  // check inside the button, matching its quote header's green.
  const recommendedMark = (
    <Check aria-hidden className="h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-500" />
  );

  const resolution = resolutionForConflict(ctx.resolutions ?? [], conflict.docA, conflict.docB, conflictPointers(conflict));

  const act = async (verdict: 'a' | 'b' | 'dismissed' | 'undo'): Promise<void> => {
    setBusy(verdict);
    setError(null);
    try {
      if (verdict === 'undo') {
        await ctx.undo(conflict);
      } else {
        await ctx.resolve(conflict, verdict);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const verdictButton = (side: 'a' | 'b', name: string): ReactNode => (
    <HoverPopover content={recommended === side ? 'The recommendation above' : null}>
      <button type="button" onClick={() => void act(side)} disabled={busy !== null} className={VERDICT_BTN}>
        {recommended === side && recommendedMark}
        {busy === side ? 'Recording…' : `Follow ${name}`}
      </button>
    </HoverPopover>
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-t border-border px-3 py-1.5">
      {ctx.resolutions === null ? (
        <span className="text-[11px] text-muted-foreground/70">Checking for a recorded verdict…</span>
      ) : resolution ? (
        <>
          <span className="text-[11px] text-foreground">
            {resolution.verdict === 'dismissed' ? (
              'Dismissed, not a real conflict'
            ) : (
              <>
                Resolved:{' '}
                <span className="text-emerald-600 dark:text-emerald-500">
                  {conflictSideNames(resolution)[resolution.verdict === 'a' ? 0 : 1]}
                </span>{' '}
                wins
              </>
            )}
          </span>
          {resolution.resolvedBy === 'auto' && (
            <span className="rounded border border-border px-1 text-[10px] text-muted-foreground">auto</span>
          )}
          <button type="button" onClick={() => void act('undo')} disabled={busy !== null} className={VERDICT_BTN}>
            {busy === 'undo' ? 'Undoing…' : 'Undo'}
          </button>
        </>
      ) : (
        <>
          {verdictButton('a', nameA)}
          {verdictButton('b', nameB)}
          <button type="button" onClick={() => void act('dismissed')} disabled={busy !== null} className={VERDICT_BTN}>
            {busy === 'dismissed' ? 'Recording…' : 'Not a real conflict'}
          </button>
        </>
      )}
      {error && <span className="text-[11px] text-red-500">{error}</span>}
      <Link
        to={ctx.coverageHref(conflict)}
        className="ml-auto inline-flex shrink-0 items-center gap-0.5 text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
      >
        Open in Coverage
        <ArrowUpRight aria-hidden className="h-3 w-3 shrink-0" />
      </Link>
    </div>
  );
}

/**
 * What every conflict card under it needs to record a verdict: the conflict
 * verdicts and the derived conflicts list, read once `active` says a card with
 * a conflict is on screen.
 */
export function ConflictResolveProvider({
  repoId,
  active,
  children,
}: {
  /**
   * The repository whose corpus the conflict is about, or NULL for a run of the
   * workspace (a Document scan): its corpus and its decisions are the
   * workspace's, settled once for every repository that reads the documents.
   */
  repoId: string | null;
  active: boolean;
  children: ReactNode;
}) {
  const [resolutions, setResolutions] = useState<SpecConflictResolution[] | null>(null);
  const [conflicts, setConflicts] = useState<ConflictRecord[] | null>(null);
  useEffect(() => {
    if (!active || resolutions !== null) return;
    let cancelled = false;
    (repoId ? api.getSpecCorpus(repoId) : api.getContextCorpus())
      .then((res) => {
        if (cancelled) return;
        setResolutions(res?.conflictResolutions ?? []);
        setConflicts(
          res
            ? buildCorpusConflicts(res.corpus, {
                manualExcludes: res.manualExcludes ?? [],
                conflictResolutions: res.conflictResolutions ?? [],
              })
            : [],
        );
      })
      .catch(() => {
        if (!cancelled) {
          setResolutions([]);
          setConflicts([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [active, resolutions, repoId]);

  const applyAck = (res: object): void => {
    const list = (res as { conflictResolutions?: SpecConflictResolution[] }).conflictResolutions;
    if (list) setResolutions(list);
  };
  const resolveCtx: ConflictResolveCtx = {
    resolutions,
    // The verdict is the WORKSPACE's however the conflict was reached: the
    // repository read above is only its slice of those documents, and the
    // decisions folded into it are the workspace's.
    resolve: async (d, verdict) => applyAck(await api.postContextConflictResolution({ ...d, verdict })),
    undo: async (d) => {
      applyAck(
        await api.deleteContextConflictResolution({ docA: d.docA, sentenceA: d.sentenceA, docB: d.docB, sentenceB: d.sentenceB }),
      );
    },
    // Link the conflict's EXACT Coverage record: match against the same derived
    // conflicts list that page renders (a hand-minted pair-form id would land
    // on the pair's FIRST conflict, which can be a sibling without the review).
    // Treating the conflict as a resolution-like reuses the canonical identity
    // matcher, sentences included, which tells apart the many conflicts two
    // sections can hold. No match yet (corpus not folded, mid-flight) is the
    // Coverage tab.
    coverageHref: (d) => {
      const match = (conflicts ?? []).find((c) =>
        resolutionForConflict([{ ...d, verdict: 'a' }], c.a, c.b, c.sections),
      );
      return match ? `?tab=coverage&conflict=${encodeURIComponent(match.id)}` : '?tab=coverage';
    },
  };

  return <ConflictResolveContext.Provider value={resolveCtx}>{children}</ConflictResolveContext.Provider>;
}

/** The last two path segments: enough to tell sibling docs apart. */
function basename(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts.slice(-2).join('/') || path;
}

/** How a single doc is named on a card. */
export function shortDocRef(path: string): string {
  return basename(path);
}

/**
 * How a conflict's two sides are named on a card: the doc pair's shortest
 * distinct names, or inside one doc that doc's name with each sentence.
 */
function conflictSideNames(d: Pick<DisplayConflict, 'docA' | 'anchorA' | 'docB' | 'anchorB'>): [string, string] {
  if (d.docA !== d.docB) return distinctDocRefs(d.docA, d.docB);
  const doc = d.docA.split('/').filter(Boolean).pop() ?? d.docA;
  const [a, b] = sentenceNames(d.anchorA, d.anchorB);
  return [`${doc} · ${a}`, `${doc} · ${b}`];
}

/**
 * The shortest names that still tell a doc PAIR apart: last segments when they
 * differ ("environment.mdx" vs "storage.mdx" instead of repeating a shared
 * "configuration/" prefix), two segments when they collide, full paths last.
 */
export function distinctDocRefs(a: string, b: string): [string, string] {
  const last = (p: string): string => p.split('/').filter(Boolean).pop() ?? p;
  if (last(a) !== last(b)) return [last(a), last(b)];
  if (basename(a) !== basename(b)) return [basename(a), basename(b)];
  return [a, b];
}
