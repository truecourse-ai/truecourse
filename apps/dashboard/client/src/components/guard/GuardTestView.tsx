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
 *   4 investigation    the claim-grouped step timeline beside ONE selected-step
 *                      inspector. Failure owns selection on load, so where it broke
 *                      and why are visible together without scrolling to the end.
 *                      Screenshots + replay and the flow's interface path share the
 *                      inspector rail (see {@link GuardEvidenceVisuals}).
 *   5 transcript       the run's long-form supporting record, after the investigation
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
 * EVERY row selects the SAME inspector, and ONE is selected: the failing one when
 * there is a failure, otherwise the first. Rows stay compact enough to scan as a
 * flow; expected/actual/output never push neighboring steps apart.
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

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  Braces,
  Camera,
  Check,
  ChevronDown,
  CirclePlay,
  Copy,
  Minus,
  X,
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
import { formatGuardDuration } from "@/lib/guard-drifts";
import type { GuardTestStatusView } from "@/lib/guard-flow-status";
import { GuardEvidenceVisuals } from "./GuardEvidenceVisuals";
import { GuardLongText } from "./GuardLongText";
import { GuardTestSetup } from "./GuardTestSetup";
import { GuardTriageChip } from "./GuardTriageChip";
import { GuardVisualChip } from "./GuardVisualChip";
import { GuardFlowStatusChip } from "./GuardStatusBadge";
import { PRE } from "./detail-styles";

const LABEL =
  "mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground";
const FOOT_BTN =
  "inline-flex min-w-0 max-w-full items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground";
/** A truncating label inside a footer button — it must shrink, or it stretches the row. */
const FOOT_TEXT = "min-w-0 truncate";

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
  binds?: {
    doc: string;
    section: string;
    headingText?: string;
    fingerprint?: string;
  };
  interfacePath: readonly string[];
  evidence: GuardEvidenceRef | null;
}

/** Per-step paint from the viewed result: pass up to the failure, fail at it, not-reached after. */
function stepGlyph(
  n: number,
  failedStep: number | undefined,
  passed: boolean,
): { glyph: string; label: string } {
  if (failedStep != null) {
    if (n < failedStep) return { glyph: "✓", label: "passed" };
    if (n === failedStep) return { glyph: "✗", label: "failed" };
    return { glyph: "·", label: "not reached" };
  }
  return passed
    ? { glyph: "✓", label: "passed" }
    : { glyph: "·", label: "not run" };
}

/**
 * One labelled line of the step panel — "expected", "actual", "output". The
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
                aria-label={check.ok ? "met" : "not met"}
                className={`text-[11px] ${
                  check.ok
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-red-600 dark:text-red-400"
                }`}
              >
                {check.ok ? "✓" : "✗"}
              </span>
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
 * THE JUDGE'S READING, inside the failing step's panel — what a vision model saw
 * in the screenshot the step left behind, under its own label so it sits beside
 * the measured rows without ever reading as one of them. The `yes` sentence is
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
 * A WEB step's record, in the browser's own vocabulary. A browser step spawns
 * nothing: it has no exit code and no streams, so "exit 0" and "the step printed
 * nothing" would both be inventions. What it has is an action, an address, each
 * assertion beside THE PAGE'S OWN ANSWER TO THAT ASSERTION, what the page showed,
 * and a picture.
 */
