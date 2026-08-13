/**
 * SpecCorpusView — the curated-corpus Spec tab's LEFT NAV (spec-scan redesign).
 *
 * The corpus as the shared {@link EntityList}: one search, the area chips as its
 * filter (multi-select, and a typeahead once there are many), and the sections a
 * reader knows as its collapsible GROUPS — the flagged CONFLICTS, the kept
 * DOCUMENTS, the relevance-dropped ones, and the two force-decision lists.
 * Selecting a row opens it in the RIGHT pane (single-click = preview,
 * double-click = pin) — a doc opens the markdown viewer, an overlap the
 * resolution detail. Docs fetched from a registered llms.txt site read as
 * `<source> / <page>` with a web badge; the sites themselves are managed on the
 * Sources page, not here.
 *
 * Only the WORKSPACE "Not included" group is different, and only in where its
 * rows come from: a source can have thousands, so they page in from the server —
 * through a nested embedded list, not a second list implementation.
 *
 * State (fetch + scan) lives in `useSpecCorpus` so the page header owns Scan.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Play, FileText, AlertCircle, GitMerge, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { EmptyState } from '@/components/ui/empty-state';
import { EntityList, type EntityListGroup } from '@/components/ui/entity-list';
import { HoverPopover } from '@/components/ui/hover-popover';
import { useCapability } from '@/contexts/CapabilityContext';
import { buildCorpusConflicts } from '@truecourse/shared';
import type { SpecCorpusResponse, SpecCorpusDoc, SpecConflictResolution, SpecDecisionAck, SpecSkippedDoc } from '@/lib/api';
import { webDocLabel } from '@/lib/spec-web-source';
import { createRepoSpecSource, useSpecSource, type SkippedPage, type SpecSource } from './spec-source';
import { WebSourceBadge } from './WebSourceBadge';
import { WorkspaceBadge } from './WorkspaceBadge';

/** Shown on decision actions while a PR is being viewed before its gate has run. */
const PR_GATE_HINT = 'Available after the PR gate runs.';

// Docs are listed once (keyed by their plain ref). An overlap is keyed by its
// area + doc pair so the resolution detail is addressable + URL-stable.
export const overlapKey = (area: string, a: string, b: string): string => `overlap::${area}::${a}::${b}`;

export type SpecKey =
  | { kind: 'doc'; ref: string }
  | { kind: 'overlap'; area: string; a: string; b: string };

/** Parse a `?spec=` value into the corpus item it addresses. */
export function parseSpecKey(key: string): SpecKey {
  if (key.startsWith('overlap::')) {
    const [, area, a, b] = key.split('::');
    return { kind: 'overlap', area: area ?? '', a: a ?? '', b: b ?? '' };
  }
  // Back-compat: an older area-scoped `doc::<area>::<ref>` URL still resolves.
  if (key.startsWith('doc::')) {
    const rest = key.slice('doc::'.length);
    const sep = rest.indexOf('::');
    return { kind: 'doc', ref: sep >= 0 ? rest.slice(sep + 2) : rest };
  }
  return { kind: 'doc', ref: key };
}

type DecisionAction = 'exclude' | 'unexclude' | 'include' | 'uninclude';

/**
 * Optimistically toggle a force-include/exclude in the decision lists. The corpus
 * itself stays untouched: the Documents / Not included / Force-* rows are DERIVED
 * from these lists over the corpus at render, so a toggle moves the row in BOTH
 * directions (skip and restore alike) with nothing to revert. Conflicts are
 * deliberately left untouched — they're the authoritative product of the
 * recompute, so they appear/disappear only when a fresh corpus lands.
 */
function optimisticDecision(data: SpecCorpusResponse, ref: string, action: DecisionAction): SpecCorpusResponse {
  const without = (arr?: string[]): string[] => (arr ?? []).filter((r) => r !== ref);
  const withRef = (arr?: string[]): string[] => [...new Set([...(arr ?? []), ref])];
  let manualIncludes = data.manualIncludes;
  let manualExcludes = data.manualExcludes;
  switch (action) {
    case 'exclude':
      manualExcludes = withRef(manualExcludes);
      manualIncludes = without(manualIncludes);
      break;
    case 'unexclude':
      manualExcludes = without(manualExcludes);
      break;
    case 'include':
      manualIncludes = withRef(manualIncludes);
      manualExcludes = without(manualExcludes);
      break;
    case 'uninclude':
      manualIncludes = without(manualIncludes);
      break;
  }
  return { ...data, manualIncludes, manualExcludes };
}

