/**
 * THE ACCEPTANCE SWEEP — no retired term may reach a reader.
 *
 * Guard's UI went through three review rounds whose single recurring complaint was
 * vocabulary: engine words (findings, grounds, scenarios, held, guarded, blocked-on)
 * leaking into copy a user reads. A grep would rot the moment someone re-words a
 * component, so the rule ships as a TEST: render the guard surfaces over a fixture
 * set that covers all four states, harvest everything a reader can actually see —
 * text nodes, aria-labels, titles, placeholders, hover copy — and assert no banned
 * term appears.
 *
 * Exempt by construction:
 *  - engine identifiers and wire field names (never rendered, never harvested);
 *  - DATA a test detail shows verbatim — the committed YAML, the run transcript,
 *    and the ids/paths the house style renders mono. A test file called
 *    `…scenario.yaml` is a fact about the repo, not UI copy.
 *
 * "birth" is deliberately NOT banned: it is the stage name a committed-red test
 * carries ("failed (birth)"), and the user kept it.
 *
 * The same rule, for COLOUR: guard paints from four colours (red / green / blue /
 * grey) and amber and orange are banned outright. They read as a third severity
 * between red and green, and guard makes no such distinction — a state is wrong, or
 * proven, or not yet, or nobody's to-do. The sweep below is STATIC (it reads the
 * guard sources), because a class that only renders in one branch is still a class
 * that can come back.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { GUARD_COVERAGE_STATUS_PRECEDENCE, GUARD_COVERAGE_STATUS_WORD } from '@truecourse/shared';
import type {
  GuardFlowDetail as GuardFlowDetailData,
  GuardFlowListItem,
  GuardInterfaceRow,
  GuardScenarioResult,
  GuardSectionCoverage,
  GuardSectionCoverageStatus,
} from '@truecourse/shared';
import { GuardFlowsPanel } from '@/components/guard/GuardFlowsPanel';
import { GuardFlowDetail } from '@/components/guard/GuardFlowDetail';
import { GuardRecipeDetail } from '@/components/guard/GuardRecipeDetail';
import { GuardDriftDetail } from '@/components/guard/GuardDriftDetail';
import { GuardDriftList } from '@/components/guard/GuardDriftList';
import { GuardInterfacesPane } from '@/components/guard/GuardInterfacesPane';
import { GuardInterfacesPanel } from '@/components/guard/GuardInterfacesPanel';
import { GuardSectionDetail } from '@/components/guard/GuardSectionDetail';
import { GuardStatusBadge } from '@/components/guard/GuardStatusBadge';
import { guardStatusMeta } from '@/lib/guard-status';
import type { GuardDecisionsState } from '@/hooks/useGuardDecisions';

/** A `GuardDecisionsState` stub — both dismissal tiers, overridden per case. */
function decisionsStub(over: Partial<GuardDecisionsState> = {}): GuardDecisionsState {
  return {
    dismissalFor: () => undefined,
    dismiss: async () => {},
    undismiss: async () => {},
    flowDismissal: () => undefined,
    dismissedFlowIds: new Set<string>(),
    dismissFlow: async () => {},
    undismissFlow: async () => {},
    ...over,
  };
}

// ---------------------------------------------------------------------------
// The banned list, exactly as the user wrote it.
// ---------------------------------------------------------------------------

const BANNED: { term: string; pattern: RegExp }[] = [
  // The entity is a TEST. "Finding" was the engine's name for a failed one.
  { term: 'finding(s)', pattern: /\bfindings?\b/i },
  // Replaced by "Used by flows".
  { term: 'grounds', pattern: /\bgrounds\b/i },
  // The retired all-caps section header (it became "Tests"). The surface NAMES
  // (CLI / API / Web) stay — the complaint was the shouted engine header, not the
  // English word.
  { term: 'SURFACES header', pattern: /\bSURFACES\b/ },
  // The technical artifact's name — it renders as "test" everywhere.
  { term: 'scenario(s)', pattern: /\bscenarios?\b/i },
  // Raw kind / bucket tokens off the wire.
  { term: 'blocked-on', pattern: /blocked-on/i },
  { term: 'unrealizable', pattern: /\bunrealizable\b/i },
  { term: 'no-interface', pattern: /no-interface/i },
  // Catches "Guarded" and "Unguarded" alike.
  { term: 'guarded', pattern: /guarded/i },
  { term: 'partial', pattern: /\bpartial\b/i },
  { term: 'ungenerated', pattern: /\bungenerated\b/i },
  // The retired coverage STATUS word — a mute bucket where the five words now
  // always have a real answer.
  { term: 'not generated', pattern: /\bnot generated\b/i },
  { term: 'awaiting-driver', pattern: /awaiting-driver/i },
  // Long retired: the held/limbo state no longer exists.
  { term: 'held', pattern: /\bheld\b/i },
  // The retired THIRD reading of a test. Every artifact-backed entity now offers
  // exactly two — the page and the stored file — so nothing may offer a "story".
  { term: 'story', pattern: /\bstor(y|ies)\b/i },
  // The retired MILESTONE STATUS vocabulary. A milestone has no state of its own
  // any more: the flow's milestones are a plain list of claim sentences, and the
  // test's verdict is the only status on the page. ("awaiting" survives, but only
  // as a SURFACE's gap — "Awaiting web driver." — never as a milestone's state.)
  { term: 'settled', pattern: /\bsettled\b/i },
  { term: 'drifted', pattern: /\bdrifted\b/i },
  { term: 'no milestone reached', pattern: /no milestone reached/i },
];

