/**
 * A TEST, rendered ONCE — the ONE scenario rendering in guard.
 *
 * Two things can feed it: the flow's own committed test (read inside the merged
 * FLOW detail, which is the entity) or an INSTANCE — how that test ran in one run,
 * on the Runs tab. The body is identical — only the provenance and the result that
 * feeds it differ — so a reader learns it once.
 *
 * IT IS A WORKSPACE, NOT A DOCUMENT. The job is one question — "is the code
 * broken, the test wrong, or the spec wrong?" — and the answer lives in two facts
 * that must be on screen TOGETHER: where it broke, and what that step returned.
 * A scrolling document puts them minutes apart, so the page is a fixed-height
 * workspace instead: it never scrolls, its PANES do.
 *
 *   verdict band    one or two lines: the status word, the triage verdict, where
 *                   it broke (clickable — it selects that step) and the one
 *                   "Next:" a reader acts on
 *   filmstrip       a browser run only: one tile per captured step, in step order,
 *                   the failing tile marked. Hover shows the tile at reading size,
 *                   click selects the step, Replay opens the session video
 *   steps  │ inspector    the split that IS the investigation. Left: every step as
 *                   ONE dense line. Right: everything known about the selected one,
 *                   under four tabs. Each pane scrolls itself
 *   drawers         the supporting record, closed by default — the transcript, the
 *                   interfaces this flow walks, and the rulings a reader can make
 *   footer          Test · File · Flow · Spec, on one line
 *
 * ONE SELECTION, and every pane is a projection of it. No pane owns private state:
 * the filmstrip tile, the step row and the inspector are three renderings of the
 * same number. THE SELECTION MOVES ONLY ON A CLICK (or its keyboard equivalent) —
 * hover never re-aims the inspector, so a pointer crossing the list on its way
 * somewhere else cannot yank the step a reader is mid-way through reading. The
 * strip's hover preview shows the TILE at size; it does not touch the selection.
 *
 * FAILURE OWNS THE FIRST SELECTION, and says so in redundant channels: the verdict
 * band names it, the row is tinted, its filmstrip tile is marked. Error tint is the
 * ONLY per-row colour — a rainbow of per-status row fills would make the one red
 * row worth nothing.
 *
 * FOUR FACTS PER STEP ROW: mark · number · kind · command, with the duration right
 * aligned. Rows never wrap and never grow — a long command ellipsises and keeps its
 * whole text in the title — because the list is for SCANNING; the reading happens
 * in the inspector.
 *
 * THE MILESTONE IS A DIVIDER, NOT A BAND. A group of steps is headed by its number
 * alone (`M2`) and a link to the section it proves; the claim SENTENCE reads in the
 * inspector header of every step in the group, which is where a reader asking "what
 * was this step for?" already is. A full-width claim band per group cost more
 * vertical space than the steps it introduced.
 *
 * SETUP IS STEP 0. The `setup:` block is the world step 1 starts in, so it reads as
 * a pseudo-row at the top of the same list — selectable like any other step, with
 * the seeded files, the git world and the env overlay in the inspector.
 *
 * THE INSPECTOR'S TABS ARE COUNTED AND HONEST. `Screen` exists only for a step that
 * recorded a picture; a cli step is never offered browser vocabulary and a browser
 * step is never offered an exit code. A tab that APPLIES but has nothing behind it
 * still opens, and says in words what is missing ("the step printed nothing", "not
 * recorded in this run") — a blank panel is the one thing a reader cannot act on.
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
 * NOTHING SCROLLS SIDEWAYS. Wide data (a command line, a JSON body, a transcript)
 * is never re-wrapped — it scrolls INSIDE its own block ({@link PRE}), and that is
 * the only horizontal scroll on the screen. Structurally that costs one thing
 * everywhere: every flex box between a PANE (`data-pane`) and such a block carries
 * `min-w-0`, so a wide child shrinks its column instead of stretching the page, and
 * every truncating span is width-bound rather than free to grow. Vertically, a pane
 * is the only scroll context its blocks have.
 */

import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  ArrowUpRight,
  Braces,
  Check,
  ChevronRight,
  Copy,
  Gavel,
  Minus,
  ScrollText,
  Wrench,
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

