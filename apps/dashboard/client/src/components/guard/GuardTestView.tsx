/**
 * A TEST, rendered ONCE.
 *
 * There is one screen for a test and two things it can be fed: the ENTITY (its
 * latest state, on the Tests tab) or an INSTANCE (how it ran in one run, on the
 * Runs tab). The skeleton is identical — only the provenance line and the result
 * that feeds it differ — so a reader learns the page once:
 *
 *   header        title · surface · status · provenance · the one ruling
 *   1 what it checks   the flow's goal, one line
 *   2 verdict          ONE card: result + duration + where it broke, and the claim
 *   3 steps            the structured step list, grouped by milestone; the failing
 *                      step carries its own expected/actual/output INLINE
 *   4 evidence         ONE transcript block
 *   5 journey          the code path it drives
 *   footer             labelled rows: Test · File · Flow · Spec
 *
 * The diff lives WHERE IT BROKE. A failure is a fact about one step, so it reads
 * inside that step's row — never as a top-level Expected/Actual pair a reader has
 * to re-attach to a step number, and never as a second Program-output section
 * repeating what the excerpt and the transcript already say.
 *
 * ONE row collapses: the failing one. Its diff is the only bulk on the page, it is
 * open by default, and a reader who is done with it can put it away. A passing or
 * not-reached step is static — a toggle over one expectation line would be chrome
 * for nothing.
 *
 * Everything is fetched with the tab — the reader came to read (chrome-diet, no
 * toggles). The file's own text is never rendered: the steps above ARE its
 * content, and the File row is how a developer opens the real thing.
 *
 * THE PANE NEVER SCROLLS SIDEWAYS. Wide data (a command line, a JSON body, a
 * transcript) is never re-wrapped — it scrolls INSIDE its own block ({@link PRE}),
 * and that is the only horizontal scroll on the screen. Structurally that costs
 * one thing everywhere: every flex box between the pane and such a block carries
 * `min-w-0`, so a wide child shrinks its column instead of stretching the page,
 * and every truncating span is width-bound rather than free to grow.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUpRight, ChevronDown, ChevronRight, Copy, Route } from 'lucide-react';
import type {
  GuardDriverId,
  GuardFailureDetail,
  GuardJourneyRow,
  GuardScenarioStepView,
} from '@truecourse/shared';
import { HoverPopover } from '@/components/ui/hover-popover';
import * as api from '@/lib/api';
import { formatGuardDuration } from '@/lib/guard-drifts';
import type { GuardTestStatusView } from '@/lib/guard-flow-status';
import { guardTestLabel } from '@/lib/guard-tests';
import { GuardJourneyDiagram } from './GuardJourneyDiagram';
import { GuardLongText } from './GuardLongText';
import { GuardFlowStatusChip } from './GuardStatusBadge';
import { PRE } from './detail-styles';

const LABEL = 'mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground';
const FOOT_BTN =
  'inline-flex min-w-0 max-w-full items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground';
/** A truncating label inside a footer button — it must shrink, or it stretches the row. */
const FOOT_TEXT = 'min-w-0 truncate';

/** One labelled footer row — "Test — <id>", "File — <path>". */
function FootRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <dt className="w-10 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 truncate">{children}</dd>
    </div>
  );
}

/** Where a transcript lives: under a run, or at the birth path the generate wrote. */
export type GuardEvidenceRef = { kind: 'run'; runId: string } | { kind: 'birth'; path: string };

/** The one view model both feeds produce. */
export interface GuardTestViewModel {
  id: string;
  title: string;
  surface?: GuardDriverId;
  status: GuardTestStatusView;
  /** "Latest state" | "As of run <id>" — which result the page is showing. */
  provenance: string;
  durationMs?: number | null;
  failure?: GuardFailureDetail;
  failedMilestone?: number;
  /** The claim behind the failing milestone, when the flow named one. */
  failedMilestoneClaim?: string;
  /**
   * The flow's milestone chain — the claim sentence each step group is headed
   * with. Matched to a step by `order`; absent (a hand-written test, an unjoined
   * run) leaves the group headed by its number alone.
   */
  milestones?: readonly { order: number; claimTitle: string }[];
  journeyDrifted?: boolean;
  /** What the test is ultimately checking — the flow's goal. */
  goal?: string;
  flow?: { id: string; title: string };
  binds: { doc: string; section: string; headingText?: string; fingerprint?: string };
  journeyPath: readonly string[];
  evidence: GuardEvidenceRef | null;
}