export interface SpecCorpusState {
  data: SpecCorpusResponse | null;
  hydrating: boolean;
  scanning: boolean;
  error: string | null;
  /** EE PR view: the commit whose corpus was returned (≠ ref → baseline fallback). */
  corpusCommit: string | null;
  /** Run a fresh corpus scan (curate) — wired to the page header's Scan/Rescan. */
  scan: () => Promise<void>;
  /** Re-read the corpus after an inline resolution. */
  refetch: () => Promise<void>;
  /** Replace corpus data from a mutation response (PR-scoped re-curate, or a scan). */
  apply: (res: SpecCorpusResponse) => void;
  /** Reconcile the decision lists onto the current corpus (OSS include/exclude ack — no re-curate). */
  applyDecisions: (dec: SpecDecisionAck) => void;
  /** Reconcile the section-verdict list onto the current corpus (OSS conflict ack — no re-curate). */
  applyConflictResolutions: (list: SpecConflictResolution[]) => void;
}

/**
 * Owns the corpus fetch + scan for one repo. `enabled` gates the initial read so
 * the page doesn't fetch a corpus until the Spec tab is actually shown. `ref`
 * (EE PR view) reads the corpus at a PR head — a change re-fetches. `pr` folds
 * the PR's decisions overlay into the returned corpus, so resolutions made
 * in the PR view render as resolved conflicts.
 */
