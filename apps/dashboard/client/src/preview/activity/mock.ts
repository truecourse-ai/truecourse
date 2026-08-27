/**
 * UI MOCK: hand-written stand-in data for the Activity surface (agentic runs,
 * sessions, transcripts, chat). Nothing here
 * reads the server or the store.
 */

export type RunStatus = 'running' | 'finished' | 'failed';

export type SessionStatus =
  | 'active'
  | 'awaiting-input'
  | 'queued'
  | 'done'
  | 'failed'
  | 'blocked';

export interface ProposalGroup {
  id: string;
  name: string;
  docs: number;
  reason: string;
  verdict?: 'keep' | 'exclude';
}

export type TranscriptEvent =
  | { id: string; kind: 'system'; text: string }
  | { id: string; kind: 'reply'; text: string }
  | { id: string; kind: 'user-message'; text: string }
  | { id: string; kind: 'tool'; label: string; ok: boolean; duration: string; detail: string }
  | { id: string; kind: 're-ask'; note: string }
  | { id: string; kind: 'proposal'; title: string; groups: ProposalGroup[]; applied: boolean }
  | { id: string; kind: 'question'; text: string; options: string[]; answer?: string }
  | { id: string; kind: 'outcome'; tone: 'ok' | 'fail' | 'warn'; title: string; lines: string[] };

export interface MockSession {
  id: string;
  /** Session kind: groups the rail ("Doc curation", "Flow workers"). */
  kind: string;
  /** The work item the session served: a doc path, a flow id, a step. */
  workItem: string;
  status: SessionStatus;
  turns: number;
  budget: number;
  events: TranscriptEvent[];
}

export interface MockRun {
  id: string;
  command: 'spec scan' | 'guard setup' | 'guard generate';
  gitRef: string;
  started: string;
  status: RunStatus;
  /** The always-sums counter line, pre-partitioned. */
  counters: { word: string; count: number; tone: 'ok' | 'warn' | 'fail' | 'muted' | 'active' }[];
  total: number;
  totalNoun: string;
  questions: number;
  sessions: MockSession[];
}

const SCAN_SYSTEM = `You are the spec scan orchestrator. Survey the doc universe cheaply
(titles, paths, outlines, source structure: never full contents), propose
product-area scope groups, and settle scope with the user before dispatching
curation. Persist every verdict and instruction to specs/decisions.json.
End with a structured outcome; never end without one.`;

const scanOrchestrator: MockSession = {
  id: 'ses-scan-orch',
  kind: 'Orchestrator',
  workItem: 'scope + dispatch',
  status: 'awaiting-input',
  turns: 6,
  budget: 20,
  events: [
    { id: 'e1', kind: 'system', text: SCAN_SYSTEM },
    {
      id: 'e2',
      kind: 'reply',
      text: 'Surveyed 251 docs across 2 sources (repo tree, docs.truecourse.dev). The universe splits cleanly along the doc tree; proposing 6 scope groups below.',
    },
    {
      id: 'e3',
      kind: 'proposal',
      title: 'Scope proposal: keep or exclude each group',
      applied: true,
      groups: [
        { id: 'g1', name: 'core/code-analysis', docs: 14, reason: 'Analyzer, rules, and report docs: user-facing behavior throughout.', verdict: 'keep' },
        { id: 'g2', name: 'core/spec-guard', docs: 9, reason: 'Scan, generate, and run guides; the guard pipeline surface.', verdict: 'keep' },
        { id: 'g3', name: 'core/dashboard', docs: 7, reason: 'The dashboard doc set; promised UI behavior.', verdict: 'keep' },
        { id: 'g4', name: 'core/cli', docs: 8, reason: 'Command reference pages with grammar and examples.', verdict: 'keep' },
        { id: 'g5', name: 'docs/archive', docs: 201, reason: 'Superseded plans and meeting notes; last edit 14 months ago, nothing links in.', verdict: 'exclude' },
        { id: 'g6', name: 'marketing site', docs: 12, reason: 'Landing-page copy under apps/landing; not a behavior spec.', verdict: 'exclude' },
      ],
    },
    {
      id: 'e4',
      kind: 'user-message',
      text: 'also exclude everything under docs/legacy-plans, those are superseded plan docs',
    },
    {
      id: 'e5',
      kind: 'reply',
      text: 'Excluded docs/legacy-plans (12 docs) and recorded the scope verdict plus an instruction: "docs/legacy-plans are superseded plan docs: never spec material." Kept scope is 38 docs. Dispatching doc curation.',
    },
    { id: 'e6', kind: 'tool', label: 'doc-curation · docs/cli/analyze.md', ok: true, duration: '41s', detail: 'kept · core/cli\nclaims-worthy sections: 7\ncache: miss → written' },
    { id: 'e7', kind: 'tool', label: 'doc-curation · docs/spec-guard/limits.md', ok: true, duration: '38s', detail: 'kept · core/spec-guard\nclaims-worthy sections: 4\ncache: miss → written' },
    { id: 'e8', kind: 'tool', label: 'doc-curation · docs/dashboard/flows.md', ok: true, duration: '27s', detail: 'kept · core/dashboard\nclaims-worthy sections: 5\ncache: miss → written' },
    {
      id: 'e9',
      kind: 'question',
      text: 'docs/spec-guard/limits.md says the per-file analyze budget is 500KB; docs/cli/analyze.md says 1MB. Both sections are current-tense promises. Which is the current behavior?',
      options: ['500KB is current', '1MB is current', 'Neither, flag both as a conflict'],
    },
  ],
};

