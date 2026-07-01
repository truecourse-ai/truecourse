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

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Play, FileText, ChevronRight, ChevronDown, AlertCircle, GitMerge, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { EmptyState } from '@/components/ui/empty-state';
import * as api from '@/lib/api';
import type { SpecCorpusResponse, SpecCorpusDoc, SpecRelation } from '@/lib/api';

const base = (ref: string): string => ref.split('/').pop() ?? ref;

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

export interface SpecCorpusState {
  data: SpecCorpusResponse | null;
  hydrating: boolean;
  scanning: boolean;
  error: string | null;
  /** Run a fresh corpus scan (curate) — wired to the page header's Scan/Rescan. */
  scan: () => Promise<void>;
  /** Re-read corpus + relations after an inline resolution. */
  refetch: () => Promise<void>;
}

/**
 * Owns the corpus fetch + scan for one repo. `enabled` gates the initial read so
 * the page doesn't fetch a corpus until the Spec tab is actually shown.
 */
export function useSpecCorpus(repoId: string, enabled: boolean): SpecCorpusState {
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
      .getSpecCorpus(repoId)
      .then((r) => !cancelled && setData(r))
      .catch((e) => !cancelled && setError((e as Error).message))
      .finally(() => !cancelled && setHydrating(false));
    return () => {
      cancelled = true;
    };
  }, [repoId, enabled]);

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
      setData(await api.getSpecCorpus(repoId));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [repoId]);

  return { data, hydrating, scanning, error, scan, refetch };
}

export function SpecCorpusView({
  repoId,
  corpus,
  activeKey,
  onOpen,
}: {
  repoId: string;
  corpus: SpecCorpusState;
  /** The `?spec=` value (a doc ref or an overlap key), or null. */
  activeKey: string | null;
  /** Open a doc ref / overlap key in the right pane (pinned on double-click). */
  onOpen: (key: string, pinned: boolean) => void;
}) {
  const { data, hydrating, scanning } = corpus;
  // Declared before the early returns to satisfy the rules of hooks.
  const [selectedTags, setSelectedTags] = useState<Set<string>>(() => new Set());
  // The doc ref currently being force-included / un-included (disables its row).
  const [togglingInclude, setTogglingInclude] = useState<string | null>(null);

  // Force-include a dropped doc / undo it, then re-scan to apply (the scan's own
  // cost-estimate confirm applies). Re-tagging unchanged docs is cache-cheap.
  const setInclude = useCallback(
    async (ref: string, include: boolean) => {
      setTogglingInclude(ref);
      try {
        if (include) await api.addSpecInclude(repoId, ref);
        else await api.removeSpecInclude(repoId, ref);
        await corpus.scan();
      } finally {
        setTogglingInclude(null);
      }
    },
    [repoId, corpus],
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

  // Overlaps are within-area; flatten them into ONE Conflicts list (each carries
  // its area) so docs are never duplicated across area groups.
  const overlaps = c.areas.flatMap((area) =>
    area.overlaps.map((ov) => ({
      area: area.id,
      ov,
      resolved: !!coveringRelation(effectiveRels, ov.docs[0], ov.docs[1], area.id),
    })),
  );
  // The tag filter narrows BOTH lists — conflicts by their area (tag).
  const visibleOverlaps =
    selectedTags.size === 0 ? overlaps : overlaps.filter((o) => selectedTags.has(fmtArea(o.area)));

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
      {allTags.length > 1 && (
        <div className="flex flex-wrap items-center gap-1 border-b border-border px-3 py-2">
          <span className="mr-1 text-[10px] uppercase tracking-wider text-muted-foreground">Filter docs:</span>
          {allTags.map((t) => {
            const on = selectedTags.has(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() => toggleTag(t)}
                className={`rounded-full px-2 py-0.5 text-[10px] transition-colors ${
                  on ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                {t}
              </button>
            );
          })}
          {selectedTags.size > 0 && (
            <button
              type="button"
              onClick={() => setSelectedTags(new Set())}
              className="ml-1 text-[10px] text-muted-foreground underline hover:text-foreground"
            >
              clear
            </button>
          )}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto py-1">
        {visibleOverlaps.length > 0 && (
          <Section title="Conflicts" count={visibleOverlaps.length} icon={<GitMerge className="h-3.5 w-3.5 shrink-0" />}>
            {visibleOverlaps.map(({ area, ov, resolved }, i) => (
              <OverlapRow
                key={`ov-${i}`}
                label={`${base(ov.docs[0])} ↔ ${base(ov.docs[1])}`}
                area={fmtArea(area)}
                resolved={resolved}
                active={activeKey === overlapKey(area, ov.docs[0], ov.docs[1])}
                onOpen={(pinned) => onOpen(overlapKey(area, ov.docs[0], ov.docs[1]), pinned)}
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
              onOpen={(pinned) => onOpen(doc.ref, pinned)}
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
                toggling={togglingInclude === doc.ref}
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
                toggling={togglingInclude === ref}
                onOpen={(pinned) => onOpen(ref, pinned)}
                onAction={() => setInclude(ref, false)}
              />
            ))}
          </Section>
        )}
      </div>
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

function DocRow({
  doc,
  tags,
  active,
  onOpen,
}: {
  doc: SpecCorpusDoc;
  tags: string[];
  active: boolean;
  onOpen: (pinned: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(false)}
      onDoubleClick={() => onOpen(true)}
      title={`${doc.ref} — click to preview, double-click to pin`}
      className={`flex w-full items-start gap-1.5 px-3 py-1.5 pl-7 text-left text-[13px] transition-colors ${
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
    </button>
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
  toggling,
  onOpen,
  onAction,
}: {
  docRef: string;
  reason?: string;
  active: boolean;
  actionLabel: string;
  toggling: boolean;
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
      <button
        type="button"
        disabled={toggling}
        onClick={(e) => {
          e.stopPropagation();
          onAction();
        }}
        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-primary hover:bg-primary/10 disabled:opacity-50"
      >
        {toggling ? '…' : actionLabel}
      </button>
    </div>
  );
}

function OverlapRow({
  label,
  area,
  resolved,
  active,
  onOpen,
}: {
  label: string;
  area: string;
  resolved: boolean;
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
              resolved
            </span>
          )}
        </span>
      </span>
    </button>
  );
}