export function useSpecCorpus(
  repoId: string,
  enabled: boolean,
  ref?: string,
  pr?: number,
): SpecCorpusState {
  const [data, setData] = useState<SpecCorpusResponse | null>(null);
  const [hydrating, setHydrating] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A provided (workspace) source wins; otherwise the repo default keyed to this
  // repo + PR scope. Recreated when the read scope changes so a ref change refetches.
  const ctxSource = useSpecSource();
  const repoSource = useMemo(() => createRepoSpecSource(repoId, { pr, ref }), [repoId, pr, ref]);
  const source = ctxSource ?? repoSource;

  useEffect(() => {
    if (!enabled) {
      setHydrating(false);
      return;
    }
    let cancelled = false;
    setHydrating(true);
    source
      .getCorpus()
      .then((r) => !cancelled && setData(r))
      .catch((e) => !cancelled && setError((e as Error).message))
      .finally(() => !cancelled && setHydrating(false));
    return () => {
      cancelled = true;
    };
  }, [source, enabled]);

  const scan = useCallback(async () => {
    setScanning(true);
    setError(null);
    try {
      const res = await source.scan();
      // Workspace has no on-demand scan, or the user dismissed the cost-estimate
      // confirm — leave existing data untouched.
      if (!res || 'cancelled' in res) return;
      setData(res);
      // Every doc was unchanged (no LLM calls) — toast it, mirroring generate.
      if (res.noChanges) {
        toast.success('Nothing changed', {
          description: 'No new or updated docs since the last scan — corpus is up to date.',
        });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setScanning(false);
    }
  }, [source]);

  const refetch = useCallback(async () => {
    try {
      setData(await source.getCorpus());
    } catch (e) {
      setError((e as Error).message);
    }
  }, [source]);

  const apply = useCallback((res: SpecCorpusResponse) => setData(res), []);

  // OSS include/exclude: the corpus is unchanged (no re-curate), so keep the
  // optimistically-moved corpus and only reconcile the persisted decision lists.
  // Functional update so it merges onto the latest (post-optimistic) data.
  const applyDecisions = useCallback(
    (dec: SpecDecisionAck) =>
      setData((prev) =>
        prev ? { ...prev, manualIncludes: dec.manualIncludes, manualExcludes: dec.manualExcludes } : prev,
      ),
    [],
  );

  // OSS conflict verdict: the corpus is unchanged (no re-curate), so keep it and
  // only reconcile the persisted verdict list — the conflict/orphan rows derive.
  const applyConflictResolutions = useCallback(
    (list: SpecConflictResolution[]) =>
      setData((prev) => (prev ? { ...prev, conflictResolutions: list } : prev)),
    [],
  );

  return {
    data,
    hydrating,
    scanning,
    error,
    corpusCommit: data?.corpusCommit ?? null,
    scan,
    refetch,
    apply,
    applyDecisions,
    applyConflictResolutions,
  };
}

export function SpecCorpusView({
  repoId,
  corpus,
  activeKey,
  onOpen,
  onDecision,
  onOpenSources,
  prNumber = null,
  prRef,
}: {
  repoId: string;
  corpus: SpecCorpusState;
  /** The selection key (a doc ref or an overlap key), or null. */
  activeKey: string | null;
  /** Open a doc ref / overlap key in the right pane (pinned on double-click). */
  onOpen: (key: string, pinned: boolean) => void;
  /** Fired after an OSS include/exclude is recorded, so the parent can refresh the Rescan dot. */
  onDecision?: () => void;
  /**
   * Jump to the Sources page. Passed only where that page exists (an OSS repo
   * view); its absence is what keeps the pre-scan pointer off a hosted corpus.
   */
  onOpenSources?: () => void;
  /** EE PR view: scope decisions to this PR. Repo view when null/undefined. */
  prNumber?: number | null;
  /** EE PR view: the PR head SHA. Undefined until the gate runs. */
  prRef?: string;
}) {
  const { data, hydrating, scanning } = corpus;
  // Declared before the early returns to satisfy the rules of hooks.
  const [selectedTags, setSelectedTags] = useState<Set<string>>(() => new Set());
  // The doc ref currently mutating — while set, every include/exclude action is
  // disabled (one write at a time) and this ref's row shows a spinner.
  const [busyRef, setBusyRef] = useState<string | null>(null);

  // EE PR view: every decision is scoped to the PR + head SHA. With no gate run
  // yet (no head SHA) reads fall back to baseline but writes can't be scoped, so
  // the decision actions are disabled. Repo view is unscoped (byte-identical).
  const prScope = useMemo(
    () => (prNumber != null && prRef ? { pr: prNumber, ref: prRef } : undefined),
    [prNumber, prRef],
  );
  const decisionsDisabled = prNumber != null && !prRef;

  // A provided (workspace) source wins; otherwise the repo default. Mutations +
  // the skipped listing route through it (repo behavior is byte-identical).
  const ctxSource = useSpecSource();
  const repoSource = useMemo(() => createRepoSpecSource(repoId, prScope), [repoId, prScope]);
  const source = ctxSource ?? repoSource;

  // Web sources are a REPO concern: the snapshot is real files in the working
  // tree, so the pre-scan pointer to the Sources page shows only on a repo page
  // (no provided workspace source) with a local checkout — the same gate the
  // page itself is registered behind.
  const hasLocalFilesystem = useCapability('local-filesystem');
  const showSources = ctxSource === null && hasLocalFilesystem && onOpenSources != null;

  // Force-include / exclude. Toggle the decision lists optimistically so the row
  // moves immediately (both directions — the presentation derives from the lists).
  // OSS records the decision without re-curating (a Scan later materializes the
  // batch), so the response is a decision-list ack: reconcile the lists and let the
  // parent light the Rescan dot. PR scope (EE) re-curates and returns the full
  // corpus, which replaces the optimistic state.
  const runDecision = useCallback(
    async (ref: string, action: DecisionAction, call: () => Promise<SpecCorpusResponse | SpecDecisionAck>) => {
      setBusyRef(ref);
      if (corpus.data) corpus.apply(optimisticDecision(corpus.data, ref, action));
      try {
        const res = await call();
        if ('corpus' in res) {
          corpus.apply(res);
        } else {
          corpus.applyDecisions(res);
          onDecision?.();
        }
      } catch {
        await corpus.refetch(); // write failed — resync to server truth
      } finally {
        setBusyRef(null);
      }
    },
    [corpus, onDecision],
  );

  const setInclude = useCallback(
    (ref: string, include: boolean) =>
      runDecision(ref, include ? 'include' : 'uninclude', () =>
        include ? source.addInclude(ref) : source.removeInclude(ref),
      ),
    [source, runDecision],
  );

  const setExclude = useCallback(
    (ref: string, exclude: boolean) =>
      runDecision(ref, exclude ? 'exclude' : 'unexclude', () =>
        exclude ? source.addExclude(ref) : source.removeExclude(ref),
      ),
    [source, runDecision],
  );

  if (hydrating || (scanning && !data)) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex h-full flex-col">
        <div className="min-h-0 flex-1 overflow-auto">
          <EmptyState
            icon={Play}
            title="No corpus yet"
            body={
              source.supportsScan ? (
                <>
                  Click Scan in the header to curate the docs into areas and flag overlaps.
                  {/* One quiet line, not a second empty state: a repo whose spec lives on a
                      docs site has nothing to scan until that site is registered. */}
                  {showSources && (
                    <>
                      {' '}
                      No docs of your own?{' '}
                      <button
                        type="button"
                        onClick={onOpenSources}
                        className="text-primary underline underline-offset-2 hover:text-primary/80"
                      >
                        Add a documentation site
                      </button>{' '}
                      first.
                    </>
                  )}
                </>
              ) : (
                'Sync a source in Integrations, then Process it to curate the docs into areas and flag conflicts.'
              )
            }
          />
        </div>
      </div>
    );
  }

  const { corpus: c } = data;
  const manualIncludes = data.manualIncludes ?? [];
  const manualExcludes = data.manualExcludes ?? [];
  // The section rows derive from the decision lists over the unchanged corpus, so
  // an OSS decision (no re-curate) moves a row in both directions: an excluded doc
  // leaves Documents, a restored one returns. A row whose decision the corpus
  // hasn't materialized yet (excluded doc still kept, included doc not yet kept)
  // shows the pending-rescan hint — derived, so it survives a reload and clears
  // naturally when the next scan lands.
  const keptRefs = new Set(c.docs.map((d) => d.ref));
  const excludedSet = new Set(manualExcludes);
  const includedSet = new Set(manualIncludes);
  const keptDocs = c.docs.filter((d) => !excludedSet.has(d.ref));
  // The relevance-dropped docs. A repo corpus carries the full array inline; a
  // WORKSPACE corpus ships only a `skipped` SUMMARY (scale), so its rows load
  // lazily + paged through the source (`SkippedSection`). Either way a force-
  // included/excluded ref leaves this list (it moves to Force-*).
  const decidedRefs = new Set([...includedSet, ...excludedSet]);
  const skippedDocs = (c.skippedDocs ?? []).filter((s) => !decidedRefs.has(s.ref));
  const skippedSummary = data.skipped ?? null;
  // PR view fell back to the base corpus because this PR changed no docs.
  const baselineFallback = !!prRef && !!data.corpusCommit && data.corpusCommit !== prRef;
  const decisionsHint = decisionsDisabled ? PR_GATE_HINT : null;
  // Single-product repos tag everything `core/*`; drop the redundant product in
  // area/tag labels so they read as their concern (e.g. "auth", not "core/auth").
  const showProduct = new Set(c.areas.map((a) => a.product)).size > 1;
  const fmtArea = (id: string): string => (showProduct ? id : id.split('/').pop() ?? id);

  // Web-source docs (pages fetched from a registered llms.txt site) carry the
  // source's title from the corpus enrichment; their raw snapshot ref is unreadable,
  // so every row shows `<source> / <page>`. The map covers kept AND skipped docs so
  // a dropped page reads the same, and a ref with no enrichment (a decision list, a
  // source since removed) still maps through the id its ref carries.
  const sourceTitles = new Map(
    [...c.docs, ...(c.skippedDocs ?? [])]
      .filter((d) => d.sourceTitle)
      .map((d) => [d.ref, d.sourceTitle as string] as const),
  );
  const webLabelOf = (ref: string): string | null => webDocLabel(ref, sourceTitles.get(ref));

  // Workspace corpora carry the ledger's human title per doc ref (a synthetic stable
  // docPath); repo corpora carry none. The display label prefers the web label, then
  // the title, falling back to the ref — used for conflict-row labels below (which
  // know refs only).
  const docTitle = new Map(c.docs.map((d) => [d.ref, d.title] as const));
  const labelOf = (ref: string): string => webLabelOf(ref) ?? docTitle.get(ref) ?? ref;

  // Hosted repo view: docs inherited from the workspace Knowledge corpus carry
  // `layer: 'workspace'`. The set drives the workspace badge on kept-doc + conflict
  // rows (which know refs only). Empty on OSS / repo-local corpora ⇒ no badge.
  const workspaceRefs = new Set(c.docs.filter((d) => d.layer === 'workspace').map((d) => d.ref));

  // Tag filter: the distinct area tags across docs; selecting some narrows the
  // Documents list to docs carrying ANY selected tag (OR).
  const allTags = [...new Set(keptDocs.flatMap((d) => d.areaTags.map(fmtArea)))].sort();
  const visibleDocs =
    selectedTags.size === 0
      ? keptDocs
      : keptDocs.filter((d) => d.areaTags.map(fmtArea).some((t) => selectedTags.has(t)));
  const toggleTag = (t: string): void =>
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });

  // Conflicts = the shared derivation (ONE copy in @truecourse/shared, the same
  // the guard-generate gate and CLI use): each flagged within-area overlap, open
  // or resolved by a matching verdict/dismissal or a covering exclude.
  const conflictResolutions = data.conflictResolutions ?? [];
  const decisions = { manualExcludes, conflictResolutions };
  const conflicts = buildCorpusConflicts(c, decisions).map((cf) => ({
    area: cf.area,
    a: cf.a,
    b: cf.b,
    resolved: cf.resolved,
  }));
  // No orphaned-verdict list: a stored verdict that no longer matches a flagged
  // conflict is PRUNED by the scan that wrote the corpus, so there is no stranded
  // bookkeeping to render.
  // The tag filter narrows BOTH lists — conflicts by their area (tag).
  const visibleConflicts =
    selectedTags.size === 0 ? conflicts : conflicts.filter((o) => selectedTags.has(fmtArea(o.area)));
  // Whether ANY conflict is still open (unfiltered, the shared derivation's
  // classification) — decides the Conflicts section's initial collapse state.
  const hasOpenConflicts = conflicts.some((cf) => !cf.resolved);
  // A section containing the ACTIVE selection must start expanded regardless of
  // its collapsed default — a deep link must never land on a hidden row. The
  // containment test is the SAME match each row's `active` prop uses. Captured
  // once at section mount (sections mount only after the corpus loads, so the
  // URL's activeKey is already present); a selection that lands in a collapsed
  // section LATER never re-expands it — that can only happen via a URL edit or
  // an out-of-panel action, and silently overriding a manual collapse would be
  // more surprising than letting the highlight appear on expand.
  const activeInSkipped = skippedDocs.some((d) => activeKey === d.ref);
  const activeInConflicts = conflicts.some((cf) => activeKey === overlapKey(cf.area, cf.a, cf.b));

  // Every row of the sidebar, in ONE list: the shared EntityList narrows them by
  // the area chips and the search, then groups them back into the sections the
  // reader knows. A row is a doc, a conflict, or one of the three decision lists.
  const items: CorpusRow[] = [
    ...visibleConflicts.map(({ area, a, b, resolved }) => ({
      kind: 'conflict' as const,
      id: overlapKey(area, a, b),
      label: `${labelOf(a)} \u2194 ${labelOf(b)}`,
      area: fmtArea(area),
      resolved,
      workspace: workspaceRefs.has(a) || workspaceRefs.has(b),
    })),
    ...keptDocs.map((doc) => ({
      kind: 'doc' as const,
      id: doc.ref,
      doc,
      label: webLabelOf(doc.ref),
      tags: doc.areaTags.map(fmtArea),
      workspace: doc.layer === 'workspace',
    })),
    ...(skippedSummary
      ? []
      : skippedDocs.map((doc) => ({
          kind: 'skipped' as const,
          id: doc.ref,
          label: webLabelOf(doc.ref),
          ...(doc.title ? { title: doc.title } : {}),
          ...(doc.reason ? { reason: doc.reason } : {}),
        }))),
    ...manualIncludes.map((ref) => ({
      kind: 'included' as const,
      id: ref,
      label: webLabelOf(ref),
      pending: !keptRefs.has(ref),
    })),
    ...manualExcludes.map((ref) => ({
      kind: 'excluded' as const,
      id: ref,
      label: webLabelOf(ref),
      pending: keptRefs.has(ref),
    })),
  ];

  const groupRows = (rows: CorpusRow[]): EntityListGroup<CorpusRow>[] => {
    const of = (kind: CorpusRow['kind']): CorpusRow[] => rows.filter((r) => r.kind === kind);
    const groups: EntityListGroup<CorpusRow>[] = [];
    const conflictRows = of('conflict');
    if (conflictRows.length > 0) {
      groups.push({
        key: 'conflicts',
        label: 'Conflicts',
        icon: GitMerge,
        count: conflictRows.length,
        collapsible: true,
        defaultOpen: hasOpenConflicts || activeInConflicts,
        items: conflictRows,
      });
    }
    groups.push({
      key: 'documents',
      label: 'Documents',
      icon: FileText,
      count: of('doc').length,
      collapsible: true,
      items: of('doc'),
    });
    if (skippedSummary) {
      // Workspace: the skipped SUMMARY (thousands possible) \u2014 its rows load
      // lazily + paged from the source, in an embedded list of the same shape.
      if (skippedSummary.total - decidedRefs.size > 0) {
        groups.push({
          key: 'skipped',
          label: 'Not included',
          icon: EyeOff,
          count: Math.max(0, skippedSummary.total - decidedRefs.size),
          collapsible: true,
          defaultOpen: false,
          body: (
            <SkippedSection
              source={source}
              hiddenRefs={decidedRefs}
              activeKey={activeKey}
              busy={busyRef !== null}
              disabledReason={decisionsHint}
              onOpen={onOpen}
              onInclude={(ref) => setInclude(ref, true)}
            />
          ),
        });
      }
    } else if (of('skipped').length > 0) {
      // Repo: the full array inline (relevance-filtered \u2192 naturally small).
      groups.push({
        key: 'skipped',
        label: 'Not included',
        icon: EyeOff,
        count: of('skipped').length,
        collapsible: true,
        defaultOpen: activeInSkipped,
        items: of('skipped'),
      });
    }
    if (of('included').length > 0) {
      groups.push({
        key: 'included',
        label: 'Force-included',
        icon: FileText,
        count: of('included').length,
        collapsible: true,
        items: of('included'),
      });
    }
    if (of('excluded').length > 0) {
      groups.push({
        key: 'excluded',
        label: 'Force-excluded',
        icon: EyeOff,
        count: of('excluded').length,
        collapsible: true,
        items: of('excluded'),
      });
    }
    return groups;
  };

  return (
    <div className="flex h-full flex-col">
      {corpus.error && (
        <div className="border-b border-border px-4 py-2">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{corpus.error}</AlertDescription>
          </Alert>
        </div>
      )}
      {baselineFallback && (
        <div className="border-b border-border bg-card/40 px-4 py-1.5 text-[11px] text-muted-foreground">
          Showing the base spec \u2014 this PR changed no docs.
        </div>
      )}
      <EntityList<CorpusRow>
        label="Spec corpus"
        items={items}
        group={groupRows}
        itemId={(row) => row.id}
        activeId={activeKey}
        onOpen={onOpen}
        search={{
          placeholder: 'Search documents\u2026',
          ariaLabel: 'Search documents',
          match: (row, q) => rowText(row).toLowerCase().includes(q),
        }}
        {...(allTags.length > 1
          ? {
              filter: {
                label: 'Areas',
                ariaLabel: 'Filter docs by area',
                options: allTags.map((t) => ({
                  key: t,
                  label: t,
                  count: keptDocs.filter((d) => d.areaTags.map(fmtArea).includes(t)).length,
                })),
                selected: [...selectedTags],
                onChange: (next) => setSelectedTags(new Set(next)),
                multi: true,
                // The chips narrow the DOCUMENTS (and the conflicts that share
                // their area); the decision lists are the user\u2019s own rulings and
                // stay whole.
                match: (row, tag) =>
                  row.kind === 'doc' ? row.tags.includes(tag) : row.kind === 'conflict' ? row.area === tag : true,
              },
            }
          : {})}
        noMatch="No documents match this search."
        rowClassName={() => 'pl-7'}
        renderRow={(row) =>
          row.kind === 'conflict' ? (
            <OverlapRowContent label={row.label} area={row.area} resolved={row.resolved} workspace={row.workspace} />
          ) : row.kind === 'doc' ? (
            <DocRowContent
              doc={row.doc}
              label={row.label}
              tags={row.tags}
              workspace={row.workspace}
              busy={busyRef !== null}
              disabledReason={decisionsHint}
              onSkip={() => setExclude(row.id, true)}
            />
          ) : (
            <IncludeRowContent
              docRef={row.id}
              label={row.label}
              {...(row.kind === 'skipped' && row.title ? { title: row.title } : {})}
              {...(row.kind === 'skipped' && row.reason ? { reason: row.reason } : {})}
              {...(row.kind === 'excluded' ? { reason: 'manually excluded' } : {})}
              actionLabel={row.kind === 'skipped' ? 'include' : row.kind === 'included' ? 'remove' : 'restore'}
              busy={busyRef !== null}
              pending={row.kind !== 'skipped' && row.pending}
              disabledReason={decisionsHint}
              onAction={() =>
                row.kind === 'excluded' ? setExclude(row.id, false) : setInclude(row.id, row.kind === 'skipped')
              }
            />
          )
        }
      />
    </div>
  );
}

