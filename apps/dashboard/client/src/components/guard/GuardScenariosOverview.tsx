/**
 * The Scenarios tab's MAIN-PANE OVERVIEW — what shows when the permanent Overview
 * tab is active (no scenario tab open). Composes the preparation-recipe card and
 * the "last generate" content flowing beneath it (the generation story —
 * settled/unsettled, authored vs birth-passed, calls/cost, plus birth findings
 * with view-in-spec + grouped authoring errors when present). The scenario list
 * itself lives in the left panel; selecting a row there opens a preview/pinned tab
 * over this overview. Read-only.
 */

import { useMemo, useState } from 'react';
import { ArrowUpRight, FileCode2, Loader2 } from 'lucide-react';
import type {
  GuardBirthFinding,
  GuardGenerateError,
  GuardGenerateReport,
  GuardRecipeCard as GuardRecipeCardData,
} from '@truecourse/shared';
import { EmptyState } from '@/components/ui/empty-state';
import { formatGuardTime, sectionLeaf } from '@/lib/guard-drifts';
import { deferredSectionCount, groupErrorsByPattern, settledCounts } from '@/lib/guard-report';
import { makeHeadingResolver, type HeadingResolver } from '@/lib/guard-list-rows';
import type { GuardScenarioRowData } from '@/hooks/useGuardScenarios';
import { GuardRecipeCard } from './GuardRecipeCard';

const PRE =
  'mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-all rounded border border-border bg-muted/20 p-2 font-mono text-[11px] text-foreground';
const LABEL = 'text-[10px] font-semibold uppercase tracking-wider text-muted-foreground';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className={`mb-1.5 ${LABEL}`}>{title}</div>
      {children}
    </div>
  );
}

