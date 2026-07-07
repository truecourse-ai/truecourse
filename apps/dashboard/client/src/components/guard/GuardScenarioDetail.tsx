/**
 * A scenario tab's MAIN-PANE detail (the GuardDriftDetail analog for the
 * Scenarios inventory). Composes the full scenario story: the header (last-run
 * outcome badge, id, duration, hand-written chip, title, close), the binding
 * (doc § section + a "view in spec" jump), the last result — failing step's
 * expected/actual, stale/orphaned binding notes, or the "never run" hint — the
 * YAML source (loaded eagerly; it IS the scenario), and the on-demand evidence
 * transcript (monospace, scrollable). Read-only.
 */

import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, X } from 'lucide-react';
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
  onClose,
  onOpenSpec,
}: {
  repoId: string;
  row: GuardScenarioRowData;
  /** The run the row's outcome was joined from (for evidence fetches); null when never run. */
  runId: string | null;
  onClose: () => void;
  onOpenSpec: (doc: string, section: string) => void;
}) {
  const [yaml, setYaml] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<string | null>(null);
  const [showEvidence, setShowEvidence] = useState(false);
  const [busy, setBusy] = useState<'evidence' | null>(null);

  const result = row.lastResult;
  const failed = result?.outcome === 'fail' || result?.outcome === 'error';
  const hasEvidence = failed && result?.evidencePath != null && runId != null;

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

  const toggleEvidence = useCallback(async () => {
    if (showEvidence) {
      setShowEvidence(false);
      return;
    }
    setShowEvidence(true);
    if (evidence == null && runId) {
      setBusy('evidence');
      try {
        setEvidence(await api.getGuardEvidence(repoId, runId, row.id));
      } catch (e) {
        setEvidence(e instanceof Error ? e.message : 'Evidence unavailable.');
      } finally {
        setBusy(null);
      }
    }
  }, [showEvidence, evidence, runId, repoId, row.id]);

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-border bg-card px-6 py-4">
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
        <button
          type="button"
          onClick={onClose}
          aria-label="Close scenario"
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
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

        {/* Evidence (on demand) */}
        {hasEvidence && (
          <div>
            <button
              type="button"
              onClick={() => void toggleEvidence()}
              className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground"
            >
              {showEvidence ? 'Hide evidence' : 'View evidence'}
            </button>
            {showEvidence && (
              <pre className={PRE} aria-label="evidence transcript">
                {busy === 'evidence' ? 'Loading transcript…' : evidence ?? ''}
              </pre>
            )}
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
