/**
 * Verify sidebar — lists drift items reported by the verifier. Same
 * sidebar/detail split as the Spec tab: clicking a drift selects it
 * for the right pane. Presentation-only — state owned by
 * `useVerifyState` at RepoPage level.
 */

import { useState } from 'react';
import { ShieldCheck, AlertCircle, Loader2, GitCompare } from 'lucide-react';
import { VerifyStats } from './VerifyStats';
import { DriftTypeBadge, driftType, humanizeKind } from './driftType';
import { EmptyState } from '@/components/ui/empty-state';
import type { ContractDrift, DriftSeverity, VerifyState, VerifyDiff } from '@/lib/api';

interface VerifyPanelProps {
  state: VerifyState | null;
  diff: VerifyDiff | null;
  isLoading: boolean;
  isDiffing: boolean;
  error: string | null;
  activeDriftId: string | null;
  /** Compute a fresh diff against the committed LATEST baseline. */
  onRunDiff: () => void;
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
  diff,
  isLoading,
  isDiffing,
  error,
  activeDriftId,
  onRunDiff,
  onOpenDrift,
}: VerifyPanelProps) {
  // Filter by drift "type" (artifact kind), 'all' shows everything.
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [mode, setMode] = useState<'current' | 'diff'>('current');

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
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-2">
        <ModeTab label="Current" active={mode === 'current'} onClick={() => setMode('current')} />
        <ModeTab label="Diff vs baseline" active={mode === 'diff'} onClick={() => setMode('diff')} />
        <button
          type="button"
          onClick={onRunDiff}
          disabled={isDiffing}
          title="Recompute drift diff against the committed LATEST baseline"
          className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          {isDiffing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitCompare className="h-3.5 w-3.5" />}
          {diff ? 'Recompute' : 'Compute diff'}
        </button>
      </div>
      {mode === 'diff' ? (
        <VerifyDiffView diff={diff} isDiffing={isDiffing} />
      ) : (
      <>
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
      </>
      )}
    </div>
  );
}

function ModeTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
        active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      }`}
    >
      {label}
    </button>
  );
}

function VerifyDiffView({ diff, isDiffing }: { diff: VerifyDiff | null; isDiffing: boolean }) {
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
        body="Click Compute diff to compare the current code's drifts against the committed LATEST baseline."
      />
    );
  }
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 gap-4 border-b border-border px-4 py-2 text-xs">
        <span className="text-red-600 dark:text-red-400">+{diff.summary.added} added</span>
        <span className="text-green-600 dark:text-green-400">−{diff.summary.resolved} resolved</span>
        <span className="text-muted-foreground">{diff.summary.unchanged} unchanged</span>
      </div>
      <div className="flex-1 overflow-auto">
        {diff.added.length === 0 && diff.resolved.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="No change vs baseline"
            body="The current code drifts match the committed baseline exactly."
          />
        ) : (
          <>
            <DiffSection title="added" count={diff.added.length} tone="bg-red-500/15 text-red-700 dark:text-red-300">
              {diff.added.map((d) => <DiffRow key={d.id} drift={d} />)}
            </DiffSection>
            <DiffSection title="resolved" count={diff.resolved.length} tone="bg-green-500/15 text-green-700 dark:text-green-300">
              {diff.resolved.map((d) => <DiffRow key={d.id} drift={d} />)}
            </DiffSection>
          </>
        )}
      </div>
    </div>
  );
}

function DiffSection({ title, count, tone, children }: { title: string; count: number; tone: string; children: React.ReactNode }) {
  if (count === 0) return null;
  return (
    <div>
      <div className="sticky top-0 z-10 bg-background">
        <div className={`flex items-center justify-between border-b border-border px-4 py-1.5 text-[10px] uppercase tracking-wider ${tone}`}>
          <span>{title}</span>
          <span>{count}</span>
        </div>
      </div>
      {children}
    </div>
  );
}

function DiffRow({ drift }: { drift: ContractDrift }) {
  const identity = drift.artifactRef?.identity ?? '(no ref)';
  const loc =
    drift.filePath != null
      ? `${drift.filePath.split('/').slice(-1)[0]}${drift.lineStart != null ? `:${drift.lineStart}` : ''}`
      : '';
  return (
    <div className="flex w-full flex-col items-start gap-0.5 border-b border-border/60 px-4 py-2 text-left text-xs">
      <div className="flex w-full items-center gap-2">
        <DriftTypeBadge kind={driftType(drift)} />
        <span className="font-mono text-[11px] text-muted-foreground truncate min-w-0 flex-1">{identity}</span>
        {loc && <span className="shrink-0 text-[10px] text-muted-foreground">{loc}</span>}
      </div>
      <div className="text-foreground line-clamp-2 leading-snug">{drift.obligationKey}</div>
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

