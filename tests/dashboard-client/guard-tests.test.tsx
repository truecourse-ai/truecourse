/**
 * THE TEST, as it is read: inside the flow that owns it, on the merged surface.
 *
 * There is no Tests tab and no standalone test destination — a flow and its test
 * are one entity. What this file covers is the SCENARIO RENDERING inside that
 * merged detail: it reads in the order a reader asks — what it checks → result →
 * setup → step investigation (visuals + interfaces) → transcript. It creates no dismissal
 * of its own (that ruling is the flow's "don't test this flow", the only MANUAL
 * unit — see `guard-flows.test.tsx`), but it surfaces an EXISTING dismissal
 * already recorded against the failing milestone's claim, with its undo.
 *
 * The steps carry the failure: the diff (expected / actual / the program's output
 * excerpt) reads INSIDE the failing step's expanded record, under a section headed
 * by the milestone that step realizes — never as a top-level Expected/Actual pair,
 * and never as a second "Program output" section repeating the transcript below.
 *
 * EVERY step reads the same way — expected, actual, output — because the run's
 * evidence gives a passing step its actuals too. A step the run never reached says
 * so instead of showing a blank. Every row is collapsible and the failing one
 * starts open for the viewed result.
 *
 * The pane never scrolls SIDEWAYS: wide data scrolls inside its own block, which
 * is a structural rule (min-w-0 down the flex chain, x-clip on the pane and on the
 * list panels) that jsdom can only be shown as classes.
 */

import { useState } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import type {
  GuardDismissedClaim,
  GuardEvidenceVisual,
  GuardFlowDetail,
  GuardFlowListItem,
  GuardFlowsView,
  GuardInterfaceRow,
  GuardScenarioResult,
  GuardScenarioSetupView,
} from "@truecourse/shared";
import { GuardDriftList } from "@/components/guard/GuardDriftList";
import { GuardFlowsPanel } from "@/components/guard/GuardFlowsPanel";
import { GuardFlowsPane } from "@/components/guard/GuardFlowsPane";
import { useGuardDecisions } from "@/hooks/useGuardDecisions";
import { useGuardFlowTabs } from "@/hooks/useGuardFlowTabs";
import { guardTestBinds } from "@/lib/guard-tests";
import { GUARD_CLAMP_LINES } from "@/components/guard/GuardLongText";
import type { GuardScenarioRowData } from "@/hooks/useGuardScenarios";

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const DOC = "docs/specs/tasks.md";
const FLOW_ID = "task-lifecycle";
const PASSING_ID = "task-lifecycle.cli.1";
const BIRTH_FAILED_ID = "handle-pathological-files.cli.1";
const RUN_FAILED_ID = "task-export.api.1";
const MANUAL_ID = "tasks-help-smoke";
const RUN_ID = "2026-07-24T14-02-00Z_9f31c0aa";

/** The passing flow's chain — the claim sentences its step groups are headed with. */
const CLAIMS = [
  "A task is added and gets an id",
  "A completed task reads as done",
];

const FLOW_TITLES = new Map([
  [
    FLOW_ID,
    "A user creates a task, sees it listed, completes it, and sees it done",
  ],
  [
    "handle-pathological-files-without-freezing-analyze",
    "Analyze survives a pathological file",
  ],
  ["task-export", "A user exports the task list"],
]);
const FLOW_GOALS = new Map([
  [FLOW_ID, "Create, list, complete and filter a task from the CLI"],
]);

const result = (
  id: string,
  over: Partial<GuardScenarioResult> = {},
): GuardScenarioResult => ({
  id,
  title: id,
  binds: { doc: DOC, section: "tasks/creating-tasks", fingerprint: "sha256:x" },
  outcome: "pass",
  durationMs: 120,
  stage: "run",
  ...over,
});

const INVENTORY: GuardScenarioRowData[] = [
  {
    id: PASSING_ID,
    title: "Tasks are created, listed newest-first, completed and filterable",
    doc: DOC,
    anchor: "tasks/creating-tasks",
    headingText: "Creating tasks",
    file: "scenarios/tasks/task-lifecycle.cli.1.yaml",
    handWritten: false,
    flowId: FLOW_ID,
    surface: "cli",
    status: "passing",
    lastResult: result(PASSING_ID, { outcome: "pass", durationMs: 412 }),
  },
  {
    // Committed RED: it failed the first time it ran and no run has covered it
    // since, so the inventory paints the birth status.
    id: BIRTH_FAILED_ID,
    title: "Analyze completes despite a pathological slow file",
    doc: "README.md",
    anchor: "analyze",
    headingText: "Analyze",
    file: "scenarios/analyze/pathological.cli.1.yaml",
    handWritten: false,
    flowId: "handle-pathological-files-without-freezing-analyze",
    surface: "cli",
    status: "failing",
    lastResult: null,
  },
  {
    id: RUN_FAILED_ID,
    title: "Exporting writes every task to the file",
    doc: DOC,
    anchor: "tasks/exporting",
    file: "scenarios/tasks/task-export.api.1.yaml",
    handWritten: false,
    flowId: "task-export",
    surface: "api",
    status: "passing",
    lastResult: result(RUN_FAILED_ID, {
      outcome: "fail",
      failure: { step: 2, expected: "200", actual: "500" },
    }),
  },
  {
    id: MANUAL_ID,
    title: "`tasks --help` prints usage",
    doc: DOC,
    anchor: "tasks/cli",
    file: "scenarios/manual/help.yaml",
    handWritten: true,
    flowId: `manual:${MANUAL_ID}`,
    surface: "cli",
    lastResult: null,
  },
];

/** The spec bindings the merged detail's Spec footer row reads — the same index
 *  the page builds from the committed inventory. */
const BINDS = guardTestBinds(INVENTORY);

/** The scenario id each flow owns, for a test that names one and wants its flow. */
const FLOW_OF: Record<string, string> = {
  [PASSING_ID]: FLOW_ID,
  [BIRTH_FAILED_ID]: "handle-pathological-files-without-freezing-analyze",
};

/** The merged list's rows — one per flow, the same corpus the inventory describes. */
const FLOW_ROWS: GuardFlowListItem[] = [...FLOW_TITLES].map(
  ([flowId, title]) => ({
    flowId,
    title,
    goal: FLOW_GOALS.get(flowId) ?? "",
    status: flowId === FLOW_ID ? "pass" : "fail",
    bucket: "guarded",
    epic: false,
    composedOf: [],
    manual: false,
    milestoneCount: 1,
    sectionCount: 1,
    docs: [DOC],
    surfaces: [],
    findings: 0,
    toolDefects: 0,
    errors: 0,
    interfaceDrifted: false,
  }),
);

const FLOW_DETAIL: GuardFlowDetail = {
  flowId: FLOW_ID,
  title: FLOW_TITLES.get(FLOW_ID)!,
  goal: FLOW_GOALS.get(FLOW_ID)!,
  status: "pass",
  bucket: "guarded",
  epic: false,
  manual: false,
  composedOf: [],
  milestones: CLAIMS.map((claimTitle, i) => ({
    order: i + 1,
    doc: DOC,
    anchor: "tasks/creating-tasks",
    claimTitle,
    headingText: "Creating tasks",
    live: true,
    drifted: false,
  })),
  surfaces: [
    {
      surface: "cli",
      scenarioId: PASSING_ID,
      title: "Tasks are created, listed newest-first, completed and filterable",
      status: "pass",
      birthPassed: true,
      stage: "run",
      outcome: "pass",
      durationMs: 412,
      evidencePath: `.truecourse/guard/evidence/${RUN_ID}/${PASSING_ID}`,
      hasEvidence: true,
      interfacePath: ["cli/tasks-add"],
    },
  ],
  gaps: [],
  interfaceIds: ["cli/tasks-add"],
  findings: [],
  errors: [],
  generatedAt: "2026-07-24T13:40:00.000Z",
  runId: RUN_ID,
  ranAt: "2026-07-24T14:02:00.000Z",
};

/** The claim behind the birth-failing test — the milestone its failing step realized. */
const BIRTH_CLAIM = {
  doc: "README.md",
  anchor: "analyze",
  title: "Analyze finishes on every file it is given",
};

const BIRTH_FLOW_DETAIL: GuardFlowDetail = {
  ...FLOW_DETAIL,
  flowId: "handle-pathological-files-without-freezing-analyze",
  title: FLOW_TITLES.get("handle-pathological-files-without-freezing-analyze")!,
  goal: "Analyze a repo carrying a pathological file without freezing",
  status: "fail",
  milestones: [
    {
      order: 1,
      doc: BIRTH_CLAIM.doc,
      anchor: BIRTH_CLAIM.anchor,
      claimTitle: BIRTH_CLAIM.title,
      headingText: "Analyze",
      live: true,
      drifted: false,
    },
  ],
  surfaces: [
    {
      surface: "cli",
      scenarioId: BIRTH_FAILED_ID,
      title: "Analyze completes despite a pathological slow file",
      status: "fail",
      birthPassed: false,
      stage: "birth",
      failure: {
        step: 2,
        expected: "exit 0",
        actual: "timed out after 120s",
        stdout: "analyzing 4211 files",
        stderr: "warning: pathological file skipped",
      },
      failedMilestone: 1,
      // The verdict the generate reached about this birth failure — what it IS,
      // not just that it happened.
      triage: {
        verdict: "code-drift",
        confidence: "high",
        brief: "The doc promises analyze finishes; the run timed out at 120s.",
        recommendation: "Bound the per-file work, or document the timeout.",
      },
      evidencePath: ".truecourse/guard/evidence/birth/pathological",
      hasEvidence: true,
      interfacePath: [],
    },
  ],
  interfaceIds: [],
};

const INTERFACES: GuardInterfaceRow[] = [
  {
    id: "cli/tasks-add",
    type: "cli",
    title: "tasks add",
    entry: { command: ["tasks", "add"] },
    steps: [{ kind: "invoke", command: ["tasks", "add"], flags: ["--json"] }],
    fingerprint: "sha256:j1",
    flows: [
      { flowId: FLOW_ID, title: FLOW_TITLES.get(FLOW_ID)!, realized: true },
    ],
    scenarioIds: [PASSING_ID],
    source: "tree",
  },
];

const YAML = ["guard: 3", `id: ${PASSING_ID}`, "driver: cli"].join("\n");
/**
 * The parsed step list the server ships alongside the source. A preparation step
 * annotated with NO milestone leads it, then two steps realizing milestone 1 and
 * one realizing milestone 2 — the grouping the detail renders as sections.
 */
