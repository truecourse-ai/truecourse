/**
 * THE guard surface — flows and tests MERGED, on the governing model:
 *
 *   a flow either has a test or it doesn't. Has one → the test IS the rest of the
 *   page. Doesn't → say why, in one plain sentence.
 *
 * Covers the LEFT PANEL (ONE flat list — the only guard inventory there is —
 * failing flows first, every row carrying title + goal + exactly ONE status word
 * over the whole coverage-status domain, and NO surface chips), the MERGED DETAIL
 * (the flow's header and its milestone LIST — plain, stateless, one claim sentence
 * per row — then the test itself: verdict, setup, steps, evidence, interface; or the
 * why-no-test block, with NO gaps block, NO findings block and NO authoring-errors
 * block), the RECIPE affordance in the list, and the RUNS tab's record (the same
 * scenario rendering plus the "open this flow" link).
 *
 * The step list, the setup block and the artifact toggle inside that merged detail
 * are `guard-tests.test.tsx` — this file is the flow half.
 *
 * The fixture is the plan's worked example, "taskbird", plus the shapes the
 * 2026-07-26 live review caught rendering wrong: a flow whose only news was a
 * birth failure, a flow whose blocked reason is a paragraph, an ERROR-only flow
 * (which must read Blocked — nothing ran, so nothing failed), and a committed
 * failing test that has to read as a real test.
 */

import { useState } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { GUARD_COVERAGE_STATUS_PRECEDENCE } from "@truecourse/shared";
import type {
  GuardFlowBucket,
  GuardFlowDetail as GuardFlowDetailData,
  GuardFlowListItem,
  GuardFlowsView,
  GuardRunFlow,
  GuardScenarioResult,
  GuardSectionCoverageStatus,
} from "@truecourse/shared";
import { GuardFlowsPanel } from "@/components/guard/GuardFlowsPanel";
import { GuardFlowsPane } from "@/components/guard/GuardFlowsPane";
import { GuardFlowDetail } from "@/components/guard/GuardFlowDetail";
import { GuardDriftDetail } from "@/components/guard/GuardDriftDetail";
import { useGuardFlowTabs } from "@/hooks/useGuardFlowTabs";
import { useGuardDecisions } from "@/hooks/useGuardDecisions";
import {
  GUARD_FLOW_FILTER_LABEL,
  GUARD_FLOW_FILTER_ORDER,
  GUARD_FLOW_STATUS_WORD,
  guardPlainStatus,
  guardStatusHint,
  guardStatusLabel,
  guardStatusWord,
  type GuardFlowFilter,
} from "@/lib/guard-flow-status";
import { guardStatusMeta } from "@/lib/guard-status";

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const DOC = "docs/specs/tasks.md";
const FLOW_ID = "task-lifecycle";
const SCENARIO_ID = "task-lifecycle.cli.1";
const MANUAL_ID = "tasks-help-smoke";
const RUN_ID = "2026-07-24T14-02-00Z_9f31c0aa";
const FLOW_TITLE =
  "A user creates a task, sees it listed, completes it, and sees it done";

const CLI_SURFACE = {
  surface: "cli" as const,
  scenarioId: SCENARIO_ID,
  status: "fail" as const,
  outcome: "fail" as const,
  stage: "run" as const,
  interfaceDrifted: true,
};
const WEB_GAP = {
  surface: "web" as const,
  status: "web" as const,
  gap: {
    kind: "awaiting-driver" as const,
    driver: "web" as const,
    reason: "the board is browser-only",
    label: "awaiting web driver",
  },
};

const FLOWS: GuardFlowListItem[] = [
  {
    flowId: FLOW_ID,
    title: FLOW_TITLE,
    goal: "Create, list, complete and filter a task from the CLI",
    status: "fail",
    bucket: "partial",
    epic: false,
    composedOf: [],
    manual: false,
    milestoneCount: 4,
    sectionCount: 3,
    docs: [DOC],
    surfaces: [CLI_SURFACE, WEB_GAP],
    findings: 0,
    toolDefects: 0,
    errors: 0,
    interfaceDrifted: true,
  },
  {
    flowId: "task-export",
    title: "A user exports the task list",
    goal: "Export tasks to a file from the CLI",
    status: "no-interface",
    bucket: "blocked",
    epic: false,
    composedOf: [],
    manual: false,
    milestoneCount: 1,
    sectionCount: 1,
    docs: [DOC],
    surfaces: [
      {
        surface: "cli",
        status: "no-interface",
        gap: {
          kind: "no-interface",
          reason: "no cli interface exports the list",
          label: "no interface",
        },
      },
    ],
    findings: 0,
    toolDefects: 0,
    errors: 0,
    interfaceDrifted: false,
  },
  {
    // Authoring never started: the repo declares no API preparation and no
    // credentials, so the flow states both needs in plain words — in its DETAIL.
    flowId: "task-remind",
    title: "A user schedules a reminder",
    goal: "Schedule a reminder over the API",
    status: "blocked-on",
    bucket: "blocked",
    epic: false,
    composedOf: [],
    manual: false,
    milestoneCount: 2,
    sectionCount: 1,
    docs: [DOC],
    surfaces: [
      {
        surface: "api",
        status: "blocked-on",
        gap: {
          kind: "blocked-on",
          reason:
            "blocked on a recipe `api` block, credentials: A user schedules a reminder",
          label: "blocked-on",
        },
      },
    ],
    findings: 0,
    toolDefects: 0,
    errors: 0,
    interfaceDrifted: false,
  },
  {
    flowId: `manual:${MANUAL_ID}`,
    title: "`tasks --help` prints usage",
    goal: "",
    status: "pass",
    bucket: "guarded",
    epic: false,
    composedOf: [],
    manual: true,
    milestoneCount: 0,
    sectionCount: 1,
    docs: [DOC],
    surfaces: [
      {
        surface: "cli",
        scenarioId: MANUAL_ID,
        status: "pass",
        outcome: "pass",
        stage: "run",
      },
    ],
    findings: 0,
    toolDefects: 0,
    errors: 0,
    interfaceDrifted: false,
  },
];

/**
 * Regression fixtures — the rows the 2026-07-26 live review caught.
 *
 * `BIRTH_FAILED_FLOW` mirrors `handle-pathological-files-without-freezing-analyze`.
 * Guard now COMMITS a test that fails at birth, so the flow arrives with a real
 * surface carrying `stage: 'birth'` and `status: 'fail'`: the row must read
 * Failing, and the test itself must be clickable in the detail.
 *
 * `ERROR_ONLY_FLOW` is the other half of that pair: authoring ERRORED, so no test
 * exists and NOTHING ran. It must never read Failing — a failure is a result, and
 * there is no result here.
 *
 * `LONG_BLOCKED_FLOW` mirrors `resolve-spec-conflicts-before-generating-guard-scenarios`:
 * a `blocked-on` reason naming three capabilities AND restating the flow goal —
 * the paragraph that leaked into a list row.
 */
const BIRTH_FAILED_ID = "handle-pathological-files.cli.1";
const BIRTH_FAILED_FLOW: GuardFlowListItem = {
  flowId: "handle-pathological-files-without-freezing-analyze",
  title: "Analyze completes despite a pathological slow file",
  goal: "Analyze a repo carrying a pathological file without freezing",
  status: "fail",
  bucket: "guarded",
  epic: false,
  composedOf: [],
  manual: false,
  milestoneCount: 1,
  sectionCount: 1,
  docs: ["README.md"],
  surfaces: [
    {
      surface: "cli",
      scenarioId: BIRTH_FAILED_ID,
      status: "fail",
      stage: "birth",
    },
  ],
  findings: 1,
  toolDefects: 0,
  errors: 0,
  interfaceDrifted: false,
};

const ERROR_ONLY_FLOW: GuardFlowListItem = {
  flowId: "stream-analyze-progress",
  title: "Analyze streams its progress",
  goal: "Watch analyze tick through its stages",
  status: "unguarded",
  bucket: "blocked",
  epic: false,
  composedOf: [],
  manual: false,
  milestoneCount: 2,
  sectionCount: 1,
  docs: ["README.md"],
  surfaces: [],
  findings: 0,
  toolDefects: 0,
  errors: 2,
  interfaceDrifted: false,
};

const LONG_BLOCKED_REASON =
  "blocked on llm-provider, credentials, network: Curate the spec corpus and resolve conflicts before generating guard scenarios";

const LONG_BLOCKED_FLOW: GuardFlowListItem = {
  flowId: "resolve-spec-conflicts-before-generating-guard-scenarios",
  title: "Resolve spec conflicts before generating",
  goal: "Curate the spec corpus, then generate",
  status: "blocked-on",
  bucket: "blocked",
  epic: false,
  composedOf: [],
  manual: false,
  milestoneCount: 2,
  sectionCount: 2,
  docs: ["docs/SPEC_GUARD_PLAN.md"],
  surfaces: [
    {
      surface: "cli",
      status: "blocked-on",
      gap: {
        kind: "blocked-on",
        reason: LONG_BLOCKED_REASON,
        label: "blocked-on",
      },
    },
  ],
  findings: 0,
  toolDefects: 0,
  errors: 0,
  interfaceDrifted: false,
};

/**
 * The exact wire payload the 2026-07-27 review caught: a blocked flow whose ONE
 * cli surface carries a `blocked-on` gap naming two capabilities and NO
 * scenarioId — the row that wore two words ("Blocked" in the list, "Needs setup"
 * in the detail) and looked like a test while being unclickable.
 */