/** The row union the sidebar lists: a conflict, a kept doc, or a decided ref. */
type CorpusRow =
  | { kind: 'conflict'; id: string; label: string; area: string; resolved: boolean; workspace: boolean }
  | { kind: 'doc'; id: string; doc: SpecCorpusDoc; label: string | null; tags: string[]; workspace: boolean }
  | { kind: 'skipped'; id: string; label: string | null; title?: string; reason?: string }
  | { kind: 'included'; id: string; label: string | null; pending: boolean }
  | { kind: 'excluded'; id: string; label: string | null; pending: boolean };

/** What the search reads on a row — everything the row itself shows. */
function rowText(row: CorpusRow): string {
  if (row.kind === 'conflict') return `${row.label} ${row.area}`;
  if (row.kind === 'doc') return `${row.id} ${row.label ?? ''} ${row.doc.title ?? ''} ${row.tags.join(' ')}`;
  if (row.kind === 'skipped') return `${row.id} ${row.label ?? ''} ${row.title ?? ''} ${row.reason ?? ''}`;
  return `${row.id} ${row.label ?? ''}`;
}

/**
 * A kept-doc row's CONTENT (the "Documents" section). Carries an inline "skip"
 * action (force-exclude) revealed on hover; the action button stops propagation
 * so it doesn't open the row's preview. The wrapper, its paint and its
 * preview/pin clicks belong to {@link EntityList}.
 */