function WebStepPanel({
  expected,
  actual,
  web,
  visual,
}: {
  /** The authored assertion — the fallback when the step never got to evaluate it. */
  expected: string;
  /** The failure line, when the step failed before asserting anything. */
  actual?: string;
  web: GuardStepWebActual;
  /** The vision judge's reading of this step's screenshot, on a judged failure. */
  visual?: GuardVisualAnnotation;
}) {
  return (
    <div className="mt-2 space-y-1">
      {web.checks.length > 0 ? (
        <CheckRows checks={web.checks} />
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
                {expected
                  ? "the step did not get past its action, so nothing was asserted"
                  : "nothing was asserted"}
              </NoValue>
            )}
          </DiffRow>
        </>
      )}
      {visual && <VisualJudgeRow visual={visual} />}
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
      {web.console && web.console.length > 0 && (
        <DiffRow label="console">
          <GuardLongText
            text={web.console.join("\n")}
            label="page console"
            head={8}
          />
        </DiffRow>
      )}
      {web.screenshot && (
        <DiffRow label="screen">
          <p className="pt-1 font-mono text-[11px] leading-snug text-muted-foreground">
            {web.screenshot}
          </p>
        </DiffRow>
      )}
    </div>
  );
}

/**
 * WHAT A STEP DID, read inside the step: what it asserted, what it returned, and
 * what it printed while getting there. EVERY step carries it — a passing step's
 * actuals are as much a fact as a failing one's — so a reader learns one panel and
 * reads every row with it.
 *
 * The panel speaks the step's OWN surface: a cli or api step returns a code and
 * prints streams; a web step ends up at an address and shows a page (see
 * {@link WebStepPanel}). A step with no record of its own reads the same either way
 * — the authored expectation, and the honest absence of everything else.
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

function StepPanel({
  expected,
  actual,
  stdout,
  stderr,
  recorded,
  web,
  checks,
  visual,
}: StepPanelProps) {
  if (web)
    return (
      <WebStepPanel
        expected={expected}
        {...(actual ? { actual } : {})}
        web={web}
        {...(visual ? { visual } : {})}
      />
    );
  return (
    <div className="mt-2 space-y-1">
      {checks && checks.length > 0 ? (
        // A request step's response answers its status assertion, its header
        // assertions and each json path separately — one pair per member, the same
        // reading a web step gets.
        <CheckRows checks={checks} />
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
                {recorded ? "the step returns no exit code" : NOT_RECORDED}
              </NoValue>
            )}
          </DiffRow>
        </>
      )}
      {visual && <VisualJudgeRow visual={visual} />}
      <DiffRow label="output">
        {stdout || stderr ? (
          <div className="space-y-1">
            {stdout && (
              <GuardLongText text={stdout} label="step output" head={8} />
            )}
            {stderr && (
              <GuardLongText text={stderr} label="step error output" head={8} />
            )}
          </div>
        ) : (
          <NoValue>
            {recorded ? "the step printed nothing" : NOT_RECORDED}
          </NoValue>
        )}
      </DiffRow>
    </div>
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

/**
 * ONE compact step: status · number · driver · command. Clicking it retargets the
 * shared inspector beside the timeline to what it expected, returned and printed.
 *
 * No row carries an "expects …" summary line any more: the labelled `expected` field
 * says the same thing, and a fact told twice reads as two facts.
 */
