/**
 * The Scenarios tab's MAIN-PANE OVERVIEW — what shows when the permanent Overview
 * tab is active (no scenario tab open). Composes the preparation-recipe card and
 * the "last generate" stats flowing beneath it (the generation story in numbers —
 * settled/unsettled, authored, birth-passed, findings, calls/cost as stat chips)
 * plus the deferred-authoring-errors housekeeping line when present. Birth findings
 * live only in the left-panel list, not here. Selecting a row there opens a
 * preview/pinned tab over this overview. Read-only.
 */

import { useMemo, useState } from 'react';
import { ArrowUpRight, FileCode2, Loader2 } from 'lucide-react';
import type {
  GuardGenerateError,
  GuardGenerateReport,
  GuardRecipeCard as GuardRecipeCardData,
} from '@truecourse/shared';
import { EmptyState } from '@/components/ui/empty-state';
import { formatGuardTime } from '@/lib/guard-drifts';
import { deferredSectionCount, groupErrorsByPattern, settledCounts } from '@/lib/guard-report';
import { makeHeadingResolver, type HeadingResolver } from '@/lib/guard-list-rows';
import type { GuardScenarioRowData } from '@/hooks/useGuardScenarios';
import { GuardRecipeCard } from './GuardRecipeCard';

const LABEL = 'text-[10px] font-semibold uppercase tracking-wider text-muted-foreground';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className={`mb-2 ${LABEL}`}>{title}</div>
      {children}
    </div>
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
 * panel: a small-cap heading, the when/status envelope line, a wrap row of stat
 * chips (settled/unsettled · authored · birth-passed · findings · held ·
 * calls/cost), then the deferred-authoring-errors housekeeping line when any
 * section stayed unsettled.
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

  // The generation story as numbers: number-first stat chips. Findings + held
  // render always (0 is honest); birth-passed/calls/cost only when the report
  // carries them. Held = birth-passed scenarios an unsettled section withheld.
  const heldCount = (report.heldSections ?? []).reduce((n, h) => n + h.readyScenarios.length, 0);
  const stats: { label: string; value: string | number }[] = [
    { label: 'settled', value: settle.settled },
    { label: 'unsettled', value: settle.unsettled },
    { label: 'authored', value: report.written.length },
    ...(report.birthPassed != null ? [{ label: 'birth-passed', value: report.birthPassed }] : []),
    { label: 'findings', value: report.birthFindings.length },
    { label: 'held', value: heldCount },
    ...(usage
      ? [{ label: 'calls', value: usage.calls }, { label: 'cost', value: `$${usage.costUsd.toFixed(2)}` }]
      : []),
  ];

  return (
    <div className="space-y-6">
      <div>
        <div className={`mb-2 ${LABEL}`}>Last generate</div>
        <div className="text-sm text-foreground">
          {formatGuardTime(report.generatedAt)}{' '}
          <span className="text-xs text-muted-foreground">· {report.status}</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="flex items-center gap-1.5 rounded border border-border bg-muted/30 px-2.5 py-1.5"
            >
              <span className="text-sm font-semibold text-foreground">{stat.value}</span>
              <span className="text-xs text-muted-foreground">{stat.label}</span>
            </div>
          ))}
        </div>
      </div>
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
            scenarios.
          </>
        }
      />
    );
  }

  return (
    <div role="region" aria-label="Scenarios overview" className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-6 px-5 py-5">
        {recipe && <GuardRecipeCard recipe={recipe} />}
        {report && (
          <GuardLastGenerateStrip report={report} scenarioRows={scenarioRows} onOpenSpec={onOpenSpec} />
        )}
      </div>
    </div>
  );
}
