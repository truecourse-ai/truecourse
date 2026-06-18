/**
 * Drifts column (center of the 3-column verify view): the drift list, grouped
 * by severity (Normal mode) or split into added / resolved (Git Diff mode).
 * Clicking a drift selects it for the detail column. Stats live in the left
 * column (`VerifyStatsColumn`); state is owned by `useVerifyState` in RepoPage.
 */

import { ShieldCheck, AlertCircle, Loader2, GitCompare, X } from 'lucide-react';
import { DriftTypeBadge, driftType, humanizeKind } from './driftType';
import { EmptyState } from '@/components/ui/empty-state';
import { FilterBar } from '@/components/ui/filter-bar';
import type { DriftFilters } from './VerifyStatsColumn';
import type { ContractDrift, DriftSeverity, VerifyState, VerifyDiff } from '@/lib/api';

export type DriftFilterTarget = 'severity' | 'kind' | 'file';

interface VerifyPanelProps {
  state: VerifyState | null;
  diff: VerifyDiff | null;
  /** Controlled view mode, driven by the header Normal / Git Diff toggle. */
  mode: 'current' | 'diff';
  isLoading: boolean;
  isDiffing: boolean;
  error: string | null;
  activeDriftId: string | null;
  /** Filters set by clicking the analytics charts (severity / kind / file). */
  filters: DriftFilters;
  onClearFilter: (target: DriftFilterTarget) => void;
  /** Open a drift in the right pane. `pinned=false` opens it as a
   * preview tab (replaces the existing preview); `pinned=true` pins it
   * as a permanent tab. Mirrors the file / contracts viewer pattern. */
  onOpenDrift: (id: string, pinned: boolean) => void;
  /** EE: the analytics charts are display-only on a separate tab, so the drift
   *  list gets its own severity filter here (same severity toggle). Absent in OSS,
   *  where filtering happens by clicking the adjacent charts. */
  onSetSeverity?: (s: DriftSeverity) => void;
  /** Hosted (EE): drift is computed automatically by the server-side scan; there
   * is no in-dashboard Verify button, so empty-state copy must not point at one. */
  hosted?: boolean;
}

/** Apply the analytics-driven filters (severity / kind / file) to a drift set. */
function applyFilters(drifts: ContractDrift[], f: DriftFilters): ContractDrift[] {
  return drifts.filter(
    (d) =>
      (!f.severity || d.severity === f.severity) &&
      (!f.kind || driftType(d) === f.kind) &&
      (!f.file || d.filePath === f.file),
  );
}

/**
 * "Filtered by:" chip row, mirroring analyze's ViolationsPanel: one chip per
 * active filter with a small uppercase dimension label, its value, and an X to
 * clear just that filter.
 */
function FilteredBy({
  filters,
  onClearFilter,
}: {
  filters: DriftFilters;
  onClearFilter: (target: DriftFilterTarget) => void;
}) {
  if (!filters.severity && !filters.kind && !filters.file) return null;
  return (
    <div className="mx-3 mb-3 mt-3 flex flex-wrap items-center gap-1.5 rounded-md bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
      <span className="shrink-0">Filtered by:</span>
      {filters.severity && (
        <FilterChip dimension="severity" value={filters.severity} onClear={() => onClearFilter('severity')} />
      )}
      {filters.kind && (
        <FilterChip dimension="kind" value={humanizeKind(filters.kind)} onClear={() => onClearFilter('kind')} />
      )}
      {filters.file && (
        <FilterChip
          dimension="file"
          value={filters.file.split('/').pop() || filters.file}
          title={filters.file}
          onClear={() => onClearFilter('file')}
        />
      )}
    </div>
  );
}

