/**
 * SpecCorpusView — the curated-corpus Spec tab's LEFT NAV (spec-scan redesign).
 *
 * Mirrors the contracts tree: a list of AREAS, each expanding to its source
 * docs and within-area OVERLAPS, plus the registered web SOURCES the doc set is
 * partly fetched from. Selecting a row opens it in the RIGHT pane (single-click =
 * preview, double-click = pin), URL-synced as `?spec=` via the shared
 * `handleOpenSpec` machinery — a doc opens the markdown viewer, an overlap opens
 * the resolution detail, a source opens its detail (`?gsrc=` in Guard's Coverage
 * tab, whose tab codec owns the params).
 *
 * State (fetch + scan) lives in `useSpecCorpus` so the page header owns Scan.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Play, FileText, ChevronRight, ChevronDown, AlertCircle, GitMerge, EyeOff, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { EmptyState } from '@/components/ui/empty-state';
import { HoverPopover } from '@/components/ui/hover-popover';
import { useCapability } from '@/contexts/CapabilityContext';
import { useScrollToSelected } from '@/hooks/useScrollToSelected';
import { buildCorpusConflicts } from '@truecourse/shared';
import type { SpecCorpusResponse, SpecCorpusDoc, SpecConflictResolution, SpecDecisionAck, SpecSkippedDoc } from '@/lib/api';
import { webDocLabel } from '@/lib/spec-web-source';
import { createRepoSpecSource, useSpecSource, type SkippedPage, type SpecSource } from './spec-source';
import { SpecSourcesGroup } from './SpecSourcesGroup';
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
  prNumber = null,
  prRef,
  sourcesReloadKey = 0,
}: {
  repoId: string;
  corpus: SpecCorpusState;
  /** The selection key (a doc ref, an overlap key, or a source key), or null. */
  activeKey: string | null;
  /** Open a doc ref / overlap key / source key in the right pane (pinned on double-click). */
  onOpen: (key: string, pinned: boolean) => void;
  /** Fired after an OSS include/exclude is recorded, so the parent can refresh the Rescan dot. */
  onDecision?: () => void;
  /** Bumped on `spec:complete { kind: 'sources' }` — re-reads the Sources group. */
  sourcesReloadKey?: number;
  /** EE PR view: scope decisions to this PR. Repo view when null/undefined. */
  prNumber?: number | null;
  /** EE PR view: the PR head SHA. Undefined until the gate runs. */
  prRef?: string;
}) {
  const { data, hydrating, scanning } = corpus;
  // Declared before the early returns to satisfy the rules of hooks.
  const [selectedTags, setSelectedTags] = useState<Set<string>>(() => new Set());
  // A doc opened from elsewhere (a Coverage deep link, a jump from a flow) is
  // off-screen in a long corpus — the cross-navigation rule every panel follows.
  const rows = useScrollToSelected<HTMLDivElement>(activeKey, [data, selectedTags]);
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
  // tree, so the group shows only on a repo page (no provided workspace source)
  // with a local checkout — the same gate the External APIs tab uses.
  const hasLocalFilesystem = useCapability('local-filesystem');
  const showSources = ctxSource === null && hasLocalFilesystem;

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
    // The sources group stays reachable before the first scan — registering a
    // docs site is exactly a pre-scan action (its pages land in the next curate).
    return (
      <div className="flex h-full flex-col">
        {showSources && (
          // Bounded + scrollable on its own: a long registry must not push the
          // "what to do next" empty state out of the panel.
          <div className="max-h-[60%] shrink-0 overflow-auto">
            <SpecSourcesGroup
              repoId={repoId}
              activeKey={activeKey}
              reloadKey={sourcesReloadKey}
              onOpen={onOpen}
            />
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-auto">
          <EmptyState
            icon={Play}
            title="No corpus yet"
            body={
              source.supportsScan
                ? 'Click Scan in the header to curate the docs into areas and flag overlaps.'
                : 'Sync a source in Integrations, then Process it to curate the docs into areas and flag conflicts.'
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
          Showing the base spec — this PR changed no docs.
        </div>
      )}
      {allTags.length > 1 && (
        <AreaTagFilter
          tags={allTags}
          selected={selectedTags}
          onToggle={toggleTag}
          onClear={() => setSelectedTags(new Set())}
        />
      )}
      {/* pb-1 only (no top pad): a scroll container's top padding leaves a band
          above `sticky top-0` section headers where scrolled rows bleed through. */}
      <div className="min-h-0 flex-1 overflow-auto pb-1">
        {visibleConflicts.length > 0 && (
          <Section
            title="Conflicts"
            count={visibleConflicts.length}
            icon={<GitMerge className="h-3.5 w-3.5 shrink-0" />}
            defaultOpen={hasOpenConflicts || activeInConflicts}
          >
            {visibleConflicts.map(({ area, a, b, resolved }, i) => (
              <OverlapRow
                key={`ov-${i}`}
                label={`${labelOf(a)} ↔ ${labelOf(b)}`}
                area={fmtArea(area)}
                resolved={resolved}
                workspace={workspaceRefs.has(a) || workspaceRefs.has(b)}
                active={activeKey === overlapKey(area, a, b)}
                onOpen={(pinned) => onOpen(overlapKey(area, a, b), pinned)}
              />
            ))}
          </Section>
        )}
        {/* The doc universe's WEB half — registered llms.txt sites, above the docs
            they contribute: their pages appear in the sections below once a Scan
            folds them in. */}
        {showSources && (
          <SpecSourcesGroup
            repoId={repoId}
            activeKey={activeKey}
            reloadKey={sourcesReloadKey}
            onOpen={onOpen}
          />
        )}
        <Section title="Documents" count={visibleDocs.length} icon={<FileText className="h-3.5 w-3.5 shrink-0" />}>
          {visibleDocs.map((doc) => (
            <DocRow
              key={doc.ref}
              doc={doc}
              label={webLabelOf(doc.ref)}
              tags={doc.areaTags.map(fmtArea)}
              workspace={doc.layer === 'workspace'}
              active={activeKey === doc.ref}
              busy={busyRef !== null}
              disabledReason={decisionsHint}
              rowRef={rows.set(doc.ref)}
              onOpen={(pinned) => onOpen(doc.ref, pinned)}
              onSkip={() => setExclude(doc.ref, true)}
            />
          ))}
        </Section>
        {skippedSummary
          ? // Workspace: the skipped SUMMARY (thousands possible) → a lazy, paged,
            // searchable expander that pulls rows from the source on demand.
            skippedSummary.total - decidedRefs.size > 0 && (
              <SkippedSection
                source={source}
                total={skippedSummary.total}
                hiddenRefs={decidedRefs}
                activeKey={activeKey}
                busy={busyRef !== null}
                disabledReason={decisionsHint}
                onOpen={onOpen}
                onInclude={(ref) => setInclude(ref, true)}
              />
            )
          : // Repo: the full array inline (relevance-filtered → naturally small).
            skippedDocs.length > 0 && (
              <Section
                title="Not included"
                count={skippedDocs.length}
                icon={<EyeOff className="h-3.5 w-3.5 shrink-0" />}
                defaultOpen={activeInSkipped}
              >
                {skippedDocs.map((doc) => (
                  <IncludeRow
                    key={doc.ref}
                    docRef={doc.ref}
                    label={webLabelOf(doc.ref)}
                    title={doc.title}
                    reason={doc.reason}
                    active={activeKey === doc.ref}
                    actionLabel="include"
                    busy={busyRef !== null}
                    disabledReason={decisionsHint}
                    onOpen={(pinned) => onOpen(doc.ref, pinned)}
                    onAction={() => setInclude(doc.ref, true)}
                  />
                ))}
              </Section>
            )}
        {manualIncludes.length > 0 && (
          <Section
            title="Force-included"
            count={manualIncludes.length}
            icon={<FileText className="h-3.5 w-3.5 shrink-0" />}
          >
            {manualIncludes.map((ref) => (
              <IncludeRow
                key={ref}
                docRef={ref}
                label={webLabelOf(ref)}
                active={activeKey === ref}
                actionLabel="remove"
                busy={busyRef !== null}
                pending={!keptRefs.has(ref)}
                disabledReason={decisionsHint}
                onOpen={(pinned) => onOpen(ref, pinned)}
                onAction={() => setInclude(ref, false)}
              />
            ))}
          </Section>
        )}
        {manualExcludes.length > 0 && (
          <Section
            title="Force-excluded"
            count={manualExcludes.length}
            icon={<EyeOff className="h-3.5 w-3.5 shrink-0" />}
          >
            {manualExcludes.map((ref) => (
              <IncludeRow
                key={ref}
                docRef={ref}
                label={webLabelOf(ref)}
                reason="manually excluded"
                active={activeKey === ref}
                actionLabel="restore"
                busy={busyRef !== null}
                pending={keptRefs.has(ref)}
                disabledReason={decisionsHint}
                onOpen={(pinned) => onOpen(ref, pinned)}
                onAction={() => setExclude(ref, false)}
              />
            ))}
          </Section>
        )}
      </div>
    </div>
  );
}

/** Above this many area tags the flat chip row is unusable (crowds out the doc
 * list); switch to a type-to-filter combobox. At or below it, one-click chips
 * are nicer — you see every option at a glance. */
const HYBRID_TAG_THRESHOLD = 12;

interface AreaTagFilterProps {
  tags: string[];
  selected: Set<string>;
  onToggle: (t: string) => void;
  onClear: () => void;
}

/** Doc-list area-tag filter. Chips for a handful of tags, a typeahead combobox
 * when there are many. Empty selection = no filter (all docs), either way. */
function AreaTagFilter(props: AreaTagFilterProps) {
  return props.tags.length <= HYBRID_TAG_THRESHOLD ? (
    <AreaTagChips {...props} />
  ) : (
    <AreaTagCombobox {...props} />
  );
}

/** The small-N filter: every tag as a one-click toggle chip. */
function AreaTagChips({ tags, selected, onToggle, onClear }: AreaTagFilterProps) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-3 py-2">
      <span className="mr-1 text-[10px] uppercase tracking-wider text-muted-foreground">Filter docs:</span>
      {tags.map((t) => {
        const on = selected.has(t);
        return (
          <button
            key={t}
            type="button"
            onClick={() => onToggle(t)}
            className={`rounded-full px-2 py-0.5 text-[10px] transition-colors ${
              on ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            {t}
          </button>
        );
      })}
      {selected.size > 0 && (
        <button
          type="button"
          onClick={onClear}
          className="ml-1 text-[10px] text-muted-foreground underline hover:text-foreground"
        >
          clear
        </button>
      )}
    </div>
  );
}

/**
 * The many-N filter: selected tags as removable pills + a search input that
 * reveals a scrollable, type-narrowed list of the remaining tags. The list
 * expands inline (not a floating popover) so it can't be clipped by the panel's
 * `overflow-hidden`. Picking a tag adds a pill; clearing removes the filter.
 */
function AreaTagCombobox({ tags, selected, onToggle, onClear }: AreaTagFilterProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close the suggestion list when focus/clicks leave the widget.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const q = query.trim().toLowerCase();
  const selectedList = tags.filter((t) => selected.has(t));
  const suggestions = tags.filter((t) => !selected.has(t) && (q === '' || t.toLowerCase().includes(q)));

  return (
    <div ref={containerRef} className="shrink-0 border-b border-border">
      <div className="flex flex-wrap items-center gap-1 px-3 py-2">
        <span className="mr-1 shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">Filter docs:</span>
        {selectedList.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10px] text-primary-foreground"
          >
            {t}
            <button type="button" aria-label={`Remove ${t}`} onClick={() => onToggle(t)} className="hover:opacity-80">
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}
        <div className="flex min-w-[7rem] flex-1 items-center gap-1">
          <Search className="h-3 w-3 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder={selectedList.length ? 'Add area…' : 'Type to filter by area…'}
            className="w-full bg-transparent text-[11px] text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
          />
        </div>
        {selected.size > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="ml-1 shrink-0 text-[10px] text-muted-foreground underline hover:text-foreground"
          >
            clear
          </button>
        )}
      </div>
      {open && suggestions.length > 0 && (
        <div className="max-h-48 overflow-y-auto border-t border-border/60 py-1">
          {suggestions.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                onToggle(t);
                setQuery('');
                inputRef.current?.focus();
              }}
              className="flex w-full items-center px-3 py-1 text-left text-[11px] text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            >
              {t}
            </button>
          ))}
        </div>
      )}
      {open && suggestions.length === 0 && q !== '' && (
        <div className="border-t border-border/60 px-3 py-2 text-[11px] text-muted-foreground/70">
          No areas match “{query}”.
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  count,
  icon,
  defaultOpen = true,
  children,
}: {
  title: string;
  count: number;
  icon: React.ReactNode;
  /** Initial collapse state, captured ONCE at mount (sections mount only after the
   *  corpus loads, so this is decided when the data first becomes available); later
   *  data refetches never re-force it and manual toggles always win. */
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="sticky top-0 z-10 flex w-full items-center gap-1.5 border-b border-border bg-card px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
      >
        {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
        {icon}
        <span className="flex-1 truncate">{title}</span>
        <span>{count}</span>
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}

/**
 * A kept-doc row (the "Documents" section). Previewable like every list row —
 * single-click previews, double-click pins. Carries an inline "skip" action
 * (force-exclude) revealed on hover; the action button stops propagation so it
 * doesn't open the preview. A div (not a button) so the nested action is valid.
 */
function DocRow({
  doc,
  label,
  tags,
  workspace = false,
  active,
  busy,
  disabledReason,
  rowRef,
  onOpen,
  onSkip,
}: {
  doc: SpecCorpusDoc;
  /** Web-source docs: `<source> / <page>` in place of the raw snapshot ref. */
  label?: string | null;
  tags: string[];
  /** Hosted repo view: this doc is inherited from the workspace Knowledge corpus. */
  workspace?: boolean;
  active: boolean;
  busy: boolean;
  /** When set, the inline action is disabled and the reason shows on hover. */
  disabledReason?: string | null;
  /** Ref-map slot — a doc opened from elsewhere scrolls its row into view. */
  rowRef?: (el: HTMLDivElement | null) => void;
  onOpen: (pinned: boolean) => void;
  onSkip: () => void;
}) {
  return (
    <div
      ref={rowRef}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(false)}
      onDoubleClick={() => onOpen(true)}
      title={`${doc.ref} — click to preview, double-click to pin`}
      className={`group flex w-full cursor-pointer items-start gap-1.5 px-3 py-1.5 pl-7 text-left text-[13px] transition-colors ${
        active ? 'bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground'
      }`}
    >
      <FileText className="mt-0.5 h-3 w-3 shrink-0" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1">
          <span className="truncate">{label ?? doc.title ?? doc.ref}</span>
          {workspace && <WorkspaceBadge />}
          {label && <WebSourceBadge source={doc.sourceTitle} />}
        </span>
        {tags.length > 0 && (
          <span className="flex flex-wrap gap-1">
            {tags.slice(0, 2).map((t) => (
              <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {t}
              </span>
            ))}
            {tags.length > 2 && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">+{tags.length - 2} more</span>
            )}
          </span>
        )}
      </span>
      <HoverPopover content={disabledReason ?? null} side="top" align="end">
        <button
          type="button"
          disabled={busy || !!disabledReason}
          title="Exclude this doc from the corpus"
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
 * A dropped-doc row (the "Not included" + "Force-included" sections). Previewable
 * like every other list row — single-click previews the doc's markdown in the
 * right pane, double-click pins it (the doc viewer reads the file from disk, so a
 * dropped doc still previews). It also carries an inline action (include /
 * remove) that re-scans; the action button stops propagation so it doesn't open
 * the preview. A div (not a button) so the nested action button is valid.
 */
function IncludeRow({
  docRef,
  label,
  title,
  reason,
  active,
  actionLabel,
  busy,
  pending = false,
  disabledReason,
  onOpen,
  onAction,
}: {
  docRef: string;
  /** Web-source docs: `<source> / <page>` in place of the raw snapshot ref. */
  label?: string | null;
  /** Workspace only: the ledger's human title for this ref. Falls back to the ref. */
  title?: string;
  reason?: string;
  active: boolean;
  actionLabel: string;
  busy: boolean;
  /** The decision is recorded but not yet materialized — shows a "pending rescan" hint. */
  pending?: boolean;
  /** When set, the inline action is disabled and the reason shows on hover. */
  disabledReason?: string | null;
  onOpen: (pinned: boolean) => void;
  onAction: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(false)}
      onDoubleClick={() => onOpen(true)}
      title={`${docRef} — click to preview, double-click to pin`}
      className={`flex w-full cursor-pointer items-start gap-1.5 px-3 py-1.5 pl-7 text-left text-[13px] transition-colors ${
        active ? 'bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground'
      }`}
    >
      <FileText className="mt-0.5 h-3 w-3 shrink-0 opacity-60" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1">
          <span className="truncate">{label ?? title ?? docRef}</span>
          {label && <WebSourceBadge />}
        </span>
        {reason && (
          <span className="truncate text-[10px] text-muted-foreground/70" title={reason}>
            {reason}
          </span>
        )}
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
 * The workspace "Not included" expander. The corpus payload ships only a skipped
 * COUNT (a source may have thousands), so the rows load lazily + paged from the
 * source, with a search box and per-row force-include. Force-included/excluded
 * refs (`hiddenRefs`) are filtered out client-side so an include moves the row
 * out immediately, mirroring the repo section's optimistic behavior.
 */
function SkippedSection({
  source,
  total,
  hiddenRefs,
  activeKey,
  busy,
  disabledReason,
  onOpen,
  onInclude,
}: {
  source: SpecSource;
  total: number;
  hiddenRefs: Set<string>;
  activeKey: string | null;
  busy: boolean;
  disabledReason?: string | null;
  onOpen: (key: string, pinned: boolean) => void;
  onInclude: (ref: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<SpecSkippedDoc[]>([]);
  const [matched, setMatched] = useState(total);
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

  // First expand loads page 0; a search reloads from 0 (lightly debounced).
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    const t = setTimeout(() => void load(0, q), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [open, query, load]);

  const visible = rows.filter((d) => !hiddenRefs.has(d.ref));
  const headerCount = Math.max(0, total - hiddenRefs.size);
  const hasMore = offset < matched;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="sticky top-0 z-10 flex w-full items-center gap-1.5 border-b border-border bg-card px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
      >
        {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
        <EyeOff className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1 truncate">Not included</span>
        <span>{headerCount}</span>
      </button>
      {open && (
        <div>
          <div className="flex items-center gap-1 border-b border-border px-3 py-1.5">
            <Search className="h-3 w-3 shrink-0 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search not-included docs…"
              className="w-full bg-transparent text-[11px] text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
            />
          </div>
          {error && (
            <div className="px-3 py-2">
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            </div>
          )}
          {visible.map((doc) => (
            <IncludeRow
              key={doc.ref}
              docRef={doc.ref}
              title={doc.title}
              reason={doc.reason}
              active={activeKey === doc.ref}
              actionLabel="include"
              busy={busy}
              disabledReason={disabledReason}
              onOpen={(pinned) => onOpen(doc.ref, pinned)}
              onAction={() => onInclude(doc.ref)}
            />
          ))}
          {loading && (
            <div className="flex items-center justify-center py-3">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          )}
          {!loading && visible.length === 0 && (
            <div className="px-3 py-2 text-[11px] text-muted-foreground/70">
              {query.trim() ? `No not-included docs match “${query.trim()}”.` : 'No not-included docs.'}
            </div>
          )}
          {hasMore && !loading && (
            <button
              type="button"
              onClick={() => void load(offset, query.trim())}
              className="w-full px-3 py-1.5 text-left text-[11px] text-primary hover:bg-primary/10"
            >
              Load more ({matched - offset} more)
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function OverlapRow({
  label,
  area,
  resolved,
  workspace = false,
  active,
  onOpen,
}: {
  label: string;
  area: string;
  resolved: boolean;
  /** Hosted repo view: a workspace-inherited doc is one side of this conflict. */
  workspace?: boolean;
  active: boolean;
  onOpen: (pinned: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(false)}
      onDoubleClick={() => onOpen(true)}
      title={`${label} — click to preview, double-click to pin`}
      className={`flex w-full items-start gap-1.5 px-3 py-1.5 pl-7 text-left text-[13px] transition-colors ${
        active ? 'bg-primary/10 text-foreground' : 'hover:bg-muted/40'
      }`}
    >
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
    </button>
  );
}