function DocRowContent({
  doc,
  label,
  tags,
  workspace = false,
  busy,
  disabledReason,
  onSkip,
}: {
  doc: SpecCorpusDoc;
  /** Web-source docs: `<source> / <page>` in place of the raw snapshot ref. */
  label?: string | null;
  tags: string[];
  /** Hosted repo view: this doc is inherited from the workspace Knowledge corpus. */
  workspace?: boolean;
  busy: boolean;
  /** When set, the inline action is disabled and the reason shows on hover. */
  disabledReason?: string | null;
  onSkip: () => void;
}) {
  return (
    <div className="group flex w-full items-start gap-1.5 text-[13px] text-muted-foreground">
      <FileText className="mt-0.5 h-3 w-3 shrink-0" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1">
          {/* The row's PRIMARY line — foreground ink, like every other list's
              title; only the secondary facts around it stay muted. */}
          <span className="truncate text-foreground">{label ?? doc.title ?? doc.ref}</span>
          {workspace && <WorkspaceBadge />}
          {label && <WebSourceBadge />}
        </span>
        {tags.length > 0 && (
          <span className="flex flex-wrap gap-1">
            {tags.slice(0, 2).map((t) => (
              <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {t}
              </span>
            ))}
            {tags.length > 2 && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                +{tags.length - 2} more
              </span>
            )}
          </span>
        )}
      </span>
      <HoverPopover content={disabledReason ?? 'Exclude this doc from the corpus'} side="top" align="end">
        <button
          type="button"
          disabled={busy || !!disabledReason}
          onClick={(e) => {
            e.stopPropagation();
            onSkip();
          }}
          className="shrink-0 rounded px-1.5 py-0.5 text-[10px] opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus:opacity-100 group-hover:opacity-100 disabled:opacity-50 disabled:hover:bg-transparent"
        >
          skip
        </button>
      </HoverPopover>
    </div>
  );
}

