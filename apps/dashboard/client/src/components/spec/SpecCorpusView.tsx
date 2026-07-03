/**
 * SpecCorpusView — the curated-corpus Spec tab's LEFT NAV (spec-scan redesign).
 *
 * Mirrors the contracts tree: a list of AREAS, each expanding to its source
 * docs and within-area OVERLAPS. Selecting a row opens it in the RIGHT pane
 * (single-click = preview, double-click = pin), URL-synced as `?spec=` via the
 * shared `handleOpenSpec` machinery — a doc opens the markdown viewer, an
 * overlap opens the resolution detail.
 *
 * State (fetch + scan) lives in `useSpecCorpus` so the page header owns Scan.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Play, FileText, ChevronRight, ChevronDown, AlertCircle, GitMerge, EyeOff, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { EmptyState } from '@/components/ui/empty-state';
import { HoverPopover } from '@/components/ui/hover-popover';
import * as api from '@/lib/api';
import type { SpecCorpusResponse, SpecCorpusDoc, SpecRelation } from '@/lib/api';

const base = (ref: string): string => ref.split('/').pop() ?? ref;

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

/** A relation covers an overlap pair when it names both docs (either order), unscoped or scoped to this area. */
export function coveringRelation(rels: SpecRelation[], a: string, b: string, area: string): SpecRelation | undefined {
  return rels.find((r) => {
    const samePair = (r.older === a && r.newer === b) || (r.older === b && r.newer === a);
    return samePair && (r.scope === undefined || r.scope === area);
  });
}

/** Resolved-badge text for a synthesized conflict — names the relation type + winner. */
function resolvedSummary(rel: SpecRelation): string {
  return rel.type === 'keep-both' ? 'resolved — keep both' : `resolved — ${rel.type}: ${base(rel.newer)} wins`;
}

type DecisionAction = 'exclude' | 'unexclude' | 'include' | 'uninclude';

/**
 * Optimistically reflect a force-include/exclude before the server re-curate
 * returns, so only the DOC jumps immediately — out of Documents into
 * Force-excluded (or between the include lists). Conflicts are deliberately left
 * untouched here: they're the authoritative product of the recompute, so they
 * appear/disappear only when the server corpus lands (the progress popup covers
 * that window).
 */
function optimisticDecision(data: SpecCorpusResponse, ref: string, action: DecisionAction): SpecCorpusResponse {
  const without = (arr?: string[]): string[] => (arr ?? []).filter((r) => r !== ref);
  const withRef = (arr?: string[]): string[] => [...new Set([...(arr ?? []), ref])];
  let manualIncludes = data.manualIncludes;
  let manualExcludes = data.manualExcludes;
  let corpus = data.corpus;
  switch (action) {
    case 'exclude':
      manualExcludes = withRef(manualExcludes);
      manualIncludes = without(manualIncludes);
      // Move the doc out of Documents only — leave overlaps for the re-curate.
      corpus = { ...corpus, docs: corpus.docs.filter((d) => d.ref !== ref) };
      break;
    case 'unexclude':
      manualExcludes = without(manualExcludes);
      break;
    case 'include':
      manualIncludes = withRef(manualIncludes);
      manualExcludes = without(manualExcludes);
      corpus = { ...corpus, skippedDocs: (corpus.skippedDocs ?? []).filter((s) => s.ref !== ref) };
      break;
    case 'uninclude':
      manualIncludes = without(manualIncludes);
      break;
  }
  return { ...data, corpus, manualIncludes, manualExcludes };
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
  /** Re-read corpus + relations after an inline resolution. */
  refetch: () => Promise<void>;
  /** Replace corpus data from a mutation response (include/exclude re-curate server-side). */
  apply: (res: SpecCorpusResponse) => void;
}

/**
 * Owns the corpus fetch + scan for one repo. `enabled` gates the initial read so
 * the page doesn't fetch a corpus until the Spec tab is actually shown. `ref`
 * (EE PR view) reads the corpus at a PR head — a change re-fetches.
 */
