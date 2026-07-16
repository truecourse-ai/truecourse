/**
 * The section detail side panel — opened by clicking a statused section. Tells
 * the claim-level story: the section's status + reason, then its scenarios with
 * last outcomes. Failing rows expose their failure detail; every EXECUTED row with
 * a captured transcript (pass or fail) offers an evidence link that fetches it
 * (text/plain, monospace, scrollable); every row can
 * reveal its YAML source. Rows are previewable (single-click preview,
 * double-click pin), with inline actions stopping propagation.
 *
 * An unsettled section (status `finding` / `held` / `authoring-error`) lists
 * EVERYTHING bound to it: its birth findings (red rows, expandable to expected →
 * actual), its ready-but-held scenarios (amber rows), and its deduped authoring
 * errors (red rows with attempt counts) — the all-or-nothing persist withheld the
 * scenarios, so no committed scenario exists to list otherwise. On `finding`/`held`
 * the authoring errors ride along as blocker context; on `authoring-error` they are
 * the section's sole record.
 *
 * When the section has no run results — a guarded section with no run yet, or a
 * coverage gap (untestable / driver-not-yet / blocked-on) — the pane explains
 * that with an EmptyState instead of an empty list.
 */

import { useCallback, useState } from 'react';
import { FlaskConical, PlayCircle, X } from 'lucide-react';
import type { GuardSectionAuthoringError, GuardSectionCoverage, GuardSectionFinding, GuardSectionHeldScenario, GuardSectionScenario } from '@truecourse/shared';
import { EmptyState } from '@/components/ui/empty-state';
import { HoverPopover } from '@/components/ui/hover-popover';
import * as api from '@/lib/api';
import { guardStatusMeta } from '@/lib/guard-status';
import { GuardStatusBadge } from './GuardStatusBadge';
import { GuardFindingBadge } from './GuardFindingBadge';
import { GuardHeldBadge } from './GuardHeldBadge';

const OUTCOME_TEXT: Record<string, string> = {
  pass: 'text-emerald-600 dark:text-emerald-400',
  fail: 'text-red-600 dark:text-red-400',
  error: 'text-red-600 dark:text-red-400',
  stale: 'text-amber-600 dark:text-amber-400',
  orphaned: 'text-amber-600 dark:text-amber-400',
};

const PRE = 'mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-all rounded border border-border bg-muted/20 p-2 font-mono text-[11px] text-foreground';