/**
 * A decided-doc row's CONTENT (the "Not included" / "Force-included" /
 * "Force-excluded" sections). It carries an inline action (include / remove /
 * restore) that re-scans; the action button stops propagation so it doesn't open
 * the row's preview.
 */
function IncludeRowContent({
  docRef,
  label,
  title,
  reason,
  actionLabel,
  busy,
  pending = false,
  disabledReason,
  onAction,
}: {
  docRef: string;
  /** Web-source docs: `<source> / <page>` in place of the raw snapshot ref. */
  label?: string | null;
  /** Workspace only: the ledger's human title for this ref. Falls back to the ref. */
  title?: string;
  reason?: string;
  actionLabel: string;
  busy: boolean;
  /** The decision is recorded but not yet materialized — shows a "pending rescan" hint. */
  pending?: boolean;
  /** When set, the inline action is disabled and the reason shows on hover. */
  disabledReason?: string | null;
  onAction: () => void;
}) {
  return (
    <div className="flex w-full items-start gap-1.5 text-[13px] text-muted-foreground">
      <FileText className="mt-0.5 h-3 w-3 shrink-0 opacity-60" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1">
          <span className="truncate">{label ?? title ?? docRef}</span>
          {label && <WebSourceBadge />}
        </span>
        {reason && <span className="truncate text-[10px] text-muted-foreground/70">{reason}</span>}
        {pending && <span className="text-[10px] italic text-muted-foreground/60">pending rescan</span>}
      </span>
      <HoverPopover content={disabledReason ?? null} side="top" align="end">
        <button
          type="button"
          disabled={busy || !!disabledReason}
          onClick={(e) => {
            e.stopPropagation();
            onAction();
          }}
          className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-primary hover:bg-primary/10 disabled:opacity-50"
        >
          {actionLabel}
        </button>
      </HoverPopover>
    </div>
  );
}

