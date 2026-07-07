/**
 * The Runs view's RIGHT detail pane for a single selected scenario. Composes the
 * claim story: the binding (doc § section + a "view in spec" jump), the failing
 * step's expected/actual, the stale/orphaned binding notes, and — on demand — the
 * evidence transcript (text/plain, monospace, scrollable) and the scenario YAML
 * source. A passing scenario shows its last result (`pass · Nms`) instead of a
 * failure; passes have no evidence. Read-only; drift-vs-bug is the developer's
 * call, never resolved here.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, FlaskConical, X } from 'lucide-react';
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
  onClose,
  onOpenSpec,
}: {
  repoId: string;
  scenario: GuardScenarioResult;
  runId: string;
  onClose: () => void;
  onOpenSpec: (doc: string, section: string) => void;
}) {
  const [evidence, setEvidence] = useState<string | null>(null);
  const [yaml, setYaml] = useState<string | null>(null);
  const [showEvidence, setShowEvidence] = useState(false);
  const [showYaml, setShowYaml] = useState(false);
  const [busy, setBusy] = useState<'evidence' | 'yaml' | null>(null);

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

  const toggleEvidence = useCallback(async () => {
    if (showEvidence) {
      setShowEvidence(false);
      return;
    }
    setShowEvidence(true);
    if (evidence == null) {
      setBusy('evidence');
      try {
        const text = await api.getGuardEvidence(repoId, runId, scenario.id);
        if (mounted.current) setEvidence(text);
      } catch (e) {
        if (mounted.current) setEvidence(e instanceof Error ? e.message : 'Evidence unavailable.');
      } finally {
        if (mounted.current) setBusy(null);
      }
    }
  }, [showEvidence, evidence, repoId, runId, scenario.id]);

  const toggleYaml = useCallback(async () => {
    if (showYaml) {
      setShowYaml(false);
      return;
    }
    setShowYaml(true);
    if (yaml == null) {
      setBusy('yaml');
      try {
        const src = await api.getGuardScenarioSource(repoId, scenario.id);
        if (mounted.current) setYaml(src ? src.content : 'Scenario source not found.');
      } catch (e) {
        if (mounted.current) setYaml(e instanceof Error ? e.message : 'Source unavailable.');
      } finally {
        if (mounted.current) setBusy(null);
      }
    }
  }, [showYaml, yaml, repoId, scenario.id]);

  const failed = scenario.outcome === 'fail' || scenario.outcome === 'error';
  const hasEvidence = failed && scenario.evidencePath != null;

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-border bg-card px-6 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <GuardStatusBadge status={scenario.outcome} />
            <span className="truncate font-mono text-[11px] text-muted-foreground">{scenario.id}</span>
            <span className="shrink-0 text-[10px] text-muted-foreground">{formatGuardDuration(scenario.durationMs)}</span>
          </div>
          <h2 className="mt-1 text-sm font-semibold text-foreground">{scenario.title}</h2>
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

        {/* Evidence + source */}
        <div className="flex flex-wrap gap-2">
          {hasEvidence && (
            <button
              type="button"
              onClick={() => void toggleEvidence()}
              className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground"
            >
              {showEvidence ? 'Hide evidence' : 'View evidence'}
            </button>
          )}
          <button
            type="button"
            onClick={() => void toggleYaml()}
            className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground"
          >
            {showYaml ? 'Hide YAML' : 'View YAML source'}
          </button>
        </div>

        {hasEvidence && showEvidence && (
          <pre className={PRE} aria-label="evidence transcript">
            {busy === 'evidence' ? 'Loading transcript…' : evidence ?? ''}
          </pre>
        )}
        {showYaml && (
          <pre className={PRE} aria-label="scenario source">
            {busy === 'yaml' ? 'Loading source…' : yaml ?? ''}
          </pre>
        )}

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
