/**
 * A TEST, rendered ONCE — the ONE scenario rendering in guard.
 *
 * Two things can feed it: the flow's own committed test (read inside the merged
 * FLOW detail, which is the entity) or an INSTANCE — how that test ran in one run,
 * on the Runs tab. The body is identical — only the provenance and the result that
 * feeds it differ — so a reader learns it once:
 *
 *   1 what it checks   the flow's goal, one line
 *   2 verdict          ONE card: result + duration + where it broke, and the claim
 *   3 setup            the world the steps start in — the `setup:` block the runner
 *                      materializes before step 1 (only when the file declares one)
 *   4 steps            the structured step list, grouped by the claim each group
 *                      realizes — and each such header LINKS to the section that
 *                      states it, which is why the flow detail no longer carries a
 *                      milestone list of its own above the test. Every step says
 *                      what it drives (`cli`, `git`, `file`, `api`) and carries its
 *                      own expected/actual/output INLINE
 *   5 evidence         ONE transcript block
 *   6 interface          the code path it drives
 *   footer             labelled rows: Test · File · Flow · Spec
 *
 * {@link GuardScenarioBody} is that body — the flow detail embeds it under the
 * flow's own header and milestone list. {@link GuardTestView} wraps it in a
 * header + scroll box of its own for the RUN INSTANCE, which has no flow header
 * above it. Same component, one implementation, no parallel test screen.
 *
 * NO SURFACE LABEL rides here. Guard runs one surface per flow today, so "CLI
 * test" only ever restated the same word on every row and every header. When a
 * second surface exists it returns as a plain label beside the title — not a chip.
 *
 * The diff lives WHERE IT BROKE. A failure is a fact about one step, so it reads
 * inside that step's row — never as a top-level Expected/Actual pair a reader has
 * to re-attach to a step number, and never as a second Program-output section
 * repeating what the excerpt and the transcript already say.
 *
 * EVERY step reads the same way, because every step is the same kind of thing: what
 * it expected, what it actually returned, what it printed. The actual half comes
 * from the run's evidence, joined on the server; a step the run never reached, and
 * every step of a test that has never run, says so instead of showing a blank.
 *
 * TWO readings of one file, on the header's shared mode switch: View (this page —
 * the result and the steps) and YAML (the stored artifact itself). Every
 * artifact-backed entity offers exactly that pair, through the same component —
 * see {@link ArtifactModeSwitch}.
 *
 * EVERY row collapses, and ONE is open: the failing one. That is the row the reader
 * came for, and it is the only one whose bulk earns the page by default; the rest
 * are one click from exactly the same three fields.
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
  GuardFailureDetail,
  GuardInterfaceRow,
  GuardScenarioSetupView,
  GuardScenarioStepView,
  GuardTriage,
} from '@truecourse/shared';
import { ArtifactModeSwitch, ArtifactRaw, useArtifactMode } from '@/components/ui/artifact-view';
import { HoverPopover } from '@/components/ui/hover-popover';
import * as api from '@/lib/api';
import { formatGuardDuration } from '@/lib/guard-drifts';
import type { GuardTestStatusView } from '@/lib/guard-flow-status';
import { GuardInterfaceDiagram } from './GuardInterfaceDiagram';
import { GuardLongText } from './GuardLongText';
import { GuardTestSetup } from './GuardTestSetup';
import { GuardTriageChip } from './GuardTriageChip';
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
  status: GuardTestStatusView;
  /** "Latest state" | "As of run <id>" — which result the page is showing. */
  provenance: string;
  durationMs?: number | null;
  failure?: GuardFailureDetail;
  /**
   * The triage verdict behind a BIRTH failure — what the failure IS, not
   * just that it happened. Absent on a run failure (a different event, with no
   * verdict of its own) and on a test that committed untriaged.
   */
  triage?: GuardTriage;
  failedMilestone?: number;
  /** The claim behind the failing milestone, when the flow named one. */
  failedMilestoneClaim?: string;
  /**
   * The flow's milestones — the claim sentence each step group is headed with, and
   * the section that states it, which the header links to. Matched to a step by
   * `order`; absent (a hand-written test, an unjoined run) leaves the group headed
   * by its number alone, with nothing to link to.
   */
  milestones?: readonly {
    order: number;
    claimTitle: string;
    doc?: string;
    anchor?: string;
    /** The live section's heading text; absent ⇒ the anchor stands in for it. */
    headingText?: string;
  }[];
  /**
   * Claim id → its sentence, for the steps that name their milestone by IDENTITY
   * rather than by position. An id the map doesn't answer for renders as itself:
   * the header always names the claim the group proves, never a blank and never
   * "Prepare".
   */
  claimTitles?: Readonly<Record<string, string>>;
  interfaceDrifted?: boolean;
  /**
   * True when the failing step was an UNMILESTONED preparation step — a prerequisite
   * the spec never asserts. Renders beside the failure so a red test that never
   * reached the specified behavior is not read as drift.
   */
  blockedPrecondition?: boolean;
  /** What the test is ultimately checking — the flow's goal. */
  goal?: string;
  flow?: { id: string; title: string };
  /**
   * The spec section the test binds to — the footer's Spec row. Optional: read
   * inside its own flow the milestone list above already links every section the
   * test walks, and a flow with no inventory row behind it has nothing to point at.
   */
  binds?: { doc: string; section: string; headingText?: string; fingerprint?: string };
  interfacePath: readonly string[];
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

