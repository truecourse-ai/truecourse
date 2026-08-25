/**
 * A TEST, rendered ONCE — the ONE scenario rendering in guard.
 *
 * Two things can feed it: the flow's own committed test (read inside the merged
 * FLOW detail, which is the entity) or an INSTANCE — how that test ran in one run,
 * on the Runs tab. The body is identical — only the provenance and the result that
 * feeds it differ — so a reader learns it once.
 *
 * IT IS ONE COLUMN AND ONE SCROLL. The page reads top to bottom at every screen
 * size; the hosting pane scrolls, and nothing inside it nests a vertical scroll
 * of its own.
 *
 *   verdict band    a fit-width card: the status word, the triage verdict, where
 *                   it broke (clickable — it expands that step and scrolls to it)
 *                   and the one "Next:" a reader acts on
 *   filmstrip       a browser run only: one tile per captured step, in step order,
 *                   the failing tile marked. Clicking a tile expands its step and
 *                   brings its picture into view; Replay plays the session video
 *                   in a modal
 *   the steps       every step as ONE dense collapsible line. Opening a row reads
 *                   its whole record inline — result, output, picture, run
 *                   conditions — and closing it gives the line back. The failing
 *                   step starts open.
 *   the record      Transcript and Interfaces, collapsible, stacked one after the
 *                   other; the rulings stand OPEN below them — a decision surface
 *                   is not something to hide behind a toggle
 *   footer          Test · File · Flow · Spec, on one line
 *
 * FAILURE OWNS THE FIRST OPEN ROW, and says so in redundant channels: the verdict
 * band names it, the row is tinted, its filmstrip tile is marked. Error tint is the
 * ONLY per-row colour — a rainbow of per-status row fills would make the one red
 * row worth nothing.
 *
 * FOUR FACTS PER STEP ROW: mark · number · kind · command, with the duration right
 * aligned. Collapsed rows never wrap and never grow — a long command ellipsises and
 * keeps its whole text in the title — because the closed list is for SCANNING; the
 * reading happens inside the opened row.
 *
 * THE MILESTONE IS A DIVIDER, NOT A BAND. A group of steps is headed by its number
 * alone (`M2`) and a link to the section it proves; the claim SENTENCE reads at the
 * top of every opened step in the group, which is where a reader asking "what was
 * this step for?" already is. A full-width claim band per group cost more vertical
 * space than the steps it introduced.
 *
 * SETUP IS STEP 0. The `setup:` block is the world step 1 starts in, so it reads as
 * a pseudo-row at the top of the same list — expandable like any other step, with
 * the seeded files, the git world and the env overlay inline.
 *
 * AN OPEN ROW IS HONEST. A step's record speaks its own surface — a cli step is
 * never offered browser vocabulary and a browser step is never offered an exit
 * code — and a field that applies but has nothing behind it says so in words
 * ("the step printed nothing", "not recorded in this run"): a blank is the one
 * thing a reader cannot act on.
 *
 * TWO READINGS of one file, on the header's shared mode switch: View (this page)
 * and YAML (the stored artifact itself). Every artifact-backed entity offers exactly
 * that pair, through the same component — see {@link ArtifactModeSwitch}.
 *
 * {@link GuardScenarioBody} is the workspace — the flow detail embeds it under the
 * flow's own header, where it claims the height the header leaves.
 * {@link GuardTestView} wraps it in a header of its own for the RUN INSTANCE, which
 * has no flow header above it. Same component, one implementation, no parallel test
 * screen.
 *
 * NO SURFACE LABEL rides here. Guard runs one surface per flow today, so "CLI test"
 * only ever restated the same word on every row and every header. When a second
 * surface exists it returns as a plain label beside the title — not a chip.
 *
 * NOTHING SCROLLS SIDEWAYS. Wide DATA (an expected value, an output, a
 * transcript) WRAPS in place ({@link GuardLongText}) so it reads without a
 * horizontal scrollbar; only the indentation-sensitive raw source keeps an
 * unwrapped block ({@link PRE}), the one horizontal scroll on the screen.
 * Structurally that costs one thing everywhere: every flex box between the
 * hosting pane (`data-pane`) and such a block carries `min-w-0`, so a wide child
 * shrinks its column instead of stretching the page, and every truncating span
 * is width-bound rather than free to grow. Vertically, the hosting pane is the
 * only scroll context.
 */

import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowDown,
  ArrowUpRight,
  Braces,
  ChevronRight,
  Copy,
  ScrollText,
  Wrench,
} from "lucide-react";
import type {
  GuardEvidenceVisual,
  GuardFailureDetail,
  GuardInterfaceRow,
  GuardScenarioSetupView,
  GuardScenarioStepView,
  GuardStepApiCheck,
  GuardStepWebActual,
  GuardTriage,
  GuardVisualAnnotation,
} from "@truecourse/shared";
import {
  ArtifactModeSwitch,
  ArtifactRaw,
  useArtifactMode,
} from "@/components/ui/artifact-view";
import { HoverPopover } from "@/components/ui/hover-popover";
import * as api from "@/lib/api";
import { renderInlineMarkup } from "@/lib/inline-markup";
import { formatGuardDuration } from "@/lib/guard-drifts";
import type { GuardTestStatusView } from "@/lib/guard-flow-status";
import {
  GuardRunFilmstrip,
  GuardScreenshotLightbox,
  GuardStepScreenshot,
} from "./GuardEvidenceVisuals";
import { GuardLongText } from "./GuardLongText";
import { GuardTestSetup } from "./GuardTestSetup";
import { GuardTriageChip } from "./GuardTriageChip";
import { GuardVisualChip } from "./GuardVisualChip";
import { GuardFlowStatusChip } from "./GuardStatusBadge";
import { PRE } from "./detail-styles";

/** The section label every panel wears ABOVE its frame — Verdict, Steps, … */
const LABEL =
  "mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground";
/** A truncating label inside a footer fact — it must shrink, or it stretches the row. */
const FOOT_TEXT = "min-w-0 truncate";
const FOOT_BTN =
  "inline-flex min-w-0 max-w-full cursor-pointer items-center gap-1 rounded text-[11px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary";

/** One fact on the footer's single line — "Test <id>", "File <path>". */
function FootFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 max-w-full items-baseline gap-1.5">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate">{children}</dd>
    </div>
  );
}

