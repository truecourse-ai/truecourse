/**
 * SpecOverlapDetail — right-pane viewer for one flagged within-area overlap.
 * Shows the two docs that may disagree (side-by-side, scrolled to + highlighting
 * the conflicting section) and the SECTION-scoped resolution (plan item 31): a
 * verdict on the disagreement — "<docA> is right" / "<docB> is right" (the loser's
 * disputed claim is suppressed at guard generate) or "Not a real conflict"
 * (dismissal). Verdicts write to decisions.json instantly (OSS, no re-curate) and
 * render resolved-in-place with an Undo. The other resolution path — fixing the
 * doc itself in your editor — is a one-line hint: the docsChanged staleness dot
 * picks the edit up. Opened from the Spec tab's left nav.
 */

import { useEffect, useMemo, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { buildCorpusConflicts, type ConflictResolutionLike } from '@truecourse/shared';
import { Button } from '@/components/ui/button';
import { HoverPopover } from '@/components/ui/hover-popover';
import type { SpecConflictResolution, SpecCorpusResponse } from '@/lib/api';
import { SpecDocViewer } from './SpecDocViewer';
import { WorkspaceBadge } from './WorkspaceBadge';
import { createRepoSpecSource, useSpecSource } from './spec-source';

/** Shown on resolution actions while a PR is being viewed before its gate has run. */
const PR_GATE_HINT = 'Available after the PR gate runs.';

/** Same set as the shared derivation: is this the same unordered doc pair? */
const samePair = (a1: string, b1: string, a2: string, b2: string): boolean =>
  (a1 === a2 && b1 === b2) || (a1 === b2 && b1 === a2);

export function SpecOverlapDetail({
  repoId,
  area,
  docA,
  docB,
  data,
  prNumber = null,
  prRef,
  onResolved,
  onConflictChange,
  onDecision,
  onClose,
}: {
  repoId: string;
  area: string;
  docA: string;
  docB: string;
  data: SpecCorpusResponse;
  /** EE PR view: scope the resolution to this PR. Repo view when null/undefined. */
  prNumber?: number | null;
  /** EE PR view: the PR head SHA — also the commit the docs are read at. */
  prRef?: string;
  /** An EE PR re-curate returns the full corpus; the page applies it. */
  onResolved: (res?: SpecCorpusResponse) => void;
  /** OSS verdict ack: the new conflict-resolution list, so the page can update the corpus data. */
  onConflictChange?: (list: SpecConflictResolution[]) => void;
  /** Fired after a verdict is recorded, so the page can refresh the Rescan dot. */
  onDecision?: () => void;
  /** When set, render a close affordance in the header (Guard's detail pane has no
   *  tab bar to close from). BL Drift omits it — closing is the spec tab's X. */
  onClose?: () => void;
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
  // falling back to the ref — identity (docA/docB in the verdict payloads) is always
  // the ref.
  const docMeta = new Map(data.corpus.docs.map((d) => [d.ref, d] as const));
  const titleOf = (ref: string): string => docMeta.get(ref)?.title ?? ref;
  // Hosted repo view: a doc inherited from the workspace Knowledge corpus carries
  // `layer: 'workspace'` — flags the workspace badge beside its title (repo-local
  // side stays unbadged). Inert on OSS / repo-local corpora.
  const isWorkspace = (ref: string): boolean => docMeta.get(ref)?.layer === 'workspace';

  const overlap = data.corpus.areas
    .find((ar) => ar.id === area)
    ?.overlaps.find(
      (o) => (o.docs[0] === docA && o.docs[1] === docB) || (o.docs[0] === docB && o.docs[1] === docA),
    );

  // The ONE shared derivation: classify this pair as open/resolved, carrying HOW
  // (a section verdict or an exclude). Reused so this pane never disagrees with
  // the sidebar or the gate about resolution.
  const conflict = useMemo(() => {
    const conflicts = buildCorpusConflicts(data.corpus, {
      manualExcludes: data.manualExcludes ?? [],
      conflictResolutions: data.conflictResolutions ?? [],
    });
    return conflicts.find((c) => samePair(c.a, c.b, docA, docB) && (c.area === area || c.areas.includes(area)));
  }, [data, docA, docB, area]);

  const derivedResolution = conflict?.resolution;
  const resolution = override !== undefined ? override : derivedResolution;
  const excludedRef = conflict?.excludedRef;
  const note = overlap?.note;

  // Heading pointers for a doc (null pointers — preamble conflicts — excluded).
  const sectionsFor = (d: string): string[] =>
    (overlap?.sections ?? [])
      .filter((s) => s.doc === d && s.heading !== null)
      .map((s) => s.heading as string);
  const preambleFor = (d: string): boolean =>
    (overlap?.sections ?? []).some((s) => s.doc === d && s.heading === null);

  // On open (or when the overlap changes), scroll each pane to its first
  // conflicting section, and drop any stale optimistic verdict from a prior pair.
  useEffect(() => {
    setOverride(undefined);
    const a = sectionsFor(docA)[0];
    const b = sectionsFor(docB)[0];
    if (a) setScrollA({ heading: a, nonce: 1 });
    if (b) setScrollB({ heading: b, nonce: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docA, docB, area]);

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
  // per doc) — the same identity the CLI and gate key on.
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
    <div className="flex h-full flex-col">
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
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close conflict detail"
              className="ml-auto shrink-0 rounded p-1 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {note && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{note}</p>}

        {resolution ? (
          // Resolved by a section verdict — render in place with an Undo.
          <div data-testid="conflict-verdict" className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            {resolution.verdict === 'dismissed' ? (
              <span className="text-emerald-600 dark:text-emerald-400">Dismissed — not a real conflict</span>
            ) : (
              <span className="flex flex-wrap items-center gap-1 text-emerald-600 dark:text-emerald-400">
                Resolved —
                <HoverPopover content={titleOf(winnerOf(resolution))}>
                  <span className="max-w-[22rem] truncate font-medium">{titleOf(winnerOf(resolution))}</span>
                </HoverPopover>
                is right
              </span>
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
            Resolved — {titleOf(excludedRef)} excluded from the corpus
          </div>
        ) : (
          // Open — the verdict actions on the disagreement itself.
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
              Or fix the doc itself and rescan — the Rescan button lights up when a doc changes.
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

/** "<doc> is right" verdict button — the doc path truncates, full path on hover.
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