const STEPS = [
  { n: 1, kind: "cli", command: "tasks init", expectation: "exit 0" },
  {
    n: 2,
    kind: "cli",
    command: 'tasks add "write the spec"',
    expectation: "exit 0",
    milestone: 1,
  },
  {
    n: 3,
    kind: "cli",
    command: "tasks list",
    env: ["NO_COLOR=1"],
    expectation: "exit 0 · stdout contains “write the spec”",
    milestone: 1,
  },
  {
    n: 4,
    kind: "cli",
    command: "tasks done 1",
    expectation: "exit 0",
    milestone: 2,
  },
];
/**
 * The same list as the SERVER merges it after the run that FAILED at step 2: steps 1
 * and 2 carry what they actually did, and the steps the run never reached carry
 * nothing — there is no record of them to show.
 */
const STEPS_STOPPED_AT_2 = STEPS.map((step) =>
  step.n === 1
    ? {
        ...step,
        actual: {
          n: 1,
          actual: "exit 0",
          durationMs: 12,
          stdout: "initialized tasks.json",
        },
      }
    : step.n === 2
      ? {
          ...step,
          actual: {
            n: 2,
            actual: "timed out",
            durationMs: 120_004,
            stdout: "analyzing 4211 files",
          },
        }
      : step,
);
/** The same list after the run that PASSED: every step executed, so every step has a record. */
const STEPS_ALL_RAN = STEPS.map((step) => ({
  ...step,
  actual: {
    n: step.n,
    actual: "exit 0",
    durationMs: 20 + step.n,
    stdout: `step ${step.n} output`,
  },
}));
/**
 * The same list with a WEB step in it, as the server merges it after a run that
 * took it. A browser step returns no exit code and prints no streams: its record is
 * the action, the address, each assertion beside the page's answer to it, what the
 * page showed, and the picture.
 */
const WEB_STEPS = [
  STEPS[0],
  {
    n: 2,
    kind: "web",
    command: "click button “Security”",
    expectation: "page text contains “Filtered by”",
    milestone: 1,
    actual: {
      n: 2,
      actual: "at /repos/sample-app",
      durationMs: 310,
      web: {
        action: "click button “Security”",
        url: "/repos/sample-app",
        screenshot: "step-2.png",
        checks: [
          {
            subject: "url",
            expected: 'the address contains "/repos/sample-app"',
            actual: 'the address was "/repos/sample-app"',
            ok: true,
          },
          {
            subject: "text",
            expected: 'the page text contains "Filtered by"',
            actual: 'the page text was "Filtered by: CATEGORY"',
            ok: true,
          },
        ],
        text: "Code Analysis\nFiltered by: CATEGORY",
      },
    },
  },
  STEPS[3],
];
/**
 * The same web step after a run where its TEXT matcher MISSED: the page renders
 * its heading uppercase (a CSS transform, which is the case `innerText` reports),
 * so the words are on screen in a different case than the matcher asked for. The
 * deterministic check is honestly red — and the vision judge's reading of the
 * step's screenshot says the result IS there, the test-is-wrong signal the
 * failure carries as `visual`.
 */
const WEB_STEPS_FAILED_AT_2 = [
  {
    ...STEPS[0],
    actual: {
      n: 1,
      actual: "exit 0",
      durationMs: 12,
      stdout: "initialized tasks.json",
    },
  },
  {
    n: 2,
    kind: "web",
    command: "click button “Security”",
    expectation: "page text contains “Filtered by”",
    milestone: 1,
    actual: {
      n: 2,
      actual: 'the page text was "FILTERED BY: CATEGORY"',
      durationMs: 310,
      web: {
        action: "click button “Security”",
        url: "/repos/sample-app",
        screenshot: "step-2.png",
        checks: [
          {
            subject: "url",
            expected: 'the address contains "/repos/sample-app"',
            actual: 'the address was "/repos/sample-app"',
            ok: true,
          },
          {
            subject: "text",
            expected: 'the page text contains "Filtered by"',
            actual: 'the page text was "FILTERED BY: CATEGORY"',
            ok: false,
          },
        ],
        text: "Code Analysis\nFILTERED BY: CATEGORY",
      },
    },
  },
  STEPS[3],
];
/**
 * A MIXED list as the server merges it after a run that took both: the browser step
 * ACTS and asserts the UI-level fact, and the request step reads the structured
 * answer. A request step returns a STATUS, not an exit code, and its record pairs
 * every assertion — status, header, each json path — with the response's own answer.
 */
const MIXED_STEPS = [
  WEB_STEPS[1],
  {
    n: 3,
    kind: "api",
    command: "GET /api/repos/sample-app/violations?severity=critical",
    expectation: "status 200 · total is 2",
    milestone: 1,
    actual: {
      n: 3,
      actual: "status 200",
      durationMs: 24,
      checks: [
        {
          subject: "status",
          expected: "status 200",
          actual: "status 200",
          ok: true,
        },
        {
          subject: "json",
          expected: "json total is 2",
          actual: "json total was 2",
          ok: true,
        },
      ],
      stdout: '{"total":2,"violations":[{"ruleKey":"no-eval"}]}',
    },
  },
  STEPS[3],
];
/** The claim id a hand-authored test tags a step with, and the sentence behind it. */
const CLAIM_ID = "a-task-is-added-and-gets-an-id";
/** The same file, tagged the way an AUTHORED corpus tags it: by claim IDENTITY. */
const CLAIM_TAGGED_STEPS = [
  { n: 1, command: "tasks init", expectation: "exit 0" },
  {
    n: 2,
    command: 'tasks add "write the spec"',
    expectation: "exit 0",
    claims: [CLAIM_ID],
  },
];
const LONG_TRANSCRIPT_LINES = 60;
const RUN_TRANSCRIPT = [
  '$ tasks add "write the spec"',
  ...Array.from(
    { length: LONG_TRANSCRIPT_LINES - 2 },
    (_, i) => `line ${i + 1}`,
  ),
  "ok",
].join("\n");
const BIRTH_TRANSCRIPT = "$ analyze .\ntimed out after 120s";

/** The decisions file the stub server holds — the dismiss/undismiss writes mutate
 *  it and answer with the updated file, exactly as the routes do. */
let dismissedClaims: GuardDismissedClaim[] = [];
let fetchMock: ReturnType<typeof vi.fn>;
/** Which step list the stub server ships — positional milestones, or claim ids. */
let servedSteps: unknown[] = STEPS;
/** The failing flow's detail — a test that needs a different failure swaps it. */
let servedBirthDetail: GuardFlowDetail = BIRTH_FLOW_DETAIL;
/** The starting world the stub server ships with the source; undefined = the file declares none. */
let servedSetup: GuardScenarioSetupView | undefined;
/** Every `/guard/scenario` URL the detail asked for — the run it named rides on it. */
let scenarioRequests: string[] = [];
/**
 * The visual half of the bundle the stub server holds. EMPTY by default: that is
 * what every cli/api run — and every run recorded before the web driver existed —
 * answers, and the whole suite below reads the page in exactly that state.
 */
let servedVisuals: GuardEvidenceVisual[] = [];
/** Every `/guard/evidence/visuals` URL asked for — it must address the same bundle. */
let visualsRequests: string[] = [];
/** Every spec section the page jumped to, as `[doc, anchor]`. */
let openedSpec: [string, string][] = [];

const decisionsBody = () =>
  json({ version: 1, dismissedClaims, dismissedFlows: [] });

beforeEach(() => {
  dismissedClaims = [];
  servedSteps = STEPS;
  servedBirthDetail = BIRTH_FLOW_DETAIL;
  servedSetup = undefined;
  servedVisuals = [];
  visualsRequests = [];
  scenarioRequests = [];
  openedSpec = [];
  fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/guard/flows/")) {
      return json(u.includes("pathological") ? servedBirthDetail : FLOW_DETAIL);
    }
    if (u.includes("/guard/scenario?")) {
      scenarioRequests.push(u);
      return json({
        id: PASSING_ID,
        file: "x.yaml",
        content: YAML,
        driver: "cli",
        steps: servedSteps,
        ...(servedSetup ? { setup: servedSetup } : {}),
      });
    }
    if (u.includes("/guard/evidence/visuals")) {
      visualsRequests.push(u);
      return json({ visuals: servedVisuals });
    }
    if (u.includes("/guard/finding-evidence"))
      return new Response(BIRTH_TRANSCRIPT, { status: 200 });
    if (u.includes("/guard/evidence"))
      return new Response(RUN_TRANSCRIPT, { status: 200 });
    if (u.includes("/guard/decisions")) return decisionsBody();
    if (u.includes("/guard/undismiss")) {
      dismissedClaims = [];
      return decisionsBody();
    }
    if (u.includes("/guard/dismiss")) {
      dismissedClaims = [
        {
          ...(JSON.parse(String(init?.body)) as GuardDismissedClaim),
          dismissedAt: "2026-07-26T00:00:00.000Z",
        },
      ];
      return decisionsBody();
    }
    return json({});
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

// --- ONE row anatomy, in the one list that still shows results --------------

describe("the run-result row — the shared guard row anatomy", () => {
  it("leads with the TITLE and puts the status FIRST on the chip line", () => {
    render(
      <GuardDriftList
        drifts={[]}
        passed={[
          result(PASSING_ID, {
            title: "Tasks are created",
            outcome: "pass",
            durationMs: 412,
          }),
        ]}
        activeId={null}
        onPreview={() => {}}
        onPin={() => {}}
      />,
    );
    const row = within(
      screen.getByRole("list", { name: "Run results" }),
    ).getAllByRole("listitem")[0];
    // Title first (it wraps — a claim is a sentence), then the chip line whose
    // FIRST chip is the one status word. That is the anatomy of every guard row.
    expect(row.firstElementChild).toHaveTextContent("Tasks are created");
    expect(row.children[1].firstElementChild).toHaveTextContent("Passing");
    // NO surface label: one surface per flow, so "CLI test" said nothing.
    expect(row).not.toHaveTextContent("CLI test");
  });

  it("drops the per-row extras in the Runs list — the detail carries them", () => {
    render(
      <GuardDriftList
        drifts={[
          result(RUN_FAILED_ID, {
            title: "Exporting writes every task to the file",
            outcome: "fail",
            durationMs: 900,
            failure: { step: 2, expected: "200", actual: "500" },
            flowId: "task-export",
            failedMilestone: 2,
          }),
        ]}
        passed={[]}
        activeId={null}
        onPreview={() => {}}
        onPin={() => {}}
      />,
    );
    const row = within(
      screen.getByRole("list", { name: "Run results" }),
    ).getAllByRole("listitem")[0];
    expect(row).toHaveTextContent("Failing");
    expect(row).toHaveTextContent("Exporting writes every task to the file");
    // No duration, no failure snippet, no id line.
    expect(row.textContent).not.toMatch(/900ms|failed at milestone|500/);
    expect(row.textContent).not.toContain(RUN_FAILED_ID);
  });

  it("wraps the title — a claim is a sentence, and a row never cuts it", () => {
    const title =
      "Tasks are created, listed newest-first, completed and filterable";
    render(
      <GuardDriftList
        drifts={[]}
        passed={[result(PASSING_ID, { title })]}
        activeId={null}
        onPreview={() => {}}
        onPin={() => {}}
      />,
    );
    const el = screen.getByText(title);
    expect(el.className).toContain("break-words");
    expect(el.className).not.toContain("truncate");
    expect(el.className).not.toContain("line-clamp");
  });
});

// --- The merged surface: a test is read inside its flow ---------------------

function TestsHarness({
  claimTitles,
}: {
  claimTitles?: Readonly<Record<string, string>>;
}) {
  const tabs = useGuardFlowTabs("r");
  // The real decisions hook — the ruling's write path is under test, not a stub.
  const decisions = useGuardDecisions("r", true);
  const loc = useLocation();
  const [filter, setFilter] = useState<"all">("all");
  const view = { flows: FLOW_ROWS, recipe: null } as unknown as GuardFlowsView;
  return (
    <div>
      <span data-testid="search">{loc.search}</span>
      <div data-testid="panel">
        <GuardFlowsPanel
          flows={FLOW_ROWS}
          loading={false}
          error={null}
          activeId={tabs.activeId}
          filter={filter}
          onFilter={() => {}}
          drivers={[]}
          onDrivers={() => {}}
          onOpen={tabs.open}
        />
      </div>
      <GuardFlowsPane
        repoId="r"
        view={view}
        loading={false}
        error={null}
        interfaces={INTERFACES}
        {...(claimTitles ? { claimTitles } : {})}
        binds={BINDS}
        decisions={decisions}
        tabs={tabs}
        onOpenInterface={() => {}}
        onOpenSpec={(doc, section) => openedSpec.push([doc, section])}
      />
    </div>
  );
}

const renderPane = (
  url = "/repos/r?tab=guardflows",
  props: { claimTitles?: Readonly<Record<string, string>> } = {},
) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <TestsHarness {...props} />
    </MemoryRouter>,
  );