/** Where a transcript lives: under a run, or at the birth path the generate wrote. */
export type GuardEvidenceRef =
  | { kind: "run"; runId: string }
  | { kind: "birth"; path: string };

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
   * the section that states it, which the divider links to. Matched to a step by
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
   * the divider always names the claim the group proves, never a blank and never
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
   * The spec section the test binds to — the footer's Spec fact. Optional: read
   * inside its own flow the step dividers already link every section the test
   * walks, and a flow with no inventory row behind it has nothing to point at.
   */
  binds?: {
    doc: string;
    section: string;
    headingText?: string;
    fingerprint?: string;
  };
  interfacePath: readonly string[];
  evidence: GuardEvidenceRef | null;
}

/** The pseudo-step the `setup:` block reads as — the world step 1 starts in. */
const SETUP_STEP = 0;

type StepOutcome = "passed" | "failed" | "skipped";

/** Per-step outcome from the viewed result: pass up to the failure, fail at it, not-reached after. */
function stepOutcome(
  n: number,
  failedStep: number | undefined,
  passed: boolean,
): { outcome: StepOutcome; label: string } {
  if (failedStep != null) {
    if (n < failedStep) return { outcome: "passed", label: "passed" };
    if (n === failedStep) return { outcome: "failed", label: "failed" };
    return { outcome: "skipped", label: "not reached" };
  }
  return passed
    ? { outcome: "passed", label: "passed" }
    : { outcome: "skipped", label: "not run" };
}

const STEP_DOT: Record<StepOutcome, string> = {
  passed: "bg-emerald-500",
  failed: "bg-red-500",
  skipped: "bg-slate-400",
};

/**
 * The left strip a step row wears — coloured only where a verdict landed.
 * Painted as an inset shadow, not a border: two borders on one box miter into
 * each other with a diagonal seam, and the strip's ends must stay square.
 */
const STEP_BAND: Record<StepOutcome, string> = {
  passed: "shadow-[inset_2px_0_0_0_#10b981]",
  failed: "shadow-[inset_2px_0_0_0_#ef4444]",
  skipped: "",
};

/** The one mark a step wears — the product-wide status dot, in its outcome's colour. */
function StepMark({ outcome }: { outcome: StepOutcome }) {
  return (
    <span
      aria-hidden
      className={`h-2 w-2 shrink-0 rounded-full ${STEP_DOT[outcome]}`}
    />
  );
}

/**
 * One labelled line of a step panel — "expected", "actual", "output". The
 * verdict mark lives INSIDE the fixed-width label column so every value box
 * starts at the same left edge whether or not its row carries a mark.
 */