/** Per-step paint from the viewed result: pass up to the failure, fail at it, not-reached after. */
function stepGlyph(n: number, failedStep: number | undefined, passed: boolean): { glyph: string; label: string } {
  if (failedStep != null) {
    if (n < failedStep) return { glyph: '✓', label: 'passed' };
    if (n === failedStep) return { glyph: '✗', label: 'failed' };
    return { glyph: '·', label: 'not reached' };
  }
  return passed ? { glyph: '✓', label: 'passed' } : { glyph: '·', label: 'not run' };
}

/** One labelled line of the inline diff — "expected", "actual", "output". */
function DiffRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <span className="w-14 shrink-0 pt-1.5 text-[10px] text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * WHY the step failed, read inside the step that failed: what it wanted, what it
 * got, and what the program printed while getting it. Every block is a long-data
 * block — clamped vertically, scrolled horizontally, never wrapped (a wrapped
 * command line or JSON body lies about its shape).
 */
function StepFailure({ failure }: { failure: GuardFailureDetail }) {
  return (
    <div className="mt-2 space-y-1">
      <DiffRow label="expected">
        <GuardLongText text={failure.expected} label="expected value" />
      </DiffRow>
      <DiffRow label="actual">
        <GuardLongText text={failure.actual} label="actual value" />
      </DiffRow>
      {(failure.stdout || failure.stderr) && (
        <DiffRow label="output">
          <div className="space-y-1">
            {failure.stdout && <GuardLongText text={failure.stdout} label="step output" />}
            {failure.stderr && <GuardLongText text={failure.stderr} label="step error output" />}
          </div>
        </DiffRow>
      )}
    </div>
  );
}

/**
 * ONE step: glyph · number · command, then the world it runs in and what it
 * asserts.
 *
 * A step that passed (or was never reached) is STATIC — its detail is a single
 * expectation line, and a toggle over one line is chrome for nothing. The step
 * that FAILED is the only collapsible row, because it is the only one carrying
 * bulk: its expected / actual / output diff, open by default (that is the row the
 * reader came for) and closable when they are done with it.
 *
 * The failing row drops the "expects …" summary: the labelled `expected` field
 * below says the same thing, and a fact told twice reads as two facts.
 */