/** One birth finding row — previewable; expands to the expected/actual + spec jump. */
function BirthFindingRow({
  finding,
  expanded,
  onPreview,
  onPin,
  onOpenSpec,
}: {
  finding: GuardBirthFinding;
  expanded: boolean;
  onPreview: () => void;
  onPin: () => void;
  onOpenSpec: (doc: string, section: string) => void;
}) {
  return (
    <div className="border-b border-border/60">
      <button
        type="button"
        onClick={onPreview}
        onDoubleClick={onPin}
        title="Click to preview, double-click to pin"
        className="flex w-full flex-col gap-0.5 px-3 py-2 text-left transition-colors hover:bg-muted/40"
      >
        <span className="text-[13px] text-foreground">{finding.title}</span>
        <span className="truncate text-[10px] text-muted-foreground">{sectionLeaf(finding.anchor)}</span>
      </button>
      {expanded && (
        <div className="px-3 pb-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Failed at step {finding.step}
          </div>
          <div>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Expected</span>
            <pre className={PRE}>{finding.expected}</pre>
          </div>
          <div className="mt-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Actual</span>
            <pre className={PRE}>{finding.actual}</pre>
          </div>
          <button
            type="button"
            onClick={() => onOpenSpec(finding.doc, finding.anchor)}
            className="mt-1.5 inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground"
          >
            View in spec
            <ArrowUpRight className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}

function BirthFindingsSection({
  findings,
  onOpenSpec,
}: {
  findings: GuardBirthFinding[];
  onOpenSpec: (doc: string, section: string) => void;
}) {
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);
  const [pinned, setPinned] = useState<Set<number>>(new Set());
  const togglePin = (i: number) =>
    setPinned((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <Section title={`Birth findings — ${findings.length} (generation defect or real drift — your call)`}>
      <div className="rounded border border-border">
        {findings.map((f, i) => (
          <BirthFindingRow
            key={`${f.doc}\0${f.anchor}\0${i}`}
            finding={f}
            expanded={previewIdx === i || pinned.has(i)}
            onPreview={() => setPreviewIdx(i)}
            onPin={() => togglePin(i)}
            onOpenSpec={onOpenSpec}
          />
        ))}
      </div>
    </Section>
  );
}

/**
 * Authoring errors as ONE honest deferred-work line, not a pretend to-do list.
 * Unlike findings (user decisions), errored sections are self-healing — they stay
 * unsettled and re-attempt next generate. The header counts DISTINCT sections
 * (a section erroring under two patterns counts once); each pattern expands to the
 * FULL message (wrapped, never truncated) and its affected sections by HUMAN
 * heading name, each a live view-in-spec link — never a dead slug chip.
 */
function ErrorsSection({
  errors,
  resolveHeading,
  onOpenSpec,
}: {
  errors: GuardGenerateError[];
  resolveHeading: HeadingResolver;
  onOpenSpec: (doc: string, section: string) => void;
}) {
  const groups = groupErrorsByPattern(errors);
  const [openPattern, setOpenPattern] = useState<string | null>(null);
  if (groups.length === 0) return null;
  const deferred = deferredSectionCount(errors);
  return (
    <Section title={`${deferred} section${deferred === 1 ? '' : 's'} deferred — will re-attempt on the next generate`}>
      <div className="rounded border border-border">
        {groups.map((g) => {
          const open = openPattern === g.pattern;
          return (
            <div key={g.pattern} className="border-b border-border/60">
              <button
                type="button"
                onClick={() => setOpenPattern(open ? null : g.pattern)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/40"
              >
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-foreground">
                  {g.sections.length}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{g.pattern}</span>
              </button>
              {open && (
                <div className="space-y-2 px-3 pb-3">
                  {/* The FULL message — wrapped, never truncated. */}
                  <pre className="whitespace-pre-wrap break-words rounded border border-border bg-muted/20 p-2 font-mono text-[11px] text-foreground">
                    {g.message}
                  </pre>
                  {/* Affected sections by HUMAN heading — each a live view-in-spec link. */}
                  <div className="flex flex-col items-start gap-1">
                    {g.sections.map((s) => (
                      <button
                        key={`${s.doc}\0${s.anchor}`}
                        type="button"
                        onClick={() => onOpenSpec(s.doc, s.anchor)}
                        className="inline-flex max-w-full items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                      >
                        <span className="truncate">{resolveHeading(s.doc, s.anchor)}</span>
                        <ArrowUpRight className="h-3 w-3 shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

/**
 * The "last generate" content — plain, flowing under the recipe card, not a boxed
 * panel: a small-cap heading, the one-line summary, then the birth-findings and
 * grouped-authoring-errors sections when the last generate had any.
 */
function GuardLastGenerateStrip({
  report,
  scenarioRows,
  onOpenSpec,
}: {
  report: GuardGenerateReport;
  /** Committed rows — the source for resolving errored sections' human headings. */
  scenarioRows: GuardScenarioRowData[];
  onOpenSpec: (doc: string, section: string) => void;
}) {
  const settle = settledCounts(report);
  const usage = report.usage;
  const resolveHeading = useMemo(() => makeHeadingResolver(scenarioRows), [scenarioRows]);

  // One line, one text node (so it reads — and tests — as a single summary):
  // when · status · sections settled/unsettled · authored vs birth-passed · calls/cost.
  const summary = [
    formatGuardTime(report.generatedAt),
    report.status,
    `${settle.settled}/${settle.unsettled} settled`,
    `${report.written.length} authored`,
    ...(report.birthPassed != null ? [`${report.birthPassed} birth-passed`] : []),
    ...(usage ? [`${usage.calls} calls`, `$${usage.costUsd.toFixed(2)}`] : []),
  ].join(' · ');

  return (
    <div className="space-y-3">
      <div>
        <div className={`mb-1 ${LABEL}`}>Last generate</div>
        <div className="truncate text-xs text-muted-foreground">{summary}</div>
      </div>
      {report.birthFindings.length > 0 && (
        <BirthFindingsSection findings={report.birthFindings} onOpenSpec={onOpenSpec} />
      )}
      <ErrorsSection errors={report.errors} resolveHeading={resolveHeading} onOpenSpec={onOpenSpec} />
    </div>
  );
}

export function GuardScenariosOverview({
  recipe,
  report,
  scenarioRows,
  hasScenarios,
  loading,
  error,
  onOpenSpec,
}: {
  recipe: GuardRecipeCardData | null;
  report: GuardGenerateReport | null;
  /** Committed rows — used to resolve errored sections' human heading names. */
  scenarioRows: GuardScenarioRowData[];
  /** Whether the committed inventory (the left panel) has any rows. */
  hasScenarios: boolean;
  loading: boolean;
  error: string | null;
  onOpenSpec: (doc: string, section: string) => void;
}) {
  const empty = !hasScenarios && !recipe && !report;

  if (loading && empty) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error && empty) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <p className="max-w-sm px-6 text-center text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }
  if (empty) {
    return (
      <EmptyState
        icon={FileCode2}
        title="No scenarios yet"
        body={
          <>
            Run <code className="rounded bg-muted px-1 py-0.5 text-xs">truecourse guard generate</code> to author
            scenarios, or commit hand-written ones under{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">.truecourse/scenarios/</code>.
          </>
        }
      />
    );
  }

  return (
    <div role="region" aria-label="Scenarios overview" className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-3 px-5 py-4">
        {recipe && <GuardRecipeCard recipe={recipe} />}
        {report && (
          <GuardLastGenerateStrip report={report} scenarioRows={scenarioRows} onOpenSpec={onOpenSpec} />
        )}
      </div>
    </div>
  );
}