/** One page of skipped rows pulled per expand / search / "load more". */
const SKIPPED_PAGE_SIZE = 50;

/**
 * The workspace "Not included" rows. The corpus payload ships only a skipped
 * COUNT (a source may have thousands), so they load lazily + paged FROM THE
 * SOURCE — the one thing an outer list can't do for them. They are still an
 * {@link EntityList}: the search is controlled (the server does the matching) and
 * "load more" is the group's footer, so the idiom holds all the way down.
 * Force-included/excluded refs (`hiddenRefs`) are filtered out client-side so an
 * include moves the row out immediately, mirroring the repo section's optimistic
 * behavior.
 */
function SkippedSection({
  source,
  hiddenRefs,
  activeKey,
  busy,
  disabledReason,
  onOpen,
  onInclude,
}: {
  source: SpecSource;
  hiddenRefs: Set<string>;
  activeKey: string | null;
  busy: boolean;
  disabledReason?: string | null;
  onOpen: (key: string, pinned: boolean) => void;
  onInclude: (ref: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<SpecSkippedDoc[]>([]);
  const [matched, setMatched] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (nextOffset: number, q: string) => {
      setLoading(true);
      setError(null);
      try {
        const page: SkippedPage = await source.listSkipped({
          query: q || undefined,
          limit: SKIPPED_PAGE_SIZE,
          offset: nextOffset,
        });
        setMatched(page.total);
        setRows((prev) => (nextOffset === 0 ? page.docs : [...prev, ...page.docs]));
        setOffset(nextOffset + page.docs.length);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [source],
  );

  // Mounting IS the expand (the group renders this only while open): load page 0,
  // and reload from 0 on a search (lightly debounced).
  useEffect(() => {
    const q = query.trim();
    const t = setTimeout(() => void load(0, q), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [query, load]);

  const visible = rows.filter((d) => !hiddenRefs.has(d.ref));
  const hasMore = offset < matched;

  return (
    <>
      {error && (
        <div className="px-3 py-2">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      )}
      <EntityList<SpecSkippedDoc>
        variant="embedded"
        label="Not-included documents"
        items={visible}
        itemId={(doc) => doc.ref}
        activeId={activeKey}
        onOpen={onOpen}
        loading={loading}
        search={{
          placeholder: 'Search not-included docs…',
          ariaLabel: 'Search not-included docs',
          value: query,
          onChange: setQuery,
        }}
        rowClassName={() => 'pl-7'}
        emptyText={query.trim() ? `No not-included docs match “${query.trim()}”.` : 'No not-included docs.'}
        groups={[
          {
            key: 'rows',
            label: '',
            items: visible,
            ...(hasMore && !loading
              ? {
                  footer: (
                    <button
                      type="button"
                      onClick={() => void load(offset, query.trim())}
                      className="w-full px-3 py-1.5 text-left text-[11px] text-primary hover:bg-primary/10"
                    >
                      Load more ({matched - offset} more)
                    </button>
                  ),
                }
              : {}),
          },
        ]}
        renderRow={(doc) => (
          <IncludeRowContent
            docRef={doc.ref}
            {...(doc.title ? { title: doc.title } : {})}
            {...(doc.reason ? { reason: doc.reason } : {})}
            actionLabel="include"
            busy={busy}
            disabledReason={disabledReason}
            onAction={() => onInclude(doc.ref)}
          />
        )}
      />
    </>
  );
}

/** A within-area overlap's CONTENT — the pair, its area, and whether it's settled. */
function OverlapRowContent({
  label,
  area,
  resolved,
  workspace = false,
}: {
  label: string;
  area: string;
  resolved: boolean;
  /** Hosted repo view: a workspace-inherited doc is one side of this conflict. */
  workspace?: boolean;
}) {
  return (
    <div className="flex w-full items-start gap-1.5 text-[13px]">
      <GitMerge className={`mt-0.5 h-3 w-3 shrink-0 ${resolved ? 'text-emerald-500' : 'text-amber-500'}`} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-foreground">{label}</span>
        <span className="flex flex-wrap items-center gap-1">
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{area}</span>
          {workspace && <WorkspaceBadge />}
          {resolved && (
            <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-600 dark:text-emerald-400">
              Resolved
            </span>
          )}
        </span>
      </span>
    </div>
  );
}