/**
 * Everything a reader can see in `root`: visible text plus the attributes screen
 * readers and tooltips surface. `<pre>` blocks and mono spans are DATA (committed
 * YAML, run transcripts, ids, repo paths) and are skipped — the rule is about
 * words the product chose, not words the repo contains.
 */
function userFacingStrings(root: HTMLElement): string[] {
  const out: string[] = [];
  const isData = (el: Element | null) =>
    !!el && (el.closest('pre') !== null || el.closest('[class*="font-mono"]') !== null);

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (isData(node.parentElement)) continue;
    const text = (node.textContent ?? '').trim();
    if (text) out.push(text);
  }
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('[aria-label],[title],[placeholder]'))) {
    for (const attr of ['aria-label', 'title', 'placeholder']) {
      const value = el.getAttribute(attr);
      if (value) out.push(value);
    }
  }
  return out;
}

/** Assert no banned term appears in what `render` put on screen. */
function expectCleanVocabulary(where: string) {
  const strings = userFacingStrings(document.body);
  expect(strings.length, `${where} rendered nothing to sweep`).toBeGreaterThan(0);
  for (const { term, pattern } of BANNED) {
    const hit = strings.find((s) => pattern.test(s));
    expect(hit, `${where} renders the retired term "${term}": ${JSON.stringify(hit)}`).toBeUndefined();
  }
}

// ---------------------------------------------------------------------------
// A fixture set covering all four states — passing, failing (run AND birth),
// blocked, not generated — because a term that only leaks in one state is still
// a term that leaks.
// ---------------------------------------------------------------------------

const DOC = 'docs/specs/tasks.md';
const RUN_ID = '2026-07-24T14-02-00Z_9f31c0aa';
const PASSING_ID = 'task-lifecycle.cli.1';
const BIRTH_ID = 'analyze-pathological.cli.1';

const flow = (over: Partial<GuardFlowListItem>): GuardFlowListItem => ({
  flowId: 'f',
  title: 'A user creates a task and sees it listed',
  goal: 'Create and list a task from the CLI',
  status: 'pass',
  bucket: 'guarded',
  epic: false,
  composedOf: [],
  manual: false,
  milestoneCount: 2,
  sectionCount: 1,
  docs: [DOC],
  surfaces: [],
  findings: 0,
  toolDefects: 0,
  errors: 0,
  interfaceDrifted: false,
  ...over,
});

