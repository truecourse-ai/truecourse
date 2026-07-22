/**
 * The section detail side panel — opened by clicking a statused section. Tells
 * the claim-level story: the section's status + reason, then its scenarios with
 * last outcomes. Failing rows expose their failure detail AND, when present, the
 * generate-time diagnosis (the triage verdict + recommendation carried by a
 * committed drift scenario); every EXECUTED row with a captured transcript (pass or
 * fail) offers an evidence link that fetches it (text/plain, monospace, scrollable);
 * every row can reveal its YAML source. Rows are previewable (single-click preview,
 * double-click pin), with inline actions stopping propagation.
 *
 * Below the run outcomes ride the quiet context: deduped authoring errors (with
 * attempt counts), the tool-defect residue (muted rows — weak/undecidable candidates
 * the tool re-authors next generate, never red drift), and the auto-resolved ledger.
 * None of them withhold a committed sibling — real drift commits as an ordinary
 * failing scenario and paints by its run outcome instead.
 *
 * When the section has no run results — a guarded section with no run yet, or a
 * coverage gap (untestable / driver-not-yet / blocked-on) — the pane explains
 * that with an EmptyState instead of an empty list.
 */

import { useCallback, useEffect, useState } from 'react';
import { FlaskConical, PlayCircle, X } from 'lucide-react';
import type { GuardSectionAuthoringError, GuardSectionAutoResolved, GuardSectionCoverage, GuardSectionFinding, GuardSectionScenario, GuardScenarioSource } from '@truecourse/shared';
import { EmptyState } from '@/components/ui/empty-state';
import { HoverPopover } from '@/components/ui/hover-popover';
import * as api from '@/lib/api';
import { guardStatusMeta } from '@/lib/guard-status';
import { GuardStatusBadge } from './GuardStatusBadge';
import { GuardScenarioStory } from './GuardScenarioStory';
import { GuardFindingBadge } from './GuardFindingBadge';
import { GuardTriageChip } from './GuardTriageChip';

const OUTCOME_TEXT: Record<string, string> = {
  pass: 'text-emerald-600 dark:text-emerald-400',
  fail: 'text-red-600 dark:text-red-400',
  error: 'text-red-600 dark:text-red-400',
  stale: 'text-amber-600 dark:text-amber-400',
  orphaned: 'text-amber-600 dark:text-amber-400',
};

const PRE = 'mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-all rounded border border-border bg-muted/20 p-2 font-mono text-[11px] text-foreground';

/** Fetch a scenario's source (parsed → story, raw → YAML) once `active` turns true. */
function useScenarioSource(repoId: string, id: string, active: boolean) {
  const [source, setSource] = useState<GuardScenarioSource | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!active || source !== null) return;
    let cancelled = false;
    setBusy(true);
    api
      .getGuardScenarioSource(repoId, id)
      .then((src) => {
        if (!cancelled) setSource(src ?? { id, file: '', content: 'Scenario source not found.' });
      })
      .catch((e) => {
        if (!cancelled) setSource({ id, file: '', content: e instanceof Error ? e.message : 'Source unavailable.' });
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [active, source, repoId, id]);
  return { source, busy };
}

/** One scenario result row — previewable: the plain-words story on expand, with
 *  on-demand evidence and the raw YAML behind its toggle. */
