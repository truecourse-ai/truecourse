/**
 * Verify sidebar — lists drift items reported by the verifier. Same
 * sidebar/detail split as the Spec tab: clicking a drift selects it
 * for the right pane. Presentation-only — state owned by
 * `useVerifyState` at RepoPage level.
 */

import { useState } from 'react';
import { ShieldCheck, AlertCircle, Loader2 } from 'lucide-react';
import { VerifyStats } from './VerifyStats';
import { DriftTypeBadge, driftType, humanizeKind } from './driftType';
import { EmptyState } from '@/components/ui/empty-state';
import type { ContractDrift, DriftSeverity, VerifyState } from '@/lib/api';

interface VerifyPanelProps {
  state: VerifyState | null;
  isLoading: boolean;
  error: string | null;
  activeDriftId: string | null;
  /** Open a drift in the right pane. `pinned=false` opens it as a
   * preview tab (replaces the existing preview); `pinned=true` pins it
   * as a permanent tab. Mirrors the file / contracts viewer pattern. */
  onOpenDrift: (id: string, pinned: boolean) => void;
}

const SEVERITY_ORDER: DriftSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];

const SEVERITY_TONE: Record<DriftSeverity, string> = {
  critical: 'bg-red-500/20 text-red-700 dark:text-red-300',
  high: 'bg-red-500/15 text-red-700 dark:text-red-300',
  medium: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  low: 'bg-amber-500/10 text-amber-800 dark:text-amber-200',
  info: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
};

export function VerifyPanel({
  state,
  isLoading,
  error,
  activeDriftId,
  onOpenDrift,
}: VerifyPanelProps) {
  // Filter by drift "type" (artifact kind), 'all' shows everything.
  const [typeFilter, setTypeFilter] = useState<string>('all');

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

  if (!state) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="No verify run yet"
        body={
          <>
            Click <strong>Verify</strong> in the header to compare your code
            against the generated TC contracts.
          </>
        }
      />
    );
  }

  // Drift "type" = artifact kind. Build the filter-tab list from the
  // kinds actually present, ordered by descending count (like the
  // Analysis category tabs).
  const typeCounts = new Map<string, number>();
  for (const d of state.drifts) {
    const t = driftType(d);
    typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
  }
  const presentTypes = [...typeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([t]) => t);
  // A stale filter (kind no longer present after a re-run) falls back to 'all'.
  const activeType = typeFilter !== 'all' && typeCounts.has(typeFilter) ? typeFilter : 'all';
  const visibleDrifts =
    activeType === 'all'
      ? state.drifts
      : state.drifts.filter((d) => driftType(d) === activeType);

  // Group the visible drifts by severity for stable, scannable ordering.
  const bySeverity = new Map<DriftSeverity, ContractDrift[]>();
  for (const sev of SEVERITY_ORDER) bySeverity.set(sev, []);
  for (const d of visibleDrifts) {
    bySeverity.get(d.severity)?.push(d);
  }

  return (
    <div className="flex h-full flex-col">
      <VerifyStats state={state} />
      {state.drifts.length > 0 && (
        <div className="shrink-0 border-b border-border px-3 py-2">
          <div className="flex gap-1 overflow-x-auto scrollbar-thin">
            <TypeTab
              label="All"
              count={state.drifts.length}
              active={activeType === 'all'}
              onClick={() => setTypeFilter('all')}
            />
            {presentTypes.map((t) => (
              <TypeTab
                key={t}
                label={humanizeKind(t)}
                count={typeCounts.get(t) ?? 0}
                active={activeType === t}
                onClick={() => setTypeFilter(t)}
              />
            ))}
          </div>
        </div>
      )}
      <div className="flex-1 overflow-auto">
        {state.drifts.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="No drift detected"
            body="Code matches every checked artifact in the contracts."
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

function TypeTab({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
        active
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      }`}
    >
      {label}
      <span className="ml-0.5 text-[10px] opacity-70">{count}</span>
    </button>
  );
}