function StepRow({
  step,
  failedStep,
  passed,
  failure,
}: {
  step: GuardScenarioStepView;
  failedStep: number | undefined;
  passed: boolean;
  /** The viewed result's failure — rendered inline on the step it names. */
  failure?: GuardFailureDetail;
}) {
  const { glyph, label } = stepGlyph(step.n, failedStep, passed);
  const failed = glyph === '✗';
  const diff = failed && failure ? failure : null;
  const [open, setOpen] = useState(true);
  const Chevron = open ? ChevronDown : ChevronRight;

  const head = (
    <>
      <span
        className={`w-4 shrink-0 text-center text-[11px] ${
          failed ? 'text-red-600 dark:text-red-400' : glyph === '✓' ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'
        }`}
      >
        {glyph}
      </span>
      <span className="w-4 shrink-0 text-[11px] text-muted-foreground">{step.n}</span>
      <span className="min-w-0 flex-1 break-words font-mono text-[12px] text-foreground">{step.command}</span>
      {step.repeat != null && step.repeat > 1 && (
        <span className="mt-0.5 shrink-0 text-[10px] text-muted-foreground">×{step.repeat}</span>
      )}
    </>
  );

  const env = step.env && step.env.length > 0 && (
    <div className="break-words font-mono text-[11px] text-muted-foreground">with {step.env.join(' ')}</div>
  );

  return (
    <li
      aria-label={`Step ${step.n}: ${step.command} — ${label}`}
      className={`border-b border-border/60 last:border-b-0 ${failed ? 'border-l-2 border-l-red-500/60' : ''}`}
    >
      {diff ? (
        // The whole line is the target — a step is one thing to click, not a
        // chevron a reader has to aim at.
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${open ? 'Collapse' : 'Expand'} step ${step.n}`}
          onClick={() => setOpen((v) => !v)}
          className="flex w-full min-w-0 items-start gap-2 px-3 py-2 text-left hover:bg-muted/40"
        >
          <Chevron className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
          {head}
        </button>
      ) : (
        <div className="flex min-w-0 items-start gap-2 px-3 py-2">
          {/* The chevron's gutter, kept empty: every row's glyph lines up whether or
              not that row can be opened. */}
          <span className="w-3 shrink-0" aria-hidden />
          {head}
        </div>
      )}
      {/* Indented to the command column, so the detail reads as that step's. */}
      {(diff ? open : env || step.expectation) && (
        <div className="pb-2 pl-20 pr-3">
          {env}
          {diff ? (
            <StepFailure failure={diff} />
          ) : (
            step.expectation && (
              <div className="text-[11px] leading-snug text-muted-foreground">expects {step.expectation}</div>
            )
          )}
        </div>
      )}
    </li>
  );
}

/** Consecutive steps sharing a milestone — one section of the step list. */
type StepGroup = { milestone: number | null; steps: GuardScenarioStepView[] };

/**
 * The step list as SECTIONS: each milestone's steps under that milestone's claim,
 * in file order. Steps annotated with no milestone are preparation, and head their
 * own "Setup" section — emitted only where such steps actually are.
 */
function groupStepsByMilestone(steps: readonly GuardScenarioStepView[]): StepGroup[] {
  const groups: StepGroup[] = [];
  for (const step of steps) {
    const milestone = step.milestone ?? null;
    const last = groups[groups.length - 1];
    if (last && last.milestone === milestone) last.steps.push(step);
    else groups.push({ milestone, steps: [step] });
  }
  return groups;
}

export function GuardTestView({
  repoId,
  test,
  journeys,
  lead,
  action,
  headerAction,
  notes,
  onOpenFlow,
  onOpenJourney,
  onOpenSpec,
}: {
  repoId: string;
  test: GuardTestViewModel;
  /** The mapped catalog, for the journeys this test drives; null = unmapped. */
  journeys: GuardJourneyRow[] | null;
  /** Run-scoped chrome above the verdict (the run's flow-instance paint). */
  lead?: ReactNode;
  /** The one ruling this page offers (entity view only). */
  action?: ReactNode;
  /** A link out of this page (the run instance's "open this test"). */
  headerAction?: ReactNode;
  /** Extra verdict-card notes (stale/orphaned bindings, "no result yet"). */
  notes?: ReactNode;
  onOpenFlow?: (flowId: string) => void;
  onOpenJourney?: (journeyId: string) => void;
  onOpenSpec: (doc: string, section: string) => void;
}) {
  const [source, setSource] = useState<{ file?: string; content: string; steps: GuardScenarioStepView[] } | null>(
    null,
  );
  const [evidence, setEvidence] = useState<string | null>(null);
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  // Ephemeral: which representation the reader is on. Never a URL param — it is a
  // way of looking at this page, not a place.
  const [mode, setMode] = useState<'View' | 'YAML'>('View');

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    setSource(null);
    api
      .getGuardScenarioSource(repoId, test.id)
      .then((src) => {
        if (!mounted.current) return;
        setSource(
          src
            ? { ...(src.file ? { file: src.file } : {}), content: src.content, steps: src.steps ?? [] }
            : { content: 'Steps not found on disk.', steps: [] },
        );
      })
      .catch((e: unknown) => {
        if (mounted.current)
          setSource({ content: e instanceof Error ? e.message : 'Steps unavailable.', steps: [] });
      });
  }, [repoId, test.id]);

  const ev = test.evidence;
  useEffect(() => {
    if (!ev) return;
    setEvidence(null);
    setEvidenceBusy(true);
    const load =
      ev.kind === 'birth'
        ? api.getGuardFindingEvidence(repoId, ev.path)
        : api.getGuardEvidence(repoId, ev.runId, test.id);
    load
      .then((text) => {
        if (mounted.current) setEvidence(text);
      })
      .catch((e: unknown) => {
        if (mounted.current) setEvidence(e instanceof Error ? e.message : 'Transcript unavailable.');
      })
      .finally(() => {
        if (mounted.current) setEvidenceBusy(false);
      });
  }, [repoId, test.id, ev]);

  const failed = test.status.plain === 'failing';
  const passed = test.status.plain === 'passing' && !failed;
  // "failed (birth)" is the plan's own wording for a test committed red: it ran
  // once, at authoring time, and disagreed with the code.
  const verdictWord = failed ? (test.status.birth ? 'failed (birth)' : 'failed') : passed ? 'passed' : test.status.word.toLowerCase();
  const byId = new Map((journeys ?? []).map((j) => [j.id, j]));
  const claims = new Map((test.milestones ?? []).map((m) => [m.order, m.claimTitle]));
  const claimOf = (order: number) => claims.get(order);
  // WHICH step is the open one is a fact about the VIEWED RESULT, so the step list
  // is keyed on it: reading another test — or this same test as another run's
  // record — re-opens that result's failing step instead of inheriting the toggle
  // the last one was left in.
  const resultKey = `${test.id}:${test.failure?.step ?? 'none'}`;

  return (
    <div className="flex h-full min-w-0 flex-col bg-background">
      <div className="min-w-0 border-b border-border bg-card px-6 py-4">
        <h2 className="break-words text-sm font-semibold text-foreground">{test.title}</h2>
        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-2">
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {guardTestLabel(test.surface)}
          </span>
          <GuardFlowStatusChip status={test.status.plain} word={test.status.word} />
          <span className="text-[11px] text-muted-foreground">{test.provenance}</span>
          {/* The editor idiom: read the page, or read the file it came from. */}
          <div role="group" aria-label="View mode" className="ml-auto flex shrink-0 rounded border border-border">
            {(['View', 'YAML'] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
                className={`px-2 py-0.5 text-[10px] font-medium first:rounded-l last:rounded-r ${
                  mode === m ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
        {headerAction}
      </div>

      {/* The pane owns HEIGHT scrolling only: `overflow-y-auto` alone would compute
          the x axis to `auto` too and let one wide line scroll the whole page
          sideways, so x is clipped here and the code blocks scroll themselves. */}
      <div className="min-w-0 flex-1 space-y-5 overflow-y-auto overflow-x-hidden px-6 py-4">
        {mode === 'YAML' ? (
          // The whole file — a reader who switched here asked for all of it. The
          // pane's own scroll carries it; the block never scrolls on its own.
          <pre className={PRE} aria-label="test source">
            {source?.content ?? 'Loading…'}
          </pre>
        ) : (
          <>
        {lead}

        {/* 1. What it checks — one line. */}
        <div>
          <div className={LABEL}>What it checks</div>
          <p className="text-[13px] leading-relaxed text-foreground">{test.goal ?? test.title}</p>
        </div>

        {/* 2. The verdict — ONE card. Everything about the result is inside it. */}
        <div>
          <div className={LABEL}>Verdict</div>
          <div
            className={`rounded border p-3 ${failed ? 'border-red-500/60' : 'border-border'}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <GuardFlowStatusChip status={test.status.plain} word={verdictWord} className="text-[11px]" />
              {test.durationMs != null && (
                <span className="text-[11px] text-muted-foreground">{formatGuardDuration(test.durationMs)}</span>
              )}
              {failed && test.status.birth && (
                <HoverPopover portal
                  width="wide"
                  content="This test failed the first time it ran, when it was written. It is committed anyway — the doc and the code disagree, and the next run that turns it green closes that gap."
                >
                  <span className="text-[11px] text-muted-foreground underline decoration-dotted">
                    what does birth mean?
                  </span>
                </HoverPopover>
              )}
            </div>

            {test.failure && (
              <div className="mt-2">
                <div className="text-[11px] text-muted-foreground">
                  Failed at step <span className="text-foreground">{test.failure.step}</span>
                  {test.failedMilestone != null && (
                    <span className="text-foreground"> · milestone {test.failedMilestone}</span>
                  )}
                </div>
                {test.failedMilestoneClaim && (
                  <div className="mt-0.5 text-[12px] leading-snug text-foreground">{test.failedMilestoneClaim}</div>
                )}
              </div>
            )}

            {test.journeyDrifted && (
              <HoverPopover portal
                align="start"
                width="wide"
                content="The live journey catalog no longer matches the fingerprints this test was grounded on — the code surface it was derived from moved. Never a pass/fail input; re-generate to re-ground it."
              >
                <div className="mt-2 flex items-center gap-2 text-[12px] text-amber-600 dark:text-amber-400">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                  Journey drift — the mapped surface moved since this test was written
                </div>
              </HoverPopover>
            )}

            {notes}
            {action}
          </div>
        </div>

        {/* 3. The steps, as steps — grouped under the claim each one realizes, with
               the failure read inside the step it happened in. */}
        <div>
          <div className={LABEL}>Steps</div>
          {/* One stable container, whatever its state: loading, the step list, or —
              for a file that doesn't parse as a known driver — its own text. A
              failure never depends on that parse: when there are no steps to hang
              it on, it reads as its own block rather than disappearing. */}
          <div aria-label="test steps">
            {source != null && source.steps.length > 0 ? (
              <div key={resultKey} className="rounded border border-border">
                {groupStepsByMilestone(source.steps).map((group, i) => (
                  <div key={`${group.milestone ?? 'setup'}-${i}`} className="border-b border-border last:border-b-0">
                    <div className="bg-muted/40 px-3 py-1.5 text-[11px] leading-snug">
                      {group.milestone == null ? (
                        // "Setup" is the one group header that names no claim, so it
                        // says what it IS on hover rather than leaving a reader to
                        // wonder which promise these steps serve.
                        <HoverPopover portal width="narrow" content="Prepares the test — not tied to a spec promise.">
                          <span className="font-medium text-foreground underline decoration-dotted underline-offset-2">
                            Setup
                          </span>
                        </HoverPopover>
                      ) : (
                        <>
                          <span className="font-medium text-foreground">Milestone {group.milestone}</span>
                          {claimOf(group.milestone) && (
                            <span className="text-muted-foreground"> — {claimOf(group.milestone)}</span>
                          )}
                        </>
                      )}
                    </div>
                    <ol>
                      {group.steps.map((step) => (
                        <StepRow
                          key={step.n}
                          step={step}
                          failedStep={test.failure?.step}
                          passed={passed}
                          {...(test.failure ? { failure: test.failure } : {})}
                        />
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
            ) : (
              <>
                {test.failure && (
                  <div className="rounded border border-red-500/60 px-3 py-2">
                    <div className="text-[11px] text-muted-foreground">
                      Step <span className="text-foreground">{test.failure.step}</span> —{' '}
                      <span className="text-red-600 dark:text-red-400">failed</span>
                    </div>
                    <StepFailure failure={test.failure} />
                  </div>
                )}
                <pre className={PRE}>{source == null ? 'Loading steps…' : source.content}</pre>
              </>
            )}
          </div>
        </div>

        {/* 4. Evidence — ONE transcript, never repeated as separate sections. */}
        {ev && (
          <div>
            <div className={LABEL}>Evidence</div>
            <GuardLongText text={evidenceBusy ? 'Loading transcript…' : evidence ?? ''} label="evidence transcript" />
          </div>
        )}

        {/* 5. The journey it drives — context, not verdict, so it comes last. */}
        <div>
          <div className={LABEL}>Journey</div>
          {test.journeyPath.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">
              This test records no journey path (hand-written, or written before mapping).
            </p>
          ) : (
            <div className="space-y-2">
              {test.journeyPath.map((id) => {
                const journey = byId.get(id);
                return (
                  <div key={id}>
                    <button
                      type="button"
                      onClick={() => onOpenJourney?.(id)}
                      disabled={!onOpenJourney}
                      className="mb-1 inline-flex items-center gap-1 font-mono text-[11px] text-primary hover:underline disabled:no-underline"
                    >
                      <Route className="h-3 w-3" />
                      {id}
                    </button>
                    {journey ? (
                      <GuardJourneyDiagram journey={journey} label={journey.id} />
                    ) : (
                      <p className="text-[12px] text-muted-foreground">
                        Not in the current catalog — run Map on the Journeys tab to re-derive it.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* The technical footer: what this is and where it lives, as labelled rows
            — never a pile of bare strings. The file path is how a developer opens
            the real file; the page itself never shows its text. */}
        <dl className="space-y-1 border-t border-border pt-3 text-[11px]">
          <FootRow label="Test">
            <span className="truncate font-mono text-muted-foreground">{test.id}</span>
          </FootRow>
          {source?.file && (
            <FootRow label="File">
              <button
                type="button"
                onClick={() => void navigator.clipboard?.writeText(source.file!)}
                title="Copy the path"
                className={`${FOOT_BTN} font-mono`}
              >
                <span className={FOOT_TEXT}>{source.file}</span>
                <Copy className="h-3 w-3 shrink-0" />
              </button>
            </FootRow>
          )}
          {test.flow && onOpenFlow && (
            <FootRow label="Flow">
              <button type="button" onClick={() => onOpenFlow(test.flow!.id)} className={FOOT_BTN}>
                <span className={FOOT_TEXT}>{test.flow.title}</span>
                <ArrowUpRight className="h-3 w-3 shrink-0" />
              </button>
            </FootRow>
          )}
          <FootRow label="Spec">
            <button
              type="button"
              onClick={() => onOpenSpec(test.binds.doc, test.binds.section)}
              className={FOOT_BTN}
            >
              <span className={FOOT_TEXT}>{test.binds.headingText ?? test.binds.doc}</span>
              <span className={`${FOOT_TEXT} text-muted-foreground`}>§ {test.binds.section}</span>
              <ArrowUpRight className="h-3 w-3 shrink-0" />
            </button>
          </FootRow>
        </dl>
          </>
        )}
      </div>
    </div>
  );
}