const CONFLICTS_FLOW_ID = "review-and-resolve-spec-conflicts";
const CONFLICTS_GAP = {
  kind: "blocked-on" as const,
  reason: "blocked on credentials, network: Review and resolve spec conflicts",
  label: "blocked-on",
};
const CONFLICTS_FLOW: GuardFlowListItem = {
  flowId: CONFLICTS_FLOW_ID,
  title: "A maintainer reviews and resolves spec conflicts",
  goal: "Resolve every open conflict before generating",
  status: "blocked-on",
  bucket: "blocked",
  epic: false,
  composedOf: [],
  manual: false,
  milestoneCount: 3,
  sectionCount: 2,
  docs: ["docs/SPEC_GUARD_PLAN.md"],
  surfaces: [{ surface: "cli", status: "blocked-on", gap: CONFLICTS_GAP }],
  findings: 0,
  toolDefects: 0,
  errors: 0,
  interfaceDrifted: false,
};

/**
 * The flow the specs no longer derive: recomposition dropped it from
 * `flows.json`, so it has NO title, NO goal and NO milestones — only its
 * committed test keeps it alive. Everything a reader sees about it has to come
 * from the one sentence, because the corpus that described it is gone.
 */
const UNDERIVED_ID = "purge-tasks";
const UNDERIVED_TEST_ID = "purge-tasks.cli.1";
const UNDERIVED_FLOW: GuardFlowListItem = {
  flowId: UNDERIVED_ID,
  title: UNDERIVED_ID,
  goal: "",
  status: "pass",
  bucket: "guarded",
  epic: false,
  composedOf: [],
  manual: false,
  milestoneCount: 0,
  sectionCount: 1,
  docs: [DOC],
  surfaces: [
    {
      surface: "cli",
      scenarioId: UNDERIVED_TEST_ID,
      status: "pass",
      outcome: "pass",
      stage: "run",
    },
  ],
  findings: 0,
  toolDefects: 0,
  errors: 0,
  interfaceDrifted: false,
  orphaned: true,
};

const VIEW: GuardFlowsView = {
  flows: FLOWS,
  totals: {
    total: 4,
    guarded: 1,
    partial: 1,
    blocked: 2,
    ungenerated: 0,
    manual: 1,
  },
  noFlowClaims: 1,
  synthesized: true,
  generatedAt: "2026-07-24T13:40:00.000Z",
  runId: RUN_ID,
  ranAt: "2026-07-24T14:02:00.000Z",
  recipe: {
    surfaces: {
      cli: { build: "pnpm build", entry: ["node", "dist/tasks.js"] },
    },
    fingerprint: "sha256:9f2caabbccdd",
    stale: false,
  },
};

const DETAIL: GuardFlowDetailData = {
  flowId: FLOW_ID,
  title: FLOW_TITLE,
  goal: "Create, list, complete and filter a task from the CLI",
  status: "fail",
  bucket: "partial",
  epic: false,
  manual: false,
  composedOf: [],
  fingerprint: "sha256:41ac",
  milestones: [
    {
      order: 1,
      doc: DOC,
      anchor: "tasks/creating-tasks",
      claimTitle: "Creating a task prints its id",
      headingText: "Creating tasks",
      live: true,
      drifted: false,
    },
    {
      order: 2,
      doc: DOC,
      anchor: "tasks/listing-tasks",
      claimTitle: "The list shows tasks newest-first",
      headingText: "Listing tasks",
      live: true,
      // The bound section was edited since synthesis — the drift paint.
      drifted: true,
    },
    {
      order: 3,
      doc: DOC,
      anchor: "tasks/completing-tasks",
      claimTitle: "A task can be marked done",
      headingText: "Completing tasks",
      live: true,
      drifted: false,
    },
    {
      order: 4,
      doc: DOC,
      anchor: "tasks/completing-tasks",
      claimTitle: "Done tasks appear under --done",
      headingText: "Completing tasks",
      live: true,
      drifted: false,
    },
  ],
  surfaces: [
    {
      surface: "cli",
      scenarioId: SCENARIO_ID,
      title: "Tasks are created, listed newest-first, completed and filterable",
      file: ".truecourse/scenarios/tasks/task-lifecycle.cli.1.yaml",
      status: "fail",
      birthPassed: true,
      stage: "run",
      outcome: "fail",
      durationMs: 412,
      failure: {
        step: 3,
        expected: "exit 0",
        actual: "exit 1: unknown command `done`",
      },
      failedMilestone: 3,
      interfaceDrifted: true,
      evidencePath: `.truecourse/guard/evidence/${RUN_ID}/${SCENARIO_ID}`,
      hasEvidence: true,
      interfacePath: ["cli/tasks-add", "cli/tasks-list", "cli/tasks-done"],
    },
    {
      surface: "web",
      status: "web",
      birthPassed: false,
      hasEvidence: false,
      interfacePath: [],
      gap: WEB_GAP.gap,
    },
  ],
  gaps: [{ surface: "web", ...WEB_GAP.gap }],
  interfaceIds: ["cli/tasks-add", "cli/tasks-list", "cli/tasks-done"],
  findings: [],
  errors: [],
  generatedAt: "2026-07-24T13:40:00.000Z",
  runId: RUN_ID,
  ranAt: "2026-07-24T14:02:00.000Z",
};

/** The committed-failing-test detail — the review's "unclickable failing test". */
const BIRTH_FAILED_DETAIL: GuardFlowDetailData = {
  ...DETAIL,
  flowId: BIRTH_FAILED_FLOW.flowId,
  title: BIRTH_FAILED_FLOW.title,
  goal: BIRTH_FAILED_FLOW.goal,
  status: "fail",
  bucket: "guarded",
  milestones: [DETAIL.milestones[0]],
  surfaces: [
    {
      surface: "cli",
      scenarioId: BIRTH_FAILED_ID,
      title: "Analyze completes despite a pathological slow file",
      status: "fail",
      birthPassed: false,
      stage: "birth",
      failure: { step: 2, expected: "exit 0", actual: "timed out after 120s" },
      hasEvidence: true,
      interfacePath: [],
    },
  ],
  gaps: [],
  interfaceIds: [],
  findings: [],
  errors: [],
};

/** The error-only detail: no test, no gap — authoring could not finish. The read
 *  side paints such a surface `authoring-error`, so the row carries that status. */
const ERROR_ONLY_DETAIL: GuardFlowDetailData = {
  ...DETAIL,
  flowId: ERROR_ONLY_FLOW.flowId,
  title: ERROR_ONLY_FLOW.title,
  goal: ERROR_ONLY_FLOW.goal,
  status: "authoring-error",
  bucket: "blocked",
  milestones: [DETAIL.milestones[0]],
  surfaces: [
    {
      surface: "cli",
      status: "authoring-error",
      birthPassed: false,
      hasEvidence: false,
      interfacePath: [],
    },
  ],
  gaps: [],
  interfaceIds: [],
  findings: [],
  errors: [
    {
      doc: "README.md",
      anchor: "analyze",
      kind: "authoring",
      surface: "cli",
      message: "the model returned an unparseable envelope",
    },
  ],
};

/** Nothing attempted yet: no test, no gap — and no error either. */
const NOT_ATTEMPTED_DETAIL: GuardFlowDetailData = {
  ...ERROR_ONLY_DETAIL,
  flowId: "not-attempted",
  status: "unguarded",
  surfaces: [],
  errors: [],
};

/**
 * A flow with no test and a full chain — the ONE page that still reads its
 * milestones as a list of their own. Where a test exists, its step list already
 * groups the steps under those same claims and links those same sections, so the
 * list stands down rather than saying the chain twice.
 */
const NO_TEST_DETAIL: GuardFlowDetailData = {
  ...NOT_ATTEMPTED_DETAIL,
  milestones: DETAIL.milestones,
};

const UNDERIVED_DETAIL: GuardFlowDetailData = {
  ...DETAIL,
  flowId: UNDERIVED_ID,
  title: UNDERIVED_ID,
  goal: "",
  status: "pass",
  bucket: "guarded",
  milestones: [],
  surfaces: [
    {
      surface: "cli",
      scenarioId: UNDERIVED_TEST_ID,
      title: "Purged tasks leave the list",
      status: "pass",
      birthPassed: true,
      stage: "run",
      outcome: "pass",
      hasEvidence: false,
      interfacePath: [],
    },
  ],
  gaps: [],
  interfaceIds: [],
  findings: [],
  errors: [],
  orphaned: true,
};

const CONFLICTS_DETAIL: GuardFlowDetailData = {
  ...DETAIL,
  flowId: CONFLICTS_FLOW_ID,
  title: CONFLICTS_FLOW.title,
  goal: CONFLICTS_FLOW.goal,
  status: "blocked-on",
  bucket: "blocked",
  milestones: [DETAIL.milestones[0]],
  surfaces: [
    {
      surface: "cli",
      status: "blocked-on",
      birthPassed: false,
      hasEvidence: false,
      interfacePath: [],
      gap: CONFLICTS_GAP,
    },
  ],
  gaps: [{ surface: "cli", ...CONFLICTS_GAP }],
  interfaceIds: [],
  findings: [],
  errors: [],
};