/** One flow per plain state, plus the epic/manual markers and a drift dot. */
const FLOWS: GuardFlowListItem[] = [
  flow({
    flowId: 'passing',
    status: 'pass',
    bucket: 'guarded',
    surfaces: [{ surface: 'cli', scenarioId: PASSING_ID, status: 'pass', outcome: 'pass', stage: 'run' }],
  }),
  flow({
    flowId: 'failing-run',
    title: 'A user exports the task list',
    status: 'fail',
    bucket: 'guarded',
    interfaceDrifted: true,
    surfaces: [
      { surface: 'api', scenarioId: 'x.api.1', status: 'fail', outcome: 'fail', stage: 'run', interfaceDrifted: true },
    ],
  }),
  flow({
    flowId: 'failing-birth',
    title: 'Analyze finishes on a pathological file',
    status: 'fail',
    bucket: 'guarded',
    findings: 1,
    surfaces: [{ surface: 'cli', scenarioId: BIRTH_ID, status: 'fail', stage: 'birth' }],
  }),
  flow({
    flowId: 'blocked',
    title: 'A user schedules a reminder',
    status: 'blocked-on',
    bucket: 'blocked',
    surfaces: [
      {
        surface: 'api',
        status: 'blocked-on',
        gap: {
          kind: 'blocked-on',
          reason: 'blocked on a recipe `api` block, credentials: A user schedules a reminder',
          label: 'blocked-on',
        },
      },
    ],
  }),
  flow({
    flowId: 'awaiting',
    title: 'A user drags a task on the board',
    status: 'web',
    bucket: 'blocked',
    epic: true,
    composedOf: ['passing'],
    surfaces: [
      {
        surface: 'web',
        status: 'web',
        gap: { kind: 'awaiting-driver', driver: 'web', reason: 'the board is browser-only', label: 'awaiting web driver' },
      },
    ],
  }),
  flow({
    flowId: 'not-generated',
    title: 'Analyze streams its progress',
    status: 'unguarded',
    bucket: 'ungenerated',
    errors: 2,
  }),
  flow({ flowId: 'manual:help', title: '`tasks --help` prints usage', goal: '', manual: true, status: 'pass' }),
  // A flow the specs no longer derive: no title, no goal, kept for its test. Its
  // explanation is the one place "orphaned" would be easiest to leak.
  flow({
    flowId: 'purge-tasks',
    title: 'purge-tasks',
    goal: '',
    orphaned: true,
    status: 'pass',
    bucket: 'guarded',
    milestoneCount: 0,
    surfaces: [{ surface: 'cli', scenarioId: 'purge-tasks.cli.1', status: 'pass', outcome: 'pass', stage: 'run' }],
  }),
];

const FLOW_DETAIL: GuardFlowDetailData = {
  flowId: 'passing',
  title: 'A user creates a task and sees it listed',
  goal: 'Create and list a task from the CLI',
  status: 'fail',
  bucket: 'partial',
  epic: true,
  manual: false,
  composedOf: ['other'],
  milestones: [
    {
      order: 1,
      doc: DOC,
      anchor: 'tasks/creating-tasks',
      claimTitle: 'Creating a task prints its id',
      headingText: 'Creating tasks',
      live: true,
      drifted: true,
    },
  ],
  surfaces: [
    {
      surface: 'cli',
      scenarioId: PASSING_ID,
      title: 'Tasks are created and listed newest-first',
      status: 'fail',
      birthPassed: false,
      stage: 'birth',
      failure: { step: 2, expected: 'exit 0', actual: 'exit 1' },
      hasEvidence: true,
      interfacePath: [],
    },
    {
      surface: 'web',
      status: 'web',
      birthPassed: false,
      hasEvidence: false,
      interfacePath: [],
      gap: { kind: 'awaiting-driver', driver: 'web', reason: 'the board is browser-only', label: 'awaiting web driver' },
    },
    {
      surface: 'api',
      status: 'blocked-on',
      birthPassed: false,
      hasEvidence: false,
      interfacePath: [],
      gap: { kind: 'blocked-on', reason: 'blocked on credentials: schedule a reminder', label: 'blocked-on' },
    },
    {
      surface: 'tui',
      status: 'unrealizable',
      birthPassed: false,
      hasEvidence: false,
      interfacePath: [],
      gap: { kind: 'unrealizable', reason: 'no code path offers it', label: 'unrealizable' },
    },
  ],
  gaps: [],
  interfaceIds: ['cli/tasks-add'],
  findings: [],
  errors: [],
  generatedAt: '2026-07-24T13:40:00.000Z',
  runId: RUN_ID,
  ranAt: '2026-07-24T14:02:00.000Z',
};

/** The flow the specs no longer derive: hollow by nature, kept for its test. */
const UNDERIVED_DETAIL: GuardFlowDetailData = {
  ...FLOW_DETAIL,
  flowId: 'purge-tasks',
  title: 'purge-tasks',
  goal: '',
  orphaned: true,
  status: 'pass',
  bucket: 'guarded',
  epic: false,
  composedOf: [],
  milestones: [],
  surfaces: [
    {
      surface: 'cli',
      scenarioId: 'purge-tasks.cli.1',
      title: 'Purged tasks leave the list',
      status: 'pass',
      birthPassed: true,
      stage: 'run',
      outcome: 'pass',
      hasEvidence: false,
      interfacePath: [],
    },
  ],
  interfaceIds: [],
  errors: [],
};

/** The authoring-error flow: no test, no gap — the retry sentence. */
const ERROR_DETAIL: GuardFlowDetailData = {
  ...FLOW_DETAIL,
  flowId: 'not-generated',
  status: 'unguarded',
  bucket: 'ungenerated',
  epic: false,
  composedOf: [],
  surfaces: [],
  interfaceIds: [],
  errors: [{ doc: DOC, anchor: 'tasks/creating-tasks', message: 'the model returned an unparseable envelope' }],
};