/** The one mark a step wears, in the one colour its outcome earns. */
function StepMark({ glyph, className }: { glyph: string; className: string }) {
  const Icon = glyph === "✗" ? X : glyph === "✓" ? Check : Minus;
  const tone =
    glyph === "✗"
      ? "text-red-600 dark:text-red-400"
      : glyph === "✓"
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-muted-foreground";
  return <Icon aria-hidden className={`${className} shrink-0 ${tone}`} />;
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
 * THE JUDGE'S READING, inside the failing step's Result tab — what a vision model
 * saw in the screenshot the step left behind, under its own label so it sits beside
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
      {visual && <VisualJudgeRow visual={visual} />}
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

/** How many lines a panel's streams hold — the volume its tab advertises. */
function lineCount(...blocks: (string | undefined)[]): number {
  return blocks
    .filter((block): block is string => !!block)
    .reduce((total, block) => total + block.split("\n").length, 0);
}

/** The row height every step line keeps — one line, four facts, never growing. */
const STEP_ROW =
  "flex h-7 w-full min-w-0 cursor-pointer items-center gap-2 px-2.5 text-left outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary";
/** The kind token — a fact about the step, never a verdict, so never coloured. */
const STEP_KIND =
  "shrink-0 rounded bg-muted px-1 py-px text-[10px] font-medium text-muted-foreground";

/**
 * ONE compact step: mark · number · kind · command, with its duration right
 * aligned. Clicking it moves the shared inspector to what that step expected,
 * returned and printed — the ONLY thing that moves it; hovering a row changes
 * nothing but the row's own hover paint. The command never wraps — the row is
 * for scanning, and the whole text stays reachable in the title and in the
 * inspector header.
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
  /** The one row the workspace is pinned to — the inspector's subject. */
  selected: boolean;
  onSelect: () => void;
  rowRef?: (node: HTMLLIElement | null) => void;
}) {
  const { glyph, label } = stepGlyph(step.n, failedStep, passed);
  const failed = glyph === "✗";
  const duration = step.actual?.durationMs;

  return (
    <li
      ref={rowRef}
      aria-label={`Step ${step.n}: ${step.command} — ${label}`}
      className={`border-b border-border/50 last:border-b-0 ${
        selected
          ? "bg-primary/[0.055] ring-1 ring-inset ring-primary/20"
          : failed
            ? "bg-red-500/[0.05]"
            : ""
      }`}
    >
      <button
        type="button"
        aria-pressed={selected}
        aria-label={`Inspect step ${step.n}`}
        title={step.command}
        tabIndex={selected ? 0 : -1}
        onClick={onSelect}
        className={STEP_ROW}
      >
        <StepMark glyph={glyph} className="h-3 w-3" />
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
  selected,
  onSelect,
  rowRef,
}: {
  selected: boolean;
  onSelect: () => void;
  rowRef?: (node: HTMLLIElement | null) => void;
}) {
  return (
    <li
      ref={rowRef}
      aria-label="Step 0: setup — the world the steps start in"
      className={`border-b border-border/50 ${
        selected ? "bg-primary/[0.055] ring-1 ring-inset ring-primary/20" : ""
      }`}
    >
      <button
        type="button"
        aria-pressed={selected}
        aria-label="Inspect setup"
        tabIndex={selected ? 0 : -1}
        onClick={onSelect}
        className={STEP_ROW}
      >
        <Wrench aria-hidden className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span className="w-4 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
          0
        </span>
        <span className={STEP_KIND}>setup</span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
          the world the steps start in
        </span>
      </button>
    </li>
  );
}

/**
 * The claim a group of steps proves, as a THIN divider: the milestone's number and
 * a link to the section that states it. The claim sentence itself is not here —
 * it reads in the inspector header of every step below, where a reader asking what
 * a step was for already is.
 *
 * A group tagged by claim IDENTITY has no number to stand in for it, so the claim
 * is what names it (truncated — the divider stays one line either way). A group
 * that names NEITHER is named by its POSITION, which is what such a group IS.
 */
