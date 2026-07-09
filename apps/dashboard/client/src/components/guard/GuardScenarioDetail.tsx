/**
 * A scenario tab's MAIN-PANE detail (the GuardDriftDetail analog for the
 * Scenarios inventory). Composes the full scenario story: the header (last-run
 * outcome badge, id, duration, hand-written chip, title), the binding
 * (doc § section + a "view in spec" jump), the last result — failing step's
 * expected/actual, stale/orphaned binding notes, or the "never run" hint — the
 * evidence transcript (monospace, scrollable, fetched with the tab), and the YAML
 * source (it IS the scenario). Both render open. Read-only; the tab strip owns the
 * close.
 */

import { useEffect, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { HoverPopover } from '@/components/ui/hover-popover';
import * as api from '@/lib/api';
import { formatGuardDuration } from '@/lib/guard-drifts';
import { guardRowStatus, type GuardScenarioRowData } from '@/hooks/useGuardScenarios';
import { GuardStatusBadge } from './GuardStatusBadge';

const PRE =
  'mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded border border-border bg-muted/20 p-2 font-mono text-[11px] text-foreground';
const LABEL = 'mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground';

export function GuardScenarioDetail({
  repoId,
  row,
  runId,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for RepoPage's wiring; the tab strip owns the close now (unused, clean up later)
  onClose,
  onOpenSpec,
}: {
  repoId: string;
  row: GuardScenarioRowData;
  /** The run the row's outcome was joined from (for evidence fetches); null when never run. */
  runId: string | null;
  /** Unused — the tab strip's X is the only close. Kept for the RepoPage caller. */
  onClose: () => void;
  onOpenSpec: (doc: string, section: string) => void;
}) {
  const [yaml, setYaml] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<string | null>(null);
  const [evidenceBusy, setEvidenceBusy] = useState(false);

  const result = row.lastResult;
  // Any executed outcome that captured a transcript renders it — passes included
  // (evidence for passes too). A non-executed stale/orphaned or an older pass
  // without one has no evidencePath, so no evidence section renders.
  const hasEvidence = result?.evidencePath != null && runId != null;

  // The YAML source is the scenario — load it with the tab.
  useEffect(() => {
    let cancelled = false;
    setYaml(null);
    api
      .getGuardScenarioSource(repoId, row.id)
      .then((src) => {
        if (!cancelled) setYaml(src ? src.content : 'Scenario source not found.');
      })
      .catch((e) => {
        if (!cancelled) setYaml(e instanceof Error ? e.message : 'Source unavailable.');
      });
    return () => {
      cancelled = true;
    };
  }, [repoId, row.id]);

  // The evidence transcript — fetched with the tab and shown expanded (the reader
  // came to read it). The `cancelled` guard closes the async gap so a stale fetch
  // never writes into the next scenario's pane.
  useEffect(() => {
    if (!hasEvidence || runId == null) return;
    let cancelled = false;
    setEvidence(null);
    setEvidenceBusy(true);
    api
      .getGuardEvidence(repoId, runId, row.id)
      .then((text) => {
        if (!cancelled) setEvidence(text);
      })
      .catch((e) => {
        if (!cancelled) setEvidence(e instanceof Error ? e.message : 'Evidence unavailable.');
      })
      .finally(() => {
        if (!cancelled) setEvidenceBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [hasEvidence, repoId, runId, row.id]);

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex items-start gap-3 border-b border-border bg-card px-6 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <GuardStatusBadge status={guardRowStatus(row)} className="shrink-0" />
            {row.handWritten && (
              <HoverPopover content="Hand-written scenario — no manifest section authored it.">
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  hand-written
                </span>
              </HoverPopover>
            )}
            <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">{row.id}</span>
            {result && (
              <span className="shrink-0 text-[10px] text-muted-foreground">{formatGuardDuration(result.durationMs)}</span>
            )}
          </div>
          <h2 className="mt-1 text-sm font-semibold text-foreground">{row.title}</h2>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 space-y-4 overflow-auto px-6 py-4">
        {/* Binding */}
        <div>
          <div className={LABEL}>Binding</div>
          <div className="break-all font-mono text-sm text-foreground">{row.doc}</div>
          <div className="break-all text-sm leading-relaxed text-muted-foreground">§ {row.anchor}</div>
          <div>
            <button
              type="button"
              onClick={() => onOpenSpec(row.doc, row.anchor)}
              className="mt-1.5 inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground"
            >
              View in spec
              <ArrowUpRight className="h-3 w-3" />
            </button>
          </div>
        </div>

        {/* Last result */}
        {result?.failure && (
          <div>
            <div className={LABEL}>
              Failed at step <span className="text-foreground">{result.failure.step}</span>
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Expected</span>
              <pre className={PRE}>{result.failure.expected}</pre>
            </div>
            <div className="mt-1">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Actual</span>
              <pre className={PRE}>{result.failure.actual}</pre>
            </div>
          </div>
        )}
        {result?.outcome === 'orphaned' && (
          <div className="text-sm leading-relaxed text-muted-foreground">
            The bound section no longer exists in the doc — this guard is orphaned.
          </div>
        )}
        {result?.currentFingerprint && (
          <div className="text-sm leading-relaxed text-muted-foreground">
            Section text changed since generation (stale binding).
          </div>
        )}
        {!result && (
          <div className="text-sm leading-relaxed text-muted-foreground">
            No result in the last run — run{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">truecourse guard run</code> to test it.
          </div>
        )}

        {/* Evidence — the run transcript from disk (pass or fail), always expanded. */}
        {hasEvidence && (
          <div>
            <div className={LABEL}>Evidence</div>
            <pre className={PRE} aria-label="evidence transcript">
              {evidenceBusy ? 'Loading transcript…' : evidence ?? ''}
            </pre>
          </div>
        )}

        {/* YAML source */}
        <div>
          <div className={LABEL}>Scenario source</div>
          <pre className={PRE} aria-label="scenario source">
            {yaml ?? 'Loading source…'}
          </pre>
        </div>
      </div>
    </div>
  );
}