/** The never-attempted flow: no test, no gap, no error — the not-generated sentence. */
const NOT_ATTEMPTED_DETAIL: GuardFlowDetailData = { ...ERROR_DETAIL, flowId: 'not-attempted', errors: [] };

/** The merged detail of the flow whose test failed at birth — the state where
 *  the engine's own words are likeliest to leak into a reader's page. */
const BIRTH_DETAIL: GuardFlowDetailData = {
  ...FLOW_DETAIL,
  flowId: 'failing-birth',
  title: 'Analyze finishes on a pathological file',
  goal: 'Analyze a repo carrying a pathological file without freezing',
  status: 'fail',
  bucket: 'guarded',
  surfaces: [
    {
      surface: 'cli',
      scenarioId: BIRTH_ID,
      title: 'Analyze finishes on a pathological file',
      status: 'fail',
      birthPassed: false,
      stage: 'birth',
      failure: { step: 2, expected: 'exit 0', actual: 'timed out' },
      failedMilestone: 1,
      evidencePath: '.truecourse/guard/evidence/birth/pathological',
      hasEvidence: true,
      interfacePath: [],
    },
  ],
};

const runResult = (over: Partial<GuardScenarioResult> = {}): GuardScenarioResult => ({
  id: PASSING_ID,
  title: 'Tasks are created and listed newest-first',
  binds: { doc: DOC, section: 'tasks/creating-tasks', fingerprint: 'sha256:abc' },
  outcome: 'fail',
  durationMs: 412,
  failure: { step: 2, expected: 'exit 0', actual: 'exit 1' },
  evidencePath: `.truecourse/guard/evidence/${RUN_ID}/${PASSING_ID}`,
  interfaceDrifted: true,
  ...over,
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL) =>
      String(url).includes('/guard/scenario?')
        ? new Response(JSON.stringify({ id: PASSING_ID, file: 'a.yaml', content: 'guard: 3' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        : new Response('transcript', { status: 200 }),
    ),
  );
}

// ---------------------------------------------------------------------------

describe('guard vocabulary — no retired term reaches a reader', () => {
  it('the Flows list, over all four states at once', () => {
    render(
      <GuardFlowsPanel
        flows={FLOWS}
        loading={false}
        error={null}
        activeId={null}
        filter="all"
        onFilter={() => {}}
        drivers={[]}
        onDrivers={() => {}}
        onOpen={() => {}}
      />,
    );
    expectCleanVocabulary('GuardFlowsPanel');
  });

  it('the Flows list filter — every status option it offers', () => {
    render(
      <GuardFlowsPanel
        flows={FLOWS}
        loading={false}
        error={null}
        activeId={null}
        filter="all"
        onFilter={() => {}}
        drivers={[]}
        onDrivers={() => {}}
        onOpen={() => {}}
      />,
    );
    const options = within(screen.getByRole('group', { name: 'Filter by status' }))
      .getAllByRole('button')
      .map((o) => o.textContent ?? '');
    expect(options.length).toBeGreaterThan(1);
    for (const { term, pattern } of BANNED) {
      expect(options.find((o) => pattern.test(o)), `status filter offers "${term}"`).toBeUndefined();
    }
  });

  it('a flow detail carrying a test, two blocked surfaces and an unrealized one', () => {
    render(
      <GuardFlowDetail repoId="r"
        detail={FLOW_DETAIL}
        onOpenSpec={() => {}}
        onOpenInterface={() => {}}
      />,
    );
    expectCleanVocabulary('GuardFlowDetail');
  });

  it('a flow detail the specs no longer derive — the kept-for-its-test sentence', () => {
    render(
      <GuardFlowDetail repoId="r"
        detail={UNDERIVED_DETAIL}
        onOpenSpec={() => {}}
        onOpenInterface={() => {}}
      />,
    );
    expectCleanVocabulary('GuardFlowDetail (no longer derived)');
    // "Orphaned" is the ENGINE's word for this state (the manifest field). It is
    // not banned globally — the run and coverage surfaces use it for their own,
    // older meaning — but it must never be how a FLOW explains itself.
    expect(userFacingStrings(document.body).find((s) => /orphan/i.test(s))).toBeUndefined();
  });

  it('a flow detail whose authoring errored — the retry sentence', () => {
    render(
      <GuardFlowDetail repoId="r"
        detail={ERROR_DETAIL}
        onOpenSpec={() => {}}
        onOpenInterface={() => {}}
      />,
    );
    expectCleanVocabulary('GuardFlowDetail (authoring error)');
  });

  it('a flow detail nothing was attempted for — the not-generated sentence', () => {
    render(
      <GuardFlowDetail repoId="r"
        detail={NOT_ATTEMPTED_DETAIL}
        onOpenSpec={() => {}}
        onOpenInterface={() => {}}
      />,
    );
    expectCleanVocabulary('GuardFlowDetail (nothing attempted)');
  });

  it('a flow detail offering the dismissal ruling — the button and its hover copy', () => {
    render(
      <GuardFlowDetail repoId="r"
        detail={FLOW_DETAIL}
        decisions={decisionsStub()}
        onOpenSpec={() => {}}
        onOpenInterface={() => {}}
      />,
    );
    expectCleanVocabulary('GuardFlowDetail (dismissal offered)');
  });

  it('a flow detail already ruled out — the dismissed sentence and its undo', () => {
    render(
      <GuardFlowDetail repoId="r"
        detail={FLOW_DETAIL}
        decisions={decisionsStub({
          flowDismissal: () => ({
            flowId: FLOW_DETAIL.flowId,
            title: FLOW_DETAIL.title,
            dismissedAt: '2026-07-25T10:00:00.000Z',
            note: 'not a user path',
          }),
        })}
        onOpenSpec={() => {}}
        onOpenInterface={() => {}}
      />,
    );
    expectCleanVocabulary('GuardFlowDetail (dismissed)');
  });

  it('the recipe detail — the preparation the Tests tab opens', () => {
    render(
      <GuardRecipeDetail
        repoId="r"
        recipe={{
          surfaces: {
            cli: { build: 'pnpm build', entry: ['node', 'dist/tasks.js'], env: { TASKS_HOME: '.tmp/tasks' } },
            // The shared-server case, so its one line is swept too.
            api: {
              serve: ['node', 'dist/web.js'],
              healthPath: '/health',
              services: { up: 'docker compose up -d --wait' },
              sharedWithWeb: true,
            },
          },
          fingerprint: 'sha256:9f2c',
          stale: true,
        }}
      />,
    );
    expectCleanVocabulary('GuardRecipeDetail');
  });

  it('the merged detail of a test that failed at birth — verdict, steps, transcript', async () => {
    stubFetch();
    render(
      <GuardFlowDetail
        repoId="r"
        detail={BIRTH_DETAIL}
        interfaces={[]}
        decisions={decisionsStub()}
        onOpenSpec={() => {}}
        onOpenInterface={() => {}}
      />,
    );
    await screen.findByLabelText('test steps');
    expectCleanVocabulary('GuardFlowDetail (birth failure)');
  });

  it('the merged detail whose claim is already ruled out — the dismissed line', async () => {
    stubFetch();
    render(
      <GuardFlowDetail
        repoId="r"
        detail={BIRTH_DETAIL}
        interfaces={[]}
        decisions={decisionsStub({
          dismissalFor: () => ({
            doc: 'docs/cli.md',
            anchor: 'a',
            title: 'a claim',
            dismissedAt: '2026-07-25T10:00:00.000Z',
          }),
        })}
        onOpenSpec={() => {}}
        onOpenInterface={() => {}}
      />,
    );
    await screen.findByLabelText('test steps');
    expectCleanVocabulary('GuardFlowDetail (dismissed claim)');
  });

  it('a run instance detail — the flow instance, binding, evidence and steps', async () => {
    stubFetch();
    render(
      <MemoryRouter>
        <GuardDriftDetail
          repoId="r"
          scenario={runResult()}
          runId={RUN_ID}
          runFlow={{
            flowId: 'passing',
            title: 'A user creates a task and sees it listed',
            goal: 'Create and list a task from the CLI',
            epic: false,
            milestones: [
              { order: 1, doc: DOC, anchor: 'tasks/creating-tasks', claimTitle: 'Creating a task prints its id' },
            ],
          }}
          onOpenSpec={() => {}}
          onOpenFlow={() => {}}
        />
      </MemoryRouter>,
    );
    await screen.findByLabelText('test steps');
    expectCleanVocabulary('GuardDriftDetail');
  });

  it('a run instance that never executed — the stale / orphaned notes', async () => {
    stubFetch();
    render(
      <GuardDriftDetail
        repoId="r"
        scenario={runResult({ outcome: 'orphaned', failure: undefined, evidencePath: undefined })}
        runId={RUN_ID}
        onOpenSpec={() => {}}
      />,
    );
    await screen.findByLabelText('test steps');
    expectCleanVocabulary('GuardDriftDetail (orphaned)');
  });

  it('the run list — the severity-led rows and the passed group', () => {
    render(
      <GuardDriftList
        drifts={[runResult(), runResult({ id: 'b.cli.1', outcome: 'stale', failure: undefined })]}
        passed={[runResult({ id: 'c.cli.1', outcome: 'pass', failure: undefined })]}
        activeId={null}
        onPreview={() => {}}
        onPin={() => {}}
      />,
    );
    expectCleanVocabulary('GuardDriftList');
  });

  it('the interface catalog — the reverse index onto the flows that use each interface', () => {
    // "Used by flows", never "Grounds"; a matched-but-blocked flow says so in
    // plain words rather than naming the artifact that was never written.
    const interfaces: GuardInterfaceRow[] = [
      {
        id: 'cli/tasks-add',
        type: 'cli',
        title: 'tasks add',
        entry: { command: ['tasks', 'add'] },
        steps: [{ kind: 'invoke', command: ['tasks', 'add'], flags: [] }],
        fingerprint: 'sha256:j1',
        flows: [
          { flowId: 'passing', title: 'A user creates a task', realized: true },
          {
            flowId: 'blocked',
            title: 'A user schedules a reminder',
            realized: false,
            gap: { kind: 'blocked-on', reason: 'blocked on credentials', label: 'blocked-on' },
          },
        ],
        scenarioIds: ['task-lifecycle.cli.1'],
        source: 'tree',
      },
      {
        id: 'cli/tasks-purge',
        type: 'cli',
        title: 'tasks purge',
        entry: { command: ['tasks', 'purge'] },
        steps: [],
        fingerprint: 'sha256:j2',
        flows: [],
        scenarioIds: [],
        source: 'tree',
      },
    ];
    render(
      <GuardInterfacesPanel
        interfaces={interfaces}
        loading={false}
        error={null}
        activeId={null}
        surfaces={[]}
        onSurfaces={() => {}}
        onOpen={() => {}}
      />,
    );
    expectCleanVocabulary('GuardInterfacesPanel');
  });

  it('the interface detail pane — the reverse index and the fingerprint note', () => {
    render(
      <GuardInterfacesPane repoId="r"
        view={{
          mapped: true,
          generatedAt: '2026-07-24T13:00:00.000Z',
          recipeFingerprint: 'sha256:r',
          interfaces: [
            {
              id: 'cli/tasks-add',
              type: 'cli',
              title: 'tasks add',
              entry: { command: ['tasks', 'add'] },
              steps: [{ kind: 'invoke', command: ['tasks', 'add'], flags: [] }],
              fingerprint: 'sha256:j1',
              flows: [
                { flowId: 'passing', title: 'A user creates a task', realized: true },
                {
                  flowId: 'blocked',
                  title: 'A user schedules a reminder',
                  realized: false,
                  gap: { kind: 'blocked-on', reason: 'blocked on credentials', label: 'blocked-on' },
                },
              ],
              scenarioIds: [PASSING_ID],
              source: 'tree',
            },
          ],
          surfaces: [
            { surface: 'cli', label: 'CLI', runnable: true, interfaces: 1, detected: true, source: 'tree' },
            { surface: 'web', label: 'Web', runnable: false, waitingLabel: 'Needs web driver', interfaces: 0, detected: true },
          ],
          totals: { interfaces: 1, detectedSurfaces: 2, grounded: 1, ungrounded: 0 },
        }}
        loading={false}
        error={null}
        tabs={{
          activeId: 'cli/tasks-add',
          openTabs: [{ id: 'cli/tasks-add', pinned: true }],
          open: () => {},
          close: () => {},
        }}
        commandTabs={{
          activeId: null,
          openTabs: [],
          open: () => {},
          close: () => {},
        }}
        onOpenFlow={() => {}}
      />,
    );
    expectCleanVocabulary('GuardInterfacesPane');
  });

  it('a coverage section detail — the flows that test the section', () => {
    const section: GuardSectionCoverage = {
      anchor: 'tasks/creating-tasks',
      headingText: 'Creating tasks',
      level: 2,
      fingerprint: 'sha256:x',
      status: 'fail',
      flows: [
        {
          flowId: 'passing',
          title: 'A user creates a task and sees it listed',
          status: 'fail',
          epic: false,
          manual: false,
          milestonesInSection: [1],
          milestoneCount: 2,
          surfaces: [{ surface: 'cli', scenarioId: PASSING_ID, status: 'fail', outcome: 'fail', stage: 'run' }],
        },
        {
          flowId: 'manual:help',
          title: '`tasks --help` prints usage',
          status: 'pass',
          epic: false,
          manual: true,
          milestonesInSection: [],
          milestoneCount: 0,
          surfaces: [{ surface: 'cli', scenarioId: 'manual-help', status: 'pass', outcome: 'pass', stage: 'run' }],
        },
      ],
      scenarioIds: [PASSING_ID],
      scenarios: [],
    };
    render(<GuardSectionDetail repoId="r" section={section} onOpenFlow={() => {}} onClose={() => {}} />);
    expectCleanVocabulary('GuardSectionDetail');
  });

  it('the status badge, over EVERY coverage status the wire can send', () => {
    // The status table is the one place a raw wire token could reach a label, so
    // it is swept exhaustively rather than by sample.
    for (const status of GUARD_COVERAGE_STATUS_PRECEDENCE as readonly GuardSectionCoverageStatus[]) {
      render(<GuardStatusBadge status={status} />);
      expectCleanVocabulary(`status "${status}"`);
      cleanup();
    }
  });

  it('a section badge says ONE of the five words, whatever the wire sent', () => {
    // The counterpart of the sweep above: not just "no retired term", but the
    // positive rule — every coverage status a reader meets is one of five.
    const FIVE = Object.values(GUARD_COVERAGE_STATUS_WORD);
    for (const status of GUARD_COVERAGE_STATUS_PRECEDENCE as readonly GuardSectionCoverageStatus[]) {
      const { container } = render(<GuardStatusBadge status={status} />);
      expect(FIVE, status).toContain(container.textContent);
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// The other half of the hover rule: copy a reader can't SEE is as bad as copy
// that reads wrong. Every guard popover is portaled out of the render tree, so
// no scrolling panel and no overflow-hidden pane can cut one off at its edge —
// jsdom lays nothing out, so the rule is pinned as STRUCTURE.
// ---------------------------------------------------------------------------

/** Every popover on screen is portaled into the body, under no clipping box. */
function expectHoversCannotClip(where: string) {
  const tips = Array.from(document.body.querySelectorAll('[role="tooltip"]'));
  for (const tip of tips) {
    expect(tip.getAttribute('data-hover-popover'), `${where}: a hover is not portaled`).not.toBeNull();
    expect(tip.parentElement, `${where}: a portaled hover left the body`).toBe(document.body);
    for (let el = tip.parentElement; el; el = el.parentElement) {
      if (el.tagName === 'BODY') break;
      expect(el.className, `${where}: a hover sits inside a clipping box`).not.toMatch(
        /overflow-(auto|hidden|scroll|x-|y-)/,
      );
    }
  }
  return tips.length;
}

describe('guard hover popovers — none of them can clip', () => {
  it('the Flows list', () => {
    render(
      <GuardFlowsPanel
        flows={FLOWS}
        loading={false}
        error={null}
        activeId={null}
        filter="all"
        onFilter={() => {}}
        drivers={[]}
        onDrivers={() => {}}
        onOpen={() => {}}
      />,
    );
    expect(expectHoversCannotClip('GuardFlowsPanel')).toBeGreaterThan(0);
  });

  it('a flow detail — the milestone list, the markers and the drift note', () => {
    render(
      <GuardFlowDetail repoId="r"
        detail={FLOW_DETAIL}
        onOpenSpec={() => {}}
        onOpenInterface={() => {}}
      />,
    );
    expect(expectHoversCannotClip('GuardFlowDetail')).toBeGreaterThan(0);
  });

  it('the merged detail — its hovers survive an opened step record', async () => {
    // The divider headers are gone; the detail's hovers now ride the verdict
    // chips and the rows themselves. The clip rule must hold with a record open.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) =>
        String(url).includes('/guard/scenario?')
          ? new Response(
              JSON.stringify({
                id: BIRTH_ID,
                file: 'a.yaml',
                content: 'guard: 3',
                driver: 'cli',
                steps: [
                  { n: 1, command: 'tasks init', expectation: 'exit 0' },
                  { n: 2, command: 'tasks add "buy milk"', expectation: 'exit 0', milestone: 1 },
                ],
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            )
          : new Response('transcript', { status: 200 }),
      ),
    );
    render(
      <GuardFlowDetail
        repoId="r"
        detail={BIRTH_DETAIL}
        interfaces={null}
        onOpenSpec={() => {}}
        onOpenInterface={() => {}}
      />,
    );
    const steps = await screen.findByLabelText('test steps');
    await within(steps).findAllByRole('listitem');
    await userEvent
      .setup()
      .click(within(steps).getByRole('button', { name: 'Step 2 record' }));
    expect(expectHoversCannotClip('GuardFlowDetail (steps)')).toBeGreaterThan(0);
  });

  it('a coverage section detail', () => {
    const section: GuardSectionCoverage = {
      anchor: 'tasks/creating-tasks',
      headingText: 'Creating tasks',
      level: 2,
      fingerprint: 'sha256:x',
      status: 'fail',
      flows: [
        {
          flowId: 'manual:help',
          title: '`tasks --help` prints usage',
          status: 'pass',
          epic: false,
          manual: true,
          milestonesInSection: [],
          milestoneCount: 0,
          surfaces: [{ surface: 'cli', scenarioId: 'manual-help', status: 'pass', outcome: 'pass', stage: 'run' }],
        },
      ],
      scenarioIds: [PASSING_ID],
      scenarios: [],
    };
    render(<GuardSectionDetail repoId="r" section={section} onOpenFlow={() => {}} onClose={() => {}} />);
    expect(expectHoversCannotClip('GuardSectionDetail')).toBeGreaterThan(0);
  });

});


// ---------------------------------------------------------------------------
// THE PALETTE SWEEP — four colours, and amber/orange banned outright.
//
// Static, over the sources: every guard component and every guard lib that feeds
// them classes. A rendered-DOM check would only ever see the branches one fixture
// happens to take; the ban has to hold for the branches nobody rendered.
// ---------------------------------------------------------------------------

const GUARD_SOURCE_DIRS = [
  'apps/dashboard/client/src/components/guard',
  'apps/dashboard/client/src/hooks',
  'apps/dashboard/client/src/lib',
];

/** Every guard source file, as [repo-relative path, contents]. */
function guardSources(): [string, string][] {
  const root = path.resolve(__dirname, '../..');
  const out: [string, string][] = [];
  for (const dir of GUARD_SOURCE_DIRS) {
    const abs = path.join(root, dir);
    for (const name of fs.readdirSync(abs)) {
      if (!/\.tsx?$/.test(name)) continue;
      // The hooks/ and lib/ dirs are shared — only their guard members are ours.
      if (!dir.endsWith('/guard') && !/^(useGuard|guard-)/.test(name)) continue;
      out.push([`${dir}/${name}`, fs.readFileSync(path.join(abs, name), 'utf8')]);
    }
  }
  return out;
}

describe('guard palette — amber and orange are banned', () => {
  it('sweeps every guard source for an amber or orange class', () => {
    const files = guardSources();
    // A guard against the sweep silently matching nothing (a moved directory).
    expect(files.length).toBeGreaterThan(20);
    const offenders = files.flatMap(([file, text]) =>
      [...text.matchAll(/\b(?:bg|text|border|ring|from|to|via|decoration|outline|fill|stroke|shadow)-(amber|orange)-\d{2,3}\b/g)].map(
        (m) => `${file}: ${m[0]}`,
      ),
    );
    expect(offenders, 'guard paints from red / green / blue / grey only').toEqual([]);
  });

  it('keeps the four colours it DOES use — a status is never colourless', () => {
    const ALLOWED = ['red', 'emerald', 'sky', 'slate', 'zinc'];
    const paints = GUARD_COVERAGE_STATUS_PRECEDENCE.map((s) => {
      const meta = guardStatusMeta(s as GuardSectionCoverageStatus);
      return [s, `${meta.band} ${meta.dot} ${meta.badge}`] as const;
    });
    for (const [what, paint] of paints) {
      // `\d{2,3}` is what keeps a SIDE out of this (`border-t-2` is not a colour).
      const used = [...paint.matchAll(/\b(?:bg|text|border|ring)-([a-z]+)-\d{2,3}\b/g)].map((m) => m[1]);
      expect([...new Set(used)].filter((c) => !ALLOWED.includes(c)), String(what)).toEqual([]);
    }
  });

  it('paints BLOCKED blue and the UNKNOWNS grey — the two remaps that removed them', () => {
    // Blocked is a to-do someone can clear, so it reads like every other "not yet".
    for (const status of ['blocked', 'blocked-on', 'needs-setup', 'unguarded'] as const) {
      expect(guardStatusMeta(status).badge, status).toContain('sky');
    }
    // Stale/orphaned never executed: an unknown is grey, never a verdict colour.
    for (const status of ['stale', 'orphaned'] as const) {
      expect(guardStatusMeta(status).badge, status).toBe(guardStatusMeta('untestable').badge);
    }
  });
});
