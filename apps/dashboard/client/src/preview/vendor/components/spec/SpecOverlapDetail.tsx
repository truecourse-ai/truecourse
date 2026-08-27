/**
 * SpecOverlapDetail, right-pane viewer for one flagged within-area overlap.
 * Shows the two docs that may disagree (side-by-side, scrolled to + highlighting
 * the conflicting section) and the SECTION-scoped resolution: a
 * verdict on the disagreement, "<docA> is right" / "<docB> is right" (the loser's
 * disputed claim is suppressed at guard generate) or "Not a real conflict"
 * (dismissal). Verdicts write to decisions.json instantly (OSS, no re-curate) and
 * render resolved-in-place with an Undo. The other resolution path, fixing the
 * doc itself in your editor, is a one-line hint: the docsChanged staleness dot
 * picks the edit up. Opened from the Spec tab's left nav.
 *
 * The pane reads top-down the way a guard test's does: the judge's ASSESSMENT
 * leads (reasoning and recommendation in one card), the verdict actions sit with
 * it, and the two docs follow as the evidence. A recommendation never lands a
 * pane away from the reasoning that justifies it.
 */

import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Loader2 } from 'lucide-react';
import type { ConflictResolutionLike, CorpusConflict } from '@/preview/vendor/shared';
import { Button } from '@/components/ui/button';
import { HoverPopover } from '@/preview/ui/hover-popover';
import type { SpecConflictResolution, SpecCorpusResponse, SpecOverlap, SpecOverlapReview } from '@/preview/vendor/lib/api';
import { webDocLabel } from '@/preview/vendor/lib/spec-web-source';
import { SpecDocViewer } from '@/preview/vendor/components/spec/SpecDocViewer';
import { WorkspaceBadge } from '@/components/spec/WorkspaceBadge';
import { createRepoSpecSource, useSpecSource } from '@/components/spec/spec-source';

/** Shown on resolution actions while a PR is being viewed before its gate has run. */
const PR_GATE_HINT = 'Available after the PR gate runs.';

/** Caption above a detail card, the label grammar the guard detail panes read in. */
const LABEL = 'mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground';