function FilterChip({
  dimension,
  value,
  title,
  onClear,
}: {
  dimension: string;
  value: string;
  title?: string;
  onClear: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-background/60 px-1.5 py-0.5">
      <span className="text-[10px] uppercase opacity-70">{dimension}</span>
      <span className="font-medium text-foreground truncate max-w-48" title={title ?? value}>
        {value}
      </span>
      <button onClick={onClear} className="rounded p-0.5 hover:bg-muted" title={`Clear ${dimension} filter`}>
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

const SEVERITY_ORDER: DriftSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];

const SEVERITY_TONE: Record<DriftSeverity, string> = {
  critical: 'bg-red-500/20 text-red-700 dark:text-red-300',
  high: 'bg-red-500/15 text-red-700 dark:text-red-300',
  medium: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  low: 'bg-amber-500/10 text-amber-800 dark:text-amber-200',
  info: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
};

/**
 * Severity filter for the drift list — shown in EE, where the analytics charts
 * live on a separate tab and can't filter this list. Single-select with toggle-
 * off (re-click clears); reuses the shared severity toggle. Only severities
 * actually present in the drifts are offered, each with its count.
 */
function SeverityFilterBar({
  drifts,
  active,
  onSet,
}: {
  drifts: ContractDrift[];
  active: DriftSeverity | null;
  onSet: (s: DriftSeverity) => void;
}) {
  const options = SEVERITY_ORDER.filter((sev) => drifts.some((d) => d.severity === sev)).map((sev) => ({
    key: sev,
    label: sev,
    count: drifts.filter((d) => d.severity === sev).length,
    tone: SEVERITY_TONE[sev],
  }));
  return <FilterBar label="Severity" options={options} active={active} onSelect={(k) => onSet(k as DriftSeverity)} />;
}

export function VerifyPanel({
  state,
  diff,
  mode,
  isLoading,
  isDiffing,
  error,
  activeDriftId,
  filters,
  onClearFilter,
  onOpenDrift,
  onSetSeverity,
  hosted = false,
}: VerifyPanelProps) {
  if (isLoading && !state) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-sm text-muted-foreground">
        <AlertCircle className="h-5 w-5 text-destructive" />
        <span>{error}</span>
      </div>
    );
  }

  // Diff mode (PR view / Git Diff) is self-contained — VerifyDiffView reads only
  // the diff, so render it before the no-state guard: a PR's head snapshot may
  // still be loading (or absent) while its stored diff is already available.
  if (mode === 'diff') {
    return (
      <div className="flex h-full flex-col">
        <VerifyDiffView
          diff={diff}
          isDiffing={isDiffing}
          activeDriftId={activeDriftId}
          filters={filters}
          onClearFilter={onClearFilter}
          onOpenDrift={onOpenDrift}
          onSetSeverity={onSetSeverity}
          hosted={hosted}
        />
      </div>
    );
  }

  if (!state) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="No verify run yet"
        body={
          hosted ? (
            <>
              Drift is computed automatically when your default branch is scanned.
              Results will appear here once a scan completes.
            </>
          ) : (
            <>
              Click <strong>Verify</strong> in the header to compare your code
              against the generated TC contracts.
            </>
          )
        }
      />
    );
  }

  // Apply the analytics-driven filters, then group by severity for stable,
  // scannable ordering.
  const visibleDrifts = applyFilters(state.drifts, filters);
  const bySeverity = new Map<DriftSeverity, ContractDrift[]>();
  for (const sev of SEVERITY_ORDER) bySeverity.set(sev, []);
  for (const d of visibleDrifts) {
    bySeverity.get(d.severity)?.push(d);
  }

  return (
    <div className="flex h-full flex-col">
      {onSetSeverity && (
        <SeverityFilterBar drifts={state.drifts} active={filters.severity} onSet={onSetSeverity} />
      )}
      <FilteredBy filters={filters} onClearFilter={onClearFilter} />
      <div className="flex-1 overflow-auto">
        {state.drifts.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="No drift detected"
            body="Code matches every checked artifact in the contracts."
          />
        ) : visibleDrifts.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="No drifts match the active filters"
            body="Clear the filters to see all drifts."
          />
        ) : (
          SEVERITY_ORDER.filter((sev) => (bySeverity.get(sev) ?? []).length > 0).map((sev) => (
            <Section
              key={sev}
              title={sev}
              count={(bySeverity.get(sev) ?? []).length}
              tone={SEVERITY_TONE[sev]}
            >
              {(bySeverity.get(sev) ?? []).map((d) => (
                <DriftRow
                  key={d.id}
                  drift={d}
                  active={d.id === activeDriftId}
                  onPreview={() => onOpenDrift(d.id, false)}
                  onPin={() => onOpenDrift(d.id, true)}
                />
              ))}
            </Section>
          ))
        )}
      </div>
    </div>
  );
}