function DiffRow({
  label,
  mark,
  children,
}: {
  label: string;
  mark?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <span className="flex w-14 shrink-0 items-baseline justify-between gap-1 pt-1.5 text-[10px] text-muted-foreground">
        {label}
        {mark}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** A field with nothing behind it — said in words, never left as a blank. */
function NoValue({ children }: { children: ReactNode }) {
  return (
    <p className="pt-1 text-[11px] italic leading-snug text-muted-foreground">
      {children}
    </p>
  );
}

/** The one thing an unrecorded field can honestly say. */
const NOT_RECORDED = "not recorded in this run";

/**
 * EVERY member of a step's expectation beside the answer THAT member got — the
 * honest pairing, in one component because it is one idea on every surface: a
 * browser step asserting an address and the page's words has two answers, and so
 * does a request step asserting a status and a json path. Showing one of them
 * beside all the assertions reads as a failure on a step that passed.
 */
function CheckRows({
  checks,
}: {
  checks: readonly { expected: string; actual: string; ok: boolean }[];
}) {
  return (
    <>
      {checks.map((check, i) => (
        <Fragment key={`${check.expected}-${i}`}>
          <DiffRow
            label="expected"
            mark={
              <span
                role="img"
                aria-label={check.ok ? "met" : "not met"}
                className={`h-2 w-2 shrink-0 self-center rounded-full ${
                  check.ok ? "bg-emerald-500" : "bg-red-500"
                }`}
              />
            }
          >
            <GuardLongText text={check.expected} label="expected value" />
          </DiffRow>
          <DiffRow label="actual">
            <GuardLongText text={check.actual} label="actual value" />
          </DiffRow>
        </Fragment>
      ))}
    </>
  );
}

/**
 * THE JUDGE'S READING, under the PICTURE it read — what a vision model
 * saw in the screenshot the step left behind, under its own label so it never
 * reads as one of the measured rows above it. It follows the `screen` row
 * because it is a reading OF that picture; a judged failure whose bytes are
 * missing keeps the row, since the verdict is still the honest record. The `yes` sentence is
 * the whole reason the judge exists: a reader looking at a red step needs to
 * know the disagreement may be the assertion's, not the page's.
 */
function VisualJudgeRow({ visual }: { visual: GuardVisualAnnotation }) {
  return (
    <DiffRow label="on screen">
      <div className="space-y-1 pt-1 text-[11px] leading-snug">
        <p className="text-foreground">{visual.summary}</p>
        {visual.rationale && (
          <p className="text-foreground">{visual.rationale}</p>
        )}
        {visual.verdict === "yes" && (
          <p className="text-sky-700 dark:text-sky-300">
            The expected result appears visible, so the assertion itself may be
            wrong — a brittle locator or matcher — rather than the page.
          </p>
        )}
        <p className="italic text-muted-foreground">
          a vision model’s reading of the step’s screenshot — the expectation
          above alone decided this step
        </p>
      </div>
    </DiffRow>
  );
}

/**
 * WHAT A STEP DID, as the four things a reader asks for in the order they ask.
 * EVERY step carries the same set — a passing step's actuals are as much a fact as
 * a failing one's — so a reader learns one inspector and reads every row with it.
 *
 * The panels speak the step's OWN surface: a cli or api step returns a code and
 * prints streams; a web step ends up at an address, shows a page and logs to a
 * console. A step with no record of its own reads the same either way — the
 * authored expectation, and the honest absence of everything else.
 *
 * Nothing here is invented. A step the viewed run never reached (it stopped at an
 * earlier failure) and every step of a test that has never run say so, in place of
 * the value they do not have.
 *
 * Every value is a long-data block — clamped vertically, scrolled horizontally,
 * never wrapped (a wrapped command line or JSON body lies about its shape).
 */
interface StepPanelProps {
  /** What the step asserts, as authored — empty when it asserts nothing. */
  expected: string;
  /** What it returned: `exit 0`, `status 200`, the mismatch. Absent when it returns nothing. */
  actual?: string;
  stdout?: string;
  stderr?: string;
  /** Whether the viewed run has a record of this step at all — what tells "no output" from "not recorded". */
  recorded: boolean;
  /** The browser's record, on a web step the viewed run took. */
  web?: GuardStepWebActual;
  /** Each assertion beside its own answer, on a request step the viewed run took. */
  checks?: readonly GuardStepApiCheck[];
  /** The vision judge's reading of the step's screenshot, on a judged failure. */
  visual?: GuardVisualAnnotation;
}

/**
 * The RESULT tab: what the step asserted, what it got back, and — on a browser
 * step — where it ended up and what the page showed. The judge's reading rides
 * here too, under its own label, because it is about this same verdict.
 */
function ResultPanel({
  expected,
  actual,
  recorded,
  web,
  checks,
  visual,
}: StepPanelProps) {
  const pairs = web ? web.checks : (checks ?? []);
  return (
    <div className="space-y-1">
      {pairs.length > 0 ? (
        <CheckRows checks={pairs} />
      ) : (
        <>
          <DiffRow label="expected">
            {expected ? (
              <GuardLongText text={expected} label="expected value" head={8} />
            ) : (
              <NoValue>this step asserts nothing</NoValue>
            )}
          </DiffRow>
          <DiffRow label="actual">
            {actual ? (
              <GuardLongText text={actual} label="actual value" head={8} />
            ) : (
              <NoValue>
                {web
                  ? expected
                    ? "the step did not get past its action, so nothing was asserted"
                    : "nothing was asserted"
                  : recorded
                    ? "the step returns no exit code"
                    : NOT_RECORDED}
              </NoValue>
            )}
          </DiffRow>
        </>
      )}
      {web && (
        <>
          <DiffRow label="at">
            <GuardLongText text={web.url} label="page address" head={8} />
          </DiffRow>
          <DiffRow label="page text">
            {web.text ? (
              <GuardLongText text={web.text} label="page text" head={8} />
            ) : (
              <NoValue>the page showed no text</NoValue>
            )}
          </DiffRow>
        </>
      )}
    </div>
  );
}

/**
 * The OUTPUT tab: what the step PRINTED while doing what it did. A browser step
 * spawns nothing — no exit code, no streams — so the only stream it has is the
 * page's own console, and the panel says so in the browser's words rather than
 * inventing an "exit 0" it never had.
 */
function OutputPanel({ stdout, stderr, recorded, web }: StepPanelProps) {
  if (web) {
    const console = web.console ?? [];
    return (
      <DiffRow label="console">
        {console.length > 0 ? (
          <GuardLongText
            text={console.join("\n")}
            label="page console"
            head={8}
          />
        ) : (
          <NoValue>
            {recorded ? "the page logged nothing" : NOT_RECORDED}
          </NoValue>
        )}
      </DiffRow>
    );
  }
  return (
    <DiffRow label="output">
      {stdout || stderr ? (
        <div className="space-y-1">
          {stdout && <GuardLongText text={stdout} label="step output" head={8} />}
          {stderr && (
            <GuardLongText text={stderr} label="step error output" head={8} />
          )}
        </div>
      ) : (
        <NoValue>{recorded ? "the step printed nothing" : NOT_RECORDED}</NoValue>
      )}
    </DiffRow>
  );
}

/** The detail shown for one authored step in the inspector. */
function stepPanelProps(
  step: GuardScenarioStepView,
  failedStep: number | undefined,
  failure?: GuardFailureDetail,
): StepPanelProps {
  const diff = step.n === failedStep && failure ? failure : null;
  const recorded = step.actual ?? null;
  const checks = recorded?.checks ?? [];
  const showChecks =
    checks.length > 0 && (!diff || checks.some((check) => !check.ok));
  return {
    expected: step.expectation || diff?.expected || "",
    ...((diff?.actual ?? recorded?.actual)
      ? { actual: diff?.actual ?? recorded?.actual }
      : {}),
    ...(recorded?.web ? { web: recorded.web } : {}),
    ...(diff?.visual ? { visual: diff.visual } : {}),
    ...(showChecks ? { checks } : {}),
    ...(diff && (diff.stdout || diff.stderr)
      ? {
          ...(diff.stdout ? { stdout: diff.stdout } : {}),
          ...(diff.stderr ? { stderr: diff.stderr } : {}),
        }
      : {
          ...(recorded?.stdout ? { stdout: recorded.stdout } : {}),
          ...(recorded?.stderr ? { stderr: recorded.stderr } : {}),
        }),
    recorded: recorded != null || diff != null,
  };
}

/** The row height every closed step line keeps — one line, four facts. */
const STEP_ROW =
  "flex h-7 w-full min-w-0 cursor-pointer items-center gap-2 px-2.5 text-left outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary";
/** The kind token — a fact about the step, never a verdict, so never coloured. */
const STEP_KIND =
  "shrink-0 rounded bg-muted px-1 py-px text-[10px] font-medium text-muted-foreground";

/** The chevron every collapsible row leads with — pointing at what a click does. */
function RowChevron({ open }: { open: boolean }) {
  return (
    <ChevronRight
      aria-hidden
      className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform ${
        open ? "rotate-90" : ""
      }`}
    />
  );
}

/**
 * ONE collapsible step: mark · number · kind · command on the closed line, with
 * its duration right aligned; clicking opens the step's whole record inline
 * under it ({@link StepBody}). The closed command never wraps — the closed list
 * is for scanning, and the whole text stays reachable in the title and in the
 * opened record.
 */
function StepRow({
  step,
  failedStep,
  passed,
  open,
  onToggle,
  rowRef,
  children,
}: {
  step: GuardScenarioStepView;
  failedStep: number | undefined;
  passed: boolean;
  /** Whether the step's record is expanded under its line. */
  open: boolean;
  onToggle: () => void;
  rowRef?: (node: HTMLLIElement | null) => void;
  /** The expanded record; rendered only while open. */
  children?: ReactNode;
}) {
  const { outcome, label } = stepOutcome(step.n, failedStep, passed);
  const duration = step.actual?.durationMs;

  return (
    <li
      ref={rowRef}
      aria-label={`Step ${step.n}: ${step.command} — ${label}`}
      className={`border-b border-border/50 last:border-b-0 ${STEP_BAND[outcome]}`}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`guard-step-body-${step.n}`}
        aria-label={`Step ${step.n} record`}
        title={step.command}
        onClick={onToggle}
        className={STEP_ROW}
      >
        <RowChevron open={open} />
        <StepMark outcome={outcome} />
        <span className="w-4 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
          {step.n}
        </span>
        <span className={STEP_KIND}>{step.kind}</span>
        {step.teardown && (
          <span className="shrink-0 rounded bg-sky-500/15 px-1 py-px text-[10px] font-medium text-sky-700 dark:text-sky-300">
            teardown
          </span>
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground">
          {step.command}
        </span>
        {duration != null && (
          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
            {formatGuardDuration(duration)}
          </span>
        )}
      </button>
      {open && <div id={`guard-step-body-${step.n}`}>{children}</div>}
    </li>
  );
}

/**
 * STEP 0 — the world the steps start in, as a row of the same list. The `setup:`
 * block is not a section above the investigation: it is the state that was already
 * true when step 1 ran, which makes it the first thing in the sequence a reader
 * walks. It renders only when the file declares one.
 */
function SetupRow({
  open,
  onToggle,
  rowRef,
  setup,
}: {
  open: boolean;
  onToggle: () => void;
  rowRef?: (node: HTMLLIElement | null) => void;
  setup: GuardScenarioSetupView;
}) {
  return (
    <li
      ref={rowRef}
      aria-label="Step 0: setup — the world the steps start in"
      className="border-b border-border/50"
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls="guard-step-body-setup"
        aria-label="Setup record"
        onClick={onToggle}
        className={STEP_ROW}
      >
        <RowChevron open={open} />
        <Wrench aria-hidden className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span className="w-4 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
          0
        </span>
        <span className={STEP_KIND}>setup</span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
          the world the steps start in
        </span>
      </button>
      {open && (
        <div
          id="guard-step-body-setup"
          className="border-t border-border/50 px-2.5 py-2"
        >
          <GuardTestSetup setup={setup} framed={false} />
        </div>
      )}
    </li>
  );
}

/**
 * One step's whole record, inline under its row, as the labelled rows a reader
 * asks for in order: what it asserted and got, what it printed, the picture it
 * left, and the conditions it ran under. Every value is a long-data block —
 * clamped by its own expander, scrolled horizontally, never wrapped.
 */
function StepBody({
  step,
  failedStep,
  passed,
  failure,
  claim,
  claimLink,
  picture,
}: {
  step: GuardScenarioStepView;
  failedStep: number | undefined;
  passed: boolean;
  failure?: GuardFailureDetail;
  claim?: string;
  /** The spec section stating the claim — the jump the divider used to carry. */
  claimLink?: { label: string; onOpen: () => void };
  /** The step's picture, when the run's evidence bundle holds one for it. */
  picture?: ReactNode;
}) {
  const failed = stepOutcome(step.n, failedStep, passed).outcome === "failed";
  const panel = stepPanelProps(step, failedStep, failure);
  return (
    <div className="space-y-1 border-t border-border/50 px-2.5 py-2">
      {claim && (
        <p className="text-[11px] leading-snug text-muted-foreground">
          {claim}
          {claimLink && (
            <button
              type="button"
              onClick={claimLink.onOpen}
              aria-label={claimLink.label}
              className="ml-1.5 inline-flex cursor-pointer items-center gap-0.5 rounded align-baseline text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
            >
              <span aria-hidden className="text-[11px] leading-none">
                §
              </span>
              <ArrowUpRight aria-hidden className="h-3 w-3" />
            </button>
          )}
        </p>
      )}
      {failed && (
        <p className="text-[11px] leading-snug text-red-700 dark:text-red-400">
          Execution stopped here. The steps after this one were not reached.
        </p>
      )}
      <ResultPanel {...panel} />
      <OutputPanel {...panel} />
      {!picture && !panel.web?.screenshot && panel.visual && (
        <VisualJudgeRow visual={panel.visual} />
      )}
      {picture ? (
        <>
          <DiffRow label="screen">
            <div id={`guard-step-screen-${step.n}`} className="max-w-xl pt-1">
              {picture}
            </div>
          </DiffRow>
          {panel.visual && <VisualJudgeRow visual={panel.visual} />}
        </>
      ) : (
        panel.web?.screenshot && (
          // The picture's bytes are not in this bundle — its recorded file
          // name is the honest remainder of the record.
          <>
            <DiffRow label="screen">
              <p className="pt-1 font-mono text-[11px] leading-snug text-muted-foreground">
                {panel.web.screenshot}
              </p>
            </DiffRow>
            {panel.visual && <VisualJudgeRow visual={panel.visual} />}
          </>
        )
      )}
      <InfoPanel step={step} />
    </div>
  );
}

/**
 * The conditions the step ran under, and the note it was written with. A step
 * with nothing set around it renders nothing — inline, an empty-conditions line
 * on every row would be noise, not honesty.
 */
function InfoPanel({ step }: { step: GuardScenarioStepView }) {
  const env = step.env && step.env.length > 0 ? step.env.join(" ") : null;
  const repeat = step.repeat != null && step.repeat > 1 ? step.repeat : null;
  if (!env && !step.cwd && !step.note && !repeat) return null;
  return (
    <div className="space-y-1">
      {env && (
        <DiffRow label="env">
          <p className="break-words pt-1 font-mono text-[11px] leading-snug text-foreground">
            {env}
          </p>
        </DiffRow>
      )}
      {step.cwd && (
        <DiffRow label="cwd">
          <p className="break-words pt-1 font-mono text-[11px] leading-snug text-foreground">
            {step.cwd}
          </p>
        </DiffRow>
      )}
      {repeat && (
        <DiffRow label="repeat">
          <p className="pt-1 text-[11px] leading-snug text-foreground">
            ×{repeat}
          </p>
        </DiffRow>
      )}
      {step.note && (
        <DiffRow label="note">
          <p className="pt-1 text-[11px] leading-snug text-muted-foreground">
            {renderInlineMarkup(step.note)}
          </p>
        </DiffRow>
      )}
    </div>
  );
}

/**
 * The recorded failure's record — the run outlived the scenario revision it
 * executed, so the evidence renders without pretending a current authored row
 * is the one that ran.
 */
function RecordedFailureBody({ failure }: { failure: GuardFailureDetail }) {
  const panel: StepPanelProps = {
    expected: failure.expected,
    ...(failure.actual ? { actual: failure.actual } : {}),
    ...(failure.stdout ? { stdout: failure.stdout } : {}),
    ...(failure.stderr ? { stderr: failure.stderr } : {}),
    ...(failure.visual ? { visual: failure.visual } : {}),
    recorded: true,
  };
  return (
    <div className="space-y-1 border-t border-border/50 px-2.5 py-2">
      <p className="text-[11px] leading-snug text-muted-foreground">
        This run used an earlier test revision. Step {failure.step} is not in
        the current YAML, but its failure and captured evidence are preserved
        here.
      </p>
      <p className="text-[11px] leading-snug text-red-700 dark:text-red-400">
        Execution stopped here. The recorded action did not complete.
      </p>
      <ResultPanel {...panel} />
      <OutputPanel {...panel} />
      {panel.visual && <VisualJudgeRow visual={panel.visual} />}
    </div>
  );
}

/** The recorded-failure row, at the head of a list it is no longer part of. */
function RecordedFailureRow({
  failure,
  open,
  onToggle,
  rowRef,
}: {
  failure: GuardFailureDetail;
  open: boolean;
  onToggle: () => void;
  rowRef: (node: HTMLLIElement | null) => void;
}) {
  return (
    <div className="border-b border-border">
      <div className="px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Recorded run · earlier test revision
      </div>
      <ol>
        <li
          ref={rowRef}
          aria-label={`Step ${failure.step}: recorded run failure — failed`}
          className={STEP_BAND.failed}
        >
          <button
            type="button"
            aria-expanded={open}
            aria-controls="guard-step-body-recorded"
            aria-label={`Step ${failure.step} record`}
            title={failure.expected}
            onClick={onToggle}
            className={STEP_ROW}
          >
            <RowChevron open={open} />
            <StepMark outcome="failed" />
            <span className="w-4 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
              {failure.step}
            </span>
            <span className={STEP_KIND}>recorded</span>
            <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground">
              {failure.expected}
            </span>
          </button>
          {open && (
            <div id="guard-step-body-recorded">
              <RecordedFailureBody failure={failure} />
            </div>
          )}
        </li>
      </ol>
    </div>
  );
}

/** The claim or preparation phase a selected step belongs to. */
function stepClaim(
  step: GuardScenarioStepView | null,
  test: GuardTestViewModel,
  milestones: ReadonlyMap<
    number,
    NonNullable<GuardTestViewModel["milestones"]>[number]
  >,
): string | undefined {
  if (!step) return undefined;
  if (step.milestone != null) {
    const milestone = milestones.get(step.milestone);
    return milestone
      ? `Milestone ${step.milestone} — ${milestone.claimTitle}`
      : `Milestone ${step.milestone}`;
  }
  if (step.claims && step.claims.length > 0) {
    return step.claims.map((id) => test.claimTitles?.[id] ?? id).join(" · ");
  }
  return undefined;
}

function InterfacePathSection({
  path,
  interfaces,
  onOpenInterface,
}: {
  path: readonly string[];
  interfaces: GuardInterfaceRow[] | null;
  onOpenInterface?: (interfaceId: string) => void;
}) {
  const byId = new Map((interfaces ?? []).map((row) => [row.id, row]));
  return (
    <section aria-label="Interfaces used by this flow" className="min-w-0">
      {path.length === 0 ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          This test records no interface path. It may be hand-written or predate
          interface mapping.
        </p>
      ) : (
        <ol className="grid sm:grid-cols-2 xl:grid-cols-3">
          {path.map((id, index) => {
            const iface = byId.get(id);
            const content = (
              <>
                <span className="w-5 shrink-0 text-[10px] tabular-nums text-muted-foreground">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">
                  {id}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {iface?.type ?? "unmapped"}
                </span>
                {iface && onOpenInterface && (
                  <ArrowUpRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                )}
              </>
            );
            return (
              <li
                key={`${id}-${index}`}
                className="min-w-0 border-b border-border/60 last:border-b-0 sm:border-r sm:[&:nth-child(2n)]:border-r-0 xl:[&:nth-child(2n)]:border-r xl:[&:nth-child(3n)]:border-r-0"
              >
                {iface && onOpenInterface ? (
                  <button
                    type="button"
                    onClick={() => onOpenInterface(id)}
                    aria-label={`Open interface ${id}`}
                    className="flex w-full min-w-0 cursor-pointer items-center gap-2 px-3 py-2 text-left outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                  >
                    {content}
                  </button>
                ) : (
                  <div
                    className="flex min-w-0 items-center gap-2 px-3 py-2"
                    title={
                      iface ? undefined : "Not in the current interface catalog"
                    }
                  >
                    {content}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/**
 * One supporting record, closed until a reader asks for it — a full-width header
 * row with the content inline under it, the sections stacking one after the
 * other. Opening one never closes another, and nothing in it scrolls on its own:
 * the page does.
 */
function CollapsibleSection({
  id,
  label,
  count,
  icon: Icon,
  open,
  onToggle,
  children,
}: {
  id: string;
  label: string;
  count?: number;
  icon: typeof Braces;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section aria-label={label} className="min-w-0 rounded border border-border">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`guard-drawer-${id}`}
        onClick={onToggle}
        className="flex w-full cursor-pointer items-center gap-1.5 px-2.5 py-1.5 text-left text-[11px] text-muted-foreground outline-none hover:bg-muted/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
      >
        <ChevronRight
          aria-hidden
          className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
        />
        <Icon aria-hidden className="h-3.5 w-3.5 shrink-0" />
        {label}
        {count != null && <span className="tabular-nums">{count}</span>}
      </button>
      {open && (
        <div
          id={`guard-drawer-${id}`}
          className="min-w-0 border-t border-border p-2.5"
        >
          {children}
        </div>
      )}
    </section>
  );
}

/**
 * The verdict's paint — the product-wide status dot at display size, echoed by
 * the card's border. Same four-colour vocabulary as every guard chip
 * (`lib/guard-status.ts`): red is a verdict someone must act on, green is
 * proven, blue is "no verdict yet, and someone can move it", grey is nobody's
 * to-do. The dot and border carry the colour and the word says the fact; the
 * card's background stays unwashed.
 */
const VERDICT_TONE: Record<
  GuardTestStatusView["plain"],
  { dot: string; border: string }
> = {
  failed: { dot: "bg-red-500", border: "border-red-500/35" },
  succeeded: { dot: "bg-emerald-500", border: "border-emerald-500/35" },
  blocked: { dot: "bg-sky-500", border: "border-sky-500/35" },
  "never-run": { dot: "bg-sky-500", border: "border-sky-500/35" },
  "not-testable": { dot: "bg-slate-400", border: "border-border" },
};

/**
 * THE scenario workspace — no header and no scroll box of its own, so it drops
 * straight into the merged flow detail's body under the flow's header and claims
 * the height that header leaves. {@link GuardTestView} is the same body with a
 * header of its own, for the run instance that has no flow header above it.
 *
 * The parent supplies a flex column with a definite height; this body fills it and
 * gives its own panes the scroll.
 */
export function GuardScenarioBody({
  repoId,
  test,
  interfaces,
  raw = false,
  rulings,
  notes,
  showGoal = true,
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
  /** The rulings a reader can make about this flow — the drawer's last item. */
  rulings?: ReactNode;
  /** Extra verdict-band notes (stale/orphaned bindings, "no result yet"). */
  notes?: ReactNode;
  /** The merged flow header already states the goal; standalone run instances do not. */
  showGoal?: boolean;
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
  /** The bundle's screenshots + session video; empty for every run that took none. */
  const [visuals, setVisuals] = useState<GuardEvidenceVisual[]>([]);
  /** The steps whose records are expanded inline; the failing one starts open. */
  const [openSteps, setOpenSteps] = useState<ReadonlySet<number>>(new Set());
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [interfacesOpen, setInterfacesOpen] = useState(false);
  /** Which screenshot the lightbox is showing; null = closed. */
  const [openShot, setOpenShot] = useState<number | null>(null);
  const stepRows = useRef(new Map<number, HTMLLIElement>());

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
  const evRunId = ev?.kind === "run" ? ev.runId : null;
  const evPath = ev?.kind === "birth" ? ev.path : null;

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
            : { content: "Steps not found on disk.", steps: [] },
        );
      })
      .catch((e: unknown) => {
        if (mounted.current)
          setSource({
            content: e instanceof Error ? e.message : "Steps unavailable.",
            steps: [],
          });
      });
  }, [repoId, test.id, evRunId, evPath]);

  // The bundle the visuals are addressed by — the same directory the transcript is
  // read from, as the pair of primitives above already names it.
  const where: api.GuardEvidenceWhere | null = evPath
    ? { evidencePath: evPath }
    : evRunId
      ? { runId: evRunId, scenarioId: test.id }
      : null;

  useEffect(() => {
    if (!ev) return;
    setEvidence(null);
    setEvidenceBusy(true);
    const load =
      ev.kind === "birth"
        ? api.getGuardFindingEvidence(repoId, ev.path)
        : api.getGuardEvidence(repoId, ev.runId, test.id);
    load
      .then((text) => {
        if (mounted.current) setEvidence(text);
      })
      .catch((e: unknown) => {
        if (mounted.current)
          setEvidence(
            e instanceof Error ? e.message : "Transcript unavailable.",
          );
      })
      .finally(() => {
        if (mounted.current) setEvidenceBusy(false);
      });
  }, [repoId, test.id, ev]);

  // The visuals, on their own read — keyed on the two primitives, so re-rendering
  // the parent never re-fetches them. A bundle that has none, and a store that
  // cannot answer for them, leave the workspace exactly as it was: the transcript
  // alone. Never blocks the transcript, and never reports a failure of its own.
  useEffect(() => {
    if (!evRunId && !evPath) {
      setVisuals([]);
      return;
    }
    setVisuals([]);
    const from: api.GuardEvidenceWhere = evPath
      ? { evidencePath: evPath }
      : { runId: evRunId!, scenarioId: test.id };
    api
      .getGuardEvidenceVisuals(repoId, from)
      .then((found) => {
        if (mounted.current) setVisuals(found);
      })
      .catch(() => {
        if (mounted.current) setVisuals([]);
      });
  }, [repoId, test.id, evRunId, evPath]);

  const failed = test.status.plain === "failed";
  const passed = test.status.plain === "succeeded" && !failed;
  // "failed (birth)" is the plan's own wording for a test committed red: it ran
  // once, at authoring time, and disagreed with the code.
  const verdictWord = failed
    ? test.status.birth
      ? "failed (birth)"
      : "failed"
    : passed
      ? "passed"
      : test.status.word.toLowerCase();
  const verdictTone = VERDICT_TONE[test.status.plain];
  const verdictHeadline =
    verdictWord.charAt(0).toUpperCase() + verdictWord.slice(1);
  const milestones = useMemo(
    () => new Map((test.milestones ?? []).map((m) => [m.order, m])),
    [test.milestones],
  );
  // WHICH rows start open is a fact about the VIEWED RESULT, so the step list is
  // keyed on it: reading another test — or this same test as another run's
  // record — re-opens that result's failing step instead of inheriting the
  // toggles the last one was left in.
  const resultKey = `${test.id}:${test.failure?.step ?? "none"}`;
  const stepSignature = source?.steps.map((step) => step.n).join(",") ?? "";
  useEffect(() => {
    const failure = test.failure?.step;
    setOpenSteps(new Set(failure != null ? [failure] : []));
  }, [resultKey, stepSignature]);

  const steps = source?.steps ?? [];
  const recordedFailureMissingFromSource =
    test.failure != null &&
    source != null &&
    !steps.some((step) => step.n === test.failure!.step);
  const screenshots = visuals.filter((visual) => visual.kind === "screenshot");
  const videos = visuals.filter((visual) => visual.kind === "video");
  // The lightbox is keyed on the sequence ITSELF (its file names), so a different
  // test's evidence closes it and an ordinary re-render — `visuals` may be a
  // fresh array — does not.
  const shotSequence = screenshots.map((visual) => visual.file).join("|");
  useEffect(() => setOpenShot(null), [shotSequence]);
  const completedSteps = test.failure
    ? steps.filter((step) => step.n < test.failure!.step).length
    : passed
      ? steps.length
      : 0;
  const notReachedSteps = test.failure
    ? steps.filter((step) => step.n > test.failure!.step).length
    : 0;

  const toggleStep = (step: number) => {
    setOpenSteps((prev) => {
      const next = new Set(prev);
      if (next.has(step)) next.delete(step);
      else next.add(step);
      return next;
    });
  };
  /**
   * Expand a step's record and bring it into view — the landing move of every
   * jump here (a filmstrip tile, the verdict's "failed at" line). When the step
   * left a picture, the scroll aims at the picture itself.
   */
  const revealStep = (step: number) => {
    setOpenSteps((prev) => (prev.has(step) ? prev : new Set(prev).add(step)));
    requestAnimationFrame(() => {
      const screen = document.getElementById(`guard-step-screen-${step}`);
      if (screen) screen.scrollIntoView({ block: "center" });
      else stepRows.current.get(step)?.scrollIntoView({ block: "nearest" });
    });
  };

  if (raw)
    return (
      <ArtifactRaw content={source?.content ?? null} label="test source" />
    );

  const stepRowRef = (n: number) => (node: HTMLLIElement | null) => {
    if (node) stepRows.current.set(n, node);
    else stepRows.current.delete(n);
  };

  return (
    <div className="mx-auto flex min-h-0 w-full min-w-0 max-w-[110rem] flex-1 flex-col gap-2.5 overflow-x-hidden">
      {showGoal && (
        <p className="max-w-[75ch] shrink-0 text-[13px] leading-relaxed text-foreground">
          {test.goal ?? test.title}
        </p>
      )}

      {/* THE VERDICT — the one thing a reader opens this page to learn, on a
          card washed in the verdict's own colour and sized to what it says, not
          to the row. The status chip is gone from here — the word with its mark
          already is that fact — and every fact on the card reads at the page's
          own quiet sizes; everything else about the failure reads at the step
          it happened on. */}
      <section aria-label="Test verdict" className="min-w-0 shrink-0">
        <div className={LABEL}>Verdict</div>
        <div
          className={`w-fit min-w-0 max-w-full rounded border bg-card px-3 py-2.5 ${verdictTone.border}`}
        >
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className="inline-flex shrink-0 items-center gap-1.5">
            <span
              aria-hidden
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${verdictTone.dot}`}
            />
            <span className="text-[12px] leading-none text-foreground">
              {verdictHeadline}
            </span>
          </span>
          {test.triage && <GuardTriageChip triage={test.triage} />}
          {test.failure?.visual && (
            <GuardVisualChip visual={test.failure.visual} />
          )}
          {test.durationMs != null && (
            <span className="text-[11px] text-muted-foreground">
              {formatGuardDuration(test.durationMs)}
            </span>
          )}
          {steps.length > 0 && (
            <span className="text-[11px] text-muted-foreground">
              {recordedFailureMissingFromSource ? (
                <>
                  {steps.length} current steps · recorded failure at{" "}
                  {test.failure!.step}
                </>
              ) : (
                <>
                  {completedSteps} passed
                  {test.failure ? " · 1 failed" : ""}
                  {notReachedSteps > 0 ? ` · ${notReachedSteps} not reached` : ""}
                </>
              )}
            </span>
          )}
          {failed && test.status.birth && (
            <HoverPopover
              portal
              width="wide"
              content="This test failed the first time it ran, when it was written. It is committed anyway — the doc and the code disagree, and the next run that turns it green closes that gap."
            >
              <span className="cursor-help text-[11px] text-muted-foreground underline decoration-dotted">
                what does birth mean?
              </span>
            </HoverPopover>
          )}
          {test.interfaceDrifted && (
            <HoverPopover
              portal
              align="start"
              width="wide"
              content="The live interface catalog no longer matches the fingerprints this test was grounded on — the code surface it was derived from moved. Never a pass/fail input; re-generate to re-ground it."
            >
              <span className="inline-flex cursor-help items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="h-2 w-2 shrink-0 rounded-full bg-slate-400" />
                Interface drift
              </span>
            </HoverPopover>
          )}
        </div>

        {test.failure && (
          <p className="mt-1.5 min-w-0 text-[12px] leading-snug">
            {/* The failure is a fact about ONE step, so the sentence that names it
                is the way to that step — the fourth channel the failure surfaces
                in, beside the tinted row, the marked tile and the first selection. */}
            <button
              type="button"
              onClick={() => revealStep(test.failure!.step)}
              className="group inline-flex cursor-pointer items-center gap-1 rounded text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {recordedFailureMissingFromSource
                ? "Recorded failure at"
                : "Failed at"}{" "}
              step {test.failure.step}
              {steps.length > 0 && !recordedFailureMissingFromSource
                ? ` of ${steps.length}`
                : ""}
              {test.failedMilestone != null
                ? ` · milestone ${test.failedMilestone}`
                : ""}
              <ArrowDown
                aria-hidden
                className="h-3 w-3 shrink-0 text-muted-foreground group-hover:text-foreground"
              />
            </button>
            {test.failedMilestoneClaim && (
              <span className="text-muted-foreground">
                {" "}
                — {test.failedMilestoneClaim}
              </span>
            )}
            {recordedFailureMissingFromSource && (
              <span className="text-muted-foreground">
                {" "}
                · this result came from a previous test revision, whose current
                definition has {steps.length} steps
              </span>
            )}
          </p>
        )}

        {test.triage && (
          <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
            <span className="text-foreground">Next: </span>
            {test.triage.recommendation}
          </p>
        )}
        {notes}
        </div>
      </section>

      {/* THE RUN, AS PICTURES — one tile per captured step, in step order.
          Clicking a tile expands its step below and brings its picture into
          view. A cli/api run recorded none, so a cli/api run has no strip. */}
      {where && screenshots.length > 0 && (
        <div className="min-w-0 shrink-0">
          <div className={LABEL}>Visual evidence</div>
          <GuardRunFilmstrip
          repoId={repoId}
          where={where}
          screenshots={screenshots}
          videos={videos}
            {...(test.failure ? { failedStep: test.failure.step } : {})}
            onOpenShot={setOpenShot}
            onGoToStep={revealStep}
          />
        </div>
      )}

      {/* THE STEPS — one collapsible list, one column at every width. An opened
          row grows the page and the page scrolls; nothing here scrolls on its
          own. */}
      <section aria-label="test steps" className="min-w-0 shrink-0">
        <div className={LABEL}>Steps</div>
        <div className="min-w-0 overflow-hidden rounded border border-border bg-card">
          {source != null && source.steps.length > 0 ? (
            <div key={resultKey} className="min-w-0">
              {recordedFailureMissingFromSource && test.failure && (
                <RecordedFailureRow
                  failure={test.failure}
                  open={openSteps.has(test.failure.step)}
                  onToggle={() => toggleStep(test.failure!.step)}
                  rowRef={stepRowRef(test.failure.step)}
                />
              )}
              <ol className="min-w-0">
                {source.setup && (
                  <SetupRow
                    setup={source.setup}
                    open={openSteps.has(SETUP_STEP)}
                    onToggle={() => toggleStep(SETUP_STEP)}
                    rowRef={stepRowRef(SETUP_STEP)}
                  />
                )}
              </ol>
              <ol className="min-w-0">
                {source.steps.map((step) => {
                  const shot = screenshots.find(
                    (visual) => visual.step === step.n,
                  );
                  const milestone =
                    step.milestone != null
                      ? milestones.get(step.milestone)
                      : undefined;
                  return (
                    <StepRow
                      key={step.n}
                      step={step}
                      failedStep={test.failure?.step}
                      passed={passed}
                      open={openSteps.has(step.n)}
                      onToggle={() => toggleStep(step.n)}
                      rowRef={stepRowRef(step.n)}
                    >
                      <StepBody
                        step={step}
                        failedStep={test.failure?.step}
                        passed={passed}
                        {...(test.failure ? { failure: test.failure } : {})}
                        {...(stepClaim(step, test, milestones)
                          ? { claim: stepClaim(step, test, milestones)! }
                          : {})}
                        {...(milestone?.doc && milestone.anchor
                          ? {
                              claimLink: {
                                label: `§ ${milestone.headingText ?? milestone.anchor}`,
                                onOpen: () =>
                                  onOpenSpec(milestone.doc!, milestone.anchor!),
                              },
                            }
                          : {})}
                        {...(shot && where
                          ? {
                              picture: (
                                <GuardStepScreenshot
                                  repoId={repoId}
                                  where={where}
                                  visual={shot}
                                  onOpen={() =>
                                    setOpenShot(
                                      screenshots.findIndex(
                                        (visual) => visual.file === shot.file,
                                      ),
                                    )
                                  }
                                />
                              ),
                            }
                          : {})}
                      />
                    </StepRow>
                  );
                })}
              </ol>
            </div>
          ) : test.failure && source != null ? (
            <RecordedFailureRow
              failure={test.failure}
              open={openSteps.has(test.failure.step)}
              onToggle={() => toggleStep(test.failure!.step)}
              rowRef={stepRowRef(test.failure.step)}
            />
          ) : (
            <pre className={PRE}>
              {source == null ? "Loading steps…" : source.content}
            </pre>
          )}
        </div>
      </section>

      {/* THE SUPPORTING RECORD — Transcript and Interfaces closed until asked
          for, stacked one after the other; a decision belongs after the
          evidence, so the rulings stand OPEN below them, never behind a
          toggle. */}
      <div className="min-w-0 shrink-0 space-y-1.5">
        {where && (
          <CollapsibleSection
            id="transcript"
            label="Transcript"
            icon={ScrollText}
            open={transcriptOpen}
            onToggle={() => setTranscriptOpen((prev) => !prev)}
          >
            <GuardLongText
              text={evidenceBusy ? "Loading transcript…" : (evidence ?? "")}
              label="evidence transcript"
            />
          </CollapsibleSection>
        )}
        <CollapsibleSection
          id="interfaces"
          label="Interfaces"
          count={test.interfacePath.length}
          icon={Braces}
          open={interfacesOpen}
          onToggle={() => setInterfacesOpen((prev) => !prev)}
        >
          <InterfacePathSection
            path={test.interfacePath}
            interfaces={interfaces}
            {...(onOpenInterface ? { onOpenInterface } : {})}
          />
        </CollapsibleSection>
        {/* The ruling stands apart from the record it follows — a destructive
            control never sits flush under ordinary reading. */}
        {rulings && <div className="min-w-0 pt-3">{rulings}</div>}
      </div>

      {/* The facts a developer copies or jumps from — one line, never a block. */}
      <dl className="min-w-0 shrink-0 space-y-1 border-t border-border pt-2 text-[11px]">
        <FootFact label="Test">
          <span className="truncate font-mono text-muted-foreground">
            {test.id}
          </span>
        </FootFact>
        {source?.file && (
          <FootFact label="File">
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(source.file!)}
              title="Copy the path"
              className={`${FOOT_BTN} font-mono`}
            >
              <span className={FOOT_TEXT}>{source.file}</span>
              <Copy className="h-3 w-3 shrink-0" />
            </button>
          </FootFact>
        )}
        {test.flow && onOpenFlow && (
          <FootFact label="Flow">
            <button
              type="button"
              onClick={() => onOpenFlow(test.flow!.id)}
              className={FOOT_BTN}
            >
              <span className={FOOT_TEXT}>{test.flow.title}</span>
              <ArrowUpRight className="h-3 w-3 shrink-0" />
            </button>
          </FootFact>
        )}
        {test.binds && (
          <FootFact label="Spec">
            <button
              type="button"
              onClick={() => onOpenSpec(test.binds!.doc, test.binds!.section)}
              className={FOOT_BTN}
            >
              <span className={FOOT_TEXT}>
                {test.binds.headingText ?? test.binds.doc}
              </span>
              <span className={`${FOOT_TEXT} text-muted-foreground`}>
                § {test.binds.section}
              </span>
              <ArrowUpRight className="h-3 w-3 shrink-0" />
            </button>
          </FootFact>
        )}
      </dl>

      {openShot != null && where && (
        <GuardScreenshotLightbox
          repoId={repoId}
          where={where}
          screenshots={screenshots}
          index={openShot}
          onIndex={setOpenShot}
          onClose={() => setOpenShot(null)}
          onGoToStep={(step) => {
            setOpenShot(null);
            revealStep(step);
          }}
        />
      )}
    </div>
  );
}

