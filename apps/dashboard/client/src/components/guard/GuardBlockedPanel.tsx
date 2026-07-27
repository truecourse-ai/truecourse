/**
 * The Scenarios-tab BLOCKED panel — shown in place of the recipe/last-generate
 * overview when the last guard generate ended `open-conflicts`: birth generation
 * refuses to author scenarios while the spec corpus still carries unresolved
 * disagreements (extracting both sides of a live conflict would only birth a red
 * finding that IS the dispute). In that state there are no scenarios and no runs,
 * so this panel is the whole pane.
 *
 * The conflict list renders LIVE from the spec corpus (never the report snapshot),
 * so resolving one on the Coverage tab drops it here on the next read: each row
 * routes to the Coverage tab with that conflict's resolution detail open. When the
 * live open-conflict count reaches zero (the user resolved them all; regeneration
 * re-runs automatically but hasn't landed) the panel flips to a "resolved — will
 * re-run" note. `conflicts === null` = the corpus is still loading.
 */

import { AlertTriangle, ArrowUpRight, CheckCircle2, GitMerge, Loader2 } from 'lucide-react';
import { buildCorpusConflicts } from '@truecourse/shared';
import type { SpecCorpusResponse } from '@/lib/api';
import { overlapKey } from '@/components/spec/SpecCorpusView';

/** One live open (unresolved) conflict, display-ready for the blocked panel. */
export interface BlockedConflictRow {
  /** The area label (product prefix dropped for single-product repos, like the sidebar). */
  areaLabel: string;
  /** The two overlapping docs, by repo-relative ref. */
  a: string;
  b: string;
  /** The disagreement note. */
  note: string;
  /** The `overlap::…` deep-link key the Coverage tab resolves. */
  key: string;
}

/**
 * Derive the LIVE open (unresolved) conflicts from the spec corpus — the SAME
 * shared derivation the Coverage sidebar and the guard-generate gate use, so no
 * surface disagrees about which overlaps are still open. Resolved-by-verdict /
 * dismissed / exclude-covered overlaps drop out.
 */
export function buildOpenConflictRows(data: SpecCorpusResponse): BlockedConflictRow[] {
  const c = data.corpus;
  const decisions = {
    manualExcludes: data.manualExcludes ?? [],
    conflictResolutions: data.conflictResolutions ?? [],
  };
  // Single-product repos tag everything `core/*`; drop the redundant product so the
  // area reads as its concern — matches the Coverage sidebar's conflict rows.
  const showProduct = new Set(c.areas.map((a) => a.product)).size > 1;
  const fmtArea = (id: string): string => (showProduct ? id : id.split('/').pop() ?? id);
  return buildCorpusConflicts(c, decisions)
    .filter((cf) => !cf.resolved)
    .map((cf) => ({
      areaLabel: fmtArea(cf.area),
      a: cf.a,
      b: cf.b,
      note: cf.note,
      key: overlapKey(cf.area, cf.a, cf.b),
    }));
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full w-full items-center justify-center">{children}</div>;
}

export function GuardBlockedPanel({
  conflicts,
  onOpenConflict,
}: {
  /** Live open conflicts; `null` while the corpus is still loading. */
  conflicts: BlockedConflictRow[] | null;
  /** Route to the Coverage tab with this conflict's resolution detail open. */
  onOpenConflict: (key: string) => void;
}) {
  if (conflicts === null) {
    return (
      <Centered>
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </Centered>
    );
  }

  // The user resolved every conflict — regeneration re-runs on its own; nothing to do.
  if (conflicts.length === 0) {
    return (
      <div
        role="region"
        aria-label="Test generation blocked"
        className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center"
      >
        <CheckCircle2 className="h-8 w-8 text-emerald-500" />
        <div>
          <h3 className="text-sm font-semibold text-foreground">Spec conflicts resolved</h3>
          <p className="mt-1 max-w-md text-xs text-muted-foreground">
            All open spec conflicts have been resolved. Spec Guard will write the missing tests on
            the next generate.
          </p>
        </div>
      </div>
    );
  }

  const n = conflicts.length;
  return (
    <div role="region" aria-label="Test generation blocked" className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-5 px-5 py-6">
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">Test generation is blocked</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {n} open spec conflict{n === 1 ? '' : 's'} must be resolved before Spec Guard can write its
              tests. Open each conflict to pick a side or dismiss it — generation re-runs automatically
              once they are all resolved.
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-border">
          {conflicts.map((cf) => (
            <button
              key={cf.key}
              type="button"
              onClick={() => onOpenConflict(cf.key)}
              title={`${cf.a} ↔ ${cf.b} — resolve on the Coverage tab`}
              className="group flex w-full items-start gap-2.5 border-b border-border/60 px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-muted/40"
            >
              <GitMerge className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-[13px] font-medium text-foreground">
                    {cf.a} ↔ {cf.b}
                  </span>
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {cf.areaLabel}
                  </span>
                </span>
                {cf.note && (
                  <span className="text-[11px] leading-relaxed text-muted-foreground">{cf.note}</span>
                )}
              </span>
              <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