function VerifyDiffView({
  diff,
  isDiffing,
  activeDriftId,
  filters,
  onClearFilter,
  onOpenDrift,
  onSetSeverity,
  hosted = false,
}: {
  diff: VerifyDiff | null;
  isDiffing: boolean;
  activeDriftId: string | null;
  filters: DriftFilters;
  onClearFilter: (target: DriftFilterTarget) => void;
  onOpenDrift: (id: string, pinned: boolean) => void;
  onSetSeverity?: (s: DriftSeverity) => void;
  hosted?: boolean;
}) {
  if (isDiffing && !diff) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!diff) {
    return (
      <EmptyState
        icon={GitCompare}
        title="No diff computed yet"
        body={
          hosted
            ? 'Drift is compared against the committed baseline automatically on each scan.'
            : "Click Verify to compare the current code's drifts against the committed baseline."
        }
      />
    );
  }
  const addedFiltered = applyFilters(diff.added, filters);
  const resolvedFiltered = applyFilters(diff.resolved, filters);
  const totalChanges = diff.added.length + diff.resolved.length;
  const shownChanges = addedFiltered.length + resolvedFiltered.length;

  // Group the changed drifts by severity — exactly like the normal list — rather
  // than splitting into added/resolved sections. The section headers always mean
  // severity; everything here is "added vs baseline" except the resolved set,
  // which is rendered struck through inline.
  const combined: Array<{ drift: ContractDrift; isResolved: boolean }> = [
    ...addedFiltered.map((d) => ({ drift: d, isResolved: false })),
    ...resolvedFiltered.map((d) => ({ drift: d, isResolved: true })),
  ];
  const bySeverity = new Map<DriftSeverity, Array<{ drift: ContractDrift; isResolved: boolean }>>();
  for (const sev of SEVERITY_ORDER) bySeverity.set(sev, []);
  for (const item of combined) bySeverity.get(item.drift.severity)?.push(item);

  return (
    <div className="flex h-full flex-col">
      {onSetSeverity && (
        <SeverityFilterBar
          drifts={[...diff.added, ...diff.resolved]}
          active={filters.severity}
          onSet={onSetSeverity}
        />
      )}
      <FilteredBy filters={filters} onClearFilter={onClearFilter} />
      <div className="flex-1 overflow-auto">
        {totalChanges === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="No change vs baseline"
            body="The current code drifts match the committed baseline exactly."
          />
        ) : shownChanges === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="No changes match the active filters"
            body="Clear the filters to see all added and resolved drifts."
          />
        ) : (
          SEVERITY_ORDER.filter((sev) => (bySeverity.get(sev) ?? []).length > 0).map((sev) => (
            <Section
              key={sev}
              title={sev}
              count={(bySeverity.get(sev) ?? []).length}
              tone={SEVERITY_TONE[sev]}
            >
              {(bySeverity.get(sev) ?? []).map(({ drift, isResolved }) => (
                <DiffRow
                  key={drift.id}
                  drift={drift}
                  isResolved={isResolved}
                  active={drift.id === activeDriftId}
                  onPreview={() => onOpenDrift(drift.id, false)}
                  onPin={() => onOpenDrift(drift.id, true)}
                />
              ))}
            </Section>
          ))
        )}
      </div>
    </div>
  );
}

function DiffRow({
  drift,
  isResolved = false,
  active,
  onPreview,
  onPin,
}: {
  drift: ContractDrift;
  isResolved?: boolean;
  active: boolean;
  onPreview: () => void;
  onPin: () => void;
}) {
  const identity = drift.artifactRef?.identity ?? '(no ref)';
  const loc =
    drift.filePath != null
      ? `${drift.filePath.split('/').slice(-1)[0]}${drift.lineStart != null ? `:${drift.lineStart}` : ''}`
      : '';
  return (
    <button
      type="button"
      onClick={onPreview}
      onDoubleClick={onPin}
      title="Click to preview, double-click to pin"
      className={`flex w-full flex-col items-start gap-0.5 border-b border-border/60 px-4 py-2 text-left text-xs transition-colors ${
        active ? 'bg-primary/10 text-foreground' : 'hover:bg-muted/40'
      } ${isResolved ? 'opacity-60' : ''}`}
    >
      <div className="flex w-full items-center gap-2">
        <DriftTypeBadge kind={driftType(drift)} />
        <span className="font-mono text-[11px] text-muted-foreground truncate min-w-0 flex-1">{identity}</span>
        {loc && <span className="shrink-0 text-[10px] text-muted-foreground">{loc}</span>}
      </div>
      <div className={`text-foreground line-clamp-2 leading-snug ${isResolved ? 'line-through' : ''}`}>{drift.obligationKey}</div>
    </button>
  );
}

function Section({
  title,
  count,
  tone,
  children,
}: {
  title: string;
  count: number;
  tone: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="sticky top-0 z-10 bg-background">
        <div
          className={`flex items-center justify-between border-b border-border px-4 py-1.5 text-[10px] uppercase tracking-wider ${tone}`}
        >
          <span>{title}</span>
          <span>{count}</span>
        </div>
      </div>
      {children}
    </div>
  );
}

function DriftRow({
  drift,
  active,
  onPreview,
  onPin,
}: {
  drift: ContractDrift;
  active: boolean;
  onPreview: () => void;
  onPin: () => void;
}) {
  const identity = drift.artifactRef?.identity ?? '(no ref)';
  return (
    <button
      type="button"
      onClick={onPreview}
      onDoubleClick={onPin}
      title="Click to preview, double-click to pin"
      className={`flex w-full flex-col items-start gap-0.5 border-b border-border/60 px-4 py-2 text-left text-xs transition-colors ${
        active ? 'bg-primary/10 text-foreground' : 'hover:bg-muted/40'
      }`}
    >
      <div className="flex w-full items-center gap-2">
        <DriftTypeBadge kind={driftType(drift)} />
        <span className="font-mono text-[11px] text-muted-foreground truncate min-w-0 flex-1">
          {identity}
        </span>
      </div>
      <div className="text-foreground line-clamp-2 leading-snug">{drift.obligationKey}</div>
    </button>
  );
}