function StepRow({
  step,
  failedStep,
  passed,
  selected,
  onSelect,
  rowRef,
}: {
  step: GuardScenarioStepView;
  failedStep: number | undefined;
  passed: boolean;
  selected: boolean;
  onSelect: () => void;
  rowRef?: (node: HTMLLIElement | null) => void;
}) {
  const { glyph, label } = stepGlyph(step.n, failedStep, passed);
  const failed = glyph === "✗";
  const Mark = failed ? X : glyph === "✓" ? Check : Minus;

  return (
    <li
      ref={rowRef}
      aria-label={`Step ${step.n}: ${step.command} — ${label}`}
      className={`border-b border-border/60 last:border-b-0 ${
        selected
          ? "bg-primary/[0.055] ring-1 ring-inset ring-primary/20"
          : failed
            ? "bg-red-500/[0.035]"
            : ""
      }`}
    >
      <button
        type="button"
        aria-pressed={selected}
        aria-label={`Inspect step ${step.n}`}
        onClick={onSelect}
        className="flex w-full min-w-0 items-start gap-2 px-3 py-2.5 text-left outline-none hover:bg-muted/35 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
      >
        <Mark
          aria-hidden
          className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
            failed
              ? "text-red-600 dark:text-red-400"
              : glyph === "✓"
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-muted-foreground"
          }`}
        />
        <span className="w-5 shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {step.n}
        </span>
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          {step.kind}
        </span>
        <span className="min-w-0 flex-1 break-words font-mono text-[12px] leading-relaxed text-foreground">
          {step.command}
        </span>
        {step.repeat != null && step.repeat > 1 && (
          <span className="mt-0.5 shrink-0 text-[10px] text-muted-foreground">
            ×{step.repeat}
          </span>
        )}
      </button>
    </li>
  );
}

/** One step's full authored + recorded reading, kept beside the timeline. */
function StepInspector({
  step,
  failedStep,
  passed,
  failure,
  claim,
}: {
  step: GuardScenarioStepView | null;
  failedStep: number | undefined;
  passed: boolean;
  failure?: GuardFailureDetail;
  claim?: string;
}) {
  if (!step) {
    return (
      <div className="rounded border border-border bg-card p-4 text-[12px] text-muted-foreground">
        Loading step details…
      </div>
    );
  }
  const { glyph, label } = stepGlyph(step.n, failedStep, passed);
  const failed = glyph === "✗";
  const Mark = failed ? X : glyph === "✓" ? Check : Minus;
  return (
    <section
      aria-label="Selected step details"
      aria-live="polite"
      className="min-w-0 rounded border border-border bg-card"
    >
      <div className="border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Mark
            aria-hidden
            className={`h-4 w-4 shrink-0 ${
              failed
                ? "text-red-600 dark:text-red-400"
                : glyph === "✓"
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-muted-foreground"
            }`}
          />
          <h3 className="text-[13px] font-semibold text-foreground">
            Step {step.n}
          </h3>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {step.kind}
          </span>
          <span className="ml-auto text-[11px] text-muted-foreground">
            step {label}
          </span>
        </div>
        <p className="mt-2 break-words font-mono text-[12px] leading-relaxed text-foreground">
          {step.command}
        </p>
        {claim && (
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
            {claim}
          </p>
        )}
      </div>
      <div className="min-w-0 px-4 py-3">
        {failed && (
          <div className="mb-3 rounded border border-red-500/40 bg-red-500/[0.035] px-3 py-2 text-[11px] leading-relaxed text-foreground">
            Execution stopped here. The steps after this one were not reached.
          </div>
        )}
        <div className="space-y-1 text-[11px] text-muted-foreground">
          {step.env && step.env.length > 0 && (
            <div className="break-words font-mono">
              with {step.env.join(" ")}
            </div>
          )}
          {step.cwd && (
            <div className="break-words font-mono">in {step.cwd}</div>
          )}
          {step.actual?.durationMs != null && (
            <div>{formatGuardDuration(step.actual.durationMs)}</div>
          )}
        </div>
        <StepPanel {...stepPanelProps(step, failedStep, failure)} />
        {step.note && (
          <p className="mt-3 border-t border-border pt-3 text-[11px] leading-relaxed text-muted-foreground">
            {step.note}
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * A run can outlive the exact scenario revision it executed. When its failure
 * names a step that no longer exists in the current YAML, the failure is still
 * first-class evidence: render its recorded diff without pretending the current
 * authored row is the one that ran.
 */
function RecordedFailureInspector({
  failure,
}: {
  failure: GuardFailureDetail;
}) {
  return (
    <section
      aria-label="Selected step details"
      aria-live="polite"
      className="min-w-0 rounded border border-red-500/40 bg-card"
    >
      <div className="border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <X
            aria-hidden
            className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400"
          />
          <h3 className="text-[13px] font-semibold text-foreground">
            Step {failure.step}
          </h3>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            recorded run
          </span>
          <span className="ml-auto text-[11px] text-muted-foreground">
            step failed
          </span>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          This run used an earlier test revision. Step {failure.step} is not in
          the current YAML, but its failure and captured evidence are preserved
          below.
        </p>
      </div>
      <div className="min-w-0 px-4 py-3">
        <div className="mb-3 rounded border border-red-500/40 bg-red-500/[0.035] px-3 py-2 text-[11px] leading-relaxed text-foreground">
          Execution stopped here. The recorded action did not complete.
        </div>
        <StepPanel
          expected={failure.expected}
          actual={failure.actual}
          {...(failure.stdout ? { stdout: failure.stdout } : {})}
          {...(failure.stderr ? { stderr: failure.stderr } : {})}
          {...(failure.visual ? { visual: failure.visual } : {})}
          recorded
        />
      </div>
    </section>
  );
}

function RecordedFailureRow({
  failure,
  selected,
  onSelect,
  rowRef,
}: {
  failure: GuardFailureDetail;
  selected: boolean;
  onSelect: () => void;
  rowRef: (node: HTMLLIElement | null) => void;
}) {
  return (
    <div className="border-t border-border first:border-t-0">
      <div className="bg-red-500/[0.035] px-3 py-2 text-[11px] font-medium text-foreground">
        Recorded run · earlier test revision
      </div>
      <ol>
        <li
          ref={rowRef}
          aria-label={`Step ${failure.step}: recorded run failure — failed`}
          className={`bg-red-500/[0.035] ${selected ? "ring-1 ring-inset ring-red-500/35" : ""}`}
        >
          <button
            type="button"
            aria-pressed={selected}
            aria-label={`Inspect step ${failure.step}`}
            onClick={onSelect}
            className="flex w-full min-w-0 items-start gap-2 px-3 py-2.5 text-left outline-none hover:bg-muted/35 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
          >
            <X
              aria-hidden
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400"
            />
            <span className="w-5 shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {failure.step}
            </span>
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              recorded
            </span>
            <span className="min-w-0 flex-1 break-words font-mono text-[12px] leading-relaxed text-foreground">
              {failure.expected}
            </span>
          </button>
        </li>
      </ol>
    </div>
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
  heading?: "Prepare" | "Checks";
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
  return claims.length > 0 ? `c:${claims.join("␟")}` : "untagged";
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
export function groupStepsByMilestone(
  steps: readonly GuardScenarioStepView[],
): StepGroup[] {
  const groups: StepGroup[] = [];
  let lastKey: string | null = null;
  for (const step of steps) {
    const key = stepGroupKey(step);
    const last = groups[groups.length - 1];
    if (last && lastKey === key) last.steps.push(step);
    else
      groups.push({
        milestone: step.milestone ?? null,
        claims: step.claims ?? [],
        steps: [step],
      });
    lastKey = key;
  }
  return groups.map((group, i) =>
    isClaimGroup(group)
      ? group
      : {
          ...group,
          heading: groups.slice(i + 1).some(isClaimGroup)
            ? ("Prepare" as const)
            : ("Checks" as const),
        },
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
      <div className="mb-2 flex items-center gap-2">
        <Braces className="h-3.5 w-3.5 text-muted-foreground" />
        <h3 className="text-[12px] font-semibold text-foreground">
          Interfaces used by this flow
        </h3>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {path.length}
        </span>
      </div>
      {path.length === 0 ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          This test records no interface path. It may be hand-written or predate
          interface mapping.
        </p>
      ) : (
        <ol className="grid overflow-hidden rounded border border-border bg-card/40 sm:grid-cols-2 xl:grid-cols-3">
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
                className="min-w-0 border-b border-border last:border-b-0 sm:border-r sm:[&:nth-child(2n)]:border-r-0 xl:[&:nth-child(2n)]:border-r xl:[&:nth-child(3n)]:border-r-0"
              >
                {iface && onOpenInterface ? (
                  <button
                    type="button"
                    onClick={() => onOpenInterface(id)}
                    aria-label={`Open interface ${id}`}
                    className="flex w-full min-w-0 items-center gap-2 px-3 py-2.5 text-left outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                  >
                    {content}
                  </button>
                ) : (
                  <div
                    className="flex min-w-0 items-center gap-2 px-3 py-2.5"
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
 * THE scenario rendering — sections only, no header and no scroll box of its own,
 * so it drops straight into the merged flow detail's body under the flow's header
 * and milestone list. {@link GuardTestView} is the same body with a header of its
 * own, for the run instance that has no flow header above it.
 *
 * The parent supplies the scrolling container; this body owns its internal
 * investigation grid and responsive stacking in both hosts.
 */
export function GuardScenarioBody({
  repoId,
  test,
  interfaces,
  raw = false,
  action,
  notes,
  showGoal = true,
  showGoalLabel = true,
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
  /** The merged flow header already states the goal; standalone run instances do not. */
  showGoal?: boolean;
  /** Multi-surface flows need each test goal, but not a repeated section label. */
  showGoalLabel?: boolean;
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
  const [visualsBusy, setVisualsBusy] = useState(false);
  const [selectedStepNumber, setSelectedStepNumber] = useState<number | null>(
    null,
  );
  const stepRows = useRef(new Map<number, HTMLLIElement>());
  const visualsSection = useRef<HTMLDivElement | null>(null);
  const interfacesSection = useRef<HTMLDivElement | null>(null);

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
  // cannot answer for them, leave the section exactly as it was: the transcript
  // alone. Never blocks the transcript, and never reports a failure of its own.
  useEffect(() => {
    if (!evRunId && !evPath) {
      setVisuals([]);
      setVisualsBusy(false);
      return;
    }
    setVisuals([]);
    setVisualsBusy(true);
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
      })
      .finally(() => {
        if (mounted.current) setVisualsBusy(false);
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
  const milestones = new Map((test.milestones ?? []).map((m) => [m.order, m]));
  // WHICH step is the open one is a fact about the VIEWED RESULT, so the step list
  // is keyed on it: reading another test — or this same test as another run's
  // record — re-opens that result's failing step instead of inheriting the toggle
  // the last one was left in.
  const resultKey = `${test.id}:${test.failure?.step ?? "none"}`;
  const stepSignature = source?.steps.map((step) => step.n).join(",") ?? "";
  useEffect(() => {
    const first = source?.steps[0]?.n ?? null;
    const failure = test.failure?.step;
    setSelectedStepNumber(failure ?? first);
  }, [resultKey, stepSignature]);

  const steps = source?.steps ?? [];
  const selectedStep =
    steps.find((step) => step.n === selectedStepNumber) ?? null;
  const recordedFailureMissingFromSource =
    test.failure != null &&
    source != null &&
    !steps.some((step) => step.n === test.failure!.step);
  const selectedRecordedFailure =
    recordedFailureMissingFromSource &&
    selectedStepNumber === test.failure?.step
      ? test.failure
      : null;
  const screenshotCount = visuals.filter(
    (visual) => visual.kind === "screenshot",
  ).length;
  const hasVideo = visuals.some((visual) => visual.kind === "video");
  const completedSteps = test.failure
    ? steps.filter((step) => step.n < test.failure!.step).length
    : passed
      ? steps.length
      : 0;
  const notReachedSteps = test.failure
    ? steps.filter((step) => step.n > test.failure!.step).length
    : 0;
  const inspectStep = (step: number, reveal = false) => {
    setSelectedStepNumber(step);
    if (reveal)
      requestAnimationFrame(() =>
        stepRows.current.get(step)?.scrollIntoView({ block: "center" }),
      );
  };
  const reveal = (target: { current: HTMLElement | null }) =>
    target.current?.scrollIntoView({ block: "start" });

  if (raw)
    return (
      <ArtifactRaw content={source?.content ?? null} label="test source" />
    );

  return (
    <div className="mx-auto w-full max-w-[100rem] space-y-5">
      <section aria-label="Test verdict" className="min-w-0">
        {showGoal && (
          <div className="mb-4">
            {showGoalLabel && <div className={LABEL}>What it checks</div>}
            <p className="max-w-[75ch] text-[13px] leading-relaxed text-foreground">
              {test.goal ?? test.title}
            </p>
          </div>
        )}
        <div className={LABEL}>Verdict</div>
        <div
          className={`rounded border bg-card p-4 ${failed ? "border-red-500/50" : "border-border"}`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <GuardFlowStatusChip
              status={test.status.plain}
              word={verdictWord}
              className="text-[11px]"
            />
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
                    {notReachedSteps > 0
                      ? ` · ${notReachedSteps} not reached`
                      : ""}
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
                <span className="text-[11px] text-muted-foreground underline decoration-dotted">
                  what does birth mean?
                </span>
              </HoverPopover>
            )}
          </div>

          {test.failure && (
            <div className="mt-3 flex min-w-0 flex-wrap items-start gap-x-4 gap-y-2 border-t border-border pt-3">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-foreground">
                  {recordedFailureMissingFromSource
                    ? "Recorded failure at"
                    : "Failed at"}{" "}
                  step {test.failure.step}
                  {test.failedMilestone != null
                    ? ` · milestone ${test.failedMilestone}`
                    : ""}
                </p>
                {recordedFailureMissingFromSource && (
                  <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
                    This result came from a previous test revision. The current
                    definition has {steps.length} steps.
                  </p>
                )}
                {test.failedMilestoneClaim && (
                  <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
                    {test.failedMilestoneClaim}
                  </p>
                )}
                {test.triage && (
                  <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                    <span className="text-foreground">Next: </span>
                    {test.triage.recommendation}
                  </p>
                )}
              </div>
            </div>
          )}

          {(screenshotCount > 0 ||
            hasVideo ||
            test.interfacePath.length > 0) && (
            <div className="mt-2.5 flex flex-wrap gap-2 border-t border-border pt-2.5">
              {screenshotCount > 0 && (
                <button
                  type="button"
                  onClick={() => reveal(visualsSection)}
                  className="inline-flex items-center gap-1.5 rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <Camera className="h-3.5 w-3.5" />
                  {screenshotCount} screenshot{screenshotCount === 1 ? "" : "s"}
                </button>
              )}
              {hasVideo && (
                <button
                  type="button"
                  onClick={() => reveal(visualsSection)}
                  className="inline-flex items-center gap-1.5 rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <CirclePlay className="h-3.5 w-3.5" />
                  Session replay
                </button>
              )}
              {test.interfacePath.length > 0 && (
                <button
                  type="button"
                  onClick={() => reveal(interfacesSection)}
                  className="inline-flex items-center gap-1.5 rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <Braces className="h-3.5 w-3.5" />
                  {test.interfacePath.length} interface
                  {test.interfacePath.length === 1 ? "" : "s"}
                </button>
              )}
            </div>
          )}

          {test.interfaceDrifted && (
            <HoverPopover
              portal
              align="start"
              width="wide"
              content="The live interface catalog no longer matches the fingerprints this test was grounded on — the code surface it was derived from moved. Never a pass/fail input; re-generate to re-ground it."
            >
              <div className="mt-2.5 flex items-center gap-2 text-[12px] text-muted-foreground">
                <span className="h-2 w-2 shrink-0 rounded-full bg-slate-400" />
                Interface drift — the mapped surface moved since this test was
                written
              </div>
            </HoverPopover>
          )}
          {notes}
          {action}
        </div>
      </section>

      {source?.setup && (
        <section>
          <div className={LABEL}>Setup</div>
          <GuardTestSetup setup={source.setup} />
        </section>
      )}

      <section
        aria-label="Test investigation"
        className="guard-investigation min-w-0"
      >
        <div className="guard-investigation-layout">
          <div className="guard-investigation-timeline min-w-0">
            <div className="mb-2 flex items-center gap-2">
              <h3 className="text-[12px] font-semibold text-foreground">
                Steps
              </h3>
              {steps.length > 0 && (
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {steps.length}
                </span>
              )}
            </div>
            <div aria-label="test steps">
              {source != null && source.steps.length > 0 ? (
                <div
                  key={resultKey}
                  className="overflow-hidden rounded border border-border"
                >
                  {recordedFailureMissingFromSource && test.failure && (
                    <RecordedFailureRow
                      failure={test.failure}
                      selected={selectedStepNumber === test.failure.step}
                      onSelect={() => inspectStep(test.failure!.step)}
                      rowRef={(node) => {
                        if (node)
                          stepRows.current.set(test.failure!.step, node);
                        else stepRows.current.delete(test.failure!.step);
                      }}
                    />
                  )}
                  {recordedFailureMissingFromSource && (
                    <div className="flex items-center justify-between border-t border-border bg-muted/40 px-3 py-2 text-[11px]">
                      <span className="font-medium text-foreground">
                        Current test definition
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {steps.length} steps
                      </span>
                    </div>
                  )}
                  {groupStepsByMilestone(source.steps).map((group, i) => {
                    const milestone =
                      group.milestone != null
                        ? milestones.get(group.milestone)
                        : undefined;
                    return (
                      <div
                        key={`${group.milestone ?? (group.claims.join(" ") || "untagged")}-${i}`}
                        className="border-b border-border last:border-b-0"
                      >
                        <div className="flex min-w-0 items-start gap-2 bg-muted/40 px-3 py-2 text-[11px] leading-snug">
                          <span className="min-w-0 flex-1">
                            {group.milestone != null ? (
                              <>
                                <span className="font-medium text-foreground">
                                  Milestone {group.milestone}
                                </span>
                                {milestone?.claimTitle && (
                                  <span className="text-muted-foreground">
                                    {" "}
                                    — {milestone.claimTitle}
                                  </span>
                                )}
                              </>
                            ) : group.claims.length > 0 ? (
                              <span className="font-medium text-foreground">
                                {group.claims
                                  .map((id) => test.claimTitles?.[id] ?? id)
                                  .join(" · ")}
                              </span>
                            ) : (
                              <HoverPopover
                                portal
                                width="narrow"
                                content={
                                  group.heading === "Checks"
                                    ? "Runs after the last claim these steps could prepare — not tied to a spec promise."
                                    : "Arranges a condition the claim steps below it prove — not itself tied to a spec promise."
                                }
                              >
                                <span className="font-medium text-foreground underline decoration-dotted underline-offset-2">
                                  {group.heading ?? "Prepare"}
                                </span>
                              </HoverPopover>
                            )}
                          </span>
                          {milestone?.doc && milestone.anchor && (
                            <button
                              type="button"
                              onClick={() =>
                                onOpenSpec(milestone.doc!, milestone.anchor!)
                              }
                              title={`${milestone.doc} § ${milestone.anchor}`}
                              className="inline-flex min-w-0 max-w-[45%] shrink-0 items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                            >
                              <span className="min-w-0 truncate">
                                § {milestone.headingText ?? milestone.anchor}
                              </span>
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
                              selected={step.n === selectedStepNumber}
                              onSelect={() => inspectStep(step.n)}
                              rowRef={(node) => {
                                if (node) stepRows.current.set(step.n, node);
                                else stepRows.current.delete(step.n);
                              }}
                            />
                          ))}
                        </ol>
                      </div>
                    );
                  })}
                </div>
              ) : test.failure && source != null ? (
                <div className="overflow-hidden rounded border border-red-500/40">
                  <RecordedFailureRow
                    failure={test.failure}
                    selected={selectedStepNumber === test.failure.step}
                    onSelect={() => inspectStep(test.failure!.step)}
                    rowRef={(node) => {
                      if (node) stepRows.current.set(test.failure!.step, node);
                      else stepRows.current.delete(test.failure!.step);
                    }}
                  />
                </div>
              ) : (
                <pre className={PRE}>
                  {source == null ? "Loading steps…" : source.content}
                </pre>
              )}
            </div>
          </div>

          <aside className="guard-investigation-inspector min-w-0 space-y-5">
            {selectedRecordedFailure ? (
              <RecordedFailureInspector failure={selectedRecordedFailure} />
            ) : (
              <StepInspector
                step={selectedStep}
                failedStep={test.failure?.step}
                passed={passed}
                claim={stepClaim(selectedStep, test, milestones)}
                {...(test.failure ? { failure: test.failure } : {})}
              />
            )}

            <div ref={visualsSection}>
              <div className="mb-2 flex items-center gap-2">
                <Camera className="h-3.5 w-3.5 text-muted-foreground" />
                <h3 className="text-[12px] font-semibold text-foreground">
                  Visual evidence
                </h3>
                {screenshotCount > 0 && (
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {screenshotCount}
                  </span>
                )}
              </div>
              {visualsBusy ? (
                <p className="text-[11px] text-muted-foreground">
                  Loading screenshots…
                </p>
              ) : where && visuals.length > 0 ? (
                <GuardEvidenceVisuals
                  repoId={repoId}
                  where={where}
                  visuals={visuals}
                  {...(selectedStepNumber != null
                    ? { selectedStep: selectedStepNumber }
                    : {})}
                  {...(test.failure ? { failedStep: test.failure.step } : {})}
                  onSelectStep={(step) => inspectStep(step, true)}
                />
              ) : (
                <p className="rounded border border-dashed border-border px-3 py-3 text-[11px] leading-relaxed text-muted-foreground">
                  No screenshots or session replay were recorded for this test.
                </p>
              )}
            </div>
          </aside>
        </div>
      </section>

      <div ref={interfacesSection}>
        <InterfacePathSection
          path={test.interfacePath}
          interfaces={interfaces}
          {...(onOpenInterface ? { onOpenInterface } : {})}
        />
      </div>

      {where && (
        <details
          className="group overflow-hidden rounded border border-border"
          aria-label="Run transcript"
        >
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 outline-none hover:bg-muted/35 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
            <span className="text-[12px] font-semibold text-foreground">
              Transcript
            </span>
            <span className="text-[11px] text-muted-foreground">
              supporting run evidence
            </span>
            <ChevronDown className="ml-auto h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="border-t border-border p-3">
            <GuardLongText
              text={evidenceBusy ? "Loading transcript…" : (evidence ?? "")}
              label="evidence transcript"
            />
          </div>
        </details>
      )}

      <dl className="space-y-1 border-t border-border pt-3 text-[11px]">
        <FootRow label="Test">
          <span className="truncate font-mono text-muted-foreground">
            {test.id}
          </span>
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
            <button
              type="button"
              onClick={() => onOpenFlow(test.flow!.id)}
              className={FOOT_BTN}
            >
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
              <span className={FOOT_TEXT}>
                {test.binds.headingText ?? test.binds.doc}
              </span>
              <span className={`${FOOT_TEXT} text-muted-foreground`}>
                § {test.binds.section}
              </span>
              <ArrowUpRight className="h-3 w-3 shrink-0" />
            </button>
          </FootRow>
        )}
      </dl>
    </div>
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
  const { mode, setMode, raw } = useArtifactMode("YAML");
  return (
    <div className="flex h-full min-w-0 flex-col bg-background">
      <div className="min-w-0 border-b border-border bg-card px-6 py-4">
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