/**
 * The scenario workspace under a header of its OWN — the run instance's screen,
 * where there is no flow header above it to carry the title, the status and the
 * mode switch. Everything below the header is {@link GuardScenarioBody}, the same
 * rendering the merged flow detail embeds.
 */
export function GuardTestView({
  repoId,
  test,
  interfaces,
  rulings,
  headerAction,
  notes,
  onOpenFlow,
  onOpenInterface,
  onOpenSpec,
}: {
  repoId: string;
  test: GuardTestViewModel;
  interfaces: GuardInterfaceRow[] | null;
  rulings?: ReactNode;
  /** A link out of this page (the run instance's "open this flow"). */
  headerAction?: ReactNode;
  notes?: ReactNode;
  onOpenFlow?: (flowId: string) => void;
  onOpenInterface?: (interfaceId: string) => void;
  onOpenSpec: (doc: string, section: string) => void;
}) {
  // The two readings of ONE file: this page, or the YAML it was read from.
  const { mode, setMode, raw } = useArtifactMode("YAML");
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-background">
      {/* The page's ONE vertical scroll, and the header scrolls WITH it — a
          pinned title bar cost height the reading needs. x is clipped so a wide
          line can only scroll its own block. */}
      <div
        data-pane
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden"
      >
      <div className="min-w-0 shrink-0 border-b border-border bg-card px-6 py-4">
        <h2 className="break-words text-sm font-semibold text-foreground">
          {test.title}
        </h2>
        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-2">
          {/* The status word sits FIRST, the way it does on every guard row and
              header. No surface chip: one surface, no information. */}
          <GuardFlowStatusChip
            status={test.status.plain}
            word={test.status.word}
          />
          <span className="text-[11px] text-muted-foreground">
            {test.provenance}
          </span>
          <ArtifactModeSwitch
            format="YAML"
            mode={mode}
            onSelect={setMode}
            className="ml-auto"
          />
        </div>
        {headerAction}
      </div>

      <div className="flex min-w-0 flex-1 flex-col px-6 py-4">
        <GuardScenarioBody
          repoId={repoId}
          test={test}
          interfaces={interfaces}
          raw={raw}
          {...(rulings ? { rulings } : {})}
          {...(notes ? { notes } : {})}
          {...(onOpenFlow ? { onOpenFlow } : {})}
          {...(onOpenInterface ? { onOpenInterface } : {})}
          onOpenSpec={onOpenSpec}
        />
      </div>
      </div>
    </div>
  );
}
