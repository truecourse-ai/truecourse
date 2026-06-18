/**
 * Inferred decisions — the repo's reverse-engineered undocumented decisions.
 * Mirrors the Contracts tab: this is the LEFT SIDEBAR list (kind-grouped,
 * collapsible, with a confidence count/filter header). Single-click opens a
 * transient preview tab in the main pane, double-click pins it; the selected
 * decision's rendered `.tc` + Promote / Dismiss render there via
 * `InferredDecisionDetail`. Data is owned by `useInferredDecisions` in RepoPage,
 * so OSS (file store) and EE (Postgres) behave identically.
 */

import { useState } from 'react';
import { Lightbulb, Loader2, ChevronRight, ChevronDown } from 'lucide-react';
import type { InferredDecisionView } from '@truecourse/shared';
import { EmptyState } from '@/components/ui/empty-state';
import { FilterBar } from '@/components/ui/filter-bar';
import { inferredKey } from '@/hooks/useInferredDecisions';

// Stable display order: architecture/auth first, then the schema-ish kinds.
const KIND_ORDER = [
  'ArchitectureDecision',
  'AuthRequirement',
  'Operation',
  'Entity',
  'Enum',
  'NamedConstant',
  'QueryRule',
  'EffectGroup',
  'PaginationContract',
];

const CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;

function kindRank(kind: string): number {
  const i = KIND_ORDER.indexOf(kind);
  return i === -1 ? KIND_ORDER.length : i;
}

function confidenceTone(c?: string): string {
  if (c === 'high') return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300';
  if (c === 'medium') return 'bg-amber-500/15 text-amber-700 dark:text-amber-300';
  return 'bg-muted text-muted-foreground';
}