const SCENARIO_YAML = ["guard: 3", `id: ${SCENARIO_ID}`, "driver: cli"].join(
  "\n",
);
const TRANSCRIPT = "$ tasks done 1\nunknown command `done`";
/** The flow's own entry in `scenarios/flows.json` — what the raw mode shows. */
const FLOW_RAW = JSON.stringify(
  { id: FLOW_ID, fingerprint: "sha256:41ac" },
  null,
  2,
);

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes("/guard/flow/raw"))
        return json({ id: FLOW_ID, file: "flows.json", content: FLOW_RAW });
      if (u.includes("/guard/flows/")) {
        if (u.includes(ERROR_ONLY_FLOW.flowId)) return json(ERROR_ONLY_DETAIL);
        if (u.includes(BIRTH_FAILED_FLOW.flowId))
          return json(BIRTH_FAILED_DETAIL);
        return json(DETAIL);
      }
      if (u.includes("/guard/scenario?"))
        return json({
          id: SCENARIO_ID,
          file: "x.yaml",
          content: SCENARIO_YAML,
        });
      if (u.includes("/guard/evidence"))
        return new Response(TRANSCRIPT, { status: 200 });
      return json({});
    }),
  );
}

beforeEach(stubFetch);
afterEach(() => vi.unstubAllGlobals());

// --- The left panel --------------------------------------------------------

/**
 * The panel's filter is owned ABOVE it (the page holds it, so the overview's
 * chips and this dropdown are two controls over one narrowing) — the harness
 * plays that owner.
 */
function FlowsPanelHarness(
  props: Partial<Parameters<typeof GuardFlowsPanel>[0]> = {},
) {
  const [filter, setFilter] = useState<GuardFlowFilter>("all");
  const [drivers, setDrivers] = useState<string[]>([]);
  return (
    <GuardFlowsPanel
      flows={FLOWS}
      loading={false}
      error={null}
      activeId={null}
      onOpen={() => {}}
      filter={filter}
      onFilter={setFilter}
      drivers={drivers}
      onDrivers={setDrivers}
      {...props}
    />
  );
}

/** The shared list's filter bar, and one of its count chips by status word. */
const statusFilter = () =>
  screen.getByRole("group", { name: "Filter by status" });
const statusChip = (word: string) =>
  within(statusFilter()).getByRole("button", {
    name: new RegExp(`^${word} \\d+$`),
  });

