/**
 * Verify sidebar — lists drift items reported by the verifier. Same
 * sidebar/detail split as the Spec tab: clicking a drift selects it
 * for the right pane. Presentation-only — state owned by
 * `useVerifyState` at RepoGraphPage level.
 */

import { ShieldCheck, AlertCircle, Loader2 } from 'lucide-react';
import { VerifyStats } from './VerifyStats';
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
  critical: 'bg-red-500/20 text-red-300',
  high: 'bg-red-500/15 text-red-300',
  medium: 'bg-amber-500/15 text-amber-300',
  low: 'bg-amber-500/10 text-amber-200',
  info: 'bg-blue-500/10 text-blue-300',
};

export function VerifyPanel({
  state,
  isLoading,
  error,
  activeDriftId,
  onOpenDrift,
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

  // Group drifts by severity for stable, scannable ordering.
  const bySeverity = new Map<DriftSeverity, ContractDrift[]>();
  for (const sev of SEVERITY_ORDER) bySeverity.set(sev, []);
  for (const d of state.drifts) {
    bySeverity.get(d.severity)?.push(d);
  }

  return (
    <div className="flex h-full flex-col">
      <VerifyStats state={state} />
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
  const artifact = drift.artifactRef
    ? `${drift.artifactRef.kind}:${drift.artifactRef.identity}`
    : '(no ref)';
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
        <span className="font-mono text-[11px] text-muted-foreground truncate min-w-0 flex-1">
          {artifact}
        </span>
      </div>
      <div className="text-foreground line-clamp-2 leading-snug">{drift.obligationKey}</div>
    </button>
  );
}