/** One labelled line of the step panel — "expected", "actual", "output". */
function DiffRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <span className="w-14 shrink-0 pt-1.5 text-[10px] text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** A field with nothing behind it — said in words, never left as a blank. */
function NoValue({ children }: { children: ReactNode }) {
  return <p className="pt-1 text-[11px] italic leading-snug text-muted-foreground">{children}</p>;
}

/** The one thing an unrecorded field can honestly say. */
const NOT_RECORDED = 'not recorded in this run';

/**
 * WHAT A STEP DID, read inside the step: what it asserted, what it returned, and
 * what it printed while getting there. EVERY step carries it — a passing step's
 * actuals are as much a fact as a failing one's — so a reader learns one panel and
 * reads every row with it.
 *
 * Nothing here is invented. A step the viewed run never reached (it stopped at an
 * earlier failure) and every step of a test that has never run say so, in place of
 * the value they do not have.
 *
 * Every value is a long-data block — clamped vertically, scrolled horizontally,
 * never wrapped (a wrapped command line or JSON body lies about its shape).
 */
function StepPanel({
  expected,
  actual,
  stdout,
  stderr,
  recorded,
}: {
  /** What the step asserts, as authored — empty when it asserts nothing. */
  expected: string;
  /** What it returned: `exit 0`, `status 200`, the mismatch. Absent when it returns nothing. */
  actual?: string;
  stdout?: string;
  stderr?: string;
  /** Whether the viewed run has a record of this step at all — what tells "no output" from "not recorded". */
  recorded: boolean;
}) {
  return (
    <div className="mt-2 space-y-1">
      <DiffRow label="expected">
        {expected ? (
          <GuardLongText text={expected} label="expected value" />
        ) : (
          <NoValue>this step asserts nothing</NoValue>
        )}
      </DiffRow>
      <DiffRow label="actual">
        {actual ? (
          <GuardLongText text={actual} label="actual value" />
        ) : (
          <NoValue>{recorded ? 'the step returns no exit code' : NOT_RECORDED}</NoValue>
        )}
      </DiffRow>
      <DiffRow label="output">
        {stdout || stderr ? (
          <div className="space-y-1">
            {stdout && <GuardLongText text={stdout} label="step output" />}
            {stderr && <GuardLongText text={stderr} label="step error output" />}
          </div>
        ) : (
          <NoValue>{recorded ? 'the step printed nothing' : NOT_RECORDED}</NoValue>
        )}
      </DiffRow>
    </div>
  );
}