const scanCuration = (
  id: string,
  doc: string,
  status: SessionStatus,
  turns: number,
  events: TranscriptEvent[] = [],
): MockSession => ({
  id,
  kind: 'Doc curation',
  workItem: doc,
  status,
  turns,
  budget: 5,
  events:
    events.length > 0
      ? events
      : [
          { id: `${id}-s`, kind: 'system', text: 'You are a spec curator deciding whether this doc describes user-facing behavior worth verifying, and which areas it belongs to.' },
          { id: `${id}-r1`, kind: 'reply', text: `Read ${doc}. It states user-facing behavior in the imperative; keeping. Proposing area below.` },
          { id: `${id}-o`, kind: 'outcome', tone: 'ok', title: 'Kept', lines: [`area: ${doc.includes('dashboard') ? 'core/dashboard' : doc.includes('cli') ? 'core/cli' : 'core/spec-guard'}`, 'reason: states current-tense product behavior'] },
        ],
});

const scanRun: MockRun = {
  id: 'run-scan-1',
  command: 'spec scan',
  gitRef: 'main · 6460e29f',
  started: 'today 14:32',
  status: 'running',
  counters: [
    { word: 'Curated', count: 31, tone: 'ok' },
    { word: 'Active', count: 1, tone: 'active' },
    { word: 'Queued', count: 6, tone: 'muted' },
  ],
  total: 38,
  totalNoun: 'docs',
  questions: 1,
  sessions: [
    scanOrchestrator,
    scanCuration('ses-cur-1', 'docs/cli/analyze.md', 'done', 2),
    scanCuration('ses-cur-2', 'docs/spec-guard/limits.md', 'done', 3),
    scanCuration('ses-cur-3', 'docs/dashboard/flows.md', 'done', 2),
    scanCuration('ses-cur-4', 'docs/cli/rules.md', 'done', 1),
    scanCuration('ses-cur-5', 'docs/spec-guard/recipes.md', 'active', 2, [
      { id: 'c5-s', kind: 'system', text: 'You are a spec curator deciding whether this doc describes user-facing behavior worth verifying, and which areas it belongs to.' },
      { id: 'c5-r', kind: 'reply', text: 'Reading docs/spec-guard/recipes.md. The doc defers to docs/spec-guard/setup.md for the boot contract: opening that section to settle the area.' },
      { id: 'c5-t', kind: 'tool', label: 'read-doc · docs/spec-guard/setup.md#boot', ok: true, duration: '1s', detail: '"guard setup verifies the recipe by booting the program in a fresh sandbox…"' },
    ]),
    {
      id: 'ses-area',
      kind: 'Area settling',
      workItem: 'corpus vocabulary',
      status: 'queued',
      turns: 0,
      budget: 8,
      events: [],
    },
    {
      id: 'ses-overlap',
      kind: 'Overlap',
      workItem: 'core/spec-guard',
      status: 'queued',
      turns: 0,
      budget: 12,
      events: [],
    },
  ],
};

