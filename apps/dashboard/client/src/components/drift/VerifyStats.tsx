/**
 * Compact stats strip shown at the top of the Verify sidebar panel.
 * Mirror of `SpecStats`. The Run/Re-run verify button lives in the
 * page Header.
 */

import type { VerifyState } from '@/lib/api';

interface VerifyStatsProps {
  state: VerifyState;
}

export function VerifyStats({ state }: VerifyStatsProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-border bg-card/40 px-3 py-1.5 text-[11px] text-muted-foreground">
      <Stat label="Artifacts" value={state.artifactCount} />
      <Stat label="Operations" value={state.extractedOperationCount} />
      <Stat
        label="Drifts"
        value={state.drifts.length}
        highlight={state.drifts.length > 0}
      />
      <span title={new Date(state.verifiedAt).toLocaleString()}>
        · {formatRelativeTime(state.verifiedAt)}
      </span>
    </div>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <span>
      <span className={`font-semibold ${highlight ? 'text-amber-300' : 'text-foreground'}`}>
        {value}
      </span>{' '}
      <span className="uppercase tracking-wider">{label}</span>
    </span>
  );
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffSec = Math.round((Date.now() - then) / 1000);
  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}