/** Open the flow that owns a test — the one destination a test is read at. */
const renderTest = (
  scenarioId: string,
  props: { claimTitles?: Readonly<Record<string, string>> } = {},
) => renderPane(`/repos/r?tab=guardflows&gflow=${FLOW_OF[scenarioId]}`, props);

const search = () => screen.getByTestId("search").textContent ?? "";

/**
 * The detail's settle point. The whole scenario body renders inside the flow
 * detail, so the flow join has landed before any of it exists; what still
 * arrives on its own fetch is the scenario SOURCE — the step rows replacing the
 * loading line.
 */
async function findSteps(): Promise<HTMLElement> {
  const steps = await screen.findByLabelText("test steps");
  await within(steps).findAllByRole("listitem");
  return steps;
}

/** The toggle of one step's collapsible record. */
const stepToggle = (steps: HTMLElement, n: number | "setup") =>
  within(steps).getByRole("button", {
    name: n === "setup" ? "Setup record" : `Step ${n} record`,
  });

/** One step's expanded record — the inline body under its row. */
const stepBody = (n: number | "setup" | "recorded") =>
  document.getElementById(`guard-step-body-${n}`) as HTMLElement;

/** Expand a step's record and return it. */
const openStep = async (
  user: ReturnType<typeof userEvent.setup>,
  steps: HTMLElement,
  n: number,
) => {
  await user.click(stepToggle(steps, n));
  return stepBody(n);
};