export function useSpecCorpus(repoId: string, enabled: boolean, ref?: string): SpecCorpusState {
  const [data, setData] = useState<SpecCorpusResponse | null>(null);
  const [hydrating, setHydrating] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setHydrating(false);
      return;
    }
    let cancelled = false;
    setHydrating(true);
    api
      .getSpecCorpus(repoId, ref)
      .then((r) => !cancelled && setData(r))
      .catch((e) => !cancelled && setError((e as Error).message))
      .finally(() => !cancelled && setHydrating(false));
    return () => {
      cancelled = true;
    };
  }, [repoId, enabled, ref]);

  const scan = useCallback(async () => {
    setScanning(true);
    setError(null);
    try {
      const res = await api.getSpecCorpusScan(repoId);
      // User dismissed the cost-estimate confirm — leave existing data untouched.
      if ('cancelled' in res) return;
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
  }, [repoId]);

  const refetch = useCallback(async () => {
    try {
      setData(await api.getSpecCorpus(repoId, ref));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [repoId, ref]);

  const apply = useCallback((res: SpecCorpusResponse) => setData(res), []);

  return { data, hydrating, scanning, error, corpusCommit: data?.corpusCommit ?? null, scan, refetch, apply };
}

export function SpecCorpusView({
  repoId,
  corpus,
  activeKey,
  onOpen,
  prNumber = null,
  prRef,
}: {
  repoId: string;
  corpus: SpecCorpusState;
  /** The `?spec=` value (a doc ref or an overlap key), or null. */
  activeKey: string | null;
  /** Open a doc ref / overlap key in the right pane (pinned on double-click). */
  onOpen: (key: string, pinned: boolean) => void;
  /** EE PR view: scope decisions to this PR. Repo view when null/undefined. */
  prNumber?: number | null;
  /** EE PR view: the PR head SHA. Undefined until the gate runs. */
  prRef?: string;
}) {
  const { data, hydrating, scanning } = corpus;
  // Declared before the early returns to satisfy the rules of hooks.
  const [selectedTags, setSelectedTags] = useState<Set<string>>(() => new Set());
  // The doc ref currently mutating — while set, every include/exclude action is
  // disabled (one re-curate at a time) and this ref's row shows a spinner.
  const [busyRef, setBusyRef] = useState<string | null>(null);

  // EE PR view: every decision is scoped to the PR + head SHA. With no gate run
  // yet (no head SHA) reads fall back to baseline but writes can't be scoped, so
  // the decision actions are disabled. Repo view is unscoped (byte-identical).
  const prScope = useMemo(
    () => (prNumber != null && prRef ? { pr: prNumber, ref: prRef } : undefined),
    [prNumber, prRef],
  );
  const decisionsDisabled = prNumber != null && !prRef;

  // Force-include / exclude. Move the row optimistically so it jumps immediately,
  // then let the server-driven re-curate run (its step-progress popup shows via
  // the socket, since removing/adding a doc re-runs the relation + vocab stages
  // and can take tens of seconds) and apply the authoritative corpus it returns.
  const runDecision = useCallback(
    async (ref: string, action: DecisionAction, call: () => Promise<SpecCorpusResponse>) => {
      setBusyRef(ref);
      if (corpus.data) corpus.apply(optimisticDecision(corpus.data, ref, action));
      try {
        corpus.apply(await call());
      } catch {
        await corpus.refetch(); // re-curate failed — resync to server truth
      } finally {
        setBusyRef(null);
      }
    },
    [corpus],
  );

  const setInclude = useCallback(
    (ref: string, include: boolean) =>
      runDecision(ref, include ? 'include' : 'uninclude', () =>
        include ? api.addSpecInclude(repoId, ref, prScope) : api.removeSpecInclude(repoId, ref, prScope),
      ),
    [repoId, runDecision, prScope],
  );

  const setExclude = useCallback(
    (ref: string, exclude: boolean) =>
      runDecision(ref, exclude ? 'exclude' : 'unexclude', () =>
        exclude ? api.addSpecExclude(repoId, ref, prScope) : api.removeSpecExclude(repoId, ref, prScope),
      ),
    [repoId, runDecision, prScope],
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
      <EmptyState
        icon={Play}
        title="No corpus yet"
        body="Click Scan in the header to curate the docs into areas, detect doc relations, and flag overlaps."
      />
    );
  }

  const { corpus: c, userRelations } = data;
  const effectiveRels = [...c.relations, ...userRelations];
  const skippedDocs = c.skippedDocs ?? [];
  const manualIncludes = data.manualIncludes ?? [];
  const manualExcludes = data.manualExcludes ?? [];
  // PR view fell back to the base corpus because this PR changed no docs.
  const baselineFallback = !!prRef && !!data.corpusCommit && data.corpusCommit !== prRef;
  const decisionsHint = decisionsDisabled ? PR_GATE_HINT : null;
  // Single-product repos tag everything `core/*`; drop the redundant product in
  // area/tag labels so they read as their concern (e.g. "auth", not "core/auth").
  const showProduct = new Set(c.areas.map((a) => a.product)).size > 1;
  const fmtArea = (id: string): string => (showProduct ? id : id.split('/').pop() ?? id);

  // Tag filter: the distinct area tags across docs; selecting some narrows the
  // Documents list to docs carrying ANY selected tag (OR).
  const allTags = [...new Set(c.docs.flatMap((d) => d.areaTags.map(fmtArea)))].sort();
  const visibleDocs =
    selectedTags.size === 0
      ? c.docs
      : c.docs.filter((d) => d.areaTags.map(fmtArea).some((t) => selectedTags.has(t)));
  const toggleTag = (t: string): void =>
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });

  // Conflicts = the union of two sources, flattened into ONE list (each carries
  // its area) so docs are never duplicated across area groups:
  //  (a) OPEN overlaps the corpus flags — including the legacy case where a
  //      covering relation exists (shown resolved), unchanged.
  //  (b) SYNTHESIZED resolved entries for user relations the corpus no longer
  //      flags: the scan drops relation-covered pairs by invariant (and EE
  //      re-curates on every edit), so a resolved conflict would otherwise vanish.
  // Deduped by pair (order-insensitive) + area: a relation that covers an open
  // overlap isn't synthesized again (that overlap already renders it resolved).
  const openConflicts = c.areas.flatMap((area) =>
    area.overlaps.map((ov) => ({
      area: area.id,
      a: ov.docs[0],
      b: ov.docs[1],
      resolved: !!coveringRelation(effectiveRels, ov.docs[0], ov.docs[1], area.id),
      summary: undefined as string | undefined,
    })),
  );
  const coversOpenConflict = (r: SpecRelation): boolean =>
    openConflicts.some((o) => {
      const samePair = (o.a === r.older && o.b === r.newer) || (o.a === r.newer && o.b === r.older);
      return samePair && (r.scope === undefined || r.scope === o.area);
    });
  const resolvedConflicts = userRelations
    .filter((r) => !coversOpenConflict(r))
    .map((r) => ({ area: r.scope ?? '', a: r.older, b: r.newer, resolved: true, summary: resolvedSummary(r) }));
  const conflicts = [...openConflicts, ...resolvedConflicts];
  // The tag filter narrows BOTH lists — conflicts by their area (tag).
  const visibleConflicts =
    selectedTags.size === 0 ? conflicts : conflicts.filter((o) => selectedTags.has(fmtArea(o.area)));

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
          <Section title="Conflicts" count={visibleConflicts.length} icon={<GitMerge className="h-3.5 w-3.5 shrink-0" />}>
            {visibleConflicts.map(({ area, a, b, resolved, summary }, i) => (
              <OverlapRow
                key={`ov-${i}`}
                label={`${base(a)} ↔ ${base(b)}`}
                area={fmtArea(area)}
                resolved={resolved}
                resolvedLabel={summary}
                active={activeKey === overlapKey(area, a, b)}
                onOpen={(pinned) => onOpen(overlapKey(area, a, b), pinned)}
              />
            ))}
          </Section>
        )}
        <Section title="Documents" count={visibleDocs.length} icon={<FileText className="h-3.5 w-3.5 shrink-0" />}>
          {visibleDocs.map((doc) => (
            <DocRow
              key={doc.ref}
              doc={doc}
              tags={doc.areaTags.map(fmtArea)}
              active={activeKey === doc.ref}
              busy={busyRef !== null}
              disabledReason={decisionsHint}
              onOpen={(pinned) => onOpen(doc.ref, pinned)}
              onSkip={() => setExclude(doc.ref, true)}
            />
          ))}
        </Section>
        {skippedDocs.length > 0 && (
          <Section
            title="Not included"
            count={skippedDocs.length}
            icon={<EyeOff className="h-3.5 w-3.5 shrink-0" />}
          >
            {skippedDocs.map((doc) => (
              <IncludeRow
                key={doc.ref}
                docRef={doc.ref}
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
                active={activeKey === ref}
                actionLabel="remove"
                busy={busyRef !== null}
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
                reason="manually excluded"
                active={activeKey === ref}
                actionLabel="restore"
                busy={busyRef !== null}
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
  children,
}: {
  title: string;
  count: number;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
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
  tags,
  active,
  busy,
  disabledReason,
  onOpen,
  onSkip,
}: {
  doc: SpecCorpusDoc;
  tags: string[];
  active: boolean;
  busy: boolean;
  /** When set, the inline action is disabled and the reason shows on hover. */
  disabledReason?: string | null;
  onOpen: (pinned: boolean) => void;
  onSkip: () => void;
}) {
  return (
    <div
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
        <span className="truncate">{base(doc.ref)}</span>
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
  reason,
  active,
  actionLabel,
  busy,
  disabledReason,
  onOpen,
  onAction,
}: {
  docRef: string;
  reason?: string;
  active: boolean;
  actionLabel: string;
  busy: boolean;
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
        <span className="truncate">{base(docRef)}</span>
        {reason && (
          <span className="truncate text-[10px] text-muted-foreground/70" title={reason}>
            {reason}
          </span>
        )}
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

function OverlapRow({
  label,
  area,
  resolved,
  resolvedLabel,
  active,
  onOpen,
}: {
  label: string;
  area: string;
  resolved: boolean;
  /** Rich resolved-badge text for a synthesized entry; falls back to "resolved". */
  resolvedLabel?: string;
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
        <span className="flex flex-wrap gap-1">
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{area}</span>
          {resolved && (
            <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-600 dark:text-emerald-400">
              {resolvedLabel ?? 'resolved'}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}