/**
 * ONE step: glyph · number · command, and — on click — the SAME panel every other
 * step carries: what it expected, what it actually returned, what it printed.
 *
 * Every row opens, because every row has the same thing to say. The one that FAILED
 * is open BY DEFAULT (that is the row the reader came for) and closable when they
 * are done with it; the rest start closed, one click from the same three fields.
 *
 * No row carries an "expects …" summary line any more: the labelled `expected` field
 * says the same thing, and a fact told twice reads as two facts.
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
  // The failing row leads with the MISMATCH (the assertion that actually missed and
  // what came back instead); every other row reads its record. An infra failure
  // carries no excerpts, so the record's output stands in for it.
  const recorded = step.actual ?? null;
  const panel = {
    expected: step.expectation || diff?.expected || '',
    actual: diff?.actual ?? recorded?.actual,
    ...(diff && (diff.stdout || diff.stderr)
      ? { stdout: diff.stdout, stderr: diff.stderr }
      : { stdout: recorded?.stdout, stderr: recorded?.stderr }),
    recorded: recorded != null || diff != null,
  };
  const [open, setOpen] = useState(failed);
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
      {/* WHAT the step drives, as a small leading chip. Never coloured: a kind is
          not a verdict, and the glyph on the left is the only thing on this row
          that says how the step fared. */}
      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
        {step.kind}
      </span>
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
      {/* The whole line is the target — a step is one thing to click, not a
          chevron a reader has to aim at. */}
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
      {/* Indented to the command column, so the detail reads as that step's. */}
      {open && (
        <div className="pb-2 pl-20 pr-3">
          {env}
          <StepPanel {...panel} />
        </div>
      )}
    </li>
  );
}

/**
 * Consecutive steps sharing one milestone reference — one section of the step
 * list. A step names its milestone by POSITION (a synthesized flow's `milestone:
 * 3`) or by CLAIM IDENTITY (`claims: [...]`, what a hand-authored test carries);
 * a group holds whichever kind its steps used. Both empty means the steps name no
 * milestone at all.
 */
type StepGroup = {
  milestone: number | null;
  claims: readonly string[];
  /** Set on an UNTAGGED group only — what its POSITION makes it (see the rule below). */
  heading?: 'Prepare' | 'Checks';
  steps: GuardScenarioStepView[];
};

/** A group that names a claim — by position or by identity. */
function isClaimGroup(group: StepGroup): boolean {
  return group.milestone != null || group.claims.length > 0;
}

/**
 * The grouping key: the position when there is one, else the claim-identity set.
 * The separator is a visible one on purpose — a NUL here made every tool that
 * reads this file (grep included) treat the whole thing as binary.
 */
function stepGroupKey(step: GuardScenarioStepView): string {
  if (step.milestone != null) return `m:${step.milestone}`;
  const claims = step.claims ?? [];
  return claims.length > 0 ? `c:${claims.join('␟')}` : 'untagged';
}

/**
 * The step list as SECTIONS: each milestone's steps under the claim they realize,
 * in file order — the claim named by position, or by identity for a test that tags
 * its steps with claim ids directly.
 *
 * A group whose steps name NEITHER is headed BY ITS POSITION, because position is
 * what such a group IS: preparation only means anything before the thing it
 * prepares, so an untagged group reads "Prepare" exactly while claim-tagged steps
 * still FOLLOW it. With no claim steps after it there is nothing left to prepare —
 * those are the trailing checks a test closes with, and they read "Checks".
 *
 * "Prepare" is these steps ACTING to arrange a condition; the page's "Setup"
 * section is the state that was already there before step 1. Two different things,
 * so two different words.
 */
export function groupStepsByMilestone(steps: readonly GuardScenarioStepView[]): StepGroup[] {
  const groups: StepGroup[] = [];
  let lastKey: string | null = null;
  for (const step of steps) {
    const key = stepGroupKey(step);
    const last = groups[groups.length - 1];
    if (last && lastKey === key) last.steps.push(step);
    else groups.push({ milestone: step.milestone ?? null, claims: step.claims ?? [], steps: [step] });
    lastKey = key;
  }
  return groups.map((group, i) =>
    isClaimGroup(group)
      ? group
      : { ...group, heading: groups.slice(i + 1).some(isClaimGroup) ? ('Prepare' as const) : ('Checks' as const) },
  );
}

/**
 * THE scenario rendering — sections only, no header and no scroll box of its own,
 * so it drops straight into the merged flow detail's body under the flow's header
 * and milestone list. {@link GuardTestView} is the same body with a header of its
 * own, for the run instance that has no flow header above it.
 *
 * The parent supplies the scrolling container and its `space-y-5 px-6 py-4` — one
 * spacing rhythm for the whole detail, whichever parent it is.
 */