describe("the test, read inside its flow", () => {
  it("opening a flow from the list mirrors ?gflow and renders its test in full", async () => {
    const user = userEvent.setup();
    renderPane();
    await user.click(
      within(screen.getByTestId("panel")).getByText(FLOW_TITLES.get(FLOW_ID)!),
    );
    expect(search()).toContain(`gflow=${FLOW_ID}`);
    expect(await findSteps()).toBeInTheDocument();
  });

  it("keeps the verdict above the workspace, with the drawers after it", async () => {
    renderTest(PASSING_ID);
    const steps = await findSteps();

    // The page reads top-down in the order a reader asks: the verdict, the
    // investigation, then the supporting record it can open if it needs to.
    const order = [
      screen.getByRole("region", { name: "Test verdict" }),
      steps,
      screen.getByRole("button", { name: /^Transcript/ }),
      screen.getByRole("button", { name: /^Interfaces/ }),
    ];
    const flat = Array.from(document.querySelectorAll("*"));
    const positions = order.map((el) => flat.indexOf(el));
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i], `element ${i} follows ${i - 1}`).toBeGreaterThan(
        positions[i - 1],
      );
    }

    // The merged flow header already states the goal. Its embedded test starts at
    // the verdict instead of repeating the same purpose under "What it checks".
    expect(screen.queryByText("What it checks")).toBeNull();
    // The goal renders in the flow header and NOWHERE below it: the panel row and
    // that header are the two places it belongs, and the body never restates it.
    const goals = screen.getAllByText(FLOW_GOALS.get(FLOW_ID)!);
    expect(goals).toHaveLength(2);
    expect(
      goals.every((el) => el.closest('[aria-label="test steps"]') === null),
    ).toBe(true);
    // The verdict, then the steps as STEPS (not a YAML blob) and the transcript.
    expect(screen.getByText("Passed")).toBeInTheDocument();
    expect(within(steps).getAllByRole("listitem")).toHaveLength(STEPS.length);
    // The command reads in the STEP — asked of the page at large it is ambiguous,
    // since the transcript below opens on the same line.
    expect(
      within(steps).getByText('tasks add "write the spec"'),
    ).toBeInTheDocument();
    // …and the transcript arrives on its own fetch, read by opening its section.
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /^Transcript/ }));
    await waitFor(() =>
      expect(screen.getByLabelText("evidence transcript")).toHaveTextContent(
        '$ tasks add "write the spec"',
      ),
    );
    // A passing test starts with every record closed, and a cli run recorded
    // nothing visual, so there is no filmstrip either.
    expect(screen.queryByRole("region", { name: "Run filmstrip" })).toBeNull();
    expect(screen.queryByLabelText("expected value")).toBeNull();
    // The flow-level interface path is a collapsed section — a hand-off, not
    // the read — and opens in place.
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^Interfaces/ }));
    expect(
      screen.getByRole("region", { name: "Interfaces used by this flow" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open interface cli/tasks-add" }),
    ).toBeInTheDocument();
  });

  // The status says the test is red; the chip says whose fault that
  // is, and the recommendation is the one line a reader acts on.
  it("carries the triage verdict beside the failure, with its unblock", async () => {
    renderTest(BIRTH_FAILED_ID);
    await findSteps();

    expect(screen.getByText("code drift")).toBeInTheDocument();
    expect(screen.getByText(/Bound the per-file work/)).toBeInTheDocument();
    // The verdict is a chip beside the status, never a replacement for it.
    expect(screen.getByText("Failed (birth)")).toBeInTheDocument();
  });

  it("a passing test carries no verdict chip — there is nothing to blame", async () => {
    renderTest(PASSING_ID);
    await findSteps();
    expect(screen.queryByText("code drift")).not.toBeInTheDocument();
    expect(screen.queryByText("our defect")).not.toBeInTheDocument();
  });

  // The judge's reading rides the failure twice, at two altitudes: a chip beside
  // the status for the glance, and the full reading inside the failing step's
  // inspector, under its own label, beside the measured rows it must never be
  // mistaken for.
  it("wears the judge's reading beside the failure and inside the failing step", async () => {
    const { triage: _triage, ...birthSurface } = BIRTH_FLOW_DETAIL.surfaces[0]!;
    servedBirthDetail = {
      ...BIRTH_FLOW_DETAIL,
      surfaces: [
        {
          ...birthSurface,
          stage: "run",
          failure: {
            step: 2,
            expected: 'the page text contains "Filtered by"',
            actual: 'the page text was "FILTERED BY: CATEGORY"',
            visual: {
              verdict: "yes",
              summary:
                "The Security filter is applied — the heading reads “FILTERED BY: CATEGORY”, rendered uppercase.",
              rationale:
                "The asserted phrase is present under a different case: the page renders it uppercase via CSS, which is the case the text matcher compared against.",
            },
          },
        },
      ],
    };
    servedSteps = WEB_STEPS_FAILED_AT_2;
    renderTest(BIRTH_FAILED_ID);
    await findSteps();

    // The chip, in "looks" words — an appearance, never a measurement.
    expect(screen.getByText("looks present")).toBeInTheDocument();

    // The failing step starts open; its record carries the reading under its
    // own "on screen" label, AFTER the picture it is a reading of…
    const body = stepBody(2);
    const labels = within(body)
      .getAllByText(/^(expected|actual|at|page text|screen|on screen)$/)
      .map((el) => el.textContent);
    expect(labels.indexOf("on screen")).toBeGreaterThan(labels.indexOf("screen"));
    expect(within(body).getByText("on screen")).toBeInTheDocument();
    expect(
      within(body).getByText(/The Security filter is applied/),
    ).toBeInTheDocument();
    // …with the rationale — WHY the assertion missed — rendered WHOLE beside it.
    expect(
      within(body).getByText(/present under a different case/),
    ).toBeInTheDocument();
    // …and says the test-is-wrong signal plainly, in the failure's own record.
    expect(
      within(body).getByText(/assertion itself may be wrong/),
    ).toBeInTheDocument();
  });

  it("no judged screenshot, no chip and no row — the annotation never renders empty", async () => {
    renderTest(BIRTH_FAILED_ID);
    await findSteps();
    expect(screen.queryByText(/^looks (present|absent|unclear)$/)).toBeNull();
    expect(within(stepBody(2)).queryByText("on screen")).toBeNull();
  });

  it("slims the verdict to WHERE IT BROKE, never the diff", async () => {
    renderTest(BIRTH_FAILED_ID);
    await findSteps();
    // The stage the failure came from and the step + milestone it broke at. The
    // diff itself reads at the step; the verdict never guesses a claim title.
    expect(screen.getByText("Failed (birth)")).toBeInTheDocument();
    const band = screen.getByRole("region", { name: "Test verdict" });
    expect(within(band).getByText(/Failed at step 2 of 4/)).toBeInTheDocument();
    expect(within(band).getByText(/milestone 1/)).toBeInTheDocument();
    expect(within(band).queryByText(BIRTH_CLAIM.title)).toBeNull();
    expect(within(band).queryByText("Expected")).toBeNull();
    expect(within(band).queryByText("Actual")).toBeNull();
    expect(within(band).queryByLabelText("expected value")).toBeNull();
    expect(within(band).queryByLabelText("actual value")).toBeNull();
    // The band is a LINE, not a card, and it is never painted red: the status word
    // already says red, and the diff it would decorate is at the step.
    expect(band.className).not.toMatch(/bg-red-|border-red-/);
  });

  // The failure surfaces in redundant channels, and the sentence naming it is one
  // of them: it is the way TO the step, not a restatement of it.
  it("expands the failing step from the verdict sentence", async () => {
    const user = userEvent.setup();
    renderTest(BIRTH_FAILED_ID);
    const steps = await findSteps();
    // Close the record the failure opened, then jump back to it from the band.
    await user.click(stepToggle(steps, 2));
    expect(stepToggle(steps, 2)).toHaveAttribute("aria-expanded", "false");

    await user.click(screen.getByText(/Failed at step 2/));
    expect(stepToggle(steps, 2)).toHaveAttribute("aria-expanded", "true");
    // The way to the step is an icon'd jump, never an underlined pseudo-link.
    const jump = screen.getByText(/Failed at step 2/).closest("button")!;
    expect(jump.className).not.toContain("underline");
  });

  it("paints each step from the viewed result — pass, fail, not reached", async () => {
    const user = userEvent.setup();
    renderTest(BIRTH_FAILED_ID);
    const steps = await findSteps();
    // The birth failure broke at step 2 of the four-step file.
    expect(
      within(steps).getByLabelText(/Step 1: .* — passed/),
    ).toBeInTheDocument();
    expect(
      within(steps).getByLabelText(/Step 2: .* — failed/),
    ).toBeInTheDocument();
    expect(
      within(steps).getByLabelText(/Step 3: .* — not reached/),
    ).toBeInTheDocument();
    expect(
      within(steps).getByLabelText(/Step 4: .* — not reached/),
    ).toBeInTheDocument();
    // Opening a step keeps its command on the row and reads its full record
    // inline under it.
    expect(within(steps).getByText("tasks list")).toBeInTheDocument();
    const third = await openStep(user, steps, 3);
    expect(within(third).getByText(/NO_COLOR=1/)).toBeInTheDocument();
    expect(within(third).getByLabelText("expected value")).toHaveTextContent(
      "exit 0 · stdout contains",
    );
  });

  it("makes EVERY step expandable, and opens the failing one", async () => {
    renderTest(BIRTH_FAILED_ID);
    const steps = await findSteps();
    // Every row is one toggle, and exactly one record starts open: the failure's.
    const open = within(steps).getAllByRole("button", { expanded: true });
    expect(open).toHaveLength(1);
    expect(open[0]).toHaveAccessibleName("Step 2 record");
    expect(within(stepBody(2)).getAllByLabelText("expected value")).toHaveLength(
      1,
    );
    expect(
      within(steps).getAllByRole("button", { name: /^Step \d+ record$/ }),
    ).toHaveLength(STEPS.length);
  });

  it("keeps a recorded failure inspectable when the current YAML no longer has that step", async () => {
    servedSteps = STEPS.filter((step) => step.n !== 2);
    renderTest(BIRTH_FAILED_ID);
    const steps = await findSteps();

    const selected = within(steps).getByRole("button", {
      name: "Step 2 record",
      expanded: true,
    });
    expect(selected).toBeInTheDocument();
    // Its row leads the list, above the file's own steps as they stand today —
    // the recorded run is not part of that file any more.
    const recorded = within(steps).getByText(
      "Recorded run · earlier test revision",
    );
    const current = stepToggle(steps, 1);
    expect(
      recorded.compareDocumentPosition(current) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // …and the verdict band says how far the current definition has moved.
    expect(
      screen.getByText(/current definition has 3 steps/),
    ).toBeInTheDocument();

    const body = stepBody("recorded");
    expect(
      within(body).getByText(/Step 2 is not in the current YAML/),
    ).toBeInTheDocument();
    expect(within(body).getByLabelText("expected value")).toHaveTextContent(
      "exit 0",
    );
    expect(within(body).getByLabelText("actual value")).toHaveTextContent(
      "timed out after 120s",
    );
  });

  it("gives EVERY step the same panel — expected, actual, output", async () => {
    const user = userEvent.setup();
    servedSteps = STEPS_STOPPED_AT_2;
    renderTest(BIRTH_FAILED_ID);
    const steps = await findSteps();
    // The step that PASSED carries its run record: what it asserted, the exit code
    // it returned, and what it printed — the same three labels as the failure.
    const passing = await openStep(user, steps, 1);
    expect(within(passing).getByLabelText("expected value")).toHaveTextContent(
      "exit 0",
    );
    expect(within(passing).getByLabelText("actual value")).toHaveTextContent(
      "exit 0",
    );
    expect(within(passing).getByLabelText("step output")).toHaveTextContent(
      "initialized tasks.json",
    );
    for (const label of ["expected", "actual", "output"]) {
      expect(within(passing).getByText(label)).toBeInTheDocument();
    }
  });

  it("says so when a step has no record, instead of showing a blank", async () => {
    const user = userEvent.setup();
    servedSteps = STEPS_STOPPED_AT_2;
    renderTest(BIRTH_FAILED_ID);
    const steps = await findSteps();
    // Step 3 was never reached — the run stopped at 2. Its expectation is still true
    // of the file, and the other two fields say there is nothing behind them.
    const notReached = await openStep(user, steps, 3);
    expect(
      within(notReached).getByLabelText("expected value"),
    ).toBeInTheDocument();
    expect(within(notReached).queryByLabelText("actual value")).toBeNull();
    expect(within(notReached).queryByLabelText("step output")).toBeNull();
    expect(
      within(notReached).getAllByText("not recorded in this run"),
    ).toHaveLength(2);
  });

  it("asks for the steps of the RUN it is showing, so the actuals are that run’s", async () => {
    renderTest(PASSING_ID);
    await findSteps();
    expect(
      scenarioRequests.some((u) =>
        u.includes(`runId=${encodeURIComponent(RUN_ID)}`),
      ),
    ).toBe(true);
  });

  it("asks by evidence PATH for a birth result — there is no run behind one", async () => {
    renderTest(BIRTH_FAILED_ID);
    await findSteps();
    expect(scenarioRequests.some((u) => u.includes("evidencePath="))).toBe(
      true,
    );
    expect(scenarioRequests.every((u) => !u.includes("runId="))).toBe(true);
  });

  it("opens records independently without losing the failure paint", async () => {
    const user = userEvent.setup();
    renderTest(BIRTH_FAILED_ID);
    const steps = await findSteps();
    const failure = stepToggle(steps, 2);
    expect(failure).toHaveAttribute("aria-expanded", "true");

    // Opening another record leaves the failure's open — two readings can sit
    // side by side — and the failed row keeps its paint either way.
    await openStep(user, steps, 1);
    expect(failure).toHaveAttribute("aria-expanded", "true");
    expect(stepBody(1)).toBeInTheDocument();
    expect(stepBody(2)).toBeInTheDocument();
    expect(
      within(steps).getByLabelText(/Step 2: .* — failed/),
    ).toBeInTheDocument();

    // Closing gives the line back.
    await user.click(failure);
    expect(failure).toHaveAttribute("aria-expanded", "false");
    expect(stepBody(2)).toBeNull();
  });

  it("tells a step’s expectation ONCE — the labelled field, not a summary", async () => {
    const user = userEvent.setup();
    renderTest(BIRTH_FAILED_ID);
    const steps = await findSteps();
    const failing = stepBody(2);
    // The labelled field says what it wanted…
    expect(within(failing).getByText("expected")).toBeInTheDocument();
    expect(within(failing).getByLabelText("expected value")).toHaveTextContent(
      "exit 0",
    );
    // …so the "expects …" summary line that would repeat it exists on no row at all,
    // open or closed. One rendering of one fact.
    await openStep(user, steps, 1);
    expect(within(steps).queryByText(/^expects/)).toBeNull();
  });

  it("reads the diff inside the failing step's record — and nowhere else", async () => {
    renderTest(BIRTH_FAILED_ID);
    const steps = await findSteps();
    const failing = stepBody(2);

    // What it wanted, what it got, and what the program printed — all at the step.
    expect(within(failing).getByText("expected")).toBeInTheDocument();
    expect(within(failing).getByLabelText("expected value")).toHaveTextContent(
      "exit 0",
    );
    expect(within(failing).getByLabelText("actual value")).toHaveTextContent(
      "timed out after 120s",
    );
    expect(within(failing).getByLabelText("step output")).toHaveTextContent(
      "analyzing 4211 files",
    );
    expect(
      within(failing).getByLabelText("step error output"),
    ).toHaveTextContent("warning: pathological file skipped");

    // Closed rows remain compact lines, so the diff exists only in the one
    // open record.
    for (const row of within(steps).getAllByRole("listitem")) {
      if (row.contains(failing)) continue;
      expect(within(row).queryByText("expected")).toBeNull();
      expect(within(row).queryByLabelText("expected value")).toBeNull();
      expect(within(row).queryByLabelText("actual value")).toBeNull();
    }
    // …and the page tells it exactly once.
    expect(screen.getAllByLabelText("expected value")).toHaveLength(1);
    expect(screen.getAllByLabelText("actual value")).toHaveLength(1);
    // Same wide-content rule as the transcript: no wrapping, sideways scroll.
    for (const label of [
      "expected value",
      "actual value",
      "step output",
      "step error output",
    ]) {
      const block = within(failing).getByLabelText(label);
      expect(block.className).toContain("whitespace-pre");
      expect(block.className).not.toContain("whitespace-pre-wrap");
      expect(block.className).toContain("overflow-x-auto");
    }
  });

  it("a PASSING test starts with every record closed — and each opens inline", async () => {
    const user = userEvent.setup();
    servedSteps = STEPS_ALL_RAN;
    renderTest(PASSING_ID);
    const steps = await findSteps();
    expect(within(steps).getAllByLabelText(/— passed/)).toHaveLength(
      STEPS.length,
    );
    expect(
      within(steps).getAllByRole("button", { name: /^Step \d+ record$/ }),
    ).toHaveLength(STEPS.length);
    // Nothing is expanded until asked for — the closed list is the scan.
    expect(
      within(steps).queryAllByRole("button", { expanded: true }),
    ).toHaveLength(0);
    const first = await openStep(user, steps, 1);
    expect(within(first).getByLabelText("actual value")).toHaveTextContent(
      "exit 0",
    );
    // …and a second record opens BESIDE it, each reading its own step.
    const second = await openStep(user, steps, 2);
    expect(within(second).getByLabelText("step output")).toHaveTextContent(
      "step 2 output",
    );
    expect(stepBody(1)).toBeInTheDocument();
    // The claim a step realizes reads inside its record — there are no divider
    // rows left to repeat it above the list.
    expect(within(second).getByText(`Milestone 1 — ${CLAIMS[0]}`)).toBeInTheDocument();
    expect(within(steps).queryByText("M1")).toBeNull();
    expect(within(steps).queryByText("Prepare")).toBeNull();
  });

  it("reads a WEB step in web words — each assertion beside ITS answer, the address, the page", async () => {
    const user = userEvent.setup();
    servedSteps = WEB_STEPS;
    renderTest(PASSING_ID);
    const steps = await findSteps();
    const web = await openStep(user, steps, 2);

    // EVERY member of the expectation is paired with the page's answer to THAT
    // member — the address never stands in as the actual of a text assertion.
    const expectations = within(web).getAllByLabelText("expected value");
    const answers = within(web).getAllByLabelText("actual value");
    expect(expectations).toHaveLength(2);
    expect(answers).toHaveLength(2);
    expect(expectations[0]).toHaveTextContent(
      'the address contains "/repos/sample-app"',
    );
    expect(answers[0]).toHaveTextContent('the address was "/repos/sample-app"');
    expect(expectations[1]).toHaveTextContent(
      'the page text contains "Filtered by"',
    );
    expect(answers[1]).toHaveTextContent("Filtered by: CATEGORY");

    // The browser's own record: where it ended up, what it showed, the picture.
    expect(within(web).getByLabelText("page address")).toHaveTextContent(
      "/repos/sample-app",
    );
    expect(within(web).getByLabelText("page text")).toHaveTextContent(
      "Filtered by: CATEGORY",
    );
    expect(within(web).getByText("step-2.png")).toBeInTheDocument();

    // …and NOTHING in the cli vocabulary: a browser step neither exits nor prints.
    expect(within(web).queryByText("the step printed nothing")).toBeNull();
    expect(within(web).queryByText("the step returns no exit code")).toBeNull();
    expect(within(web).queryByText("output")).toBeNull();
  });

  it("reads a REQUEST step in api words — the status, every assertion paired, the body", async () => {
    const user = userEvent.setup();
    servedSteps = MIXED_STEPS;
    renderTest(PASSING_ID);
    const steps = await findSteps();
    const row = (n: number) =>
      within(steps)
        .getAllByRole("listitem")
        .find((r) =>
          (r.getAttribute("aria-label") ?? "").startsWith(`Step ${n}:`),
        )!;

    // The row says what it drives and what it does, in the api's own words.
    expect(row(3)).toHaveTextContent("api");
    expect(row(3)).toHaveTextContent(
      "GET /api/repos/sample-app/violations?severity=critical",
    );

    const api = await openStep(user, steps, 3);
    // EVERY member paired with the RESPONSE's answer to THAT member — the status
    // never stands in as the actual of a json assertion.
    const expectations = within(api).getAllByLabelText("expected value");
    const answers = within(api).getAllByLabelText("actual value");
    expect(expectations.map((e) => e.textContent)).toEqual([
      "status 200",
      "json total is 2",
    ]);
    expect(answers.map((a) => a.textContent)).toEqual([
      "status 200",
      "json total was 2",
    ]);
    // …and the response body is what the step "printed".
    expect(within(api).getByLabelText("step output")).toHaveTextContent(
      '"ruleKey":"no-eval"',
    );
    // Nothing cli-flavoured: a request step neither exits nor spawns.
    expect(within(api).queryByText("the step returns no exit code")).toBeNull();
  });

  it("a request step the run never reached shows the authored assertion and nothing else", async () => {
    const user = userEvent.setup();
    servedSteps = MIXED_STEPS.map((step) => ({ ...step, actual: undefined }));
    renderTest(PASSING_ID);
    const steps = await findSteps();
    const api = await openStep(user, steps, 3);
    expect(within(api).getByLabelText("expected value")).toHaveTextContent(
      "status 200 · total is 2",
    );
    expect(
      within(api).getAllByText("not recorded in this run").length,
    ).toBeGreaterThan(0);
  });

  it("a web step the run never reached says so, in web words", async () => {
    const user = userEvent.setup();
    servedSteps = WEB_STEPS.map((step) => ({ ...step, actual: undefined }));
    renderTest(PASSING_ID);
    const steps = await findSteps();
    const web = await openStep(user, steps, 2);
    // The authored assertion is still true of the file; nothing else is known.
    expect(within(web).getByLabelText("expected value")).toHaveTextContent(
      "page text contains",
    );
    expect(
      within(web).getAllByText("not recorded in this run").length,
    ).toBeGreaterThan(0);
  });

  it("carries NO Program output section — the excerpt is the step’s, the streams are evidence", async () => {
    renderTest(BIRTH_FAILED_ID);
    await findSteps();
    // The section, and its stream sub-headings, are gone: the failing step's
    // excerpt and the one transcript below say all of it.
    expect(screen.queryByText("Program output")).toBeNull();
    expect(screen.queryByText(/^stdout$/i)).toBeNull();
    expect(screen.queryByText(/^stderr$/i)).toBeNull();
  });

  it("reads a step's claim inside its record — the list carries no dividers", async () => {
    const user = userEvent.setup();
    renderTest(PASSING_ID);
    const steps = await findSteps();
    // No divider rows: the closed list is steps alone, in file order.
    expect(within(steps).queryByText("Prepare")).toBeNull();
    expect(within(steps).queryByText("M1")).toBeNull();
    for (const claim of CLAIMS)
      expect(within(steps).queryByText(new RegExp(claim))).toBeNull();
    expect(within(steps).getAllByRole("listitem")).toHaveLength(STEPS.length);
    // The claim reads inside the record of the step that realizes it.
    const fourth = await openStep(user, steps, 4);
    expect(
      within(fourth).getByText(`Milestone 2 — ${CLAIMS[1]}`),
    ).toBeInTheDocument();
    expect(within(steps).queryByText(/^milestone \d+$/)).toBeNull();
  });

  /**
   * The chain lives in the step records now: the flow detail dropped its
   * milestone list and the step list dropped its dividers, so the claim line of
   * an opened step is what carries the jump to the section it proves. Losing it
   * would have made the merge a deletion.
   */
  it("links an opened step's claim to the spec section that states it", async () => {
    const user = userEvent.setup();
    renderTest(PASSING_ID);
    const steps = await findSteps();

    const second = await openStep(user, steps, 2);
    const link = within(second).getByRole("button", { name: "§ Creating tasks" });
    await user.click(link);
    expect(openedSpec).toEqual([[DOC, "tasks/creating-tasks"]]);
  });

  /**
   * WHAT a step drives, on every row. It is a fact about the step, never a verdict
   * about it, so it is a plain word and carries no colour: the glyph is the only
   * thing on the row that says how the step fared.
   */
  it("labels every step with what it drives, in plain uncoloured words", async () => {
    servedSteps = [
      { n: 1, kind: "cli", command: "tasks init", expectation: "exit 0" },
      { n: 2, kind: "git", command: "git init", expectation: "exit 0" },
      {
        n: 3,
        kind: "file",
        command: "write notes.md",
        expectation: "notes.md exists",
      },
    ];
    renderTest(PASSING_ID);
    const steps = await screen.findByLabelText("test steps");
    const rows = await within(steps).findAllByRole("listitem");

    for (const [i, kind] of ["cli", "git", "file"].entries()) {
      const label = within(rows[i]).getByText(kind);
      expect(label.className).not.toMatch(/(red|emerald|sky|amber)-\d{2,3}/);
    }
  });

  it("names a milestone the flow does not know by its number alone", async () => {
    const user = userEvent.setup();
    // The birth flow declares milestone 1 only; the file's step 4 realizes 2.
    renderTest(BIRTH_FAILED_ID);
    const steps = await findSteps();
    // A milestone the flow DOES name reads its claim in the open record…
    expect(
      within(stepBody(2)).getByText(
        new RegExp(`Milestone 1 — ${BIRTH_CLAIM.title}`),
      ),
    ).toBeInTheDocument();
    // …and the one it does not is its number alone — never a blank and never a
    // borrowed claim.
    const fourth = await openStep(user, steps, 4);
    expect(within(fourth).getByText("Milestone 2")).toBeInTheDocument();
  });

  it("switches between the page and the raw file, and defaults to the page", async () => {
    const user = userEvent.setup();
    renderTest(PASSING_ID);
    await findSteps();
    const modes = screen.getByRole("group", { name: "View mode" });
    // EXACTLY two readings — the page and the artifact. There is no third.
    expect(
      within(modes)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["View", "YAML"]);
    expect(within(modes).getByRole("button", { name: "View" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.queryByLabelText("test source")).not.toBeInTheDocument();

    await user.click(within(modes).getByRole("button", { name: "YAML" }));
    // The whole file, in the pane's own scroll context — no clamp, no expander.
    // The block is stable like the step container is: it renders the moment the
    // mode flips, holding "Loading…" until the source lands — so the wait is for
    // the CONTENT, never for the element.
    await waitFor(() =>
      expect(screen.getByLabelText("test source")).toHaveTextContent(
        "guard: 3",
      ),
    );
    expect(screen.queryByLabelText("test steps")).not.toBeInTheDocument();
    expect(screen.queryByText(/Show all \d+ lines/)).not.toBeInTheDocument();

    await user.click(within(modes).getByRole("button", { name: "View" }));
    expect(await findSteps()).toBeInTheDocument();
  });

  it("closes with LABELLED footer rows — no fingerprints, no source affordance", async () => {
    renderTest(PASSING_ID);
    await findSteps();
    // Test · File · Spec. NOT "Flow": the page IS the flow, and a footer jump to
    // the thing you are reading is a destination that goes nowhere.
    for (const label of ["Test", "File", "Spec"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.queryByText("Flow")).toBeNull();
    expect(screen.getByText("x.yaml")).toBeInTheDocument();
    // The Spec row comes off the committed inventory's binding.
    expect(screen.getByText("Creating tasks")).toBeInTheDocument();
    expect(screen.queryByText("View source")).not.toBeInTheDocument();
    expect(screen.queryByText(/sha256/)).not.toBeInTheDocument();
  });

  it("clamps a long transcript and grows it INLINE — never a vertical scroll box", async () => {
    const user = userEvent.setup();
    renderTest(PASSING_ID);
    await findSteps();
    await user.click(screen.getByRole("button", { name: /^Transcript/ }));
    const expander = await screen.findByText(
      `Show all ${LONG_TRANSCRIPT_LINES} lines`,
    );
    const block = screen.getByLabelText("evidence transcript");
    expect(block.textContent?.split("\n")).toHaveLength(GUARD_CLAMP_LINES);
    // A transcript line is never re-wrapped — it keeps its shape and the block
    // scrolls SIDEWAYS for the width the pane cannot give it.
    expect(block.className).toContain("whitespace-pre");
    expect(block.className).not.toContain("whitespace-pre-wrap");
    expect(block.className).toContain("overflow-x-auto");
    // Height is the PANE's job — the block never grows its own scrollbar.
    expect(block.className).not.toMatch(/overflow-y|max-h-/);
    // Nothing between the block and its pane scrolls: a pane is the only scroll
    // context any block on this page has, and it is marked as one.
    for (
      let el = block.parentElement;
      el && el.tagName !== "BODY";
      el = el.parentElement
    ) {
      if (el.hasAttribute("data-pane")) break;
      expect(el.className).not.toMatch(
        /overflow-(auto|scroll|y-auto|y-scroll)|max-h-/,
      );
    }
    await user.click(expander);
    expect(
      screen.getByLabelText("evidence transcript").textContent?.split("\n"),
    ).toHaveLength(LONG_TRANSCRIPT_LINES);
    expect(screen.getByText("Collapse")).toBeInTheDocument();
  });

  // jsdom lays nothing out, so the rule is pinned as STRUCTURE: a wide line can
  // only scroll the block it is in if every box above that block is allowed to
  // shrink (min-w-0) and none of them scrolls sideways itself.
  it("confines sideways scroll to the data blocks — the pane never scrolls sideways", async () => {
    const user = userEvent.setup();
    renderTest(BIRTH_FAILED_ID);
    await findSteps();
    await user.click(screen.getByRole("button", { name: /^Transcript/ }));
    for (const label of [
      "expected value",
      "actual value",
      "step output",
      "evidence transcript",
    ]) {
      const block = await screen.findByLabelText(label);
      // The block scrolls itself, and can never out-grow the column it sits in.
      expect(block.className, label).toContain("overflow-x-auto");
      expect(block.className, label).toContain("max-w-full");
      for (
        let el = block.parentElement;
        el && el.tagName !== "BODY";
        el = el.parentElement
      ) {
        const cls = el.className;
        expect(
          cls,
          `${label} — an ancestor scrolls sideways: ${cls}`,
        ).not.toContain("overflow-x-auto");
        if (/(^|\s)(flex|inline-flex|grid)(\s|$)/.test(cls)) {
          expect(
            cls,
            `${label} — a flex ancestor cannot shrink: ${cls}`,
          ).toContain("min-w-0");
        }
      }
    }
    // EVERY pane scrolls down explicitly and clips sideways — `overflow-y-auto` on
    // its own would compute the x axis to `auto` and hand a wide line the whole page.
    const panes = Array.from(
      document.querySelectorAll<HTMLElement>("[data-pane]"),
    );
    expect(panes.length).toBeGreaterThan(0);
    for (const pane of panes) {
      expect(pane.className).toContain("overflow-y-auto");
      expect(pane.className).toContain("overflow-x-hidden");
    }
    // …and each data block sits inside one.
    for (const label of ["expected value", "step output", "evidence transcript"])
      expect(
        screen.getByLabelText(label).closest("[data-pane]"),
        label,
      ).not.toBeNull();
  });

  /**
   * A BROWSER run's evidence is visual: a web step spawns nothing, so the only
   * record of what it did is the picture of where it ended up. Those pictures read
   * in the evidence section the transcript already lives in — no second pane, no
   * tab of their own — and they read for a GREEN run exactly as for a red one.
   */
  describe("the run’s own pictures, in the evidence section", () => {
    const WEB_VISUALS: GuardEvidenceVisual[] = [
      { file: "step-1.png", kind: "screenshot", step: 1 },
      { file: "step-2.png", kind: "screenshot", step: 2 },
      { file: "step-10.png", kind: "screenshot", step: 10 },
      { file: "session.webm", kind: "video" },
    ];

    it("renders the screenshots in STEP order, each labelled by its step", async () => {
      servedVisuals = WEB_VISUALS;
      // A PASSING test: visuals are evidence, not failure decoration.
      renderTest(PASSING_ID);
      await findSteps();

      const shots = await screen.findByLabelText("evidence screenshots");
      const images = within(shots).getAllByRole("img");
      expect(images.map((img) => img.getAttribute("alt"))).toEqual([
        "Step 1 screenshot",
        "Step 2 screenshot",
        "Step 10 screenshot",
      ]);
      // Each carries its step as a visible label, next to the picture it names.
      for (const step of [1, 2, 10]) {
        expect(within(shots).getByText(`Step ${step}`)).toBeInTheDocument();
      }
      // Visual evidence is available beside the steps; the very long transcript
      // follows the workspace instead of separating the screenshots from failure.
      await userEvent
        .setup()
        .click(screen.getByRole("button", { name: /^Transcript/ }));
      const transcript = screen.getByLabelText("evidence transcript");
      expect(
        shots.compareDocumentPosition(transcript) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it("addresses each picture by the run it ran in, from one URL", async () => {
      servedVisuals = WEB_VISUALS;
      renderTest(PASSING_ID);
      await findSteps();

      const shots = await screen.findByLabelText("evidence screenshots");
      const src =
        within(shots).getAllByRole("img")[0].getAttribute("src") ?? "";
      expect(src).toContain("/guard/evidence/visual?");
      expect(src).toContain("file=step-1.png");
      // Addressed by the run the page is showing, and the scenario it is of.
      expect(src).toContain(`runId=${encodeURIComponent(RUN_ID)}`);
      expect(src).toContain(`scenarioId=${encodeURIComponent(PASSING_ID)}`);
      // No new tab: the picture opens IN the app, and the thumbnail is the same
      // file the full-size reading shows — one URL, no thumbnail pipeline.
      expect(within(shots).queryAllByRole("link")).toHaveLength(0);
    });

    /**
     * The pictures are a SEQUENCE, so reading them is stepping through them: one
     * click opens the run's screenshots full size and the arrows (and ← / →) walk
     * them, stopping at the ends. Escape and a click outside leave. The video is
     * not in it — a player is already its own full reading.
     */
    describe("the screenshot carousel", () => {
      const open = async (
        user: ReturnType<typeof userEvent.setup>,
        label: string,
      ) => {
        servedVisuals = WEB_VISUALS;
        renderTest(PASSING_ID);
        await findSteps();
        const shots = await screen.findByLabelText("evidence screenshots");
        // A tile IS the way in: one click opens the carousel at that picture.
        await user.click(
          within(shots).getByRole("button", { name: `Open ${label}` }),
        );
        return screen.getByRole("dialog", { name: "Evidence screenshot" });
      };
      /** What the open carousel is showing, by the step it names. */
      const showing = () =>
        within(screen.getByRole("dialog", { name: "Evidence screenshot" }))
          .getByRole("img")
          .getAttribute("alt");

      it("opens the picture that was clicked, full size and in the app", async () => {
        const user = userEvent.setup();
        const lightbox = await open(user, "Step 2");
        expect(within(lightbox).getByRole("img")).toHaveAttribute(
          "alt",
          "Step 2 screenshot",
        );
        // The way back to the record behind the picture rides the header.
        expect(
          within(lightbox).getByRole("button", { name: "Go to step 2" }),
        ).toBeInTheDocument();
        // Its step names it, and the file it is of is readable beside it.
        expect(within(lightbox).getByText("Step 2")).toBeInTheDocument();
        expect(within(lightbox).getByText("step-2.png")).toBeInTheDocument();
        // The session video stays a plain player, outside the carousel.
        expect(within(lightbox).queryByLabelText("session video")).toBeNull();
      });

      it("lands on the step's record from Go to step — closed carousel, open row", async () => {
        const user = userEvent.setup();
        const lightbox = await open(user, "Step 2");
        await user.click(
          within(lightbox).getByRole("button", { name: "Go to step 2" }),
        );
        expect(
          screen.queryByRole("dialog", { name: "Evidence screenshot" }),
        ).toBeNull();
        expect(
          within(screen.getByLabelText("test steps")).getByRole("button", {
            name: "Step 2 record",
          }),
        ).toHaveAttribute("aria-expanded", "true");
      });

      it("steps back and next through the run, stopping at the ends", async () => {
        const user = userEvent.setup();
        const lightbox = await open(user, "Step 2");
        await user.click(
          within(lightbox).getByRole("button", { name: "Next screenshot" }),
        );
        expect(showing()).toBe("Step 10 screenshot");
        // The last one is the last one — the arrow disables instead of wrapping.
        expect(
          within(lightbox).getByRole("button", { name: "Next screenshot" }),
        ).toBeDisabled();
        await user.click(
          within(lightbox).getByRole("button", { name: "Next screenshot" }),
        );
        expect(showing()).toBe("Step 10 screenshot");
        await user.click(
          within(lightbox).getByRole("button", { name: "Previous screenshot" }),
        );
        await user.click(
          within(lightbox).getByRole("button", { name: "Previous screenshot" }),
        );
        expect(showing()).toBe("Step 1 screenshot");
        expect(
          within(lightbox).getByRole("button", { name: "Previous screenshot" }),
        ).toBeDisabled();
        await user.click(
          within(lightbox).getByRole("button", { name: "Previous screenshot" }),
        );
        expect(showing()).toBe("Step 1 screenshot");
      });

      it("walks with the arrow keys and leaves on Escape", async () => {
        const user = userEvent.setup();
        await open(user, "Step 1");
        await user.keyboard("{ArrowRight}");
        expect(showing()).toBe("Step 2 screenshot");
        await user.keyboard("{ArrowLeft}");
        expect(showing()).toBe("Step 1 screenshot");
        await user.keyboard("{Escape}");
        expect(
          screen.queryByRole("dialog", { name: "Evidence screenshot" }),
        ).toBeNull();
      });

      it("closes on the X and on a click outside it", async () => {
        const user = userEvent.setup();
        const lightbox = await open(user, "Step 1");
        await user.click(
          within(lightbox).getByRole("button", { name: "Close screenshot" }),
        );
        expect(
          screen.queryByRole("dialog", { name: "Evidence screenshot" }),
        ).toBeNull();

        await user.click(
          within(screen.getByLabelText("evidence screenshots")).getByRole(
            "button",
            { name: "Open Step 1" },
          ),
        );
        // The overlay itself is the click-outside target; the picture inside is not.
        await user.click(
          screen.getByRole("dialog", { name: "Evidence screenshot" }),
        );
        expect(
          screen.queryByRole("dialog", { name: "Evidence screenshot" }),
        ).toBeNull();
      });

      it("offers no arrows for a single picture — there is nothing to step to", async () => {
        const user = userEvent.setup();
        servedVisuals = [{ file: "step-1.png", kind: "screenshot", step: 1 }];
        renderTest(PASSING_ID);
        await findSteps();
        const shots = await screen.findByLabelText("evidence screenshots");
        await user.click(
          within(shots).getByRole("button", { name: "Open Step 1" }),
        );
        const lightbox = screen.getByRole("dialog", {
          name: "Evidence screenshot",
        });
        expect(
          within(lightbox).queryByRole("button", { name: "Next screenshot" }),
        ).toBeNull();
        expect(
          within(lightbox).queryByRole("button", {
            name: "Previous screenshot",
          }),
        ).toBeNull();
      });
    });

    it("plays the session video in a modal, from the Replay tile that leads the strip", async () => {
      const user = userEvent.setup();
      servedVisuals = WEB_VISUALS;
      renderTest(PASSING_ID);
      await findSteps();

      // No standing player: the recording opens when asked for.
      expect(screen.queryByLabelText("session video")).toBeNull();
      const replay = await screen.findByRole("button", { name: /Replay/ });
      // The Replay tile LEADS the strip, before the per-step frames.
      const shots = screen.getByLabelText("evidence screenshots");
      expect(
        replay.compareDocumentPosition(shots) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();

      await user.click(replay);
      const dialog = screen.getByRole("dialog", { name: "Evidence Replay" });
      const video = within(dialog).getByLabelText("session video");
      expect(video.tagName).toBe("VIDEO");
      expect(video).toHaveAttribute("controls");
      expect(video).toHaveAttribute("autoplay");
      expect(video.getAttribute("src")).toContain("file=session.webm");

      await user.click(
        within(dialog).getByRole("button", { name: "Close Replay" }),
      );
      expect(
        screen.queryByRole("dialog", { name: "Evidence Replay" }),
      ).toBeNull();
    });

    it("a BIRTH bundle is addressed by its stored path, like its transcript", async () => {
      servedVisuals = [{ file: "step-1.png", kind: "screenshot", step: 1 }];
      renderTest(BIRTH_FAILED_ID);
      await findSteps();

      const shots = await screen.findByLabelText("evidence screenshots");
      expect(within(shots).getAllByRole("img")[0]).toHaveAttribute(
        "src",
        expect.stringContaining("evidencePath="),
      );
      await waitFor(() =>
        expect(visualsRequests.some((u) => u.includes("evidencePath="))).toBe(
          true,
        ),
      );
    });

    it("a run that took none renders the evidence section EXACTLY as before", async () => {
      // The default: no visuals in the bundle (every cli/api run, and every run
      // recorded before the web driver existed).
      renderTest(PASSING_ID);
      await findSteps();
      await userEvent
        .setup()
        .click(screen.getByRole("button", { name: /^Transcript/ }));
      await waitFor(() =>
        expect(screen.getByLabelText("evidence transcript")).toHaveTextContent(
          '$ tasks add "write the spec"',
        ),
      );
      // The read still HAPPENED — it just found nothing, and nothing is rendered
      // for it: no empty gallery, no "no screenshots" line, no player.
      expect(visualsRequests.length).toBeGreaterThan(0);
      expect(screen.queryByLabelText("evidence screenshots")).toBeNull();
      expect(screen.queryByLabelText("session video")).toBeNull();
      expect(screen.queryByRole("img")).toBeNull();
    });
  });

  it("marks a test that failed at BIRTH and reads its birth transcript", async () => {
    renderTest(BIRTH_FAILED_ID);
    // The status word reads off the INVENTORY, before either fetch lands — the
    // failure it belongs to is the flow join's, so the page must settle first.
    await findSteps();
    expect(screen.getByText("Failed (birth)")).toBeInTheDocument();
    expect(screen.getByText("timed out after 120s")).toBeInTheDocument();
    // A birth failure's transcript is addressed by its stored path, not by a run.
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /^Transcript/ }));
    expect(await screen.findByText(/analyze \./)).toBeInTheDocument();
  });

  it("offers NO way out to a second home for the test on the page", async () => {
    renderTest(PASSING_ID);
    await findSteps();
    // The flow row is gone from the footer: the page IS the flow. What is left is
    // the id, the file, and the spec section — facts, not destinations.
    expect(
      screen.queryByRole("button", {
        name: new RegExp(FLOW_TITLES.get(FLOW_ID)!.slice(0, 20)),
      }),
    ).toBeNull();
    // …and no test address at all: a flow is the only thing the URL can name.
    expect(search()).not.toContain("gtest=");
  });

  it('rests on "pick a flow" when nothing is open — the LIST is the tab', () => {
    renderPane();
    // ONE short line, and no explainer under it: a rest state says what to do.
    expect(screen.getByText("Select a test")).toBeInTheDocument();
    expect(screen.queryByText(/Guard commits every test it writes/)).toBeNull();
    // No second control over the list's narrowing, and no Overview destination.
    expect(
      screen.queryByRole("group", { name: "Flow filters" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Overview")).not.toBeInTheDocument();
  });
});

// --- Reading an existing claim dismissal (a test creates none of its own) --

describe("an existing claim dismissal, read-only from the test that failed", () => {
  const postsTo = (path: string) =>
    fetchMock.mock.calls
      .filter((c) => String(c[0]).includes(path))
      .map((c) => c[1] as RequestInit);

  it("a FAILING test with no recorded dismissal shows no dismissal note", async () => {
    renderTest(BIRTH_FAILED_ID);
    await findSteps();
    expect(screen.queryByText(/This claim is dismissed/)).toBeNull();
    expect(
      screen.queryByText(/Guard dismissed this claim automatically/),
    ).toBeNull();
  });

  it("a PASSING test shows no dismissal note, even with one on record", async () => {
    dismissedClaims = [
      { ...BIRTH_CLAIM, dismissedAt: "2026-07-25T10:00:00.000Z" },
    ];
    renderTest(PASSING_ID);
    await findSteps();
    expect(screen.getByText("Passed")).toBeInTheDocument();
    expect(screen.queryByText(/This claim is dismissed/)).toBeNull();
  });

  it("an already-dismissed claim reads as dismissed, and undo puts it back", async () => {
    const user = userEvent.setup();
    dismissedClaims = [
      { ...BIRTH_CLAIM, dismissedAt: "2026-07-25T10:00:00.000Z" },
    ];
    renderTest(BIRTH_FAILED_ID);

    expect(
      await screen.findByText(/This claim is dismissed/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "undo" }));

    const writes = postsTo("/guard/undismiss");
    expect(writes).toHaveLength(1);
    expect(JSON.parse(String(writes[0].body))).toEqual(BIRTH_CLAIM);
    // The note goes with it — a test offers no button to bring the dismissal back.
    await waitFor(() =>
      expect(screen.queryByText(/This claim is dismissed/)).toBeNull(),
    );
  });

  // The AUTO tier: a dismissal the tool recorded itself. No engine path writes
  // one today, so this is the defensive read — a record that arrives marked
  // `auto` must never be passed off as the reader's own judgment.
  it("an AUTO dismissal names the machine, quotes its reason, and keeps the undo", async () => {
    const user = userEvent.setup();
    dismissedClaims = [
      {
        ...BIRTH_CLAIM,
        dismissedAt: "2026-07-25T10:00:00.000Z",
        auto: true,
        reason:
          "The test asserted a flag the spec never promises — a generation defect.",
      },
    ];
    renderTest(BIRTH_FAILED_ID);

    expect(
      await screen.findByText(/Guard dismissed this claim automatically/),
    ).toBeInTheDocument();
    // Never re-worded as the user's own ruling.
    expect(screen.queryByText(/^This claim is dismissed/)).toBeNull();
    // The machine's stated reason rides with it, verbatim.
    expect(screen.getByText(/a generation defect/)).toBeInTheDocument();
    // A machine's call is exactly the kind a human revisits, so undo stays.
    await user.click(screen.getByRole("button", { name: "undo" }));
    expect(postsTo("/guard/undismiss")).toHaveLength(1);
  });
});

/**
 * THE OPEN RECORD — the collapsible list's own mechanics.
 *
 * These pin what the recomposition is FOR: one column and one page scroll at
 * every width, a row that opens its whole record inline (no tabs, no second
 * pane), a filmstrip tile that expands its step, a Replay tile that plays the
 * session in a modal, and supporting sections that stack and open independently.
 */
describe("the open step record", () => {
  const VISUALS: GuardEvidenceVisual[] = [
    { file: "step-1.png", kind: "screenshot", step: 1 },
    { file: "step-2.png", kind: "screenshot", step: 2 },
    { file: "session.webm", kind: "video" },
  ];

  it("reads one open record whole — result, output, picture, conditions inline, no tabs", async () => {
    const user = userEvent.setup();
    servedVisuals = VISUALS;
    servedSteps = WEB_STEPS;
    renderTest(PASSING_ID);
    const steps = await findSteps();

    const body = await openStep(user, steps, 2);
    // The record is ONE reading: every part on the page at once.
    expect(within(body).getAllByLabelText("expected value")).toHaveLength(2);
    expect(within(body).getByLabelText("page address")).toBeInTheDocument();
    expect(within(body).getByLabelText("page text")).toBeInTheDocument();
    expect(within(body).getByText("console")).toBeInTheDocument();
    expect(
      within(body).getByRole("button", { name: "Step 2 — open full size" }),
    ).toBeInTheDocument();
    // No tabs anywhere: splitting one step's record by clicks is the old model.
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });

  it("a step that captured no picture gets no screen row; an empty field says so", async () => {
    const user = userEvent.setup();
    servedSteps = STEPS_STOPPED_AT_2;
    renderTest(BIRTH_FAILED_ID);
    const steps = await findSteps();

    // Step 4 was never reached: its record still opens, and its empty fields
    // say why instead of rendering blanks. It recorded no picture, so no
    // screen row pretends otherwise.
    const body = await openStep(user, steps, 4);
    expect(
      within(body).getAllByText("not recorded in this run").length,
    ).toBeGreaterThan(0);
    expect(within(body).queryByText("screen")).toBeNull();
    // A step with nothing set around it carries no conditions rows at all.
    expect(within(body).queryByText("env")).toBeNull();
    expect(within(body).queryByText("cwd")).toBeNull();
  });

  it("hovering a row changes nothing — a record opens on a click only", async () => {
    const user = userEvent.setup();
    renderTest(BIRTH_FAILED_ID);
    const steps = await findSteps();
    await user.hover(stepToggle(steps, 4));
    expect(stepBody(4)).toBeNull();
    // The failure's record is still the only open one.
    expect(
      within(steps).getAllByRole("button", { expanded: true }),
    ).toHaveLength(1);
  });

  it("stacks the supporting sections and opens them independently", async () => {
    const user = userEvent.setup();
    renderTest(PASSING_ID);
    await findSteps();

    const transcript = screen.getByRole("button", { name: /^Transcript/ });
    const interfaces = screen.getByRole("button", { name: /^Interfaces/ });
    // Closed sections render no content at all.
    expect(transcript).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById("guard-drawer-transcript")).toBeNull();

    // One after the other, vertically — and opening one never closes another.
    expect(
      transcript.compareDocumentPosition(interfaces) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await user.click(transcript);
    await user.click(interfaces);
    expect(transcript).toHaveAttribute("aria-expanded", "true");
    expect(interfaces).toHaveAttribute("aria-expanded", "true");
    expect(
      document.getElementById("guard-drawer-transcript"),
    ).toBeInTheDocument();
    expect(
      document.getElementById("guard-drawer-interfaces"),
    ).toBeInTheDocument();

    // The ruling is a standing control, not a section to open: its button is
    // simply there, with no header row above it.
    expect(
      screen.getByRole("button", { name: /Don.t test this flow/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Rulings")).toBeNull();
  });

  describe("the filmstrip — the run's photographic index", () => {
    it("marks the failing tile, and a tile click opens the carousel there", async () => {
      const user = userEvent.setup();
      servedVisuals = VISUALS;
      servedSteps = WEB_STEPS_FAILED_AT_2;
      renderTest(BIRTH_FAILED_ID);
      await findSteps();

      const strip = await screen.findByRole("region", {
        name: "Run filmstrip",
      });
      // The failing tile is marked in the ONE colour a failure is allowed.
      expect(within(strip).getByText("failed")).toBeInTheDocument();

      // A tile is a way into the carousel, not a selection: no pressed state.
      const tile = within(strip).getByRole("button", { name: "Open Step 1" });
      expect(tile).not.toHaveAttribute("aria-pressed");
      await user.click(tile);
      const lightbox = screen.getByRole("dialog", {
        name: "Evidence screenshot",
      });
      expect(within(lightbox).getByRole("img")).toHaveAttribute(
        "alt",
        "Step 1 screenshot",
      );
    });

    it("jumps to the step's record from the tile's own Go to step", async () => {
      const user = userEvent.setup();
      servedVisuals = VISUALS;
      servedSteps = WEB_STEPS_FAILED_AT_2;
      renderTest(BIRTH_FAILED_ID);
      const steps = await findSteps();

      const strip = await screen.findByRole("region", {
        name: "Run filmstrip",
      });
      await user.click(
        within(strip).getByRole("button", { name: "Go to step 1" }),
      );
      // No carousel — the jump lands straight on the opened record.
      expect(
        screen.queryByRole("dialog", { name: "Evidence screenshot" }),
      ).toBeNull();
      expect(stepToggle(steps, 1)).toHaveAttribute("aria-expanded", "true");
    });

    it("renders no strip at all for a run that captured nothing", async () => {
      renderTest(PASSING_ID);
      await findSteps();
      expect(
        screen.queryByRole("region", { name: "Run filmstrip" }),
      ).toBeNull();
    });
  });

  /**
   * `object-contain` only ever fits a picture to the box it is IN, so a box sized
   * by its content renders a small screenshot small — the exact thing the full-size
   * reading exists to answer. jsdom lays nothing out, so the fix is pinned as the
   * structure that produces it: a viewport-sized box, and an image told to fill it.
   */
  it("gives the lightbox picture a viewport-sized box, so a small shot scales up", async () => {
    const user = userEvent.setup();
    servedVisuals = VISUALS;
    servedSteps = WEB_STEPS;
    renderTest(PASSING_ID);
    const steps = await findSteps();
    await openStep(user, steps, 1);
    await user.click(
      screen.getByRole("button", { name: "Step 1 — open full size" }),
    );
    const lightbox = screen.getByRole("dialog", { name: "Evidence screenshot" });
    const picture = within(lightbox).getByRole("img");
    expect(picture.className).toContain("object-contain");
    // The image fills its cell…
    expect(picture.className).toMatch(/(^|\s)h-full(\s|$)/);
    expect(picture.className).toMatch(/(^|\s)w-full(\s|$)/);
    // …and that cell is sized from the VIEWPORT, never from the picture.
    const box = lightbox.firstElementChild as HTMLElement;
    expect(box.className).toContain("h-[85vh]");
    expect(box.className).toContain("w-[90vw]");
  });
});

describe("the step list reads a claim-identity milestone as its claim", () => {
  // An authored test tags its steps with claim IDs, not flow positions. The claim
  // corpus is what turns an id into the sentence the group header reads, and it
  // reaches the detail through the pane — a drop anywhere on that chain sends
  // every such group back to reading "Prepare".
  it("reads the claim sentence the corpus supplies inside the tagged step", async () => {
    const user = userEvent.setup();
    servedSteps = CLAIM_TAGGED_STEPS;
    renderTest(PASSING_ID, { claimTitles: { [CLAIM_ID]: CLAIMS[0] } });
    const steps = await findSteps();
    const body = await openStep(user, steps, 2);
    expect(within(body).getByText(CLAIMS[0])).toBeInTheDocument();
    // The id never leaks once the corpus names the claim.
    expect(within(body).queryByText(CLAIM_ID)).not.toBeInTheDocument();
  });

  it("falls back to the claim id when no corpus names it — never to a blank", async () => {
    const user = userEvent.setup();
    servedSteps = CLAIM_TAGGED_STEPS;
    renderTest(PASSING_ID);
    const steps = await findSteps();
    const body = await openStep(user, steps, 2);
    expect(within(body).getByText(CLAIM_ID)).toBeInTheDocument();
  });
});

describe("SETUP as step 0 — the world the steps start in", () => {
  /**
   * The starting world a seeded, git-backed, env-carrying test declares. Composed
   * server-side off the same parse as the steps, so the page renders it and never
   * re-reads the file to learn what was already true at step 1.
   */
  const SETUP: GuardScenarioSetupView = {
    files: [
      { path: "tasks.json", content: "[]" },
      { path: "tasks.config.json", content: '{\n  "sort": "newest"\n}' },
    ],
    git: [
      "initializes a git repository in repo",
      "on branch trunk",
      "commits as Guard Runner <guard@example.com>",
      "commit 1 \u201cseed the store\u201d \u2014 tasks.json",
      "staged, uncommitted \u2014 tasks.config.json",
    ],
    env: ["NO_COLOR=1", "TASKS_HOME=.tmp/tasks"],
  };

  /**
   * The setup's settle point. It is not a standing section any more: it is STEP 0
   * of the same list, so reading it means opening that row — exactly what a
   * reader does. The row lands with the same scenario-source fetch as the steps.
   */
  const findSetup = async (): Promise<HTMLElement> => {
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Setup record" }),
    );
    return screen.getByLabelText("test setup");
  };

  it("renders the seeded files COLLAPSED — the path is the row, the content one click", async () => {
    const user = userEvent.setup();
    servedSetup = SETUP;
    renderTest(PASSING_ID);
    const setup = await findSetup();

    // Every seeded path reads at a glance; not one of their bodies is on the page,
    // or a wall of config would bury the steps below.
    for (const file of SETUP.files!) {
      expect(within(setup).getByText(file.path)).toBeInTheDocument();
      expect(
        within(setup).queryByLabelText(`${file.path} contents`),
      ).toBeNull();
    }

    await user.click(
      within(setup).getByRole("button", { name: "Expand tasks.json" }),
    );
    expect(
      within(setup).getByLabelText("tasks.json contents"),
    ).toHaveTextContent("[]");
    // Opening one opens only that one.
    expect(
      within(setup).queryByLabelText("tasks.config.json contents"),
    ).toBeNull();

    // …and it closes again from the same row.
    await user.click(
      within(setup).getByRole("button", { name: "Collapse tasks.json" }),
    );
    expect(within(setup).queryByLabelText("tasks.json contents")).toBeNull();
  });

  it("reads the git world and the env overlay as declared, one line each", async () => {
    servedSetup = SETUP;
    renderTest(PASSING_ID);
    const setup = await findSetup();

    for (const heading of ["Files", "Git", "Env"]) {
      expect(within(setup).getByText(heading)).toBeInTheDocument();
    }
    for (const line of SETUP.git!)
      expect(within(setup).getByText(line)).toBeInTheDocument();
    for (const pair of SETUP.env!)
      expect(within(setup).getByText(pair)).toBeInTheDocument();
  });

  it("renders only the parts the scenario declares", async () => {
    servedSetup = { env: ["NO_COLOR=1"] };
    renderTest(PASSING_ID);
    const setup = await findSetup();
    expect(within(setup).getByText("NO_COLOR=1")).toBeInTheDocument();
    // No files and no git block ⇒ no headings promising either.
    expect(within(setup).queryByText("Files")).toBeNull();
    expect(within(setup).queryByText("Git")).toBeNull();
  });

  it("renders NOTHING at all for a test that declares no setup", async () => {
    renderTest(PASSING_ID);
    // The steps landed, so the source did — and it carried no setup: no row, no
    // inspector for one, and no empty heading standing in for it.
    await findSteps();
    expect(screen.queryByLabelText("test setup")).toBeNull();
    expect(screen.queryByRole("button", { name: "Setup record" })).toBeNull();
    expect(screen.queryByText("Setup")).toBeNull();
  });

  it("reads as step 0 — BEFORE the steps that run in it, in the same list", async () => {
    servedSetup = SETUP;
    renderTest(PASSING_ID);
    const steps = await findSteps();
    const rows = within(steps).getAllByRole("listitem");
    // First row of the list, ahead of every authored step.
    expect(rows[0]).toHaveAccessibleName(
      "Step 0: setup — the world the steps start in",
    );
    expect(rows[1]).toHaveAccessibleName(/^Step 1:/);
    // A passing test starts with every record closed — setup included.
    expect(
      within(steps).queryAllByRole("button", { expanded: true }),
    ).toHaveLength(0);
  });

  it("opening step 0 reads the starting world inline, and closing gives it back", async () => {
    const user = userEvent.setup();
    servedSetup = SETUP;
    renderTest(PASSING_ID);
    const steps = await findSteps();
    // Nothing of the setup is on the page until its row is opened.
    expect(screen.queryByLabelText("test setup")).toBeNull();

    await user.click(stepToggle(steps, "setup"));
    expect(screen.getByLabelText("test setup")).toBeInTheDocument();
    // Opening a step does not evict it — records stack; closing removes it.
    await openStep(user, steps, 1);
    expect(screen.getByLabelText("test setup")).toBeInTheDocument();
    await user.click(stepToggle(steps, "setup"));
    expect(screen.queryByLabelText("test setup")).toBeNull();
  });
});

/**
 * A step's authoring `note` is prose an LLM wrote about code, so it arrives
 * with backticked identifiers and the occasional **emphasis**. The page renders
 * those two marks and nothing else — a note is a sentence, not a document.
 */
describe("a step note renders its inline markup", () => {
  it("renders backticks as code and ** as bold, leaving the rest literal", async () => {
    const user = userEvent.setup();
    servedSteps = [
      {
        ...STEPS[0],
        note: "Set `TRUECOURSE_ROSLYN_HOST` and the **Delete document** button — 5 * 3 stays literal.",
      },
    ];
    renderTest(PASSING_ID);
    const steps = await findSteps();
    const body = await openStep(user, steps, 1);

    expect(within(body).getByText("TRUECOURSE_ROSLYN_HOST").tagName).toBe("CODE");
    expect(within(body).getByText("Delete document").tagName).toBe("STRONG");
    // An unpaired marker is text, never the start of a span that eats the line.
    expect(within(body).getByText(/5 \* 3 stays literal/)).toBeInTheDocument();
  });
});
