/**
 * Compact stats strip shown at the top of the Spec sidebar panel.
 * Replaces the previous section-wide toolbar so global Spec actions
 * (Refresh / Accept all / Apply) can live in the page Header while
 * the read-only counters stay inside the left panel.
 */

import { useSpec } from './SpecContext';

export function SpecStats({
  diff,
}: {
  /** PR / Git-Diff mode: show the delta counts in the same strip instead of base totals. */
  diff?: { added: number; removed: number; conflicts: number };
} = {}) {
  const { scan } = useSpec();
  if (diff) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-border bg-card/40 px-3 py-1.5 text-[11px] text-muted-foreground">
        <Stat label="Added" value={diff.added} />
        <Stat label="Removed" value={diff.removed} />
        {diff.conflicts > 0 && <Stat label="New conflicts" value={diff.conflicts} highlight />}
      </div>
    );
  }
  if (!scan) return null;
  const hasOpen = scan.openConflicts.length > 0;
  const scannedAt = scan.scannedAt;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-border bg-card/40 px-3 py-1.5 text-[11px] text-muted-foreground">
      <Stat label="Docs" value={scan.docsScanned} />
      <Stat label="Claims" value={scan.claimsExtracted} />
      <Stat label="Resolved" value={scan.resolved + scan.decided} />
      <Stat label="Open" value={scan.openConflicts.length} highlight={hasOpen} />
      {scannedAt && (
        <span title={new Date(scannedAt).toLocaleString()}>
          · {formatRelativeTime(scannedAt)}
        </span>
      )}
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
      <span className={`font-semibold ${highlight ? 'text-amber-700 dark:text-amber-300' : 'text-foreground'}`}>
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