export function SpecOverlapDetail({
  repoId,
  area,
  docA,
  docB,
  conflict,
  data,
  prNumber = null,
  prRef,
  onResolved,
  onConflictChange,
  onDecision,
}: {
  repoId: string;
  area: string;
  docA: string;
  docB: string;
  /**
   * The dispute this pane is showing, already resolved from the URL's conflict id
   * by the page. Passed in rather than re-found here: a doc PAIR can carry several
   * genuine disputes (disjoint sections), so any lookup by pair lands on the first
   * one and this pane would read, and WRITE a verdict against, the wrong dispute.
   * `undefined` when the id addresses nothing in the current corpus (a stale link).
   */
  conflict: CorpusConflict<SpecOverlap> | undefined;
  data: SpecCorpusResponse;
  /** EE PR view: scope the resolution to this PR. Repo view when null/undefined. */
  prNumber?: number | null;
  /** EE PR view: the PR head SHA, also the commit the docs are read at. */
  prRef?: string;
  /** An EE PR re-curate returns the full corpus; the page applies it. */
  onResolved: (res?: SpecCorpusResponse) => void;
  /** OSS verdict ack: the new conflict-resolution list, so the page can update the corpus data. */
  onConflictChange?: (list: SpecConflictResolution[]) => void;
  /** Fired after a verdict is recorded, so the page can refresh the Rescan dot. */
  onDecision?: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  // Optimistic verdict override: `undefined` = derive from data, `null` = optimistically
  // undone, an object = optimistically recorded. Reset when the viewed pair changes.
  const [override, setOverride] = useState<ConflictResolutionLike | null | undefined>(undefined);
  // Which heading to scroll each column to (nonce lets re-clicking the same one re-scroll).
  const [scrollA, setScrollA] = useState<{ heading: string; nonce: number } | undefined>();
  const [scrollB, setScrollB] = useState<{ heading: string; nonce: number } | undefined>();

  // Single-product repos tag everything `core/*`; drop the redundant product so
  // the area reads as its concern (matches the left-nav tags + conflict rows).
  const showProduct = new Set(data.corpus.areas.map((a) => a.product)).size > 1;
  const fmtArea = (id: string): string => (showProduct ? id : id.split('/').pop() ?? id);

  // Workspace corpora carry the ledger's human title + deep link per doc ref (a
  // synthetic stable docPath); repo corpora carry none. Display prefers the title,
  // falling back to the ref, identity (docA/docB in the verdict payloads) is always
  // the ref.
  const docMeta = new Map(data.corpus.docs.map((d) => [d.ref, d] as const));
  const titleOf = (ref: string): string =>
    webDocLabel(ref, docMeta.get(ref)?.sourceTitle) ?? docMeta.get(ref)?.title ?? ref;
  // Hosted repo view: a doc inherited from the workspace Knowledge corpus carries
  // `layer: 'workspace'`, flags the workspace badge beside its title (repo-local
  // side stays unbadged). Inert on OSS / repo-local corpora.
  const isWorkspace = (ref: string): boolean => docMeta.get(ref)?.layer === 'workspace';

  // The representative overlap of THIS dispute, carried by the conflict the
  // shared derivation produced, so the note, the review and the section pointers
  // all belong to the dispute the reader clicked rather than to whichever one
  // happens to be listed first on the pair.
  const overlap = conflict?.overlap;

  const derivedResolution = conflict?.resolution;
  const resolution = override !== undefined ? override : derivedResolution;
  const excludedRef = conflict?.excludedRef;
  const note = overlap?.note;
  const review = overlap?.review;
  const open = !resolution && !excludedRef;

  // The reviewer's action, resolved to a verdict against the PROPS' docA/docB
  // (which may sit in either order vs overlap.docs): 'pick-a' backs the overlap's
  // first doc, 'pick-b' the second, so key on the winning ref, not the letter.
  // `null` = no apply shortcut (fix-doc, or an unreviewed flag).
  const recVerdict: 'a' | 'b' | 'dismissed' | null = (() => {
    const action = review?.recommendation.action;
    if (!action || !overlap) return null;
    if (action === 'dismiss') return 'dismissed';
    if (action === 'fix-doc') return null;
    const winner = action === 'pick-a' ? overlap.docs[0] : overlap.docs[1];
    return winner === docA ? 'a' : 'b';
  })();

  // Heading pointers for a doc (null pointers, preamble conflicts, excluded).
  const sectionsFor = (d: string): string[] =>
    (overlap?.sections ?? [])
      .filter((s) => s.doc === d && s.heading !== null)
      .map((s) => s.heading as string);
  const preambleFor = (d: string): boolean =>
    (overlap?.sections ?? []).some((s) => s.doc === d && s.heading === null);

  // On open (or when the dispute changes), scroll each pane to its first
  // conflicting section, and drop any stale optimistic verdict from a prior one.
  // Keyed on the conflict ID, not the doc pair: two disputes on the SAME pair are
  // distinct panes, and keying on the pair would leave the second showing the
  // first's scroll position and optimistic verdict.
  useEffect(() => {
    setOverride(undefined);
    const a = sectionsFor(docA)[0];
    const b = sectionsFor(docB)[0];
    if (a) setScrollA({ heading: a, nonce: 1 });
    if (b) setScrollB({ heading: b, nonce: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conflict?.id, docA, docB, area]);

  const lastTouched = new Map(data.corpus.docs.map((d) => [d.ref, d.lastTouched] as const));
  const newerDoc = (lastTouched.get(docB) ?? '') >= (lastTouched.get(docA) ?? '') ? docB : docA;

  // EE PR view: scope the resolution to the PR + head SHA. With no gate run yet
  // (no head SHA) the resolution can't be scoped, so the actions are disabled.
  const prScope = prNumber != null && prRef ? { pr: prNumber, ref: prRef } : undefined;
  const decisionsDisabled = prNumber != null && !prRef;

  // A provided (workspace) source wins; otherwise the repo default scoped to the PR.
  const ctxSource = useSpecSource();
  const repoSource = useMemo(() => createRepoSpecSource(repoId, prScope), [repoId, prNumber, prRef]); // eslint-disable-line react-hooks/exhaustive-deps
  const source = ctxSource ?? repoSource;

  // Build the persisted verdict from the flagged sections (heading + verbatim quote
  // per doc), the same identity the CLI and gate key on.
  const buildResolution = (verdict: 'a' | 'b' | 'dismissed'): SpecConflictResolution => {
    const secOf = (d: string) => (overlap?.sections ?? []).find((s) => s.doc === d);
    return {
      docA,
      anchorA: secOf(docA)?.heading ?? null,
      quoteA: secOf(docA)?.quote,
      docB,
      anchorB: secOf(docB)?.heading ?? null,
      quoteB: secOf(docB)?.quote,
      verdict,
    };
  };

  const recordVerdict = async (verdict: 'a' | 'b' | 'dismissed'): Promise<void> => {
    setBusy(verdict);
    try {
      const payload = buildResolution(verdict);
      const res = await source.postConflictResolution(payload);
      if ('corpus' in res) {
        onResolved(res); // EE PR: the re-curated corpus carries the verdict
      } else {
        setOverride({ ...payload, resolvedAt: new Date().toISOString() });
        onConflictChange?.(res.conflictResolutions);
      }
      onDecision?.();
    } finally {
      setBusy(null);
    }
  };

  const undoVerdict = async (): Promise<void> => {
    if (!resolution) return;
    setBusy('undo');
    try {
      const res = await source.deleteConflictResolution({
        docA: resolution.docA,
        anchorA: resolution.anchorA,
        docB: resolution.docB,
        anchorB: resolution.anchorB,
      });
      if ('corpus' in res) onResolved(res);
      else {
        setOverride(null);
        onConflictChange?.(res.conflictResolutions);
      }
      onDecision?.();
    } finally {
      setBusy(null);
    }
  };

  const winnerOf = (r: ConflictResolutionLike): string => (r.verdict === 'a' ? r.docA : r.docB);

  return (
    <div data-testid="overlap-detail" className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <span className="flex items-center gap-1.5">
            {titleOf(docA)}
            {isWorkspace(docA) && <WorkspaceBadge />}
          </span>
          <span className="text-muted-foreground">↔</span>
          <span className="flex items-center gap-1.5">
            {titleOf(docB)}
            {isWorkspace(docB) && <WorkspaceBadge />}
          </span>
          <span className="ml-2 text-xs font-normal text-muted-foreground">{fmtArea(area)}</span>
        </div>
        {review ? (
          <ConflictAssessment
            review={review}
            winner={recVerdict === 'a' ? titleOf(docA) : recVerdict === 'b' ? titleOf(docB) : null}
            canApply={open && recVerdict !== null}
            applyDisabled={busy !== null || decisionsDisabled}
            applyDisabledReason={decisionsDisabled ? PR_GATE_HINT : null}
            applying={recVerdict !== null && busy === recVerdict}
            onApply={() => recVerdict && recordVerdict(recVerdict)}
          />
        ) : note ? (
          <div className="mt-2 rounded-md border border-border bg-muted/30 px-3 py-2">
            <p className="text-xs leading-relaxed text-foreground">{note}</p>
          </div>
        ) : null}

        {resolution ? (
          // Resolved by a section verdict, render in place with an Undo.
          <div data-testid="conflict-verdict" className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            {resolution.verdict === 'dismissed' ? (
              <span className="text-emerald-600 dark:text-emerald-400">
                {resolution.resolvedBy === 'auto' ? 'Auto-dismissed, not a real conflict' : 'Dismissed, not a real conflict'}
              </span>
            ) : (
              <span className="flex flex-wrap items-center gap-1 text-emerald-600 dark:text-emerald-400">
                {resolution.resolvedBy === 'auto' ? 'Auto-resolved -' : 'Resolved -'}
                <HoverPopover content={titleOf(winnerOf(resolution))}>
                  <span className="max-w-[22rem] truncate font-medium">{titleOf(winnerOf(resolution))}</span>
                </HoverPopover>
                is right
              </span>
            )}
            {resolution.resolvedBy === 'auto' && (
              <ConfidenceBar confidence="high" testId="auto-applied-badge" />
            )}
            <HoverPopover content={decisionsDisabled ? PR_GATE_HINT : null}>
              <button
                type="button"
                onClick={undoVerdict}
                disabled={busy !== null || decisionsDisabled}
                className="text-muted-foreground underline hover:text-foreground disabled:opacity-50"
              >
                {busy === 'undo' ? 'Undoing…' : 'Undo'}
              </button>
            </HoverPopover>
          </div>
        ) : excludedRef ? (
          <div className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">
            Resolved, {titleOf(excludedRef)} excluded from the corpus
          </div>
        ) : (
          // Open, the verdict actions on the disagreement itself.
          <div className="mt-2 flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <VerdictButton
                doc={titleOf(docA)}
                busy={busy === 'a'}
                disabled={busy !== null || decisionsDisabled}
                disabledReason={decisionsDisabled ? PR_GATE_HINT : null}
                onClick={() => recordVerdict('a')}
              />
              <VerdictButton
                doc={titleOf(docB)}
                busy={busy === 'b'}
                disabled={busy !== null || decisionsDisabled}
                disabledReason={decisionsDisabled ? PR_GATE_HINT : null}
                onClick={() => recordVerdict('b')}
              />
              <HoverPopover content={decisionsDisabled ? PR_GATE_HINT : null} side="top">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null || decisionsDisabled}
                  onClick={() => recordVerdict('dismissed')}
                >
                  {busy === 'dismissed' ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  Not a real conflict
                </Button>
              </HoverPopover>
            </div>
            <p className="text-[11px] text-muted-foreground/70">
              Or fix the doc itself and rescan, the Rescan button lights up when a doc changes.
            </p>
          </div>
        )}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-1 divide-x divide-border">
        <div className="flex min-h-0 flex-col overflow-hidden">
          <SpecDocViewer
            repoId={repoId}
            docRef={docA}
            title={docMeta.get(docA)?.title}
            sourceTitle={docMeta.get(docA)?.sourceTitle}
            url={docMeta.get(docA)?.url}
            commit={prRef}
            badge={docA === newerDoc ? 'Newer' : 'Older'}
            scrollTo={scrollA}
            highlight={sectionsFor(docA)}
            highlightPreamble={preambleFor(docA)}
          />
        </div>
        <div className="flex min-h-0 flex-col overflow-hidden">
          <SpecDocViewer
            repoId={repoId}
            docRef={docB}
            title={docMeta.get(docB)?.title}
            sourceTitle={docMeta.get(docB)?.sourceTitle}
            url={docMeta.get(docB)?.url}
            commit={prRef}
            badge={docB === newerDoc ? 'Newer' : 'Older'}
            scrollTo={scrollB}
            highlight={sectionsFor(docB)}
            highlightPreamble={preambleFor(docB)}
          />
        </div>
      </div>
    </div>
  );
}

/** Human-readable label for the reviewer's recommended action. */
function recActionLabel(action: SpecOverlapReview['recommendation']['action'], winner: string | null): string {
  if (action === 'dismiss') return 'Dismiss, not a real conflict';
  if (action === 'fix-doc') return 'Fix the doc';
  return winner ? `${winner} is right` : action === 'pick-a' ? 'Pick the first doc' : 'Pick the second doc';
}

/**
 * The judge's assessment of a reviewed conflict, its reasoning and the
 * recommendation that follows from it, in ONE card ABOVE the docs they are about.
 * Same grammar as a guard test's verdict card: a labelled card whose border
 * accents when there is something to act on. The assessment leads, the two docs
 * are the evidence under it, and the reader never has to re-attach a
 * recommendation to reasoning that sat a pane away.
 *
 * The "Apply recommendation" shortcut is wired inside the card and runs the SAME
 * verdict action as the manual controls (pick-a-side / dismissal), nothing new.
 * A `fix-doc` has no verdict to apply, so it carries no accent and no button -
 * its fix text is offered with a copy affordance for the user to edit the doc.
 */
function ConflictAssessment({
  review,
  winner,
  canApply,
  applyDisabled,
  applyDisabledReason,
  applying,
  onApply,
}: {
  review: SpecOverlapReview;
  winner: string | null;
  canApply: boolean;
  applyDisabled: boolean;
  applyDisabledReason: string | null;
  applying: boolean;
  onApply: () => void;
}) {
  const { action, rationale, fix, confidence } = review.recommendation;
  // A pick-a-side or a dismissal is a ruling the reader can take right here; a
  // fix-doc is homework, so only the former earns the accent.
  const actionable = action !== 'fix-doc';
  return (
    <div data-testid="conflict-assessment" className="mt-2">
      <div className={LABEL}>Assessment</div>
      <div className={`rounded border p-3 ${actionable ? 'border-amber-500/60' : 'border-border'}`}>
        <p className="text-xs leading-relaxed text-foreground">{review.explanation}</p>
        <div className="mt-2.5 border-t border-border pt-2.5">
          <div className={LABEL}>Recommendation</div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
              {recActionLabel(action, winner)}
            </span>
            {confidence && <ConfidenceBar confidence={confidence} />}
            {canApply && (
              <HoverPopover content={applyDisabledReason} side="top">
                <Button size="sm" disabled={applyDisabled} onClick={onApply}>
                  {applying ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  Apply recommendation
                </Button>
              </HoverPopover>
            )}
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{rationale}</p>
          {action === 'fix-doc' && fix && <FixText fix={fix} />}
        </div>
      </div>
    </div>
  );
}

/**
 * The judge's confidence grade on its recommendation, as a signal-strength bar:
 * 1 of 3 segments filled = low, 2 = medium, 3 = high, toned like the coverage
 * palette. Hover names the grade ("High confidence"), nothing more.
 */
function ConfidenceBar({
  confidence,
  testId = 'confidence-chip',
}: {
  confidence: 'low' | 'medium' | 'high';
  testId?: string;
}) {
  const filled = confidence === 'high' ? 3 : confidence === 'medium' ? 2 : 1;
  const tone =
    confidence === 'high' ? 'bg-emerald-500' : confidence === 'medium' ? 'bg-amber-500' : 'bg-rose-500';
  const label = `${confidence[0].toUpperCase()}${confidence.slice(1)} confidence`;
  const heights = ['h-1.5', 'h-2', 'h-2.5'];
  return (
    <HoverPopover content={label}>
      <span data-testid={testId} aria-label={label} className="flex items-end gap-0.5">
        {heights.map((h, i) => (
          <span
            key={h}
            className={`w-1 rounded-sm ${h} ${i < filled ? tone : 'bg-muted-foreground/25'}`}
          />
        ))}
      </span>
    </HoverPopover>
  );
}

/** The suggested doc edit for a `fix-doc` recommendation, with a copy affordance. */
function FixText({ fix }: { fix: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(fix);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="mt-2 rounded-md border border-border bg-muted/30">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Suggested fix</span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap px-3 py-2 text-xs leading-relaxed text-foreground">
        {fix}
      </pre>
    </div>
  );
}

/** "<doc> is right" verdict button, the doc path truncates, full path on hover.
 *  Spacing comes from the Button's own flex gap; extra margins would double it. */
function VerdictButton({
  doc,
  busy,
  disabled,
  disabledReason,
  onClick,
}: {
  doc: string;
  busy: boolean;
  disabled: boolean;
  disabledReason: string | null;
  onClick: () => void;
}) {
  return (
    <HoverPopover content={disabledReason ?? doc} side="top">
      <Button size="sm" variant="outline" disabled={disabled} onClick={onClick} className="max-w-[18rem]">
        {busy ? <Loader2 className="h-3 w-3 shrink-0 animate-spin" /> : null}
        <span className="truncate">{doc}</span>
        <span className="shrink-0">is right</span>
      </Button>
    </HoverPopover>
  );
}