const WORKER_SYSTEM = `You are a flow worker. Author ONE scenario proving this flow's claims
through its bound interfaces. Draft, run, observe, revise. Your only tool is
run_scenario. End with a structured outcome: settled, blocked, or
journey-defect; you cannot end without one.`;

const generateRun: MockRun = {
  id: 'run-gen-1',
  command: 'guard generate',
  gitRef: 'main · 6460e29f',
  started: 'today 11:05',
  status: 'finished',
  counters: [
    { word: 'Settled', count: 17, tone: 'ok' },
    { word: 'Blocked', count: 2, tone: 'warn' },
    { word: 'Retired', count: 1, tone: 'fail' },
  ],
  total: 20,
  totalNoun: 'flows',
  questions: 0,
  sessions: [
    {
      id: 'ses-w1',
      kind: 'Flow workers',
      workItem: 'analyze-a-repository-first-time',
      status: 'done',
      turns: 4,
      budget: 8,
      events: [
        { id: 'w1-s', kind: 'system', text: WORKER_SYSTEM },
        { id: 'w1-r1', kind: 'reply', text: 'Drafted a 6-step scenario: register the supplied fixture repo, run analyze, assert the report header, the .truecourse tree, and the exit code. Running it.' },
        { id: 'w1-t1', kind: 'tool', label: 'run_scenario · 6 steps', ok: false, duration: '2.3s', detail: 'step 3 failed: expected stdout to match /Analyzed \\d+ files/\ngot: "Analyzing 42 files…\\nAnalysis complete: 42 files, 3 findings"\nexit: 0' },
        { id: 'w1-r2', kind: 'reply', text: 'The journey promises the summary on the completion line, not a progress line. Tightening the matcher to the completion line and re-running.' },
        { id: 'w1-t2', kind: 'tool', label: 'run_scenario · 6 steps', ok: true, duration: '2.1s', detail: 'all steps passed · milestones covered: 4/4' },
        { id: 'w1-o', kind: 'outcome', tone: 'ok', title: 'Settled: passing', lines: ['4 milestones covered, 0 blocked', 'fidelity judge: faithful (fresh context)', 'confirmed in a fresh sandbox (birth)'] },
      ],
    },
    {
      id: 'ses-w2',
      kind: 'Flow workers',
      workItem: 'silence-a-rule-from-the-dashboard',
      status: 'done',
      turns: 5,
      budget: 8,
      events: [
        { id: 'w2-s', kind: 'system', text: WORKER_SYSTEM },
        { id: 'w2-r1', kind: 'reply', text: 'Mixed flow: CLI analyze arranges state, web steps silence the rule, an API read proves the count dropped. Drafting and running.' },
        { id: 'w2-t1', kind: 'tool', label: 'run_scenario · 9 steps', ok: false, duration: '11.4s', detail: 'step 7 failed: locator role=button name="Browse Rules" not found\naccessible tree excerpt attached' },
        { id: 'w2-r2', kind: 'reply', text: 'The docs promise a "Shield icon" entry point; the client renders "Browse Rules". Asserting the DOC\'s promise and recording the contradiction as a finding, per the doc-vs-journey policy.' },
        { id: 'w2-t2', kind: 'tool', label: 'run_scenario · 9 steps', ok: false, duration: '11.1s', detail: 'step 7 failed: locator role=button name="Shield" not found' },
        { id: 'w2-o', kind: 'outcome', tone: 'fail', title: 'Settled: failing, with diagnosis', lines: ['committed failing: the documented entry point does not exist in the client', 'diagnosis: doc-vs-code drift (the docs\' "Shield icon" vs the client\'s "Browse Rules")', 'finding recorded; scenario asserts the doc\'s promise'] },
      ],
    },
    {
      id: 'ses-w3',
      kind: 'Flow workers',
      workItem: 'api-transport-analysis-path',
      status: 'blocked',
      turns: 2,
      budget: 8,
      events: [
        { id: 'w3-s', kind: 'system', text: WORKER_SYSTEM },
        { id: 'w3-r1', kind: 'reply', text: 'This flow exercises the api transport configuration path. The dependency catalog marks the provider key as a supplied dependency with no registered instance.' },
        { id: 'w3-o', kind: 'outcome', tone: 'warn', title: 'Blocked: missing supplied dependency', lines: ['needs: an API provider key (supplied, unregistered)', 'register an instance on the Dependencies page to unblock', 'the claude-transport variant of this flow settled separately'] },
      ],
    },
    {
      id: 'ses-w4',
      kind: 'Flow workers',
      workItem: 'rules-list-filtering',
      status: 'failed',
      turns: 8,
      budget: 8,
      events: [
        { id: 'w4-s', kind: 'system', text: WORKER_SYSTEM },
        { id: 'w4-r1', kind: 'reply', text: 'Drafting the filter matrix scenario (enabled/disabled × severity).' },
        { id: 'w4-t1', kind: 'tool', label: 'run_scenario · 11 steps', ok: false, duration: '4.9s', detail: 'step 5 failed: expected 14 rows, got 16' },
        { id: 'w4-re', kind: 're-ask', note: 'turn 5 reply had no action block: re-asked once, recovered' },
        { id: 'w4-o', kind: 'outcome', tone: 'fail', title: 'Budget exhausted at 8/8 turns', lines: ['did not reach: a green run of the severity half of the matrix', 'ledgered as a failed attempt (2 of 3 for this flow)', 'resume continues from turn 8 with a fresh budget'] },
      ],
    },
    {
      id: 'ses-j1',
      kind: 'Fidelity judges',
      workItem: 'analyze-a-repository-first-time',
      status: 'done',
      turns: 1,
      budget: 3,
      events: [
        { id: 'j1-s', kind: 'system', text: 'You are a skeptical reviewer with fresh context. Does the assertion prove the claim?' },
        { id: 'j1-o', kind: 'outcome', tone: 'ok', title: 'Faithful', lines: ['the completion-line matcher proves the "analyzes and reports" claim', 'confidence: high'] },
      ],
    },
  ],
};