export function InferredPanel({
  decisions,
  dismissed,
  error,
  activeKey,
  onOpen,
  onRestore,
  diffMode = false,
}: {
  decisions: InferredDecisionView[] | null;
  dismissed: InferredDecisionView[];
  error: string | null;
  activeKey: string | null;
  onOpen: (d: InferredDecisionView, pinned: boolean) => void;
  onRestore: (d: InferredDecisionView) => void;
  /** PR view: the list is the PR delta (added + changed); empty-state wording differs. */
  diffMode?: boolean;
}) {
  // Confidence filter (single-select, toggle-off — like the Verify severity filter)
  // and per-kind collapse state. Both are list-only UI concerns.
  const [confActive, setConfActive] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [dismissedOpen, setDismissedOpen] = useState(false);

  const toggleKind = (kind: string) =>
    setCollapsed((cur) => {
      const next = new Set(cur);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });

  if (decisions === null && !error) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (decisions !== null && decisions.length === 0 && dismissed.length === 0 && !error) {
    return (
      <EmptyState
        icon={Lightbulb}
        title={diffMode ? 'No new undocumented decisions' : 'No undocumented decisions'}
        body={
          diffMode
            ? 'This PR introduces no new undocumented decisions vs the base branch.'
            : "Every decision in this repo's code is already captured by the spec — or no baseline scan has run yet."
        }
      />
    );
  }

  const all = decisions ?? [];

  // Confidence counts over the full set, for the filter pills.
  const counts: Record<string, number> = { high: 0, medium: 0, low: 0 };
  for (const d of all) if (d.confidence && counts[d.confidence] != null) counts[d.confidence]++;
  const confOptions = CONFIDENCE_LEVELS.filter((lvl) => counts[lvl] > 0).map((lvl) => ({
    key: lvl,
    label: lvl,
    count: counts[lvl],
    tone: confidenceTone(lvl),
  }));

  // A decision shows when no confidence is selected, or it matches the selection.
  const visible = all.filter((d) => !confActive || d.confidence === confActive);

  const groups = new Map<string, InferredDecisionView[]>();
  for (const d of visible) {
    if (!groups.has(d.kind)) groups.set(d.kind, []);
    groups.get(d.kind)!.push(d);
  }
  const orderedKinds = [...groups.keys()].sort((a, b) => kindRank(a) - kindRank(b) || a.localeCompare(b));

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {error && (
        <div className="shrink-0 border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <FilterBar
        label="Confidence"
        options={confOptions}
        active={confActive}
        onSelect={(k) => setConfActive((cur) => (cur === k ? null : k))}
      />

      <div className="min-h-0 flex-1 overflow-auto">
        {orderedKinds.map((kind) => {
          const open = !collapsed.has(kind);
          return (
            <section key={kind}>
              <button
                type="button"
                onClick={() => toggleKind(kind)}
                aria-expanded={open}
                className="sticky top-0 z-10 flex w-full items-center justify-between gap-2 border-b border-border bg-card px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
              >
                <span className="flex items-center gap-1.5">
                  {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  {kind}
                </span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[9px]">{groups.get(kind)!.length}</span>
              </button>
              {open && (
                <ul>
                  {groups.get(kind)!.map((d, i) => {
                    const k = inferredKey(d);
                    const active = k === activeKey;
                    return (
                      <li key={`${d.identity}-${i}`}>
                        <button
                          type="button"
                          onClick={() => onOpen(d, false)}
                          onDoubleClick={() => onOpen(d, true)}
                          title="Click to preview, double-click to pin"
                          className={`flex w-full flex-col gap-0.5 border-b border-border/60 px-4 py-2 text-left transition-colors ${
                            active ? 'bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className={`truncate font-mono text-[13px] ${d.resolved ? 'line-through opacity-60' : ''}`}>{d.identity}</span>
                            <span className="flex shrink-0 items-center gap-1">
                              {d.resolved && (
                                <span className="rounded bg-emerald-500/15 px-1 py-0.5 text-[9px] uppercase tracking-wide text-emerald-600 dark:text-emerald-300">
                                  resolved
                                </span>
                              )}
                              {d.changed && (
                                <span className="rounded bg-blue-500/15 px-1 py-0.5 text-[9px] uppercase tracking-wide text-blue-600 dark:text-blue-300">
                                  changed
                                </span>
                              )}
                              {d.confidence && (
                                <span className={`rounded px-1 py-0.5 text-[9px] uppercase tracking-wide ${confidenceTone(d.confidence)}`}>
                                  {d.confidence}
                                </span>
                              )}
                            </span>
                          </div>
                          {d.path && (
                            <span className="truncate font-mono text-[11px] text-muted-foreground/80">
                              {d.path}
                              {d.line != null ? `:${d.line}` : ''}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}

        {dismissed.length > 0 && (
          <section>
            <button
              type="button"
              onClick={() => setDismissedOpen((o) => !o)}
              aria-expanded={dismissedOpen}
              className="sticky top-0 z-10 flex w-full items-center justify-between gap-2 border-y border-border bg-card px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
            >
              <span className="flex items-center gap-1.5">
                {dismissedOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                Dismissed
              </span>
              <span className="rounded bg-muted px-1.5 py-0.5 text-[9px]">{dismissed.length}</span>
            </button>
            {dismissedOpen && (
              <ul>
                {dismissed.map((d, i) => (
                  <li
                    key={`dismissed-${d.identity}-${i}`}
                    className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-2"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-mono text-[13px] text-muted-foreground line-through">{d.identity}</div>
                      {d.path && (
                        <div className="truncate font-mono text-[11px] text-muted-foreground/70">
                          {d.path}
                          {d.line != null ? `:${d.line}` : ''}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => onRestore(d)}
                      title="Un-dismiss — move back to the active list"
                      className="shrink-0 rounded-md border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      Restore
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

/** The main-pane detail for one inferred decision — its rendered `.tc` + actions. */
export function InferredDecisionDetail({
  d,
  busy,
  onAct,
  readOnly = false,
}: {
  d: InferredDecisionView;
  busy: boolean;
  onAct: (d: InferredDecisionView, action: 'dismiss' | 'promote') => void;
  /** PR view: review-only — Promote / Dismiss happen from the base view. */
  readOnly?: boolean;
}) {
  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="flex items-center gap-2">
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {d.kind}
        </span>
        {d.resolved && (
          <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-emerald-600 dark:text-emerald-300">
            resolved by this PR
          </span>
        )}
        {d.changed && (
          <span className="rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-blue-600 dark:text-blue-300">
            changed
          </span>
        )}
        {d.confidence && (
          <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${confidenceTone(d.confidence)}`}>
            {d.confidence} confidence
          </span>
        )}
      </div>
      <h2 className="mt-2 break-all font-mono text-base text-foreground">{d.identity}</h2>
      {d.path && (
        <div className="mt-1 font-mono text-xs text-muted-foreground">
          {d.path}
          {d.line != null ? `:${d.line}` : ''}
        </div>
      )}
      {d.reason && <p className="mt-2 text-sm text-muted-foreground">{d.reason}</p>}

      {d.tc && (
        <div className="mt-4">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Inferred contract
          </div>
          <pre className="overflow-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-xs leading-relaxed text-foreground">
            {d.tc}
          </pre>
        </div>
      )}

      {readOnly ? (
        <p className="mt-5 text-xs text-muted-foreground">
          New on this PR — review here, then Promote or Dismiss from the base branch view.
        </p>
      ) : (
        <div className="mt-5 flex items-center gap-2">
          <button
            type="button"
            onClick={() => onAct(d, 'promote')}
            disabled={busy}
            title="Document this decision in the spec and enforce it on PRs"
            className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-50"
          >
            Promote to spec
          </button>
          <button
            type="button"
            onClick={() => onAct(d, 'dismiss')}
            disabled={busy}
            className="rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