function MilestoneDivider({
  group,
  milestone,
  claimTitles,
  onOpenSpec,
}: {
  group: StepGroup;
  milestone?: NonNullable<GuardTestViewModel["milestones"]>[number];
  claimTitles?: Readonly<Record<string, string>>;
  onOpenSpec: (doc: string, section: string) => void;
}) {
  const section =
    milestone?.doc && milestone.anchor
      ? `§ ${milestone.headingText ?? milestone.anchor}`
      : null;
  return (
    <div className="flex min-w-0 items-center gap-2 border-b border-border bg-muted/50 px-2.5 py-1 text-[10px] uppercase tracking-wider">
      {group.milestone != null ? (
        <span className="shrink-0 font-medium tabular-nums text-muted-foreground">
          M{group.milestone}
        </span>
      ) : group.claims.length > 0 ? (
        <span className="min-w-0 flex-1 truncate font-medium normal-case tracking-normal text-muted-foreground">
          {group.claims.map((id) => claimTitles?.[id] ?? id).join(" · ")}
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
          <span className="cursor-help font-medium text-muted-foreground underline decoration-dotted underline-offset-2">
            {group.heading ?? "Prepare"}
          </span>
        </HoverPopover>
      )}
      {section && (
        <button
          type="button"
          onClick={() => onOpenSpec(milestone!.doc!, milestone!.anchor!)}
          title={`${milestone!.doc} ${section}`}
          aria-label={section}
          className="ml-auto inline-flex shrink-0 cursor-pointer items-center gap-0.5 rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span aria-hidden className="text-[11px] leading-none">
            §
          </span>
          <ArrowUpRight aria-hidden className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

/** The four readings of a step, and the volume each one is carrying. */
type InspectorTabId = "result" | "output" | "screen" | "info";

interface InspectorTab {
  id: InspectorTabId;
  label: string;
  /** The volume the tab advertises before it is opened; undefined = nothing to count. */
  count?: number;
}

/**
 * One step's whole record, beside the list. The header names the step and the
 * claim its group proves; the tabs split the record by the question being asked,
 * and each one either has an answer or says what is missing.
 */
function StepInspector({
  step,
  failedStep,
  passed,
  failure,
  claim,
  tab,
  onTab,
  picture,
}: {
  step: GuardScenarioStepView | null;
  failedStep: number | undefined;
  passed: boolean;
  failure?: GuardFailureDetail;
  claim?: string;
  tab: InspectorTabId;
  onTab: (next: InspectorTabId) => void;
  /** The step's picture, when the run's evidence bundle holds one for it. */
  picture?: ReactNode;
}) {
  if (!step) {
    return (
      <InspectorFrame>
        <p className="px-3 py-3 text-[12px] text-muted-foreground">
          Loading step details…
        </p>
      </InspectorFrame>
    );
  }
  const { glyph, label } = stepGlyph(step.n, failedStep, passed);
  const failed = glyph === "✗";
  const panel = stepPanelProps(step, failedStep, failure);
  const web = panel.web;
  const facts =
    (step.env && step.env.length > 0 ? 1 : 0) +
    (step.cwd ? 1 : 0) +
    (step.note ? 1 : 0) +
    (step.repeat != null && step.repeat > 1 ? 1 : 0);
  const outputLines = web
    ? (web.console ?? []).length
    : lineCount(panel.stdout, panel.stderr);
  const checkCount = web ? web.checks.length : (panel.checks?.length ?? 0);
  const shot = picture ?? web?.screenshot ?? null;

  const tabs: InspectorTab[] = [
    { id: "result", label: "Result", ...(checkCount ? { count: checkCount } : {}) },
    { id: "output", label: "Output", ...(outputLines ? { count: outputLines } : {}) },
    ...(shot ? ([{ id: "screen", label: "Screen" }] as InspectorTab[]) : []),
    { id: "info", label: "Info", ...(facts ? { count: facts } : {}) },
  ];
  const open = tabs.some((t) => t.id === tab) ? tab : "result";

  return (
    <InspectorFrame>
      <div className="shrink-0 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <StepMark glyph={glyph} className="h-3.5 w-3.5" />
          <h3 className="shrink-0 text-[13px] font-semibold text-foreground">
            Step {step.n}
          </h3>
          <span className={STEP_KIND}>{step.kind}</span>
          {step.teardown && (
            <span className="shrink-0 rounded bg-sky-500/15 px-1 py-px text-[10px] font-medium text-sky-700 dark:text-sky-300">
              teardown
            </span>
          )}
          <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
            {step.actual?.durationMs != null
              ? `${formatGuardDuration(step.actual.durationMs)} · step ${label}`
              : `step ${label}`}
          </span>
        </div>
        <p className="mt-1.5 break-words font-mono text-[12px] leading-snug text-foreground">
          {step.command}
        </p>
        {/* The claim this step's group proves — the sentence the list divider no
            longer carries, read where the step itself is being read. */}
        {claim && (
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
            {claim}
          </p>
        )}
        {failed && (
          <p className="mt-1.5 text-[11px] leading-snug text-red-700 dark:text-red-400">
            Execution stopped here. The steps after this one were not reached.
          </p>
        )}
      </div>
      <InspectorTabs tabs={tabs} open={open} onTab={onTab} />
      <div
        data-pane
        className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-2.5"
      >
        <TabPanel id="result" open={open}>
          <ResultPanel {...panel} />
        </TabPanel>
        <TabPanel id="output" open={open}>
          <OutputPanel {...panel} />
        </TabPanel>
        {shot && (
          <TabPanel id="screen" open={open}>
            {picture ?? (
              // The picture's bytes are not in this bundle — its recorded file
              // name is the honest remainder of the record.
              <p className="font-mono text-[11px] leading-snug text-muted-foreground">
                {web?.screenshot}
              </p>
            )}
          </TabPanel>
        )}
        <TabPanel id="info" open={open}>
          <InfoPanel step={step} />
        </TabPanel>
      </div>
    </InspectorFrame>
  );
}

/** The INFO tab: the conditions the step ran under, and the note it was written with. */
function InfoPanel({ step }: { step: GuardScenarioStepView }) {
  const env = step.env && step.env.length > 0 ? step.env.join(" ") : null;
  const repeat = step.repeat != null && step.repeat > 1 ? step.repeat : null;
  if (!env && !step.cwd && !step.note && !repeat)
    return <NoValue>this step runs with nothing set around it</NoValue>;
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
            {step.note}
          </p>
        </DiffRow>
      )}
    </div>
  );
}

/** The inspector's shell — one card, its own scroll, never the page's. */
function InspectorFrame({ children }: { children: ReactNode }) {
  return (
    <section
      aria-label="Selected step details"
      aria-live="polite"
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded border border-border bg-card"
    >
      {children}
    </section>
  );
}

/** The tab strip — each tab says how much is behind it before it is opened. */
function InspectorTabs({
  tabs,
  open,
  onTab,
}: {
  tabs: readonly InspectorTab[];
  open: InspectorTabId;
  onTab: (next: InspectorTabId) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Step record"
      className="flex shrink-0 items-center gap-0.5 border-b border-border px-1.5"
    >
      {tabs.map((tab) => {
        const active = tab.id === open;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`step-tab-${tab.id}`}
            aria-selected={active}
            aria-controls={`step-panel-${tab.id}`}
            onClick={() => onTab(tab.id)}
            className={`-mb-px cursor-pointer border-b-2 px-2 py-1.5 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${
              active
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
            {tab.count != null && (
              <span className="ml-1 tabular-nums text-muted-foreground">
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * One tab's panel. Every applicable panel is rendered and the closed ones are
 * hidden in CSS: switching tabs must never re-fetch or lose an expanded long-data
 * block a reader already opened.
 */
function TabPanel({
  id,
  open,
  children,
}: {
  id: InspectorTabId;
  open: InspectorTabId;
  children: ReactNode;
}) {
  return (
    <div
      role="tabpanel"
      id={`step-panel-${id}`}
      aria-labelledby={`step-tab-${id}`}
      className={`min-w-0 ${id === open ? "" : "hidden"}`}
    >
      {children}
    </div>
  );
}

/** The setup block, read as step 0's record. */
function SetupInspector({ setup }: { setup: GuardScenarioSetupView }) {
  return (
    <InspectorFrame>
      <div className="shrink-0 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Wrench
            aria-hidden
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
          />
          <h3 className="text-[13px] font-semibold text-foreground">Setup</h3>
          <span className="ml-auto text-[11px] text-muted-foreground">
            before step 1
          </span>
        </div>
        <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
          What was already true when the first step ran — the runner materializes
          it before the test starts.
        </p>
      </div>
      <div
        data-pane
        className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-2.5"
      >
        <GuardTestSetup setup={setup} framed={false} />
      </div>
    </InspectorFrame>
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
  tab,
  onTab,
}: {
  failure: GuardFailureDetail;
  tab: InspectorTabId;
  onTab: (next: InspectorTabId) => void;
}) {
  const panel: StepPanelProps = {
    expected: failure.expected,
    ...(failure.actual ? { actual: failure.actual } : {}),
    ...(failure.stdout ? { stdout: failure.stdout } : {}),
    ...(failure.stderr ? { stderr: failure.stderr } : {}),
    ...(failure.visual ? { visual: failure.visual } : {}),
    recorded: true,
  };
  const outputLines = lineCount(panel.stdout, panel.stderr);
  const tabs: InspectorTab[] = [
    { id: "result", label: "Result" },
    { id: "output", label: "Output", ...(outputLines ? { count: outputLines } : {}) },
  ];
  const open = tabs.some((t) => t.id === tab) ? tab : "result";
  return (
    <InspectorFrame>
      <div className="shrink-0 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <StepMark glyph="✗" className="h-3.5 w-3.5" />
          <h3 className="text-[13px] font-semibold text-foreground">
            Step {failure.step}
          </h3>
          <span className={STEP_KIND}>recorded run</span>
          <span className="ml-auto text-[11px] text-muted-foreground">
            step failed
          </span>
        </div>
        <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
          This run used an earlier test revision. Step {failure.step} is not in
          the current YAML, but its failure and captured evidence are preserved
          here.
        </p>
        <p className="mt-1 text-[11px] leading-snug text-red-700 dark:text-red-400">
          Execution stopped here. The recorded action did not complete.
        </p>
      </div>
      <InspectorTabs tabs={tabs} open={open} onTab={onTab} />
      <div
        data-pane
        className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-2.5"
      >
        <TabPanel id="result" open={open}>
          <ResultPanel {...panel} />
        </TabPanel>
        <TabPanel id="output" open={open}>
          <OutputPanel {...panel} />
        </TabPanel>
      </div>
    </InspectorFrame>
  );
}

/** The recorded-failure row, at the head of a list it is no longer part of. */
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
    <div className="border-b border-border">
      <div className="bg-red-500/[0.05] px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Recorded run · earlier test revision
      </div>
      <ol>
        <li
          ref={rowRef}
          aria-label={`Step ${failure.step}: recorded run failure — failed`}
          className={`bg-red-500/[0.05] ${selected ? "ring-1 ring-inset ring-red-500/35" : ""}`}
        >
          <button
            type="button"
            aria-pressed={selected}
            aria-label={`Inspect step ${failure.step}`}
            title={failure.expected}
            tabIndex={selected ? 0 : -1}
            onClick={onSelect}
            className={STEP_ROW}
          >
            <StepMark glyph="✗" className="h-3 w-3" />
            <span className="w-4 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
              {failure.step}
            </span>
            <span className={STEP_KIND}>recorded</span>
            <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground">
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
 * The step list as SECTIONS: each milestone's steps under a divider naming the
 * claim they realize, in file order — by position, or by identity for a test that
 * tags its steps with claim ids directly.
 *
 * A group whose steps name NEITHER is headed BY ITS POSITION, because position is
 * what such a group IS: preparation only means anything before the thing it
 * prepares, so an untagged group reads "Prepare" exactly while claim-tagged steps
 * still FOLLOW it. With no claim steps after it there is nothing left to prepare —
 * those are the trailing checks a test closes with, and they read "Checks".
 *
 * "Prepare" is these steps ACTING to arrange a condition; step 0's "Setup" is the
 * state that was already there before step 1. Two different things, two words.
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

/** The three supporting records, closed until a reader asks for one. */
type DrawerId = "transcript" | "interfaces" | "rulings";

/** One drawer's tab on the collapsed row — its name, and how much is behind it. */
function DrawerTab({
  id,
  label,
  count,
  icon: Icon,
  open,
  onToggle,
}: {
  id: DrawerId;
  label: string;
  count?: number;
  icon: typeof Braces;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={`guard-drawer-${id}`}
      onClick={onToggle}
      className={`inline-flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 text-[11px] outline-none hover:bg-muted/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary ${
        open ? "bg-muted/60 text-foreground" : "text-muted-foreground"
      }`}
    >
      <ChevronRight
        aria-hidden
        className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`}
      />
      <Icon aria-hidden className="h-3.5 w-3.5" />
      {label}
      {count != null && <span className="tabular-nums">{count}</span>}
    </button>
  );
}

/**
 * The verdict's OWN paint, at full strength — the one place a status reads at
 * display size instead of chip size. Same four-colour vocabulary as every guard
 * chip (`lib/guard-status.ts`): red is a verdict someone must act on, green is
 * proven, blue is "no verdict yet, and someone can move it", grey is nobody's
 * to-do. The card wears a wash of the same hue so the eye lands on the ruling
 * before it reads anything.
 */
const VERDICT_TONE: Record<
  GuardTestStatusView["plain"],
  { card: string; word: string; Icon: typeof X }
> = {
  failed: {
    card: "border-red-500/35 bg-red-500/[0.04]",
    word: "text-red-600 dark:text-red-400",
    Icon: X,
  },
  succeeded: {
    card: "border-emerald-500/35 bg-emerald-500/[0.04]",
    word: "text-emerald-600 dark:text-emerald-400",
    Icon: Check,
  },
  blocked: {
    card: "border-sky-500/35 bg-sky-500/[0.04]",
    word: "text-sky-600 dark:text-sky-400",
    Icon: Minus,
  },
  "never-run": {
    card: "border-sky-500/35 bg-sky-500/[0.04]",
    word: "text-sky-600 dark:text-sky-400",
    Icon: Minus,
  },
  "not-testable": {
    card: "border-border bg-card",
    word: "text-muted-foreground",
    Icon: Minus,
  },
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
  /** The step the workspace is pinned to — every pane is a projection of it. */
  const [selectedStepNumber, setSelectedStepNumber] = useState<number | null>(
    null,
  );
  /** Which reading of the active step the inspector is open on. */
  const [tab, setTab] = useState<InspectorTabId>("result");
  /** Which supporting record is open; null = the row is closed. */
  const [drawer, setDrawer] = useState<DrawerId | null>(null);
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
    setTab("result");
  }, [resultKey, stepSignature]);

  const steps = source?.steps ?? [];
  const recordedFailureMissingFromSource =
    test.failure != null &&
    source != null &&
    !steps.some((step) => step.n === test.failure!.step);
  const selectedStep =
    steps.find((step) => step.n === selectedStepNumber) ?? null;
  const selectedRecordedFailure =
    recordedFailureMissingFromSource &&
    selectedStepNumber === test.failure?.step
      ? test.failure
      : null;
  const screenshots = visuals.filter((visual) => visual.kind === "screenshot");
  const videos = visuals.filter((visual) => visual.kind === "video");
  // The lightbox is keyed on the sequence ITSELF (its file names), so a different
  // test's evidence closes it and an ordinary re-render — `visuals` may be a
  // fresh array — does not.
  const shotSequence = screenshots.map((visual) => visual.file).join("|");
  useEffect(() => setOpenShot(null), [shotSequence]);
  /** The selected step's own screenshot — the `Screen` tab's value. */
  const selectedShot =
    selectedStepNumber == null
      ? undefined
      : screenshots.find((visual) => visual.step === selectedStepNumber);
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
        stepRows.current.get(step)?.scrollIntoView({ block: "nearest" }),
      );
  };
  const openSelectedShot = () => {
    if (!selectedShot) return;
    setOpenShot(
      screenshots.findIndex((visual) => visual.file === selectedShot.file),
    );
  };

  // The rows a keyboard walks, in the order they read: setup, the recorded
  // failure that is no longer in the file, then the file's own steps.
  const rowOrder: number[] = [
    ...(source?.setup ? [SETUP_STEP] : []),
    ...(recordedFailureMissingFromSource && test.failure
      ? [test.failure.step]
      : []),
    ...steps.map((step) => step.n),
  ];
  const onListKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      // A step that recorded a picture opens it where it is — the list stays put.
      if (e.key === "Enter" && selectedShot) {
        e.preventDefault();
        openSelectedShot();
      }
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const at = rowOrder.indexOf(selectedStepNumber ?? rowOrder[0]!);
    const next = rowOrder[Math.max(0, Math.min(rowOrder.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)))];
    if (next == null) return;
    inspectStep(next);
    requestAnimationFrame(() => {
      const row = stepRows.current.get(next);
      row?.scrollIntoView({ block: "nearest" });
      row?.querySelector("button")?.focus();
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

      {/* THE VERDICT — the one thing a reader opens this page to learn, so it is
          the page's single loudest element: the verdict word at display strength
          with its mark beside it, on a card washed in the verdict's own colour.
          The status chip is gone from here — a chip whispers, and beside the
          word at full strength it was the same fact told twice. Everything else
          on the card stays a quiet 11px fact; everything else about the failure
          reads at the step it happened on. */}
      <section
        aria-label="Test verdict"
        className={`min-w-0 shrink-0 rounded border px-3 py-2.5 ${verdictTone.card}`}
      >
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <h3 className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Verdict
          </h3>
          <span className="inline-flex shrink-0 items-center gap-1">
            <verdictTone.Icon
              aria-hidden
              className={`h-4 w-4 shrink-0 ${verdictTone.word}`}
            />
            <span
              className={`text-sm font-semibold leading-none ${verdictTone.word}`}
            >
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
              onClick={() => inspectStep(test.failure!.step, true)}
              className="cursor-pointer rounded font-semibold text-foreground underline decoration-dotted underline-offset-2 outline-none hover:decoration-solid focus-visible:ring-2 focus-visible:ring-primary"
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
      </section>

      {/* THE RUN, AS PICTURES — one tile per captured step, in step order. The
          strip is the scrubber: hovering shows a tile at reading size, clicking
          pins that step. A cli/api run recorded none, so a cli/api run has no
          strip. */}
      {where && screenshots.length > 0 && (
        <GuardRunFilmstrip
          repoId={repoId}
          where={where}
          screenshots={screenshots}
          videos={videos}
          {...(selectedStepNumber != null
            ? { selectedStep: selectedStepNumber }
            : {})}
          {...(test.failure ? { failedStep: test.failure.step } : {})}
          onSelectStep={(step) => inspectStep(step, true)}
        />
      )}

      {/* THE INVESTIGATION — the split this page exists for. `min-h` is a floor,
          not a height: on a short viewport the workspace stops shrinking and the
          host pane takes the scroll, rather than collapsing the two panes to
          nothing to keep a promise about the page not scrolling. */}
      <section
        aria-label="Test investigation"
        className="guard-investigation min-h-[18rem] min-w-0 flex-1"
      >
        <div className="guard-investigation-layout">
          <div
            className="guard-investigation-timeline flex min-h-0 min-w-0 flex-col"
            onKeyDown={onListKeyDown}
          >
            <div
              data-pane
              aria-label="test steps"
              className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden rounded border border-border"
            >
              {source != null && source.steps.length > 0 ? (
                <div key={resultKey} className="min-w-0">
                  {recordedFailureMissingFromSource && test.failure && (
                    <RecordedFailureRow
                      failure={test.failure}
                      selected={selectedStepNumber === test.failure.step}
                      onSelect={() => inspectStep(test.failure!.step)}
                      rowRef={stepRowRef(test.failure.step)}
                    />
                  )}
                  <ol className="min-w-0">
                    {source.setup && (
                      <SetupRow
                        selected={selectedStepNumber === SETUP_STEP}
                        onSelect={() => inspectStep(SETUP_STEP)}
                        rowRef={stepRowRef(SETUP_STEP)}
                      />
                    )}
                  </ol>
                  {groupStepsByMilestone(source.steps).map((group, i) => (
                    <div
                      key={`${group.milestone ?? (group.claims.join(" ") || "untagged")}-${i}`}
                      className="min-w-0"
                    >
                      <MilestoneDivider
                        group={group}
                        {...(group.milestone != null &&
                        milestones.get(group.milestone)
                          ? { milestone: milestones.get(group.milestone)! }
                          : {})}
                        {...(test.claimTitles
                          ? { claimTitles: test.claimTitles }
                          : {})}
                        onOpenSpec={onOpenSpec}
                      />
                      <ol className="min-w-0">
                        {group.steps.map((step) => (
                          <StepRow
                            key={step.n}
                            step={step}
                            failedStep={test.failure?.step}
                            passed={passed}
                            selected={step.n === selectedStepNumber}
                            onSelect={() => inspectStep(step.n)}
                            rowRef={stepRowRef(step.n)}
                          />
                        ))}
                      </ol>
                    </div>
                  ))}
                </div>
              ) : test.failure && source != null ? (
                <RecordedFailureRow
                  failure={test.failure}
                  selected={selectedStepNumber === test.failure.step}
                  onSelect={() => inspectStep(test.failure!.step)}
                  rowRef={stepRowRef(test.failure.step)}
                />
              ) : (
                <pre className={PRE}>
                  {source == null ? "Loading steps…" : source.content}
                </pre>
              )}
            </div>
          </div>

          <aside className="guard-investigation-inspector min-h-0 min-w-0">
            {selectedRecordedFailure ? (
              <RecordedFailureInspector
                failure={selectedRecordedFailure}
                tab={tab}
                onTab={setTab}
              />
            ) : selectedStepNumber === SETUP_STEP && source?.setup ? (
              <SetupInspector setup={source.setup} />
            ) : (
              <StepInspector
                step={selectedStep}
                failedStep={test.failure?.step}
                passed={passed}
                claim={stepClaim(selectedStep, test, milestones)}
                tab={tab}
                onTab={setTab}
                {...(test.failure ? { failure: test.failure } : {})}
                {...(selectedShot && where
                  ? {
                      picture: (
                        <GuardStepScreenshot
                          repoId={repoId}
                          where={where}
                          visual={selectedShot}
                          onOpen={openSelectedShot}
                        />
                      ),
                    }
                  : {})}
              />
            )}
          </aside>
        </div>
      </section>

      {/* THE SUPPORTING RECORD, closed. Each one is a whole reading of its own —
          a decision belongs after the evidence, not above it — and none of them is
          what a reader opened this page for. */}
      <div className="min-w-0 shrink-0">
        <div className="flex flex-wrap items-center gap-1">
          {where && (
            <DrawerTab
              id="transcript"
              label="Transcript"
              icon={ScrollText}
              open={drawer === "transcript"}
              onToggle={() =>
                setDrawer(drawer === "transcript" ? null : "transcript")
              }
            />
          )}
          <DrawerTab
            id="interfaces"
            label="Interfaces"
            count={test.interfacePath.length}
            icon={Braces}
            open={drawer === "interfaces"}
            onToggle={() =>
              setDrawer(drawer === "interfaces" ? null : "interfaces")
            }
          />
          {rulings && (
            <DrawerTab
              id="rulings"
              label="Rulings"
              icon={Gavel}
              open={drawer === "rulings"}
              onToggle={() =>
                setDrawer(drawer === "rulings" ? null : "rulings")
              }
            />
          )}
        </div>

        {where && (
          <div
            data-pane
            id="guard-drawer-transcript"
            className={`mt-1.5 max-h-[40vh] min-w-0 overflow-y-auto overflow-x-hidden rounded border border-border p-2.5 ${
              drawer === "transcript" ? "" : "hidden"
            }`}
          >
            <GuardLongText
              text={evidenceBusy ? "Loading transcript…" : (evidence ?? "")}
              label="evidence transcript"
            />
          </div>
        )}
        <div
          data-pane
          id="guard-drawer-interfaces"
          className={`mt-1.5 max-h-[40vh] min-w-0 overflow-y-auto overflow-x-hidden rounded border border-border p-2.5 ${
            drawer === "interfaces" ? "" : "hidden"
          }`}
        >
          <InterfacePathSection
            path={test.interfacePath}
            interfaces={interfaces}
            {...(onOpenInterface ? { onOpenInterface } : {})}
          />
        </div>
        {rulings && (
          <div
            data-pane
            id="guard-drawer-rulings"
            className={`mt-1.5 max-h-[40vh] min-w-0 overflow-y-auto overflow-x-hidden rounded border border-border p-2.5 ${
              drawer === "rulings" ? "" : "hidden"
            }`}
          >
            {rulings}
          </div>
        )}
      </div>

      {/* The facts a developer copies or jumps from — one line, never a block. */}
      <dl className="flex min-w-0 shrink-0 flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-border pt-2 text-[11px]">
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

      {/* The workspace claims what the header leaves. It owns HEIGHT scrolling for
          the RAW reading only (one long file); the page itself never scrolls, and
          x is clipped here so a wide line can only scroll its own block. */}
      <div
        data-pane
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-6 py-4"
      >
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
  );
}