describe("GuardFlowsPanel — the flow inventory", () => {
  const renderPanel = (
    props: Partial<Parameters<typeof GuardFlowsPanel>[0]> = {},
  ) => render(<FlowsPanelHarness {...props} />);

  /** The list rows in render order, as text. */
  const rowTexts = () =>
    within(screen.getByRole("list", { name: "Test inventory" }))
      .getAllByRole("listitem")
      .map((row) => row.textContent ?? "");

  it("is ONE flat list — no grouping chrome, failing flows first", () => {
    renderPanel();
    const list = screen.getByRole("list", { name: "Test inventory" });
    expect(
      within(list).queryByRole("button", { expanded: true }),
    ).not.toBeInTheDocument();
    expect(within(list).getAllByRole("listitem")).toHaveLength(FLOWS.length);
    const texts = rowTexts();
    expect(texts[0]).toContain(FLOW_TITLE);
    expect(texts[texts.length - 1]).toContain("`tasks --help` prints usage");
  });

  it("renders every row the same way — title, goal, then the status word FIRST", () => {
    renderPanel();
    const list = screen.getByRole("list", { name: "Test inventory" });
    const failing = within(list)
      .getByText(FLOW_TITLE)
      .closest('[role="listitem"]')! as HTMLElement;
    const passing = within(list)
      .getByText("`tasks --help` prints usage")
      .closest('[role="listitem"]')! as HTMLElement;
    expect(within(failing).getByText(FLOWS[0].goal)).toBeInTheDocument();
    // No tally line: milestone / section counts are detail copy, lists stay lean.
    expect(within(list).queryByText(/milestones? ·/)).not.toBeInTheDocument();
    expect(failing.className).toBe(passing.className);
    expect(within(list).getByText("manual")).toBeInTheDocument();

    // ONE ROW ANATOMY: the status chip is the FIRST thing on the chip line, on
    // every row, and the line holds nothing that is not a status or a marker.
    for (const row of within(list).getAllByRole("listitem")) {
      const chipLine = within(row).getAllByText(/.*/, {
        selector: "div.flex.flex-wrap",
      })[0];
      expect(
        chipLine.firstElementChild?.textContent,
        row.textContent ?? "",
      ).toMatch(/^(Failed|Blocked|Never run|Succeeded|Not testable)$/);
    }
  });

  it("carries NO surface chips on a ROW — which surfaces a test drives is a filter", () => {
    // They came back on every row as the same word, and a reader learned to skip
    // them. The question they answered is a NARROWING one, and the driver chips
    // over the list answer it now.
    renderPanel();
    const list = screen.getByRole("list", { name: "Test inventory" });
    for (const text of ["CLI ✗", "CLI ✓", "Web", "CLI", "API"]) {
      expect(within(list).queryByText(text), text).toBeNull();
    }
  });

  it("a row for a flow the specs no longer derive carries the same sentence, not a bare id", () => {
    renderPanel({ flows: [...FLOWS, UNDERIVED_FLOW] });
    const list = screen.getByRole("list", { name: "Test inventory" });
    const row = within(list)
      .getByText(UNDERIVED_ID)
      .closest('[role="listitem"]')! as HTMLElement;
    expect(
      within(row).getByText(
        "No longer derived from your specs — kept because its test still runs.",
      ),
    ).toBeInTheDocument();
    // Every other row keeps its own goal — the sentence only fills an EMPTY slot.
    const derived = within(list)
      .getByText(FLOW_TITLE)
      .closest('[role="listitem"]')! as HTMLElement;
    expect(within(derived).getByText(FLOWS[0].goal)).toBeInTheDocument();
    expect(
      within(derived).queryByText(/No longer derived/),
    ).not.toBeInTheDocument();
  });

  /**
   * The MARKER, not the explanation (round-5): a sentence reads as description,
   * so the row wears a chip a scanning eye catches — beside the status, in the
   * same chip row, and never in a status colour, because "not in specs" says
   * nothing about pass/fail.
   */
  it("marks a flow the specs no longer derive with a neutral chip beside its status", () => {
    renderPanel({ flows: [...FLOWS, UNDERIVED_FLOW] });
    const list = screen.getByRole("list", { name: "Test inventory" });
    const row = within(list)
      .getByText(UNDERIVED_ID)
      .closest('[role="listitem"]')! as HTMLElement;

    const chip = within(row).getByText("Not in specs");
    const statusChip = within(row).getByText("Succeeded");
    expect(chip.parentElement).toBe(statusChip.parentElement);
    expect(chip.className).not.toMatch(/emerald|red|amber|sky|zinc/);
    // It is a marker, not a sixth status word — the row still says exactly one.
    expect(wordsIn(row)).toEqual(["Succeeded"]);
    // …and the sentence it explains is still there, untouched.
    expect(
      within(row).getByText(
        "No longer derived from your specs — kept because its test still runs.",
      ),
    ).toBeInTheDocument();
  });

  it("marks nothing else — a flow the specs DO derive has no chip", () => {
    renderPanel({ flows: [...FLOWS, UNDERIVED_FLOW] });
    const list = screen.getByRole("list", { name: "Test inventory" });
    expect(within(list).getAllByText("Not in specs")).toHaveLength(1);
    for (const flow of FLOWS) {
      const row = within(list)
        .getByText(flow.title)
        .closest('[role="listitem"]')! as HTMLElement;
      expect(
        within(row).queryByText("Not in specs"),
        flow.flowId,
      ).not.toBeInTheDocument();
    }
  });

  /** THE FIVE — the whole coverage vocabulary, and a row shows exactly one. */
  const STATUS_WORDS = [
    "Failed",
    "Blocked",
    "Never run",
    "Succeeded",
    "Not testable",
  ];
  const wordsIn = (row: HTMLElement) =>
    STATUS_WORDS.filter((w) => within(row).queryAllByText(w).length > 0);

  it("gives every row exactly one status word", () => {
    renderPanel({
      flows: [...FLOWS, BIRTH_FAILED_FLOW, ERROR_ONLY_FLOW, LONG_BLOCKED_FLOW],
    });
    const list = screen.getByRole("list", { name: "Test inventory" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(FLOWS.length + 3);
    for (const row of rows) expect(wordsIn(row)).toHaveLength(1);
  });

  it("THE failed-vs-blocked pair: a committed failing test is Failed, an authoring error is NOT", () => {
    // The whole point of the vocabulary: Failed means a test RAN and was
    // contradicted. Authoring never ran anything, so an error-only flow is Blocked
    // — the next generate is what clears it.
    renderPanel({ flows: [BIRTH_FAILED_FLOW, ERROR_ONLY_FLOW] });
    const list = screen.getByRole("list", { name: "Test inventory" });
    const birth = within(list)
      .getByText(BIRTH_FAILED_FLOW.title)
      .closest('[role="listitem"]')!;
    const errored = within(list)
      .getByText(ERROR_ONLY_FLOW.title)
      .closest('[role="listitem"]')!;
    expect(wordsIn(birth as HTMLElement)).toEqual(["Failed"]);
    expect(wordsIn(errored as HTMLElement)).toEqual(["Blocked"]);
    // The error count never leaks into the row as a number to decode.
    expect(within(list).queryByText(/2 errors/)).not.toBeInTheDocument();
  });

  it("maps EVERY coverage status to a status word — no state can render blank", () => {
    for (const status of GUARD_COVERAGE_STATUS_PRECEDENCE) {
      for (const bucket of [
        "guarded",
        "partial",
        "blocked",
        "ungenerated",
      ] as GuardFlowBucket[]) {
        const { unmount } = renderPanel({
          flows: [{ ...ERROR_ONLY_FLOW, errors: 0, status, bucket }],
        });
        const row = within(
          screen.getByRole("list", { name: "Test inventory" }),
        ).getAllByRole("listitem")[0];
        expect(wordsIn(row), `${status} / ${bucket}`).toHaveLength(1);
        unmount();
      }
    }
  });

  it("reads a status this build never learned as Blocked — never blank", () => {
    // A payload from a newer server must still paint something a reader can act
    // on, and "attention needed" is the only safe guess.
    expect(guardPlainStatus("teleported" as GuardSectionCoverageStatus)).toBe(
      "blocked",
    );
    expect(guardStatusWord("teleported" as GuardSectionCoverageStatus)).toBe(
      "Blocked",
    );
  });

  it("shows the status word ONLY — the need and its reason are detail copy", () => {
    renderPanel({ flows: [...FLOWS, LONG_BLOCKED_FLOW] });
    const list = screen.getByRole("list", { name: "Test inventory" });
    const blocked = within(list)
      .getByText(LONG_BLOCKED_FLOW.title)
      .closest('[role="listitem"]')!;
    expect(wordsIn(blocked as HTMLElement)).toEqual(["Blocked"]);
    expect(
      within(list).queryByText(new RegExp("blocked on llm-provider")),
    ).not.toBeInTheDocument();
    expect(
      within(list).queryByText(/needs an LLM provider/),
    ).not.toBeInTheDocument();
    expect(
      within(list).queryByText(/needs API recipe/),
    ).not.toBeInTheDocument();
    expect(
      within(list).queryByText(/no code path mapped/),
    ).not.toBeInTheDocument();
    expect(
      within(list).queryByText(/awaiting web driver/),
    ).not.toBeInTheDocument();
    // The filter says the SAME word the chip says — one state, one word.
    expect(
      within(statusFilter()).getByRole("button", { name: /^Blocked \d+$/ }),
    ).toBeInTheDocument();
  });

  it("filters by plain status chips and by search", async () => {
    const user = userEvent.setup();
    renderPanel();
    // The shared list's ONE filter idiom: a count chip per status, never a
    // select — and the chips wear the five coverage words, nothing else.
    expect(
      within(statusFilter()).getByRole("button", { name: "Failed 1" }),
    ).toBeInTheDocument();
    expect(
      within(statusFilter()).getByRole("button", { name: "Blocked 2" }),
    ).toBeInTheDocument();
    expect(
      within(statusFilter()).getByRole("button", { name: "Never run 0" }),
    ).toBeInTheDocument();
    expect(
      within(statusFilter()).getByRole("button", { name: "Succeeded 1" }),
    ).toBeInTheDocument();
    expect(
      within(statusFilter()).getByRole("button", { name: "Not testable 0" }),
    ).toBeInTheDocument();

    await user.click(statusChip("Blocked"));
    expect(
      screen.getByText("A user exports the task list"),
    ).toBeInTheDocument();
    expect(screen.queryByText(FLOW_TITLE)).not.toBeInTheDocument();

    await user.click(statusChip("Failed"));
    expect(screen.getByText(FLOW_TITLE)).toBeInTheDocument();
    expect(
      screen.queryByText("A user exports the task list"),
    ).not.toBeInTheDocument();

    // Re-clicking the active chip clears the narrowing — the toggle-off rule.
    await user.click(statusChip("Failed"));
    await user.type(screen.getByLabelText("Search tests"), "exports");
    expect(
      screen.getByText("A user exports the task list"),
    ).toBeInTheDocument();
    expect(screen.queryByText(FLOW_TITLE)).not.toBeInTheDocument();
  });

  it("previews a flow on single click and pins it on double click", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    renderPanel({ onOpen });
    await user.click(screen.getByText(FLOW_TITLE));
    expect(onOpen).toHaveBeenCalledWith(`flow:${FLOW_ID}`, false);
    await user.dblClick(screen.getByText(FLOW_TITLE));
    expect(onOpen).toHaveBeenCalledWith(`flow:${FLOW_ID}`, true);
  });

  it("carries no recipe / last-generate footer — that story lives in the overview", () => {
    renderPanel();
    expect(screen.queryByText(/Recipe ·/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Last generate/)).not.toBeInTheDocument();
  });

  it("scrolls the selected row into view when the selection arrives with the view", () => {
    const scrolled: Element[] = [];
    const spy = vi
      .spyOn(Element.prototype, "scrollIntoView")
      .mockImplementation(function (this: Element) {
        scrolled.push(this);
      });
    renderPanel({ activeId: `flow:${FLOWS[1].flowId}` });
    expect(scrolled).toHaveLength(1);
    expect(scrolled[0].textContent).toContain(FLOWS[1].title);
    spy.mockRestore();
  });
});

// --- The MERGED detail: the flow, and the test that realizes it -------------

describe("GuardFlowDetail — the flow AND its test, on one page", () => {
  const renderDetail = (
    props: Partial<Parameters<typeof GuardFlowDetail>[0]> = {},
  ) =>
    render(
      <GuardFlowDetail
        repoId="r"
        detail={DETAIL}
        onOpenSpec={() => {}}
        onOpenInterface={() => {}}
        {...props}
      />,
    );

  /** The why-no-test block — the read a surface with no test gets instead. */
  const whyNoTest = () =>
    screen.getByRole("group", { name: "Why there is no test yet" });

  it("reads the milestones as a plain list — one claim SENTENCE per row, in order", () => {
    renderDetail({ detail: NO_TEST_DETAIL });
    const list = screen.getByRole("list", { name: "Milestones" });
    const rows = within(list).getAllByRole("listitem");
    const claims = DETAIL.milestones.map((m) => m.claimTitle);
    expect(rows).toHaveLength(claims.length);
    for (const [i, claim] of claims.entries()) {
      expect(within(rows[i]).getByText(claim)).toBeInTheDocument();
      expect(
        within(rows[i]).getByText(String(DETAIL.milestones[i].order)),
      ).toBeInTheDocument();
    }
  });

  /**
   * The merge. A flow's chain has exactly ONE rendering on the page: the list when
   * there is no test, the step list's own group headers when there is. Two would
   * be the same milestones read twice, one of them detached from the steps that
   * prove them.
   */
  it("drops the standalone list once a test renders — the chain is the step list", async () => {
    renderDetail();
    expect(await screen.findByLabelText("test steps")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Milestones" })).toBeNull();
    // Not merely the list element: the word does not appear as a heading either.
    expect(screen.queryByText("Milestones")).toBeNull();
  });

  it("carries NO milestone state — the test’s verdict is the page’s one status", () => {
    renderDetail({ detail: NO_TEST_DETAIL });
    const list = screen.getByRole("list", { name: "Milestones" });
    // The second milestone's section drifted and the flow has a committed test:
    // neither fact paints a row, because a milestone has no state of its own.
    for (const word of [
      "settled",
      "drifted",
      "awaiting",
      "gap",
      "not reached",
    ]) {
      expect(within(list).queryByText(new RegExp(word, "i"))).toBeNull();
    }
    // No colour either: nothing in the list carries a verdict paint, and no row
    // hides a state in a title attribute the way the retired glyphs did.
    for (const row of within(list).getAllByRole("listitem")) {
      expect(row.innerHTML).not.toMatch(/(red|emerald)-\d{2,3}/);
    }
  });

  it("jumps from a milestone to the spec section that states it", async () => {
    const user = userEvent.setup();
    const onOpenSpec = vi.fn();
    renderDetail({ detail: NO_TEST_DETAIL, onOpenSpec });
    const rows = within(
      screen.getByRole("list", { name: "Milestones" }),
    ).getAllByRole("listitem");
    for (const [i, row] of rows.entries()) {
      expect(
        within(row).getByText(`§ ${DETAIL.milestones[i].headingText}`),
      ).toBeInTheDocument();
    }
    await user.click(
      within(rows[2]).getByText(`§ ${DETAIL.milestones[2].headingText}`),
    );
    expect(onOpenSpec).toHaveBeenCalledWith(DOC, "tasks/completing-tasks");
  });

  it("IS the test: the flow header, then the whole test detail", async () => {
    renderDetail();
    // The flow's own header — title, goal, one status word.
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      FLOW_TITLE,
    );
    expect(screen.getByText(DETAIL.goal)).toBeInTheDocument();
    // …and then everything the test detail used to carry on a tab of its own.
    expect(screen.queryByText("What it checks")).toBeNull();
    expect(screen.getByText(DETAIL.surfaces[0].title!)).toBeInTheDocument();
    expect(screen.getByText("Verdict")).toBeInTheDocument();
    expect(await screen.findByLabelText("test steps")).toBeInTheDocument();
    expect(screen.getByText("Visual evidence")).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Interfaces used by this flow" }),
    ).toBeInTheDocument();
    // There is no list of surface ROWS any more — nothing to click through to.
    expect(screen.queryByRole("list", { name: "Tests" })).toBeNull();
  });

  it("names a surface ONLY when there is a second one to tell it apart from", () => {
    renderDetail();
    // This fixture has two (cli + a web gap), so each block is labelled.
    expect(screen.getByText("CLI")).toBeInTheDocument();
    expect(screen.getByText("Web")).toBeInTheDocument();
    // Never "CLI test" — the surface is a plain label, never a chip and never a
    // lead line pretending to be a status.
    expect(screen.queryByText("CLI test")).toBeNull();
  });

  it("renders EVERY committed test, not just the first — a second surface is never dropped", async () => {
    // The corpus produces one test per flow today. The shape allows more, and a
    // surface whose test rendered as nothing would be a silent hole in the page.
    renderDetail({
      detail: {
        ...DETAIL,
        surfaces: [
          DETAIL.surfaces[0],
          {
            ...DETAIL.surfaces[0],
            surface: "api",
            scenarioId: "task-lifecycle.api.1",
            title: "The API creates and lists a task",
          },
        ],
      },
    });
    expect(screen.getByText(DETAIL.surfaces[0].title!)).toBeInTheDocument();
    expect(
      screen.getByText("The API creates and lists a task"),
    ).toBeInTheDocument();
    // Each is a whole test, under its own plain surface label.
    expect(await screen.findAllByLabelText("test steps")).toHaveLength(2);
    expect(screen.getByText("CLI")).toBeInTheDocument();
    expect(screen.getByText("API")).toBeInTheDocument();
  });

  it("a single-surface flow carries no surface label at all — the page IS the test", () => {
    renderDetail({ detail: BIRTH_FAILED_DETAIL });
    expect(screen.queryByText("CLI")).toBeNull();
    expect(screen.queryByText("CLI test")).toBeNull();
  });

  it("says why a surface with NO test has none — the state, then the sentence", () => {
    renderDetail();
    const why = whyNoTest();
    expect(within(why).getByText("Blocked")).toBeInTheDocument();
    expect(within(why).getByText("Awaiting web driver.")).toBeInTheDocument();
    // The generator's raw reason never reaches it.
    expect(
      within(why).queryByText(/the board is browser-only/),
    ).not.toBeInTheDocument();
  });

  /**
   * THE anti-drift lock. Words come from ONE module; `guard-status.ts` holds
   * colour and reads its label/hint from there. If anyone re-introduces a second
   * label table, these two resolve differently and this fails.
   */
  it("resolves every status to the SAME label in both former label sources", () => {
    for (const status of GUARD_COVERAGE_STATUS_PRECEDENCE) {
      expect(guardStatusMeta(status).label, status).toBe(
        guardStatusLabel(status),
      );
      expect(guardStatusMeta(status).hint, status).toBe(
        guardStatusHint(status),
      );
    }
    // The state the review caught: `blocked-on` IS the plain word, everywhere.
    expect(guardStatusLabel("blocked-on")).toBe(GUARD_FLOW_STATUS_WORD.blocked);
    expect(guardStatusWord("blocked-on")).toBe("Blocked");
    // …and every status wears one of the five, whatever its own label says.
    for (const status of GUARD_COVERAGE_STATUS_PRECEDENCE) {
      expect(Object.values(GUARD_FLOW_STATUS_WORD), status).toContain(
        guardStatusWord(status),
      );
    }
  });

  it("says the SAME word in the list chip and the detail header", () => {
    const { unmount } = render(<FlowsPanelHarness flows={[CONFLICTS_FLOW]} />);
    const row = within(
      screen.getByRole("list", { name: "Test inventory" }),
    ).getAllByRole("listitem")[0];
    expect(within(row as HTMLElement).getByText("Blocked")).toBeInTheDocument();
    expect(
      within(row as HTMLElement).queryByText("Needs setup"),
    ).not.toBeInTheDocument();
    unmount();

    renderDetail({ detail: CONFLICTS_DETAIL });
    // The header wears the same word; "Needs setup" is never a STATUS.
    expect(screen.getAllByText("Blocked").length).toBeGreaterThan(0);
    expect(screen.queryByText(/^Needs setup$/i)).not.toBeInTheDocument();
  });

  it("a why-no-test block is NOT test-shaped: muted, unclickable, one plain sentence", () => {
    renderDetail({ detail: CONFLICTS_DETAIL });
    const why = whyNoTest();
    // The status word, then the WHY as its own sentence — needs joined with "and".
    expect(within(why).getByText("Blocked")).toBeInTheDocument();
    expect(
      within(why).getByText("Needs credentials and network access."),
    ).toBeInTheDocument();
    // Nothing about it invites a click, and none of the test's own furniture is
    // faked around it: no verdict card, no steps, no evidence.
    expect(why.tagName).not.toBe("BUTTON");
    expect(why.querySelector("button")).toBeNull();
    expect(why.className).not.toMatch(/hover:|cursor-pointer/);
    expect(screen.queryByText("Verdict")).toBeNull();
    expect(screen.queryByLabelText("test steps")).toBeNull();
  });

  /**
   * ONE artifact switch for one entity. With a test, the stored truth a developer
   * opens is the test's YAML; with none, it is the flow's own entry in
   * `scenarios/flows.json`. Two readings, never three, and never two switches.
   */
  it("switches between the page and the test\u2019s YAML, defaulting to the page", async () => {
    const user = userEvent.setup();
    renderDetail();

    const modes = screen.getByRole("group", { name: "View mode" });
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
    await waitFor(() =>
      expect(screen.getByLabelText("test source")).toHaveTextContent(
        SCENARIO_ID,
      ),
    );
    // The stored file REPLACES the page — never two readings at once.
    expect(screen.queryByText("What it checks")).toBeNull();
    expect(screen.queryByText("Verdict")).toBeNull();

    await user.click(within(modes).getByRole("button", { name: "View" }));
    expect(screen.getByText("Verdict")).toBeInTheDocument();
  });

  it("offers the FLOW entry instead when the flow has no test to show", async () => {
    const user = userEvent.setup();
    renderDetail({ detail: NOT_ATTEMPTED_DETAIL });
    const modes = screen.getByRole("group", { name: "View mode" });
    expect(
      within(modes)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["View", "JSON"]);
    await user.click(within(modes).getByRole("button", { name: "JSON" }));
    await waitFor(() =>
      expect(screen.getByLabelText("flow source")).toHaveTextContent(
        "sha256:41ac",
      ),
    );
  });

  it("reads its interfaces through the TEST that walks them — never a second list", () => {
    // The scenario body draws each interface the test grounds on. A flow-level list
    // of the same ids beside it would be the same fact told twice.
    renderDetail();
    expect(
      screen.getByRole("region", { name: "Interfaces used by this flow" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Interfaces")).toBeNull();
  });

  it("keeps the flow-level interface list for a flow with no test at all", () => {
    renderDetail({
      detail: {
        ...NOT_ATTEMPTED_DETAIL,
        interfaceIds: ["cli/tasks-add", "cli/tasks-list"],
      },
    });
    const interfaces = screen.getByText("Interfaces").parentElement!;
    expect(interfaces.querySelectorAll("button")).toHaveLength(2);
  });

  it("has NO gaps block, NO findings block and NO authoring-errors block", () => {
    renderDetail({
      detail: {
        ...DETAIL,
        errors: [
          {
            doc: DOC,
            anchor: "tasks/creating-tasks",
            message: "authoring blew up",
          },
        ],
      },
    });
    expect(screen.queryByText("Gaps")).not.toBeInTheDocument();
    expect(screen.queryByText(/^Findings$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Authoring errors/)).not.toBeInTheDocument();
    expect(screen.queryByText(/authoring blew up/)).not.toBeInTheDocument();
  });

  it('says a flow whose authoring never finished will retry — never "Failing"', () => {
    renderDetail({ detail: ERROR_ONLY_DETAIL });
    const why = whyNoTest();
    expect(
      within(why).getByText(
        /Couldn’t create the test — will retry next generate/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Failing")).not.toBeInTheDocument();
  });

  /**
   * WHY authoring could not write a test is information no sentence carries, so the
   * run's own words ride inside the row — deduped by message shape with an attempt
   * count, never N near-identical rows.
   */
  it("lists an authoring-error row’s reasons ONCE each, with how many attempts hit them", () => {
    renderDetail({
      detail: {
        ...ERROR_ONLY_DETAIL,
        errors: [
          {
            doc: "README.md",
            anchor: "analyze",
            kind: "authoring",
            surface: "cli",
            message:
              "authoring (cli) call failed: claude timed out after 600000ms",
          },
          {
            doc: "README.md",
            anchor: "analyze",
            kind: "authoring",
            surface: "cli",
            message:
              "authoring (cli) call failed: claude timed out after 600000ms",
          },
          {
            doc: "README.md",
            anchor: "analyze",
            kind: "authoring",
            surface: "cli",
            message: "authoring (cli) output invalid after re-ask: bad shape",
          },
          // Another surface's failure never leaks into this row.
          {
            doc: "README.md",
            anchor: "analyze",
            kind: "authoring",
            surface: "api",
            message: "authoring (api) call failed: transport exploded",
          },
        ],
      },
    });
    const why = whyNoTest();

    // The two timeouts fold into ONE reason, counted twice; the invalid output is
    // its own reason, counted once.
    expect(within(why).getAllByText(/timed out after 600000ms/)).toHaveLength(
      1,
    );
    expect(within(why).getByText("2 attempts")).toBeInTheDocument();
    expect(
      within(why).getByText(/output invalid after re-ask/),
    ).toBeInTheDocument();
    expect(within(why).getByText("1 attempt")).toBeInTheDocument();
    expect(
      within(why).queryByText(/transport exploded/),
    ).not.toBeInTheDocument();
  });

  it("shows no reasons on a block that is not an authoring error", () => {
    renderDetail({ detail: NOT_ATTEMPTED_DETAIL });
    expect(
      within(whyNoTest()).queryByText(/\d+ attempt/),
    ).not.toBeInTheDocument();
  });

  /**
   * The opposite promise, for the opposite fact: the run was REFUSED — declined from
   * configuration before anything was built or executed. "Will retry next generate"
   * is false there (every re-run is declined identically), and it is exactly what the
   * flow page said for a run that produced zero tests across the whole corpus.
   */
  it("says what BLOCKED a flow when the run was refused — never the retry sentence", () => {
    const message =
      "external service hit-pay is only partly configured: no key was resolved.";
    renderDetail({
      detail: {
        ...ERROR_ONLY_DETAIL,
        errors: [
          { doc: "(guard run)", anchor: "(refused)", kind: "refusal", message },
        ],
      },
    });
    const why = whyNoTest();
    expect(
      within(why).getByText(/Nothing could be tested/),
    ).toBeInTheDocument();
    expect(
      within(why).getByText(/hit-pay is only partly configured/),
    ).toBeInTheDocument();
    expect(
      within(why).queryByText(/will retry next generate/),
    ).not.toBeInTheDocument();
  });

  /**
   * A flow nothing has been attempted for yet — no test, no gap, no error. It used
   * to fall through to a bare line of prose ("Nothing tests this flow yet."), which
   * is neither a status nor a next step; it now reads as the same row every other
   * surface gets.
   */
  it("says a flow nothing was attempted for is blocked — never a bare line", () => {
    renderDetail({ detail: NOT_ATTEMPTED_DETAIL });
    const why = whyNoTest();
    expect(within(why).getByText("Blocked")).toBeInTheDocument();
    expect(within(why).queryByText("Not generated")).not.toBeInTheDocument();
    expect(
      within(why).getByText(
        /No test yet — will be attempted on the next generate/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Nothing tests this flow yet/),
    ).not.toBeInTheDocument();
    // The retry sentence belongs to an authoring that RAN — nothing ran here.
    expect(
      within(why).queryByText(/will retry next generate/),
    ).not.toBeInTheDocument();
  });

  it("reads a test that failed its birth execution right here — no click-through", async () => {
    renderDetail({ detail: BIRTH_FAILED_DETAIL });
    // The verdict, in the birth wording, with the failing step open beneath it.
    expect(screen.getByText("failed (birth)")).toBeInTheDocument();
    // Its title is the flow's here (the fixture's test carries the same sentence).
    expect(
      screen.getAllByText(BIRTH_FAILED_DETAIL.surfaces[0].title!).length,
    ).toBeGreaterThan(0);
    expect(await screen.findByLabelText("test steps")).toBeInTheDocument();
    expect(screen.getByText("timed out after 120s")).toBeInTheDocument();
  });

  /**
   * The hollow-page fix: a flow the specs no longer derive has no goal and no
   * milestones BY NATURE. One sentence takes the goal's place and says why; its
   * test still reads and clicks like any other.
   */
  it("says why a flow the specs no longer derive is empty — where the goal would be", async () => {
    renderDetail({ detail: UNDERIVED_DETAIL });

    expect(
      screen.getByText(
        "No longer derived from your specs — kept because its test still runs.",
      ),
    ).toBeInTheDocument();
    // It replaces the goal, so it sits in the header. There is no chain to draw…
    expect(screen.queryByText("Milestones")).not.toBeInTheDocument();
    // …and its test still reads exactly like any other flow's.
    expect(screen.getByText("Purged tasks leave the list")).toBeInTheDocument();
    expect(screen.getByText("passed")).toBeInTheDocument();
    expect(await screen.findByLabelText("test steps")).toBeInTheDocument();
  });

  /** The detail carries BOTH halves: the chip that marks it, the sentence that
   *  explains it. Neither replaces the other (round-5). */
  it("marks the header of a flow the specs no longer derive, and keeps the sentence", () => {
    renderDetail({ detail: UNDERIVED_DETAIL });
    const chip = screen.getByText("Not in specs");
    // The header's chip row — the same one the status chip sits in.
    expect(
      within(chip.parentElement!).getByText("Succeeded"),
    ).toBeInTheDocument();
    expect(chip.className).not.toMatch(/emerald|red|amber|sky|zinc/);
    expect(
      screen.getByText(
        "No longer derived from your specs — kept because its test still runs.",
      ),
    ).toBeInTheDocument();
  });

  it("never explains a flow the specs DO derive", () => {
    renderDetail();
    expect(screen.getByText(DETAIL.goal)).toBeInTheDocument();
    expect(
      screen.queryByText(/No longer derived from your specs/),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Not in specs")).not.toBeInTheDocument();
  });

  it("has no way OUT to a test — the flow IS its one home", () => {
    renderDetail();
    // The footer names the file and the id; it never offers a second destination
    // for the thing already on the page.
    expect(screen.getByText(SCENARIO_ID)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /open this test/i }),
    ).toBeNull();
    expect(screen.queryByText("Flow")).toBeNull();
  });

  it("renders the milestone list without a scroll container of its own", () => {
    render(
      <GuardFlowDetail
        repoId="r"
        detail={{
          ...NO_TEST_DETAIL,
          milestones: Array.from({ length: 12 }, (_, i) => ({
            ...DETAIL.milestones[0],
            order: i + 1,
            claimTitle: `Milestone claim ${i + 1}`,
          })),
        }}
        onOpenSpec={() => {}}
        onOpenInterface={() => {}}
      />,
    );
    const list = screen.getByRole("list", { name: "Milestones" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(12);
    // The list itself clips nothing — the pane it sits in owns the scrolling.
    const listRoot = list.parentElement!;
    for (let el: HTMLElement | null = list; el; el = el.parentElement) {
      expect(el.className).not.toMatch(/overflow-(auto|hidden|scroll|x-|y-)/);
      expect(el.className).not.toMatch(/(^|\s)(max-)?h-\d/);
      if (el === listRoot) break;
    }
  });
});

// --- The pane: tabs and deep links -----------------------------------------

/**
 * The whole surface as the page wires it: the list, the pane, and the shared tab
 * reducer. No recipe here — preparation is per-surface, and it is read on the
 * Interfaces tab beside the surface it prepares.
 */
function FlowsHarness({
  flows = FLOWS,
  recipe = VIEW.recipe,
}: {
  flows?: GuardFlowListItem[];
  recipe?: GuardFlowsView["recipe"];
}) {
  const tabs = useGuardFlowTabs("r");
  const loc = useLocation();
  // The list's narrowings are owned above the panel, as the page owns them.
  const [filter, setFilter] = useState<GuardFlowFilter>("all");
  const [drivers, setDrivers] = useState<string[]>([]);
  return (
    <div>
      <span data-testid="search">{loc.search}</span>
      <div data-testid="panel">
        <GuardFlowsPanel
          flows={flows}
          loading={false}
          error={null}
          activeId={tabs.activeId}
          filter={filter}
          onFilter={setFilter}
          drivers={drivers}
          onDrivers={setDrivers}
          onOpen={tabs.open}
        />
      </div>
      <GuardFlowsPane
        repoId="r"
        view={{ ...VIEW, flows, recipe }}
        loading={false}
        error={null}
        tabs={tabs}
        onOpenSpec={() => {}}
        onOpenInterface={() => {}}
      />
    </div>
  );
}

const renderPane = (
  url = "/repos/r?tab=guardflows",
  props: Partial<Parameters<typeof FlowsHarness>[0]> = {},
) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <FlowsHarness {...props} />
    </MemoryRouter>,
  );

const search = () => screen.getByTestId("search").textContent ?? "";

describe("GuardFlowsPane — tabs and deep links", () => {
  it("opening a flow from the panel mirrors ?gflow and renders its detail", async () => {
    const user = userEvent.setup();
    renderPane();
    await user.click(within(screen.getByTestId("panel")).getByText(FLOW_TITLE));
    expect(search()).toContain(`gflow=${FLOW_ID}`);
    expect(await screen.findByLabelText("test steps")).toBeInTheDocument();
  });

  it("a ?gflow deep link lands on the merged detail — the flow AND its test", async () => {
    renderPane(`/repos/r?tab=guardflows&gflow=${FLOW_ID}`);
    expect(await screen.findByRole("heading", { level: 2 })).toHaveTextContent(
      FLOW_TITLE,
    );
    expect(screen.getAllByText(DETAIL.goal)).toHaveLength(2);
    // The test is right there, not one click away.
    expect(await screen.findByLabelText("test steps")).toBeInTheDocument();
  });

  it('rests on "pick a flow" when no tab is open — no second thing to read', () => {
    renderPane();
    expect(screen.getByText("Select a test")).toBeInTheDocument();
    // The corpus, its counts and its narrowing are the LIST's, and only the
    // list's: this pane offers no Overview destination to disagree with it.
    expect(
      screen.queryByRole("group", { name: "Flow filters" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Overview")).not.toBeInTheDocument();
  });
});

// --- The retired TEST addresses are not addresses any more ------------------

describe("a retired test address selects nothing", () => {
  for (const param of ["gtest", "gscn"] as const) {
    it(`?${param}= opens no flow — the pane is simply at rest`, async () => {
      renderPane(`/repos/r?tab=guardflows&${param}=${SCENARIO_ID}`);
      // A test has no address of its own now: nothing resolves it to a flow…
      expect(screen.getByText("Select a test")).toBeInTheDocument();
      await waitFor(() => expect(search()).not.toContain("gflow="));
      // …and nothing rewrites the URL behind the reader's back either.
      expect(screen.queryByLabelText("test steps")).toBeNull();
    });
  }

  it("leaves picking a flow entirely to the list", async () => {
    const user = userEvent.setup();
    renderPane(`/repos/r?tab=guardflows&gtest=${SCENARIO_ID}`);
    await user.click(within(screen.getByTestId("panel")).getByText(FLOW_TITLE));
    expect(search()).toContain(`gflow=${FLOW_ID}`);
    expect(await screen.findByLabelText("test steps")).toBeInTheDocument();
  });
});

// --- The recipe is NOT here -------------------------------------------------

describe("the Tests list carries no recipe", () => {
  it("offers no preparation affordance at all — that reading moved to Interfaces", () => {
    renderPane();
    const panel = screen.getByTestId("panel");
    // Not an opener, not a toolbar row, not a body: a recipe is per-SURFACE, and
    // the Interfaces catalog's surface groups are where each one is opened.
    expect(within(panel).queryByRole("button", { name: /recipe/i })).toBeNull();
    expect(screen.queryByRole("region", { name: "Recipe" })).toBeNull();
  });
});

// --- The FLOW dismissal ----------------------------------------------------
//
// The flow is the ONE manual dismissal unit. The round trip runs through the
// real `useGuardDecisions` hook against stubbed routes, so the panel marker, the
// detail ruling and the two writes are proven as one wiring rather than three
// mocks agreeing with each other.

function DismissHarness() {
  const tabs = useGuardFlowTabs("r");
  const [filter, setFilter] = useState<GuardFlowFilter>("all");
  const decisions = useGuardDecisions("r", true);
  return (
    <div>
      <div data-testid="panel">
        <GuardFlowsPanel
          flows={FLOWS}
          loading={false}
          error={null}
          activeId={tabs.activeId}
          filter={filter}
          onFilter={setFilter}
          drivers={[]}
          onDrivers={() => {}}
          onOpen={tabs.open}
          dismissedFlowIds={decisions.dismissedFlowIds}
        />
      </div>
      <GuardFlowsPane
        repoId="r"
        view={VIEW}
        loading={false}
        error={null}
        tabs={tabs}
        decisions={decisions}
        onOpenSpec={() => {}}
        onOpenInterface={() => {}}
      />
    </div>
  );
}

describe("flow dismissal — the one manual unit", () => {
  /** The decisions file the stubbed routes read and write. */
  let dismissedFlows: {
    flowId: string;
    title: string;
    note?: string;
    dismissedAt: string;
  }[];
  let calls: { url: string; body: unknown }[];

  beforeEach(() => {
    dismissedFlows = [];
    calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        const u = String(url);
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        if (u.includes("/guard/flows/dismiss")) {
          calls.push({ url: u, body });
          dismissedFlows = [
            ...dismissedFlows.filter((f) => f.flowId !== body.flowId),
            { ...body, dismissedAt: "2026-07-31T00:00:00.000Z" },
          ];
          return json({ version: 1, dismissedClaims: [], dismissedFlows });
        }
        if (u.includes("/guard/flows/undismiss")) {
          calls.push({ url: u, body });
          dismissedFlows = dismissedFlows.filter(
            (f) => f.flowId !== body.flowId,
          );
          return json({ version: 1, dismissedClaims: [], dismissedFlows });
        }
        if (u.includes("/guard/decisions"))
          return json({ version: 1, dismissedClaims: [], dismissedFlows });
        if (u.includes("/guard/flows/")) return json(DETAIL);
        return json({});
      }),
    );
  });

  const renderHarness = () =>
    render(
      <MemoryRouter
        initialEntries={[`/repos/r?tab=guardflows&gflow=${FLOW_ID}`]}
      >
        <DismissHarness />
      </MemoryRouter>,
    );

  it("rules the flow out from its detail, and the list row says so without a re-generate", async () => {
    const user = userEvent.setup();
    renderHarness();
    // Nothing is dismissed yet: no marker on the row, and the ruling is offered.
    const panel = screen.getByTestId("panel");
    expect(within(panel).queryByText("Dismissed")).not.toBeInTheDocument();
    await user.click(
      await screen.findByRole("button", { name: /Don’t test this flow/ }),
    );

    // The detail now explains the consequence and offers the undo…
    expect(
      await screen.findByRole("button", { name: "Un-dismiss" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/drops this flow and deletes its tests/),
    ).toBeInTheDocument();
    // …and the LIST row wears the marker immediately — the ruling is a decision,
    // not a run, so nothing waits on the engine.
    expect(within(panel).getByText("Dismissed")).toBeInTheDocument();

    // The write carried the flow's identity AND its display copy.
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/guard/flows/dismiss");
    expect(calls[0].body).toEqual({ flowId: FLOW_ID, title: DETAIL.title });
  });

  it("un-dismisses back to the offered ruling", async () => {
    const user = userEvent.setup();
    dismissedFlows = [
      {
        flowId: FLOW_ID,
        title: DETAIL.title,
        note: "not a user path",
        dismissedAt: "2026-07-30T00:00:00.000Z",
      },
    ];
    renderHarness();
    // The recorded rationale rides with the state, so the undo is an informed one.
    expect(await screen.findByText("not a user path")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Un-dismiss" }));

    expect(
      await screen.findByRole("button", { name: /Don’t test this flow/ }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("panel")).queryByText("Dismissed"),
    ).not.toBeInTheDocument();
    expect(calls[0].body).toEqual({ flowId: FLOW_ID });
  });

  // The dismissal is a decision about whether to TEST the flow, never a verdict
  // on whether it passes — so the status chip beside the marker is untouched.
  it("never replaces the flow status — the marker sits beside it", async () => {
    renderHarness();
    await screen.findByRole("button", { name: /Don’t test this flow/ });
    const row = within(screen.getByTestId("panel")).getAllByRole("listitem")[0];
    expect(row.textContent).toContain(GUARD_FLOW_STATUS_WORD.failed);
  });

  // Without the decisions state (guard reads gated, an unresolved PR scope) the
  // ruling is not merely disabled — it is absent.
  it("offers no ruling at all when the pane has no decisions state", async () => {
    render(
      <MemoryRouter
        initialEntries={[`/repos/r?tab=guardflows&gflow=${FLOW_ID}`]}
      >
        <FlowsHarness />
      </MemoryRouter>,
    );
    await screen.findByLabelText("test steps");
    expect(
      screen.queryByRole("button", { name: /Don’t test this flow/ }),
    ).not.toBeInTheDocument();
  });
});

// --- The overview IS the list's filter dashboard ----------------------------

/**
 * A flow blocked on a third party the user CAN provide — the same `blocked-on`
 * gap kind, promoted by the read model to `needs-setup` because the externals
 * view knows `open-meteo` and it is unprovided.
 */
const NEEDS_SETUP_FLOW: GuardFlowListItem = {
  flowId: "fetch-the-forecast-for-a-place",
  title: "A visitor fetches the forecast for a place",
  goal: "Answer with the upstream forecast",
  status: "needs-setup",
  bucket: "blocked",
  epic: false,
  composedOf: [],
  manual: false,
  milestoneCount: 2,
  sectionCount: 1,
  docs: ["docs/SPEC.md"],
  surfaces: [
    {
      surface: "api",
      status: "needs-setup",
      gap: {
        kind: "blocked-on",
        reason:
          "blocked on open-meteo: the forecast comes from the upstream service",
        label: "blocked-on",
        needsSetup: { services: ["open-meteo"], provided: [] },
      },
    },
  ],
  findings: 0,
  toolDefects: 0,
  errors: 0,
  interfaceDrifted: false,
};

/** A corpus with every state on it — failing, needs-setup, blocked, not
 *  generated, passing, and one flow the specs no longer derive. */
const MIXED_FLOWS: GuardFlowListItem[] = [
  ...FLOWS,
  BIRTH_FAILED_FLOW,
  ERROR_ONLY_FLOW,
  NEEDS_SETUP_FLOW,
  UNDERIVED_FLOW,
];

/**
 * The list's own narrowing, over a corpus carrying every state. The Flows tab has
 * ONE control for this — the panel's filter bar — so a count and the rows it
 * promises can no longer be two surfaces disagreeing: they are one.
 */
describe("GuardFlowsPanel — the filter chips over the whole corpus", () => {
  const renderMixed = () => render(<FlowsPanelHarness flows={MIXED_FLOWS} />);

  // A filter that matches nothing renders the empty state instead of a list, so
  // the absent list IS zero rows — the count a 0-chip promises.
  const listRows = () => {
    const list = screen.queryByRole("list", { name: "Test inventory" });
    return list ? within(list).queryAllByRole("listitem") : [];
  };
  /** The status keys the bar offers — every one but the total (no narrowing). */
  const KEYS = GUARD_FLOW_FILTER_ORDER.filter((k) => k !== "all");

  it("counts the corpus in the list vocabulary — one chip per status, no total", () => {
    renderMixed();
    // The five words, worst-first, then the one non-status marker. A providable
    // third party and a flow generate never reached are both Blocked: they are
    // to-dos, and WHICH to-do is what the detail says. There is no "all" chip —
    // an empty selection IS every flow.
    expect(
      within(statusFilter())
        .getAllByRole("button")
        .map((c) => c.textContent),
    ).toEqual([
      "Failed 2",
      "Blocked 4",
      "Never run 0",
      "Succeeded 2",
      "Not testable 0",
      "Not in specs 1",
    ]);
  });

  it("every chip count EQUALS the rows clicking it shows", async () => {
    const user = userEvent.setup();
    renderMixed();
    for (const key of KEYS) {
      const label = GUARD_FLOW_FILTER_LABEL[key];
      const chip = statusChip(label);
      const count = Number(chip.textContent?.match(/\d+$/)?.[0]);
      await user.click(chip);
      expect(listRows(), label).toHaveLength(count);
      expect(statusChip(label).getAttribute("aria-pressed"), label).toBe(
        "true",
      );
    }
  });

  it("clearing the selection restores the whole corpus", async () => {
    const user = userEvent.setup();
    renderMixed();
    await user.click(statusChip(GUARD_FLOW_FILTER_LABEL.failed));
    expect(listRows()).toHaveLength(2);
    await user.click(within(statusFilter()).getByText("clear"));
    expect(listRows()).toHaveLength(MIXED_FLOWS.length);
    expect(
      within(statusFilter())
        .getAllByRole("button")
        .filter((b) => b.getAttribute("aria-pressed") === "true"),
    ).toHaveLength(0);
  });
});

/**
 * The DRIVER narrowing — what a test actually drives, off the wire: the step kinds
 * its scenario uses. A MIXED test (cli steps and web steps in one scenario) is
 * both, so it answers either chip and there is no third "mixed" word: mixed is not
 * a surface anybody tests on.
 */
const driverFlow = (
  flowId: string,
  title: string,
  drivers: GuardFlowListItem["drivers"],
): GuardFlowListItem => ({
  flowId,
  title,
  goal: `${title} — the goal`,
  status: "pass",
  bucket: "guarded",
  epic: false,
  composedOf: [],
  manual: false,
  milestoneCount: 1,
  sectionCount: 1,
  docs: [DOC],
  surfaces: [],
  ...(drivers ? { drivers } : {}),
  findings: 0,
  toolDefects: 0,
  errors: 0,
  interfaceDrifted: false,
});

const DRIVER_FLOWS: GuardFlowListItem[] = [
  driverFlow("cli-only", "A user runs the command", ["cli"]),
  driverFlow("api-only", "A client calls the endpoint", ["api"]),
  driverFlow("mixed", "A user clicks through, then checks the CLI", [
    "cli",
    "web",
  ]),
  // A flow no test realizes yet drives nothing — it is in the list, and no chip
  // may claim it.
  driverFlow(
    "nothing-yet",
    "A user does something nobody has tested",
    undefined,
  ),
];

describe("GuardFlowsPanel — the driver chips", () => {
  const renderDrivers = () =>
    render(<FlowsPanelHarness flows={DRIVER_FLOWS} />);
  const driverFilter = () =>
    screen.getByRole("group", { name: "Filter by driver" });
  const driverChip = (label: string) =>
    within(driverFilter()).getByRole("button", {
      name: new RegExp(`^${label} \\d+$`),
    });
  const rowTitles = () => {
    const list = screen.queryByRole("list", { name: "Test inventory" });
    return list
      ? within(list)
          .getAllByRole("listitem")
          .map((row) => row.querySelector("span")?.textContent ?? "")
      : [];
  };

  it("offers a chip per driver the corpus HAS, counted by the same predicate", () => {
    renderDrivers();
    // A mixed test is counted under BOTH of its drivers — the counts are of rows
    // the chip keeps, not a partition of the corpus.
    expect(
      within(driverFilter())
        .getAllByRole("button")
        .map((c) => c.textContent),
    ).toEqual(["CLI 2", "API 1", "Web 1"]);
  });

  it("narrows to the driver clicked, and a mixed test answers EITHER chip", async () => {
    const user = userEvent.setup();
    renderDrivers();

    await user.click(driverChip("Web"));
    expect(rowTitles()).toEqual(["A user clicks through, then checks the CLI"]);

    // Multi-select: the second chip UNIONS, it does not intersect — the mixed
    // test is not counted twice, and the cli-only one joins it.
    await user.click(driverChip("CLI"));
    expect(rowTitles()).toEqual([
      "A user clicks through, then checks the CLI",
      "A user runs the command",
    ]);

    await user.click(within(driverFilter()).getByText("clear"));
    expect(rowTitles()).toHaveLength(DRIVER_FLOWS.length);
  });

  it("narrows by status AND driver at once — two questions, two bars", async () => {
    const user = userEvent.setup();
    render(<FlowsPanelHarness flows={[...DRIVER_FLOWS, BIRTH_FAILED_FLOW]} />);
    await user.click(statusChip(GUARD_FLOW_STATUS_WORD.succeeded));
    await user.click(driverChip("API"));
    expect(rowTitles()).toEqual(["A client calls the endpoint"]);
  });
});

// --- The Runs tab: a result is an INSTANCE of its flow ----------------------

const RUN_FLOW: GuardRunFlow = {
  flowId: FLOW_ID,
  title: FLOW_TITLE,
  goal: "Create, list, complete and filter a task from the CLI",
  epic: false,
  milestones: DETAIL.milestones.map((m) => ({
    order: m.order,
    doc: m.doc,
    anchor: m.anchor,
    claimTitle: m.claimTitle,
  })),
};

const FAILED_RESULT: GuardScenarioResult = {
  id: SCENARIO_ID,
  title: "Tasks are created, listed newest-first, completed and filterable",
  binds: { doc: DOC, section: "tasks/creating-tasks", fingerprint: "sha256:x" },
  outcome: "fail",
  durationMs: 412,
  failure: {
    step: 3,
    expected: "exit 0",
    actual: "exit 1: unknown command `done`",
  },
  evidencePath: `.truecourse/guard/evidence/${RUN_ID}/${SCENARIO_ID}`,
  flowId: FLOW_ID,
  failedMilestone: 3,
  interfaceDrifted: true,
};

describe("GuardDriftDetail — the run’s own record", () => {
  const renderRun = (
    scenario: GuardScenarioResult,
    runFlow: GuardRunFlow | null = RUN_FLOW,
    onOpenFlow?: (id: string) => void,
  ) =>
    render(
      <GuardDriftDetail
        repoId="r"
        scenario={scenario}
        runId={RUN_ID}
        runFlow={runFlow}
        onOpenSpec={() => {}}
        {...(onOpenFlow ? { onOpenFlow } : {})}
      />,
    );

  it("reads the failure where it happened — no milestone chain beside the verdict", async () => {
    renderRun(FAILED_RESULT);
    expect(screen.getByText(/Failed at step/)).toBeInTheDocument();
    expect(
      await screen.findByText("exit 1: unknown command `done`"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Interface drift/)).toBeInTheDocument();
    // The retired flow-instance paint: no chain, and no per-milestone state.
    expect(screen.queryByRole("list", { name: "Milestones" })).toBeNull();
    expect(screen.queryByText(/no milestone reached/i)).toBeNull();
  });

  it("opens IN PLACE and offers ONE link out — to the flow, the one entity home", async () => {
    const user = userEvent.setup();
    const onOpenFlow = vi.fn();
    renderRun(FAILED_RESULT, RUN_FLOW, onOpenFlow);
    // The run's own record is what renders — the transcript and steps stay here.
    expect(screen.getByLabelText("test steps")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /open this flow/ }));
    // It opens the FLOW itself: there is no test address left to resolve.
    expect(onOpenFlow).toHaveBeenCalledWith(FLOW_ID);
  });

  it("offers no link out when the result joined no flow — there is nothing to open", () => {
    renderRun({ ...FAILED_RESULT, flowId: undefined }, null, () => {});
    expect(screen.queryByRole("button", { name: /open this flow/ })).toBeNull();
  });

  it("is the SAME scenario rendering the merged flow detail uses, marked as this run\u2019s record", async () => {
    renderRun(FAILED_RESULT, RUN_FLOW, () => {});
    // Same skeleton, different feed: the provenance line is the only tell.
    expect(screen.getByText(`As of run ${RUN_ID}`)).toBeInTheDocument();
    expect(screen.queryByText("Latest state")).not.toBeInTheDocument();
    expect(screen.getByText("Verdict")).toBeInTheDocument();
    expect(await screen.findByLabelText("test steps")).toBeInTheDocument();
    // …and no surface pill: the merged model dropped them everywhere.
    expect(screen.queryByText("CLI test")).toBeNull();
  });

  it("claims nothing when the failure names no milestone (a plumbing failure)", () => {
    renderRun({
      ...FAILED_RESULT,
      failedMilestone: undefined,
      interfaceDrifted: undefined,
    });
    // The verdict names the step and nothing else — no milestone is credited.
    expect(screen.getByText(/Failed at step/)).toBeInTheDocument();
    expect(screen.queryByText(/milestone \d/i)).toBeNull();
    expect(screen.queryByText(/Interface drift/)).not.toBeInTheDocument();
  });

  // The verdict renders no annotation for a blocked precondition — the field is
  // still engine data (feeds other surfaces), but the test detail no longer says
  // anything about it beyond the failure itself.
  it("renders no setup annotation for a blocked precondition — just the failure", () => {
    renderRun({
      ...FAILED_RESULT,
      failedMilestone: undefined,
      interfaceDrifted: undefined,
      blockedPrecondition: true,
      failure: { step: 1, expected: "200", actual: "404" },
    });
    expect(screen.queryByText(/Setup failed/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Interface drift/)).not.toBeInTheDocument();
    // The outcome is untouched: the verdict still reads as a failure.
    expect(screen.getByText(/Failed at step/)).toBeInTheDocument();
  });

  it("says a pass in ONE place — the verdict, with no second reading beside it", () => {
    renderRun({
      ...FAILED_RESULT,
      outcome: "pass",
      failure: undefined,
      failedMilestone: undefined,
    });
    expect(screen.getByText("passed")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Milestones" })).toBeNull();
    expect(screen.queryByText(/Failed at step/)).toBeNull();
  });

  it("reads the same way when the run joined no flow at all", () => {
    renderRun({ ...FAILED_RESULT, flowId: undefined }, null);
    expect(
      screen.queryByRole("list", { name: "Milestones" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Failed at step/)).toBeInTheDocument();
  });
});