function GuardScenarioRow({
  repoId,
  runId,
  scenario,
  headingText,
  expanded,
  onClick,
  onDoubleClick,
}: {
  repoId: string;
  runId: string | null;
  scenario: GuardSectionScenario;
  /** The bound section's human heading — the "§ …" context under Doc says. */
  headingText?: string;
  expanded: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
}) {
  const [evidence, setEvidence] = useState<string | null>(null);
  const [showEvidence, setShowEvidence] = useState(false);
  const [showYaml, setShowYaml] = useState(false);
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const { source, busy: sourceBusy } = useScenarioSource(repoId, scenario.id, expanded);

  const toggleEvidence = useCallback(async () => {
    if (showEvidence) {
      setShowEvidence(false);
      return;
    }
    setShowEvidence(true);
    if (evidence == null && runId) {
      setEvidenceBusy(true);
      try {
        setEvidence(await api.getGuardEvidence(repoId, runId, scenario.id));
      } catch (e) {
        setEvidence(e instanceof Error ? e.message : 'Evidence unavailable.');
      } finally {
        setEvidenceBusy(false);
      }
    }
  }, [showEvidence, evidence, runId, repoId, scenario.id]);

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
          {/* The plain-words story — what this scenario tests. */}
          {source?.scenario && (
            <div className="mb-2">
              <GuardScenarioStory scenario={source.scenario} headingText={headingText} />
            </div>
          )}
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
          {/* The generate-time diagnosis of a committed FAILING scenario — the triage
              verdict + recommendation the run itself can't derive (real drift). Falls
              back to the diagnosis expected/actual when the run left no failure detail. */}
          {scenario.diagnosis && (
            <div className="mb-1 text-xs">
              {!scenario.failure && (
                <div className="mt-1 grid gap-1">
                  <div>
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Expected</span>
                    <pre className={PRE}>{scenario.diagnosis.expected}</pre>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Actual</span>
                    <pre className={PRE}>{scenario.diagnosis.actual}</pre>
                  </div>
                </div>
              )}
              {scenario.diagnosis.triage && (
                <div className="mt-1.5 flex items-start gap-2">
                  <GuardTriageChip verdict={scenario.diagnosis.triage.verdict} compact />
                  <p className="leading-snug text-muted-foreground">{scenario.diagnosis.triage.recommendation}</p>
                </div>
              )}
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
                setShowYaml((v) => !v);
              }}
              className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground"
            >
              {showYaml ? 'Hide YAML' : 'View YAML source'}
            </button>
          </div>

          {showEvidence && (
            <pre className={PRE} aria-label="evidence transcript">
              {evidenceBusy ? 'Loading transcript…' : evidence ?? ''}
            </pre>
          )}
          {showYaml && (
            <pre className={PRE} aria-label="scenario source">
              {source ? source.content : sourceBusy ? 'Loading source…' : ''}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

/** A bare scenario id (no run result) — previews the plain-words story on demand,
 *  with the raw YAML source beneath it. */
function GuardScenarioIdRow({ repoId, id, headingText }: { repoId: string; id: string; headingText?: string }) {
  const [show, setShow] = useState(false);
  const { source, busy } = useScenarioSource(repoId, id, show);

  return (
    <div className="border-b border-border/60 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="truncate text-[13px] text-foreground">{id}</span>
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          className="ml-auto shrink-0 rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground"
        >
          {show ? 'Hide' : 'Preview'}
        </button>
      </div>
      {show && (
        <div className="mt-2">
          {source?.scenario && (
            <div className="mb-2">
              <GuardScenarioStory scenario={source.scenario} headingText={headingText} />
            </div>
          )}
          <pre className={PRE} aria-label="scenario source">
            {source ? source.content : busy ? 'Loading source…' : ''}
          </pre>
        </div>
      )}
    </div>
  );
}

/** One tool-defect finding bound to the section — a weak/undecidable candidate the
 *  tool couldn't turn into a guard, MUTED context (never red drift), expandable to its
 *  expected → actual. */
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
          {finding.triageVerdict && <GuardTriageChip verdict={finding.triageVerdict} compact />}
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
            The tool couldn&apos;t author a reliable guard here — it re-authors on the next generate
            (or dismiss the claim in the Scenarios tab).
          </div>
        </div>
      )}
    </div>
  );
}

/** One auto-resolved ledger entry (item 14) — MUTED context, never a red finding.
 *  The tool handled it itself (dismissed / re-attempts / re-authored), so it rides the
 *  section as a struck-through note with its verdict and one-line reason. */
function GuardSectionAutoResolvedRow({ entry }: { entry: GuardSectionAutoResolved }) {
  const action = entry.kind === 'triage-dismiss' ? 'dismissed' : entry.kind === 'triage-resolve' ? 're-attempts' : 're-authored';
  return (
    <div className="border-b border-border/60 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="inline-flex shrink-0 items-center rounded border border-border px-1 py-0 text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
          auto-resolved
        </span>
        {entry.verdict && <span className="shrink-0 text-[10px] text-muted-foreground">{entry.verdict}</span>}
        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{action}</span>
      </div>
      <span className="mt-0.5 block truncate text-[13px] text-muted-foreground line-through">{entry.title}</span>
      <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground/80">{entry.detail}</p>
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
  const authoringErrors = section.authoringErrors ?? [];
  const autoResolved = section.autoResolved ?? [];
  const hasUnsettled = findings.length > 0 || authoringErrors.length > 0;
  const isRunOutcome = section.scenarios.length > 0;
  const isGuardedNoRun = !isRunOutcome && section.scenarioIds.length > 0;
  // When authoring errors are the section's SOLE record (status `authoring-error`) the
  // reason line above already frames them, so the plain "Authoring errors" header
  // suffices; anywhere else (a committed or `finding` section that also errored) they
  // are blocker context, so the header says so.
  const errorsAreBlockerContext = section.status !== 'authoring-error';

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
        {/* Primary: the run outcomes (a committed drift scenario paints red here with
            its diagnosis one keypress away), else the guarded-no-run or empty state. */}
        {isRunOutcome ? (
          section.scenarios.map((s) => (
            <GuardScenarioRow
              key={s.id}
              repoId={repoId}
              runId={runId}
              scenario={s}
              headingText={section.headingText}
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
              <GuardScenarioIdRow key={id} repoId={repoId} id={id} headingText={section.headingText} />
            ))}
          </div>
        ) : hasUnsettled || autoResolved.length > 0 ? null : (
          <div className="px-3 pt-3">
            <EmptyState
              icon={FlaskConical}
              title={`${meta.label} — no scenario`}
              body={section.reason ?? 'No scenario is bound to this section yet.'}
            />
          </div>
        )}

        {/* Quiet context beneath the outcomes: blocking authoring errors, then the
            muted tool-defect residue, then the auto-resolved ledger. */}
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
        {findings.length > 0 && (
          <div>
            <div className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Tool defects · re-authored next generate
            </div>
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
          </div>
        )}
        {autoResolved.length > 0 && (
          <div>
            <div className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Auto-resolved · no task
            </div>
            {autoResolved.map((a) => (
              <GuardSectionAutoResolvedRow key={`auto:${a.index}`} entry={a} />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