const setupRun: MockRun = {
  id: 'run-setup-1',
  command: 'guard setup',
  gitRef: 'main · 819af9cd',
  started: 'yesterday 18:12',
  status: 'failed',
  counters: [
    { word: 'Settled', count: 2, tone: 'ok' },
    { word: 'Failed', count: 1, tone: 'fail' },
    { word: 'Blocked', count: 2, tone: 'warn' },
  ],
  total: 5,
  totalNoun: 'steps',
  questions: 0,
  sessions: [
    {
      id: 'ses-recipe',
      kind: 'Recipe repair',
      workItem: 'recipe → verify',
      status: 'failed',
      turns: 15,
      budget: 15,
      events: [
        { id: 'rr-s', kind: 'system', text: 'You are a build engineer whose deliverable is a working recipe. Repair the failed proposal to green; the done-gate is verification in a fresh sandbox you never touched.' },
        { id: 'rr-r1', kind: 'reply', text: 'The deterministic proposal failed its boot probe: the server exits 1 without DATABASE_URL. Trying an sqlite fallback declared in config.' },
        { id: 'rr-t1', kind: 'tool', label: 'sandbox · pnpm build', ok: true, duration: '48s', detail: 'build clean' },
        { id: 'rr-t2', kind: 'tool', label: 'sandbox · boot probe', ok: false, duration: '12s', detail: 'exit 1: DATABASE_URL is required in production mode\nretried with NODE_ENV=development: listens, then crashes on first request' },
        { id: 'rr-o', kind: 'outcome', tone: 'fail', title: 'Budget exhausted at 15/15 turns', lines: ['could not make the boot probe answer without a real database', 'likely a seedable dependency the catalog step must classify', 'resume with a fresh budget, or register a database instance first'] },
      ],
    },
    {
      id: 'ses-catalog',
      kind: 'Dependency catalog',
      workItem: 'classify starting state',
      status: 'blocked',
      turns: 0,
      budget: 12,
      events: [],
    },
  ],
};

export const MOCK_RUNS: MockRun[] = [scanRun, generateRun, setupRun];

/** The canned agent reply the mock chat appends after a user message. */
export const MOCK_CHAT_REPLY =
  'Noted: recorded as an instruction and applied to the remaining sessions. (UI mock: no model behind this reply.)';

/** The canned reply after answering the pending question. */
export const MOCK_ANSWER_REPLY =
  'Verdict recorded to specs/decisions.json as a conflict resolution. The losing claim is suppressed at generate; re-running the two affected curations now. (UI mock.)';