/** One scenario result row — previewable, with on-demand evidence + YAML. */
function GuardScenarioRow({
  repoId,
  runId,
  scenario,
  expanded,
  onClick,
  onDoubleClick,
}: {
  repoId: string;
  runId: string | null;
  scenario: GuardSectionScenario;
  expanded: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
}) {
  const [evidence, setEvidence] = useState<string | null>(null);
  const [yaml, setYaml] = useState<string | null>(null);
  const [showEvidence, setShowEvidence] = useState(false);
  const [showYaml, setShowYaml] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const toggleEvidence = useCallback(async () => {
    if (showEvidence) {
      setShowEvidence(false);
      return;
    }
    setShowEvidence(true);
    if (evidence == null && runId) {
      setBusy('evidence');
      try {
        setEvidence(await api.getGuardEvidence(repoId, runId, scenario.id));
      } catch (e) {
        setEvidence(e instanceof Error ? e.message : 'Evidence unavailable.');
      } finally {
        setBusy(null);
      }
    }
  }, [showEvidence, evidence, runId, repoId, scenario.id]);

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
        setYaml(src ? src.content : 'Scenario source not found.');
      } catch (e) {
        setYaml(e instanceof Error ? e.message : 'Source unavailable.');
      } finally {
        setBusy(null);
      }
    }
  }, [showYaml, yaml, repoId, scenario.id]);

  // Any executed outcome that captured a transcript offers it — passes included
  // (evidence for passes too). A non-executed stale/orphaned or an older pass
  // without one has no evidencePath, so no evidence affordance renders.
  const hasEvidence = scenario.evidencePath != null && runId != null;

  return (
    <div className="border-b border-border/60">
      <button
        type="button"
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        className="flex w-full flex-col gap-0.5 px-3 py-2 text-left transition-colors hover:bg-muted/40"
      >
        <div className="flex items-center gap-2">
          <span className={`text-[11px] font-semibold uppercase tracking-wide ${OUTCOME_TEXT[scenario.outcome] ?? 'text-muted-foreground'}`}>
            {scenario.outcome}
          </span>
          <span className="truncate text-[11px] text-muted-foreground">{scenario.id}</span>
          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{Math.round(scenario.durationMs)}ms</span>
        </div>
        <span className="text-[13px] text-foreground">{scenario.title}</span>
      </button>

      {expanded && (
        <div className="px-3 pb-2">
          {scenario.failure && (
            <div className="mb-1 text-xs">
              <div className="text-muted-foreground">
                Failed at step <span className="font-medium text-foreground">{scenario.failure.step}</span>
              </div>
              <div className="mt-1 grid gap-1">
                <div>
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Expected</span>
                  <pre className={PRE}>{scenario.failure.expected}</pre>
                </div>
                <div>
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Actual</span>
                  <pre className={PRE}>{scenario.failure.actual}</pre>
                </div>
              </div>
            </div>
          )}
          {scenario.remappedTo && (
            <div className="mb-1 text-xs text-muted-foreground">Section re-anchored to <code className="text-foreground">{scenario.remappedTo}</code></div>
          )}
          {scenario.currentFingerprint && (
            <div className="mb-1 text-xs text-muted-foreground">Section text changed since generation (stale binding).</div>
          )}

          <div className="mt-1 flex flex-wrap gap-2">
            {hasEvidence && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void toggleEvidence();
                }}
                className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground"
              >
                {showEvidence ? 'Hide evidence' : 'View evidence'}
              </button>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void toggleYaml();
              }}
              className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground"
            >
              {showYaml ? 'Hide YAML' : 'View YAML source'}
            </button>
          </div>

          {showEvidence && (
            <pre className={PRE} aria-label="evidence transcript">
              {busy === 'evidence' ? 'Loading transcript…' : evidence ?? ''}
            </pre>
          )}
          {showYaml && (
            <pre className={PRE} aria-label="scenario source">
              {busy === 'yaml' ? 'Loading source…' : yaml ?? ''}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

/** A bare scenario id (no run result) — offers only its YAML source. */
function GuardScenarioIdRow({ repoId, id }: { repoId: string; id: string }) {
  const [yaml, setYaml] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  const toggle = useCallback(async () => {
    if (show) {
      setShow(false);
      return;
    }
    setShow(true);
    if (yaml == null) {
      setBusy(true);
      try {
        const src = await api.getGuardScenarioSource(repoId, id);
        setYaml(src ? src.content : 'Scenario source not found.');
      } catch (e) {
        setYaml(e instanceof Error ? e.message : 'Source unavailable.');
      } finally {
        setBusy(false);
      }
    }
  }, [show, yaml, repoId, id]);

  return (
    <div className="border-b border-border/60 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="truncate text-[13px] text-foreground">{id}</span>
        <button
          type="button"
          onClick={toggle}
          className="ml-auto shrink-0 rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground"
        >
          {show ? 'Hide YAML' : 'YAML'}
        </button>
      </div>
      {show && <pre className={PRE} aria-label="scenario source">{busy ? 'Loading source…' : yaml ?? ''}</pre>}
    </div>
  );
}

/** One birth finding bound to the section — expandable to its expected → actual. */
function GuardSectionFindingRow({
  finding,
  expanded,
  onClick,
  onDoubleClick,
}: {
  finding: GuardSectionFinding;
  expanded: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
}) {
  return (
    <div className="border-b border-border/60">
      <button
        type="button"
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        className="flex w-full flex-col gap-0.5 px-3 py-2 text-left transition-colors hover:bg-muted/40"
      >
        <div className="flex items-center gap-2">
          <GuardFindingBadge compact />
          {finding.kind === 'fidelity' && (
            <HoverPopover content="The scenario passed birth but the fidelity reviewer judged it does not truly verify its section's claim.">
              <span className="shrink-0 rounded bg-muted px-1 py-0 text-[9px] font-medium text-muted-foreground">fidelity</span>
            </HoverPopover>
          )}
          <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">step {finding.step}</span>
        </div>
        <span className="text-[13px] text-foreground">{finding.title}</span>
      </button>
      {expanded && (
        <div className="px-3 pb-2 text-xs">
          <div className="grid gap-1">
            <div>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Expected</span>
              <pre className={PRE}>{finding.expected}</pre>
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Actual</span>
              <pre className={PRE}>{finding.actual}</pre>
            </div>
          </div>
          <div className="mt-1.5 text-[11px] text-muted-foreground">
            Decide in the Scenarios tab: dismiss the claim, or fix the drift and re-generate.
          </div>
        </div>
      )}
    </div>
  );
}

/** One ready-but-held scenario — birth-passed work the unsettled section withheld. */
function GuardSectionHeldRow({ scenario }: { scenario: GuardSectionHeldScenario }) {
  return (
    <div className="border-b border-border/60 px-3 py-2">
      <div className="flex items-center gap-2">
        <GuardHeldBadge compact />
        <span className="ml-auto min-w-0 truncate font-mono text-[11px] text-muted-foreground">{scenario.id}</span>
      </div>
      <span className="mt-0.5 block text-[13px] text-foreground">{scenario.title}</span>
    </div>
  );
}

/** One deduped authoring error — the message plus how many attempts produced it. */
function GuardAuthoringErrorRow({ error }: { error: GuardSectionAuthoringError }) {
  return (
    <div className="border-b border-border/60 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="inline-flex shrink-0 items-center rounded border border-red-500/40 px-1 py-0 text-[9px] font-medium uppercase tracking-wider text-red-600 dark:text-red-400">
          authoring error
        </span>
        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
          {error.attempts} attempt{error.attempts === 1 ? '' : 's'}
        </span>
      </div>
      <pre className={PRE}>{error.message}</pre>
    </div>
  );
}

export function GuardSectionDetail({
  repoId,
  section,
  runId,
  hasRun,
  onClose,
}: {
  repoId: string;
  section: GuardSectionCoverage;
  runId: string | null;
  hasRun: boolean;
  onClose: () => void;
}) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [pinned, setPinned] = useState<Set<string>>(new Set());

  const meta = guardStatusMeta(section.status);
  const togglePin = (id: string) =>
    setPinned((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const findings = section.findings ?? [];
  const heldScenarios = section.heldScenarios ?? [];
  const authoringErrors = section.authoringErrors ?? [];
  const hasUnsettled = findings.length > 0 || heldScenarios.length > 0 || authoringErrors.length > 0;
  const isRunOutcome = section.scenarios.length > 0;
  const isGuardedNoRun = !isRunOutcome && section.scenarioIds.length > 0;
  // On a finding/held section the errors are blocker context (a labelled header);
  // when they are the sole record (status `authoring-error`) the reason line above
  // already frames them, so the plain "Authoring errors" header suffices.
  const errorsAreBlockerContext = findings.length > 0 || heldScenarios.length > 0;

  return (
    <aside className="flex h-full w-96 shrink-0 flex-col border-l border-border bg-card">
      <div className="flex items-start gap-2 border-b border-border px-3 py-2">
        <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${meta.dot}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <GuardStatusBadge status={section.status} />
            <span className="text-[10px] text-muted-foreground">H{section.level}</span>
          </div>
          <h3 className="mt-1 text-sm font-semibold text-foreground">{section.headingText}</h3>
          <HoverPopover content="Section anchor (deep-link target)">
            <code className="mt-0.5 block truncate text-[10px] text-muted-foreground">{section.anchor}</code>
          </HoverPopover>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close section detail"
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {section.reason && (
        <div className="border-b border-border px-3 py-2 text-sm text-muted-foreground">{section.reason}</div>
      )}
      {section.blockedOnCapabilities && section.blockedOnCapabilities.length > 0 && (
        <div className="flex flex-wrap gap-1 border-b border-border px-3 py-2">
          {section.blockedOnCapabilities.map((cap) => (
            <span key={cap} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{cap}</span>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {findings.map((f) => {
          const key = `finding:${f.index}`;
          return (
            <GuardSectionFindingRow
              key={key}
              finding={f}
              expanded={previewId === key || pinned.has(key)}
              onClick={() => setPreviewId(key)}
              onDoubleClick={() => togglePin(key)}
            />
          );
        })}
        {heldScenarios.map((h) => (
          <GuardSectionHeldRow key={h.id} scenario={h} />
        ))}
        {authoringErrors.length > 0 && (
          <div>
            <div className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {errorsAreBlockerContext ? 'Blocking authoring errors' : 'Authoring errors'}
            </div>
            {authoringErrors.map((e, i) => (
              <GuardAuthoringErrorRow key={i} error={e} />
            ))}
          </div>
        )}
        {isRunOutcome ? (
          section.scenarios.map((s) => (
            <GuardScenarioRow
              key={s.id}
              repoId={repoId}
              runId={runId}
              scenario={s}
              expanded={previewId === s.id || pinned.has(s.id)}
              onClick={() => setPreviewId(s.id)}
              onDoubleClick={() => togglePin(s.id)}
            />
          ))
        ) : isGuardedNoRun ? (
          <div>
            <div className="px-3 pt-3">
              <EmptyState
                icon={PlayCircle}
                title={hasRun ? 'Not in the last run' : 'No guard run yet'}
                body={
                  <>
                    These scenarios guard this section but have no result. Run{' '}
                    <code className="rounded bg-muted px-1 py-0.5 text-[11px]">truecourse guard run</code> to test them.
                  </>
                }
              />
            </div>
            {section.scenarioIds.map((id) => (
              <GuardScenarioIdRow key={id} repoId={repoId} id={id} />
            ))}
          </div>
        ) : hasUnsettled ? null : (
          <div className="px-3 pt-3">
            <EmptyState
              icon={FlaskConical}
              title={`${meta.label} — no scenario`}
              body={section.reason ?? 'No scenario is bound to this section yet.'}
            />
          </div>
        )}
      </div>
    </aside>
  );
}