export function GuardScenarioBody({
  repoId,
  test,
  interfaces,
  raw = false,
  action,
  notes,
  onOpenFlow,
  onOpenInterface,
  onOpenSpec,
}: {
  repoId: string;
  test: GuardTestViewModel;
  /** The mapped catalog, for the interfaces this test drives; null = unmapped. */
  interfaces: GuardInterfaceRow[] | null;
  /** The parent's artifact mode: true renders the stored YAML instead of the page. */
  raw?: boolean;
  /** The one ruling the page offers (the entity view only). */
  action?: ReactNode;
  /** Extra verdict-card notes (stale/orphaned bindings, "no result yet"). */
  notes?: ReactNode;
  onOpenFlow?: (flowId: string) => void;
  onOpenInterface?: (interfaceId: string) => void;
  onOpenSpec: (doc: string, section: string) => void;
}) {
  const [source, setSource] = useState<{
    file?: string;
    content: string;
    steps: GuardScenarioStepView[];
    setup?: GuardScenarioSetupView;
  } | null>(null);
  const [evidence, setEvidence] = useState<string | null>(null);
  const [evidenceBusy, setEvidenceBusy] = useState(false);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const ev = test.evidence;
  // WHERE this test ran, as the two primitives the read needs. Kept primitive on
  // purpose: the model object is rebuilt on every parent render, so depending on it
  // here would re-fetch the file for nothing.
  const evRunId = ev?.kind === 'run' ? ev.runId : null;
  const evPath = ev?.kind === 'birth' ? ev.path : null;

  useEffect(() => {
    setSource(null);
    api
      .getGuardScenarioSource(repoId, test.id, undefined, {
        ...(evRunId ? { runId: evRunId } : {}),
        ...(evPath ? { evidencePath: evPath } : {}),
      })
      .then((src) => {
        if (!mounted.current) return;
        setSource(
          src
            ? {
                ...(src.file ? { file: src.file } : {}),
                content: src.content,
                steps: src.steps ?? [],
                ...(src.setup ? { setup: src.setup } : {}),
              }
            : { content: 'Steps not found on disk.', steps: [] },
        );
      })
      .catch((e: unknown) => {
        if (mounted.current)
          setSource({ content: e instanceof Error ? e.message : 'Steps unavailable.', steps: [] });
      });
  }, [repoId, test.id, evRunId, evPath]);

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

  const failed = test.status.plain === 'failed';
  const passed = test.status.plain === 'succeeded' && !failed;
  // "failed (birth)" is the plan's own wording for a test committed red: it ran
  // once, at authoring time, and disagreed with the code.
  const verdictWord = failed ? (test.status.birth ? 'failed (birth)' : 'failed') : passed ? 'passed' : test.status.word.toLowerCase();
  const byId = new Map((interfaces ?? []).map((j) => [j.id, j]));
  const milestones = new Map((test.milestones ?? []).map((m) => [m.order, m]));
  // WHICH step is the open one is a fact about the VIEWED RESULT, so the step list
  // is keyed on it: reading another test — or this same test as another run's
  // record — re-opens that result's failing step instead of inheriting the toggle
  // the last one was left in.
  const resultKey = `${test.id}:${test.failure?.step ?? 'none'}`;

  if (raw) return <ArtifactRaw content={source?.content ?? null} label="test source" />;

  return (
    <>
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
              {/* WHOSE fault the failure is, beside the fact that it failed. The
                  status says the test is red; this says whether that is drift in
                  the repo or a defect of ours. */}
              {test.triage && <GuardTriageChip triage={test.triage} />}
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
                {/* The unblock the verdict recommends — the one line a reader acts
                    on. The reasoning behind it stays in the chip's hover. */}
                {test.triage && (
                  <div className="mt-1 text-[12px] leading-snug text-muted-foreground">
                    <span className="text-foreground">Do: </span>
                    {test.triage.recommendation}
                  </div>
                )}
              </div>
            )}

            {test.interfaceDrifted && (
              <HoverPopover portal
                align="start"
                width="wide"
                content="The live interface catalog no longer matches the fingerprints this test was grounded on — the code surface it was derived from moved. Never a pass/fail input; re-generate to re-ground it."
              >
                {/* Never a verdict, so never a verdict colour: an unknown reads
                    grey, like every other state nothing has ruled on. */}
                <div className="mt-2 flex items-center gap-2 text-[12px] text-muted-foreground">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-slate-400" />
                  Interface drift — the mapped surface moved since this test was written
                </div>
              </HoverPopover>
            )}

            {notes}
            {action}
          </div>
        </div>

        {/* 3. The world the steps start in — rendered only for a test that declares
               one, so a scenario with no `setup:` block shows no heading at all. */}
        {source?.setup && (
          <div>
            <div className={LABEL}>Setup</div>
            <GuardTestSetup setup={source.setup} />
          </div>
        )}

        {/* 4. The steps, as steps — grouped under the claim each one realizes, with
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
                {groupStepsByMilestone(source.steps).map((group, i) => {
                  const milestone = group.milestone != null ? milestones.get(group.milestone) : undefined;
                  return (
                  <div
                    key={`${group.milestone ?? (group.claims.join(' ') || 'untagged')}-${i}`}
                    className="border-b border-border last:border-b-0"
                  >
                    <div className="flex min-w-0 items-start gap-2 bg-muted/40 px-3 py-1.5 text-[11px] leading-snug">
                      <span className="min-w-0 flex-1">
                      {group.milestone != null ? (
                        <>
                          <span className="font-medium text-foreground">Milestone {group.milestone}</span>
                          {milestone?.claimTitle && (
                            <span className="text-muted-foreground"> — {milestone.claimTitle}</span>
                          )}
                        </>
                      ) : group.claims.length > 0 ? (
                        // Named by IDENTITY, not position: the header is the claim
                        // itself. An id the corpus doesn't name renders as the id —
                        // these steps prove a promise, and saying so is the point.
                        <span className="font-medium text-foreground">
                          {group.claims.map((id) => test.claimTitles?.[id] ?? id).join(' · ')}
                        </span>
                      ) : (
                        // The two headers that name no claim, told apart by where the
                        // group sits (see `groupStepsByMilestone`). Each says what it
                        // IS on hover rather than leaving a reader to wonder which
                        // promise these steps serve.
                        <HoverPopover
                          portal
                          width="narrow"
                          content={
                            group.heading === 'Checks'
                              ? 'Runs after the last claim these steps could prepare — not tied to a spec promise.'
                              : 'Arranges a condition the claim steps below it prove — not itself tied to a spec promise.'
                          }
                        >
                          <span className="font-medium text-foreground underline decoration-dotted underline-offset-2">
                            {group.heading ?? 'Prepare'}
                          </span>
                        </HoverPopover>
                      )}
                      </span>
                      {/* The section that STATES this claim — the one link the
                          retired milestone list carried, now on the header of the
                          steps that prove it. A group the corpus does not place
                          (an identity-tagged one, a hand-written test) has no
                          section to point at and shows none. */}
                      {milestone?.doc && milestone.anchor && (
                        <button
                          type="button"
                          onClick={() => onOpenSpec(milestone.doc!, milestone.anchor!)}
                          title={`${milestone.doc} § ${milestone.anchor}`}
                          className="inline-flex min-w-0 max-w-[45%] shrink-0 items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                        >
                          <span className="min-w-0 truncate">§ {milestone.headingText ?? milestone.anchor}</span>
                          <ArrowUpRight className="h-3 w-3 shrink-0" />
                        </button>
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
                  );
                })}
              </div>
            ) : (
              <>
                {test.failure && (
                  <div className="rounded border border-red-500/60 px-3 py-2">
                    <div className="text-[11px] text-muted-foreground">
                      Step <span className="text-foreground">{test.failure.step}</span> —{' '}
                      <span className="text-red-600 dark:text-red-400">failed</span>
                    </div>
                    {/* No step list to hang it on — the same panel, standing alone. */}
                    <StepPanel
                      expected={test.failure.expected}
                      actual={test.failure.actual}
                      {...(test.failure.stdout ? { stdout: test.failure.stdout } : {})}
                      {...(test.failure.stderr ? { stderr: test.failure.stderr } : {})}
                      recorded
                    />
                  </div>
                )}
                <pre className={PRE}>{source == null ? 'Loading steps…' : source.content}</pre>
              </>
            )}
          </div>
        </div>

        {/* 5. Evidence — ONE transcript, never repeated as separate sections. */}
        {ev && (
          <div>
            <div className={LABEL}>Evidence</div>
            <GuardLongText text={evidenceBusy ? 'Loading transcript…' : evidence ?? ''} label="evidence transcript" />
          </div>
        )}

        {/* 6. The interface it drives — context, not verdict, so it comes last. */}
        <div>
          <div className={LABEL}>Interface</div>
          {test.interfacePath.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">
              This test records no interface path (hand-written, or written before mapping).
            </p>
          ) : (
            <div className="space-y-2">
              {test.interfacePath.map((id) => {
                const iface = byId.get(id);
                return (
                  <div key={id}>
                    <button
                      type="button"
                      onClick={() => onOpenInterface?.(id)}
                      disabled={!onOpenInterface}
                      className="mb-1 inline-flex items-center gap-1 font-mono text-[11px] text-primary hover:underline disabled:no-underline"
                    >
                      <Route className="h-3 w-3" />
                      {id}
                    </button>
                    {iface ? (
                      <GuardInterfaceDiagram iface={iface} label={iface.id} />
                    ) : (
                      <p className="text-[12px] text-muted-foreground">
                        Not in the current catalog — run Map on the Interfaces tab to re-derive it.
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
          {test.binds && (
            <FootRow label="Spec">
              <button
                type="button"
                onClick={() => onOpenSpec(test.binds!.doc, test.binds!.section)}
                className={FOOT_BTN}
              >
                <span className={FOOT_TEXT}>{test.binds.headingText ?? test.binds.doc}</span>
                <span className={`${FOOT_TEXT} text-muted-foreground`}>§ {test.binds.section}</span>
                <ArrowUpRight className="h-3 w-3 shrink-0" />
              </button>
            </FootRow>
          )}
        </dl>
    </>
  );
}

/**
 * The scenario body under a header of its OWN — the run instance's screen, where
 * there is no flow header above it to carry the title, the status and the mode
 * switch. Everything below the header is {@link GuardScenarioBody}, the same
 * rendering the merged flow detail embeds.
 */
export function GuardTestView({
  repoId,
  test,
  interfaces,
  action,
  headerAction,
  notes,
  onOpenFlow,
  onOpenInterface,
  onOpenSpec,
}: {
  repoId: string;
  test: GuardTestViewModel;
  interfaces: GuardInterfaceRow[] | null;
  action?: ReactNode;
  /** A link out of this page (the run instance's "open this flow"). */
  headerAction?: ReactNode;
  notes?: ReactNode;
  onOpenFlow?: (flowId: string) => void;
  onOpenInterface?: (interfaceId: string) => void;
  onOpenSpec: (doc: string, section: string) => void;
}) {
  // The two readings of ONE file: this page, or the YAML it was read from.
  const { mode, setMode, raw } = useArtifactMode('YAML');
  return (
    <div className="flex h-full min-w-0 flex-col bg-background">
      <div className="min-w-0 border-b border-border bg-card px-6 py-4">
        <h2 className="break-words text-sm font-semibold text-foreground">{test.title}</h2>
        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-2">
          {/* The status word sits FIRST, the way it does on every guard row and
              header. No surface chip: one surface, no information. */}
          <GuardFlowStatusChip status={test.status.plain} word={test.status.word} />
          <span className="text-[11px] text-muted-foreground">{test.provenance}</span>
          <ArtifactModeSwitch format="YAML" mode={mode} onSelect={setMode} className="ml-auto" />
        </div>
        {headerAction}
      </div>

      {/* The pane owns HEIGHT scrolling only: `overflow-y-auto` alone would compute
          the x axis to `auto` too and let one wide line scroll the whole page
          sideways, so x is clipped here and the code blocks scroll themselves. */}
      <div className="min-w-0 flex-1 space-y-5 overflow-y-auto overflow-x-hidden px-6 py-4">
        <GuardScenarioBody
          repoId={repoId}
          test={test}
          interfaces={interfaces}
          raw={raw}
          {...(action ? { action } : {})}
          {...(notes ? { notes } : {})}
          {...(onOpenFlow ? { onOpenFlow } : {})}
          {...(onOpenInterface ? { onOpenInterface } : {})}
          onOpenSpec={onOpenSpec}
        />
      </div>
    </div>
  );
}
