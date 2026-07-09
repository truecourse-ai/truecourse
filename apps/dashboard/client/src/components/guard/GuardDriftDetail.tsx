/**
 * The Runs view's tab-content detail for a single selected scenario. Composes the
 * claim story: the binding (doc § section + a "view in spec" jump), the failing
 * step's expected/actual, the stale/orphaned binding notes, the evidence transcript
 * (text/plain, monospace, scrollable) and the scenario YAML source — both fetched
 * with the tab and shown expanded. A passing scenario shows its last result
 * (`pass · Nms`) in place of a failure, and — when the run captured one — its own
 * evidence transcript open like a failure's (evidence for passes too). A pass from
 * an older run without a transcript renders no evidence section at all. Read-only; the
 * tab strip owns the close, and drift-vs-bug is the developer's call, never resolved here.
 */

import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, FlaskConical } from 'lucide-react';
import type { GuardScenarioResult } from '@truecourse/shared';
import { EmptyState } from '@/components/ui/empty-state';
import { HoverPopover } from '@/components/ui/hover-popover';
import * as api from '@/lib/api';
import { formatGuardDuration, shortFingerprint } from '@/lib/guard-drifts';
import { GuardStatusBadge } from './GuardStatusBadge';

const PRE =
  'mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded border border-border bg-muted/20 p-2 font-mono text-[11px] text-foreground';

const LABEL = 'mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground';

export function GuardDriftDetail({
  repoId,
  scenario,
  runId,
  onOpenSpec,
}: {
  repoId: string;
  scenario: GuardScenarioResult;
  runId: string;
  onOpenSpec: (doc: string, section: string) => void;
}) {
  const [evidence, setEvidence] = useState<string | null>(null);
  const [yaml, setYaml] = useState<string | null>(null);
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [yamlBusy, setYamlBusy] = useState(false);

  // The parent keys this component by run+scenario, so a selection change gives a
  // fresh instance (all state above resets). This guard closes the async gap: a
  // fetch in flight when the old instance unmounts must never write its (stale)
  // transcript/source into the next scenario's pane.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Any executed outcome that captured a transcript renders it — passes included
  // (evidence for passes too). A non-executed stale/orphaned or an older pass without
  // one has no evidencePath, so no evidence section renders (no placeholder noise).
  const hasEvidence = scenario.evidencePath != null;

  // Evidence + YAML render open — fetched with the tab (the reader came to read).
  useEffect(() => {
    if (!hasEvidence) return;
    setEvidenceBusy(true);
    api
      .getGuardEvidence(repoId, runId, scenario.id)
      .then((text) => {
        if (mounted.current) setEvidence(text);
      })
      .catch((e) => {
        if (mounted.current) setEvidence(e instanceof Error ? e.message : 'Evidence unavailable.');
      })
      .finally(() => {
        if (mounted.current) setEvidenceBusy(false);
      });
  }, [hasEvidence, repoId, runId, scenario.id]);

  useEffect(() => {
    setYamlBusy(true);
    api
      .getGuardScenarioSource(repoId, scenario.id)
      .then((src) => {
        if (mounted.current) setYaml(src ? src.content : 'Scenario source not found.');
      })
      .catch((e) => {
        if (mounted.current) setYaml(e instanceof Error ? e.message : 'Source unavailable.');
      })
      .finally(() => {
        if (mounted.current) setYamlBusy(false);
      });
  }, [repoId, scenario.id]);

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex items-start gap-3 border-b border-border bg-card px-6 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <GuardStatusBadge status={scenario.outcome} />
            <span className="truncate font-mono text-[11px] text-muted-foreground">{scenario.id}</span>
            <span className="shrink-0 text-[10px] text-muted-foreground">{formatGuardDuration(scenario.durationMs)}</span>
          </div>
          <h2 className="mt-1 text-sm font-semibold text-foreground">{scenario.title}</h2>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 space-y-4 overflow-auto px-6 py-4">
        {/* Binding */}
        <div>
          <div className={LABEL}>Binding</div>
          <div className="font-mono text-sm text-foreground">{scenario.binds.doc}</div>
          <div className="text-sm leading-relaxed text-muted-foreground">§ {scenario.binds.section}</div>
          <HoverPopover align="start" content="Normalized section-text hash at authoring time">
            <code className="text-[10px] text-muted-foreground">{shortFingerprint(scenario.binds.fingerprint)}</code>
          </HoverPopover>
          <div>
            <button
              type="button"
              onClick={() => onOpenSpec(scenario.binds.doc, scenario.binds.section)}
              className="mt-1.5 inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground"
            >
              View in spec
              <ArrowUpRight className="h-3 w-3" />
            </button>
          </div>
        </div>

        {/* Last result — the positive confirmation a passing scenario shows in place of a failure. */}
        {scenario.outcome === 'pass' && (
          <div>
            <div className={LABEL}>Last result</div>
            <div className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
              pass · {formatGuardDuration(scenario.durationMs)}
            </div>
          </div>
        )}

        {/* Failing step */}
        {scenario.failure && (
          <div>
            <div className={LABEL}>
              Failed at step <span className="text-foreground">{scenario.failure.step}</span>
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Expected</span>
              <pre className={PRE}>{scenario.failure.expected}</pre>
            </div>
            <div className="mt-1">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Actual</span>
              <pre className={PRE}>{scenario.failure.actual}</pre>
            </div>
          </div>
        )}

        {scenario.remappedTo && (
          <div className="text-sm leading-relaxed text-muted-foreground">
            Section re-anchored to <code className="text-foreground">{scenario.remappedTo}</code>
          </div>
        )}
        {scenario.currentFingerprint && (
          <div className="text-sm leading-relaxed text-muted-foreground">Section text changed since generation (stale binding).</div>
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

        {/* YAML source — always expanded. */}
        <div>
          <div className={LABEL}>Scenario source</div>
          <pre className={PRE} aria-label="scenario source">
            {yamlBusy ? 'Loading source…' : yaml ?? ''}
          </pre>
        </div>

        {(scenario.outcome === 'stale' || scenario.outcome === 'orphaned') && !scenario.failure && (
          <EmptyState
            icon={FlaskConical}
            title={scenario.outcome === 'stale' ? 'Stale binding' : 'Orphaned scenario'}
            body={
              scenario.outcome === 'stale'
                ? 'The bound section was edited since this scenario was written — regenerate to re-anchor it.'
                : 'The bound section no longer exists in the spec — the scenario was not run.'
            }
          />
        )}
      </div>
    </div>
  );
}
