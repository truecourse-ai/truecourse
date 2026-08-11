import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { type Express } from 'express';
import { z } from 'zod';
import { createApp } from '../../apps/dashboard/server/src/app';
import {
  GuardFlowDetailSchema,
  GuardFlowsViewCoreSchema,
  GuardInterfacesViewSchema,
  GuardRunFlowSchema,
  GuardSectionFlowSchema,
  guardCoverageWord,
} from '../../packages/shared/src/index';
import { setupTestFixture, teardownTestFixture, type TestFixture } from '../helpers/test-db';

/**
 * The FLOW read surfaces (OSS): the coverage inversion (a section lists the flows
 * that traverse it), the Flows tab's list + detail, the Interfaces catalog with its
 * reverse index, and the run payload's flow-instance join.
 *
 * The fixture is a small CLI task manager ("taskbird"): a three-section spec doc,
 * one synthesized flow across all three sections plus a second, unrealized one, a
 * generated cli scenario, a hand-written scenario (the Manual pseudo-flow), an
 * interface catalog with one interface no flow grounds on, and a run where the flow
 * failed at its third milestone. Temp-repo fixture + supertest over the real app.
 */

const DOC = 'docs/specs/tasks.md';
const RUN_ID = '2026-07-24T14-02-00Z_9f31c0aa';

const DOC_CONTENT = [
  '# Tasks',
  '',
  '## Creating tasks',
  '',
  '`tasks add <title>` creates a task and prints its id.',
  '',
  '## Listing tasks',
  '',
  '`tasks list` prints tasks newest-first.',
  '',
  '## Completing tasks',
  '',
  '`tasks done <id>` marks a task done; `tasks list --done` shows it.',
  '',
].join('\n');

// The live section fingerprints of DOC_CONTENT (the section index is the source
// of truth for these — a flow binds them, and one bind is deliberately stale).
const FP = {
  tasks: 'sha256:eee52142964222cc2e003365290f017278b6dcc04148bcedba0ffdd5ad6187e0',
  creating: 'sha256:ebc6b465e85fb844c57ac0005cb0df7048c28dd7a00b0e01590972c58ea6f856',
  listing: 'sha256:77c991ddd5e25deff5b5a039a74013e829483b01df99ce3a651c07e8a72c8e9c',
  completing: 'sha256:0d66eec0e91e0bdd30cad1eda3087408a19d0e3303ff014e3b099f1e0a352b7e',
};
// The flow bound "Completing tasks" before it was edited — the drift signal.
const STALE_COMPLETING = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';

const FLOW_ID = 'task-lifecycle';
const SCENARIO_ID = 'task-lifecycle.cli.1';
const MANUAL_ID = 'tasks-help-smoke';
const SCENARIO_FILE = path.join('.truecourse', 'scenarios', 'tasks', 'task-lifecycle.cli.1.yaml');

const FLOWS_FILE = {
  version: 1,
  generatedAt: '2026-07-24T13:40:00.000Z',
  flows: [
    {
      id: FLOW_ID,
      title: 'A user creates a task, sees it listed, completes it, and sees it done',
      goal: 'Create, list, complete and filter a task from the CLI',
      fingerprint: 'sha256:41ac',
      milestones: [
        { order: 1, doc: DOC, anchor: 'tasks/creating-tasks', claimTitle: 'Creating a task prints its id' },
        { order: 2, doc: DOC, anchor: 'tasks/listing-tasks', claimTitle: 'The list shows tasks newest-first' },
        { order: 3, doc: DOC, anchor: 'tasks/completing-tasks', claimTitle: 'A task can be marked done' },
        { order: 4, doc: DOC, anchor: 'tasks/completing-tasks', claimTitle: 'Done tasks appear under --done' },
      ],
      bindings: [
        { doc: DOC, anchor: 'tasks/creating-tasks', fingerprint: FP.creating },
        { doc: DOC, anchor: 'tasks/listing-tasks', fingerprint: FP.listing },
        { doc: DOC, anchor: 'tasks/completing-tasks', fingerprint: STALE_COMPLETING },
      ],
      composedOf: [],
      synthesisInputsHash: 'sha256:inputs',
    },
    {
      id: 'task-export',
      title: 'A user exports the task list',
      goal: 'Export tasks to a file from the CLI',
      fingerprint: 'sha256:77bb',
      milestones: [
        { order: 1, doc: DOC, anchor: 'tasks/listing-tasks', claimTitle: 'The list can be written to a file' },
      ],
      bindings: [{ doc: DOC, anchor: 'tasks/listing-tasks', fingerprint: FP.listing }],
      composedOf: [],
      synthesisInputsHash: 'sha256:inputs',
    },
  ],
  noFlowClaims: [
    {
      doc: DOC,
      anchor: 'tasks',
      claimTitle: 'Tasks are stored in a local file',
      reason: 'implementation detail — nothing observable on any surface',
    },
  ],
};

const MANIFEST = {
  version: 3,
  flows: [
    {
      flowId: FLOW_ID,
      flowFingerprint: 'sha256:41ac',
      bindings: FLOWS_FILE.flows[0].bindings,
      scenarios: [{ id: SCENARIO_ID, surface: 'cli' }],
      generationInputsHash: 'sha256:gen',
      gaps: [
        { surface: 'web', kind: 'awaiting-driver', driver: 'web', reason: 'the board is browser-only' },
      ],
    },
    {
      flowId: 'task-export',
      flowFingerprint: 'sha256:77bb',
      bindings: FLOWS_FILE.flows[1].bindings,
      scenarios: [],
      generationInputsHash: 'sha256:gen',
      gaps: [{ surface: 'cli', kind: 'no-interface', reason: 'no cli interface exports the list' }],
    },
  ],
};

const RESULT = {
  generatedAt: '2026-07-24T13:40:00.000Z',
  status: 'ok',
  sectionsTotal: 4,
  sectionsChanged: 3,
  skippedUnchanged: 1,
  noChanges: false,
  written: [
    {
      id: SCENARIO_ID,
      title: 'Tasks are created, listed newest-first, completed and filterable',
      doc: DOC,
      anchor: 'tasks/creating-tasks',
      file: SCENARIO_FILE,
      flowId: FLOW_ID,
      surface: 'cli',
    },
  ],
  coverageGaps: [
    {
      doc: DOC,
      anchor: 'tasks/creating-tasks',
      kind: 'awaiting-driver',
      driver: 'web',
      reason: 'the board is browser-only',
      flowId: FLOW_ID,
      surface: 'web',
    },
    { doc: DOC, anchor: 'tasks', kind: 'no-claim', reason: 'the overview asserts nothing' },
  ],
  birthFindings: [
    {
      doc: DOC,
      anchor: 'tasks/completing-tasks',
      kind: 'fidelity',
      title: 'Done tasks appear under --done',
      step: 4,
      expected: 'the done filter is asserted',
      actual: 'the step only re-runs `tasks list`',
      flowId: FLOW_ID,
      surface: 'cli',
      failedMilestone: 4,
      priorMilestonesPassed: true,
    },
  ],
  errors: [],
  extractionFailures: [],
  orphaned: [],
  flows: {
    total: 2,
    settled: 1,
    unsettled: 1,
    skipped: 0,
    dismissed: 0,
    orphaned: 0,
    subsumed: 0,
    noFlowClaims: 1,
    unsettledAreas: [],
  },
  interfaces: { total: 4, bySurface: { cli: 4 } },
};

const LATEST = {
  run: {
    runId: RUN_ID,
    ranAt: '2026-07-24T14:02:00.000Z',
    branch: 'main',
    commit: 'c0ffee',
    recipeFingerprint: 'sha256:r',
    scenarioFormat: 3,
  },
  summary: { total: 2, pass: 1, fail: 1, stale: 0, orphaned: 0, error: 0 },
  scenarios: [
    {
      id: SCENARIO_ID,
      title: 'Tasks are created, listed newest-first, completed and filterable',
      binds: { doc: DOC, section: 'tasks/creating-tasks', fingerprint: FP.creating },
      outcome: 'fail',
      durationMs: 412,
      failure: { step: 3, expected: 'exit 0', actual: 'exit 1: unknown command `done`' },
      evidencePath: `.truecourse/guard/evidence/${RUN_ID}/${SCENARIO_ID}`,
      flowId: FLOW_ID,
      failedMilestone: 3,
      interfaceDrifted: true,
    },
    {
      id: MANUAL_ID,
      title: '`tasks --help` prints usage',
      binds: { doc: DOC, section: 'tasks', fingerprint: FP.tasks },
      outcome: 'pass',
      durationMs: 21,
    },
  ],
  sections: [],
};

const INTERFACES = {
  version: 1,
  generatedAt: '2026-07-24T13:39:00.000Z',
  recipeFingerprint: 'sha256:r',
  interfaces: [
    {
      id: 'cli/tasks-add',
      type: 'cli',
      title: 'tasks add',
      entry: { command: ['tasks', 'add'] },
      steps: [{ kind: 'invoke', command: ['tasks', 'add'], flags: ['--json'] }],
      fingerprint: 'sha256:j1',
    },
    {
      id: 'cli/tasks-list',
      type: 'cli',
      title: 'tasks list',
      entry: { command: ['tasks', 'list'] },
      steps: [{ kind: 'invoke', command: ['tasks', 'list'], flags: ['--done'] }],
      fingerprint: 'sha256:j2',
    },
    {
      id: 'cli/tasks-done',
      type: 'cli',
      title: 'tasks done',
      entry: { command: ['tasks', 'done'] },
      steps: [{ kind: 'invoke', command: ['tasks', 'done'], flags: [] }],
      fingerprint: 'sha256:j3',
    },
    {
      id: 'cli/tasks-purge',
      type: 'cli',
      title: 'tasks purge',
      entry: { command: ['tasks', 'purge'] },
      steps: [{ kind: 'invoke', command: ['tasks', 'purge'], flags: ['--force'] }],
      fingerprint: 'sha256:j4',
    },
  ],
  source: { cli: 'tree' },
};

const SCENARIO_YAML = [
  'guard: 3',
  `id: ${SCENARIO_ID}`,
  'title: Tasks are created, listed newest-first, completed and filterable',
  `flow: { id: ${FLOW_ID}, fingerprint: "sha256:41ac" }`,
  'interface:',
  '  path: [cli/tasks-add, cli/tasks-list, cli/tasks-done]',
  '  fingerprints: ["sha256:j1", "sha256:j2", "sha256:j3"]',
  'binds:',
  `  - { doc: ${DOC}, section: tasks/creating-tasks, fingerprint: "${FP.creating}" }`,
  `  - { doc: ${DOC}, section: tasks/listing-tasks, fingerprint: "${FP.listing}" }`,
  `  - { doc: ${DOC}, section: tasks/completing-tasks, fingerprint: "${STALE_COMPLETING}" }`,
  'driver: cli',
  'steps:',
  '  - run: [add, "Buy milk"]',
  '    expect: { exit: 0 }',
  '    milestone: 1',
  '  - run: [list]',
  '    expect: { exit: 0, stdout: { contains: "Buy milk" } }',
  '    milestone: 2',
  '  - run: [done, "1"]',
  '    expect: { exit: 0 }',
  '    milestone: 3',
  '  - run: [list, --done]',
  '    expect: { exit: 0, stdout: { contains: "Buy milk" } }',
  '    milestone: 4',
  '',
].join('\n');

const MANUAL_YAML = [
  'guard: 3',
  `id: ${MANUAL_ID}`,
  'title: "`tasks --help` prints usage"',
  'binds:',
  `  - { doc: ${DOC}, section: tasks, fingerprint: "${FP.tasks}" }`,
  'driver: cli',
  'steps:',
  '  - run: [--help]',
  '    expect: { exit: 0, stdout: { contains: "Usage" } }',
  '',
].join('\n');

describe('Guard flow read surfaces', () => {
  let app: Express;
  let fixture: TestFixture;
  let root: string;

  const write = (rel: string, content: string) => {
    const f = path.join(root, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, content);
  };
  const writeJson = (rel: string, obj: unknown) => write(rel, JSON.stringify(obj, null, 2));
  const url = (suffix: string) => `/api/repos/${fixture.project.slug}/guard/${suffix}`;

  function seed() {
    write(DOC, DOC_CONTENT);
    writeJson('.truecourse/scenarios/flows.json', FLOWS_FILE);
    writeJson('.truecourse/scenarios/manifest.json', MANIFEST);
    write(SCENARIO_FILE, SCENARIO_YAML);
    write('.truecourse/scenarios/tasks/tasks-help-smoke.yaml', MANUAL_YAML);
    writeJson('.truecourse/guard/LATEST.json', LATEST);
    writeJson(`.truecourse/guard/runs/${RUN_ID}.json`, LATEST);
    writeJson('.truecourse/guard/result.json', RESULT);
    writeJson('.truecourse/guard/interfaces.json', INTERFACES);
    write(`.truecourse/guard/evidence/${RUN_ID}/${SCENARIO_ID}/transcript.txt`, '$ tasks done 1\n');
  }

  beforeEach(async () => {
    fixture = await setupTestFixture();
    root = fixture.repoPath;
    app = createApp({ serveStatic: false });
  });
  afterEach(async () => {
    await teardownTestFixture(fixture.project.slug);
  });

  // --- The wire contract the client codes against --------------------------

  it('every flow payload validates against its published wire schema', async () => {
    seed();
    // The recipe card rides the flows envelope, so validate the core + that key.
    const flowsSchema = GuardFlowsViewCoreSchema.extend({ recipe: z.unknown() });
    const flows = await request(app).get(url('flows')).expect(200);
    expect(() => flowsSchema.parse(flows.body)).not.toThrow();

    const detail = await request(app).get(url(`flows/${FLOW_ID}`)).expect(200);
    expect(() => GuardFlowDetailSchema.parse(detail.body)).not.toThrow();

    const interfaces = await request(app).get(url('interfaces')).expect(200);
    expect(() => GuardInterfacesViewSchema.parse(interfaces.body)).not.toThrow();

    const latest = await request(app).get(url('latest')).expect(200);
    expect(() => z.array(GuardRunFlowSchema).parse(latest.body.runFlows)).not.toThrow();

    const coverage = await request(app).get(url(`coverage?doc=${encodeURIComponent(DOC)}`)).expect(200);
    for (const section of coverage.body.sections) {
      expect(() => z.array(GuardSectionFlowSchema).parse(section.flows)).not.toThrow();
    }
  });

  // --- Coverage inversion: a section lists FLOWS ----------------------------

  describe('coverage — a section carries its flows, never scenarios', () => {
    it('lists the flows traversing each section with their milestone positions', async () => {
      seed();
      const res = await request(app).get(url(`coverage?doc=${encodeURIComponent(DOC)}`)).expect(200);
      const byAnchor = new Map<string, any>(res.body.sections.map((s: any) => [s.anchor, s]));

      const creating = byAnchor.get('tasks/creating-tasks');
      expect(creating.flows).toHaveLength(1);
      expect(creating.flows[0]).toMatchObject({
        flowId: FLOW_ID,
        title: FLOWS_FILE.flows[0].title,
        epic: false,
        manual: false,
        milestonesInSection: [1],
        milestoneCount: 4,
      });
      // Both surfaces ride the flow: the cli scenario (painted by the run) and the
      // web gap that explains why there is no second scenario.
      expect(creating.flows[0].surfaces).toEqual([
        expect.objectContaining({ surface: 'cli', scenarioId: SCENARIO_ID, status: 'fail', outcome: 'fail', interfaceDrifted: true }),
        expect.objectContaining({
          surface: 'web',
          status: 'web',
          gap: { kind: 'awaiting-driver', driver: 'web', reason: 'the board is browser-only', label: 'awaiting web driver' },
        }),
      ]);
      expect(creating.scenarioIds).toEqual([SCENARIO_ID]);

      // A milestone landing twice in one section reports both positions.
      expect(byAnchor.get('tasks/completing-tasks').flows[0].milestonesInSection).toEqual([3, 4]);
    });

    it('rolls the section up to the WORST status over its flows (a run beats a gap)', async () => {
      seed();
      const res = await request(app).get(url(`coverage?doc=${encodeURIComponent(DOC)}`)).expect(200);
      const listing = res.body.sections.find((s: any) => s.anchor === 'tasks/listing-tasks');
      // Two flows bind this section: the failing lifecycle and the unrealized
      // export (a `no-interface` gap). The failure wins.
      expect(listing.flows.map((f: any) => [f.flowId, f.status])).toEqual([
        [FLOW_ID, 'fail'],
        ['task-export', 'no-interface'],
      ]);
      expect(listing.status).toBe('fail');
    });

    it('groups a hand-written scenario under its Manual pseudo-flow', async () => {
      seed();
      const res = await request(app).get(url(`coverage?doc=${encodeURIComponent(DOC)}`)).expect(200);
      const overview = res.body.sections.find((s: any) => s.anchor === 'tasks');
      expect(overview.flows).toEqual([
        expect.objectContaining({
          flowId: `manual:${MANUAL_ID}`,
          title: '`tasks --help` prints usage',
          manual: true,
          status: 'pass',
          milestoneCount: 0,
        }),
      ]);
      // The section also carries a claim-level `no-claim` gap, but a run outcome
      // outranks a generate-time verdict.
      expect(overview.status).toBe('pass');
    });

    it('still paints a claim-level gap on a section no flow binds', async () => {
      seed();
      // Drop the manual scenario's run so the overview section has no flow at all.
      writeJson('.truecourse/guard/LATEST.json', {
        ...LATEST,
        scenarios: LATEST.scenarios.filter((s) => s.id !== MANUAL_ID),
      });
      const res = await request(app).get(url(`coverage?doc=${encodeURIComponent(DOC)}`)).expect(200);
      const overview = res.body.sections.find((s: any) => s.anchor === 'tasks');
      expect(overview.flows).toEqual([]);
      // No flow, no run — the section's status comes from its gapped CLAIMS, and
      // the reason that names one wins over the claim-less coverage gap.
      expect(overview).toMatchObject({
        status: 'untestable',
        reason: 'implementation detail — nothing observable on any surface',
      });
      expect(guardCoverageWord(overview.status)).toBe('Not testable');
      // Both records still show in the detail — the mix is never hidden.
      expect(overview.claimGaps).toEqual([
        expect.objectContaining({ title: 'Tasks are stored in a local file' }),
        expect.objectContaining({ reason: 'the overview asserts nothing' }),
      ]);
    });

    it('derives a Blocked section from its no-flow claims alone, never a mute bucket', async () => {
      // The reference-store shape: a section whose every claim landed in
      // `noFlowClaims`, with no coverage gap of its own and no flow binding it.
      // Before claim-keyed derivation this read `unguarded` ("Not generated").
      seed();
      // `tasks` is the preamble section: no flow binds it, and with the manual
      // scenario's run dropped it has no verdict either.
      writeJson('.truecourse/scenarios/flows.json', {
        ...FLOWS_FILE,
        noFlowClaims: [
          {
            doc: DOC,
            anchor: 'tasks',
            claimTitle: 'Tasks are managed through the guard CLI',
            reason: 'blocked-on layer 2: no `cli/guard` interface has been derived.',
          },
        ],
      });
      writeJson('.truecourse/guard/result.json', { ...RESULT, coverageGaps: [] });
      writeJson('.truecourse/guard/LATEST.json', {
        ...LATEST,
        scenarios: LATEST.scenarios.filter((s) => s.id !== MANUAL_ID),
      });

      const res = await request(app).get(url(`coverage?doc=${encodeURIComponent(DOC)}`)).expect(200);
      const section = res.body.sections.find((s: any) => s.anchor === 'tasks');
      expect(section.flows).toEqual([]);
      expect(section.status).toBe('no-interface');
      expect(guardCoverageWord(section.status)).toBe('Blocked');
      expect(section.reason).toContain('no `cli/guard` interface');
    });
  });

  // --- Flows tab: list + detail --------------------------------------------

  describe('flows list', () => {
    it('joins the corpus, manifest, run and report into one row per flow', async () => {
      seed();
      const res = await request(app).get(url('flows')).expect(200);
      const byId = new Map<string, any>(res.body.flows.map((f: any) => [f.flowId, f]));

      expect(byId.get(FLOW_ID)).toMatchObject({
        title: FLOWS_FILE.flows[0].title,
        goal: 'Create, list, complete and filter a task from the CLI',
        status: 'fail',
        bucket: 'partial',
        epic: false,
        manual: false,
        milestoneCount: 4,
        sectionCount: 3,
        docs: [DOC],
        // The fixture's finding is a FIDELITY rejection — our own defect, never
        // committed — so it never counts as drift. It rides in `toolDefects`
        // instead, and the flow does not read red because of it.
        findings: 0,
        toolDefects: 1,
        errors: 0,
        interfaceDrifted: true,
      });
      expect(byId.get('task-export')).toMatchObject({
        status: 'no-interface',
        bucket: 'blocked',
        findings: 0,
        toolDefects: 0,
      });
      // Hand-written work is a Manual pseudo-flow, so the drill-down is total.
      expect(byId.get(`manual:${MANUAL_ID}`)).toMatchObject({ manual: true, bucket: 'guarded', status: 'pass' });

      expect(res.body.totals).toEqual({ total: 3, guarded: 1, partial: 1, blocked: 1, ungenerated: 0, manual: 1 });
      expect(res.body.noFlowClaims).toBe(1);
      expect(res.body.synthesized).toBe(true);
      expect(res.body).toMatchObject({ generatedAt: RESULT.generatedAt, runId: RUN_ID, ranAt: LATEST.run.ranAt });
      // Worst-first: the failing flow leads.
      expect(res.body.flows[0].flowId).toBe(FLOW_ID);
    });

    /**
     * A row says which DRIVERS its tests exercise — the step kinds the scenario
     * actually uses, not the scenario-level `driver` field (which names the
     * sandbox world). The Tests list's driver chips narrow on exactly this.
     */
    it('carries the drivers a flow’s tests exercise, and a MIXED test reports both', async () => {
      seed();
      const res = await request(app).get(url('flows')).expect(200);
      const byId = new Map<string, any>(res.body.flows.map((f: any) => [f.flowId, f]));
      // The flow has a cli test AND a web gap: nothing runs on the surface it is
      // still waiting for, so the row drives cli alone.
      expect(byId.get(FLOW_ID).drivers).toEqual(['cli']);
      // A flow with no test ANYWHERE has no steps to read — its declared surface
      // answers instead, so a blocked flow stays reachable by the filter.
      expect(byId.get('task-export').drivers).toEqual(['cli']);

      // The same committed test with a WEB step in it: one sandbox scenario,
      // two drivers, in registry order.
      write(
        SCENARIO_FILE,
        SCENARIO_YAML.replace(
          '  - run: [list, --done]',
          ['  - driver: web', '    navigate: /tasks', '    milestone: 4', '  - run: [list, --done]'].join('\n'),
        ),
      );
      const mixed = await request(app).get(url('flows')).expect(200);
      expect(mixed.body.flows.find((f: any) => f.flowId === FLOW_ID).drivers).toEqual(['cli', 'web']);
    });

    it('is 200 with an empty payload on a fresh repo (the tab renders its CTA)', async () => {
      const res = await request(app).get(url('flows')).expect(200);
      expect(res.body).toEqual({
        flows: [],
        totals: { total: 0, guarded: 0, partial: 0, blocked: 0, ungenerated: 0, manual: 0 },
        noFlowClaims: 0,
        synthesized: false,
        recipe: null,
        generatedAt: null,
        runId: null,
        ranAt: null,
      });
    });

    it('tolerates a missing flow corpus — the manifest still yields flows', async () => {
      seed();
      fs.rmSync(path.join(root, '.truecourse/scenarios/flows.json'));
      const res = await request(app).get(url('flows')).expect(200);
      const row = res.body.flows.find((f: any) => f.flowId === FLOW_ID);
      // No corpus ⇒ no goal/milestones, but the coverage state survives — and the
      // title falls back to the flow's own committed test, never the bare id.
      expect(row).toMatchObject({
        title: 'Tasks are created, listed newest-first, completed and filterable',
        goal: '',
        milestoneCount: 0,
        status: 'fail',
        bucket: 'partial',
      });
      expect(res.body.synthesized).toBe(false);
      expect(res.body.noFlowClaims).toBe(0);
    });
  });

  describe('flow detail', () => {
    it('renders the milestone chain against the live sections, with drift', async () => {
      seed();
      const res = await request(app).get(url(`flows/${FLOW_ID}`)).expect(200);
      expect(res.body).toMatchObject({ flowId: FLOW_ID, status: 'fail', bucket: 'partial', manual: false, epic: false });
      expect(res.body.milestones).toHaveLength(4);
      expect(res.body.milestones[0]).toMatchObject({
        order: 1,
        anchor: 'tasks/creating-tasks',
        headingText: 'Creating tasks',
        live: true,
        boundFingerprint: FP.creating,
        currentFingerprint: FP.creating,
        drifted: false,
      });
      // The flow bound "Completing tasks" before it was edited.
      expect(res.body.milestones[2]).toMatchObject({ anchor: 'tasks/completing-tasks', headingText: 'Completing tasks', drifted: true });
    });

    it('carries the per-surface scenario rows, gaps, interfaces and findings', async () => {
      seed();
      const res = await request(app).get(url(`flows/${FLOW_ID}`)).expect(200);
      expect(res.body.surfaces[0]).toMatchObject({
        surface: 'cli',
        scenarioId: SCENARIO_ID,
        file: SCENARIO_FILE,
        status: 'fail',
        birthPassed: true,
        outcome: 'fail',
        failedMilestone: 3,
        interfaceDrifted: true,
        hasEvidence: true,
        evidencePath: `.truecourse/guard/evidence/${RUN_ID}/${SCENARIO_ID}`,
        interfacePath: ['cli/tasks-add', 'cli/tasks-list', 'cli/tasks-done'],
      });
      expect(res.body.surfaces[0].failure).toMatchObject({ step: 3 });
      expect(res.body.surfaces[1]).toMatchObject({ surface: 'web', status: 'web', birthPassed: false, hasEvidence: false });
      expect(res.body.gaps).toEqual([
        { surface: 'web', kind: 'awaiting-driver', driver: 'web', reason: 'the board is browser-only', label: 'awaiting web driver' },
      ]);
      expect(res.body.interfaceIds).toEqual(['cli/tasks-add', 'cli/tasks-list', 'cli/tasks-done']);
      expect(res.body.findings).toHaveLength(1);
      expect(res.body.findings[0]).toMatchObject({ kind: 'fidelity', flowId: FLOW_ID, failedMilestone: 4 });
    });

    // The board is merged across runs, so the detail's own `runId` is only the run
    // that wrote it LAST. A row carried from an earlier run has to say which run it
    // came from, or the client addresses its transcript to the wrong evidence dir.
    it('addresses each scenario row to the run that produced it', async () => {
      seed();
      const res = await request(app).get(url(`flows/${FLOW_ID}`)).expect(200);
      // Un-merged board: the row came from the envelope's run.
      expect(res.body.surfaces[0]).toMatchObject({ runId: RUN_ID });

      const CARRIED = '2026-07-20T09-00-00Z_older111';
      writeJson('.truecourse/guard/LATEST.json', {
        ...LATEST,
        run: { ...LATEST.run, runId: 'a-later-scoped-run' },
        scenarios: [
          {
            ...LATEST.scenarios[0],
            runId: CARRIED,
            ranAt: '2026-07-20T09:00:00.000Z',
            evidencePath: `.truecourse/guard/evidence/${CARRIED}/${SCENARIO_ID}`,
          },
          LATEST.scenarios[1],
        ],
      });
      const merged = await request(app).get(url(`flows/${FLOW_ID}`)).expect(200);
      expect(merged.body.runId).toBe('a-later-scoped-run');
      expect(merged.body.surfaces[0]).toMatchObject({
        runId: CARRIED,
        evidencePath: `.truecourse/guard/evidence/${CARRIED}/${SCENARIO_ID}`,
      });
    });

    // The run's blocked-precondition annotation reaches the row the detail renders —
    // the dashboard can tell "a setup step broke" from real drift.
    it('carries the blocked-precondition annotation onto the scenario row', async () => {
      seed();
      writeJson('.truecourse/guard/LATEST.json', {
        ...LATEST,
        scenarios: [
          { ...LATEST.scenarios[0], failedMilestone: undefined, blockedPrecondition: true },
          LATEST.scenarios[1],
        ],
      });
      const res = await request(app).get(url(`flows/${FLOW_ID}`)).expect(200);
      expect(res.body.surfaces[0]).toMatchObject({ status: 'fail', blockedPrecondition: true });
    });

    // A run-level REFUSAL is recorded once on the report and names the flows whose
    // validation it cancelled — so every one of them can say what blocked it without
    // the error being duplicated per flow (or, worse, per candidate) in the report.
    it('attributes a run-level refusal to the flows it cancelled, as a refusal-kind error', async () => {
      seed();
      const message = 'external service "hit-pay" is only partly configured: no key was resolved.';
      writeJson('.truecourse/guard/result.json', {
        ...RESULT,
        errors: [{ doc: '(guard run)', anchor: '(refused)', kind: 'refusal', message }],
        refusal: { status: 'missing-external-env', message, flowIds: [FLOW_ID] },
      });

      const blocked = await request(app).get(url(`flows/${FLOW_ID}`)).expect(200);
      expect(blocked.body.errors).toEqual([
        { doc: '(guard run)', anchor: '(refused)', kind: 'refusal', message },
      ]);

      // A flow the refusal does NOT name is untouched by it.
      const other = await request(app).get(url('flows/task-export')).expect(200);
      expect(other.body.errors).toEqual([]);
    });

    // Section attribution is the fallback, not the rule: an error the generator
    // attributed to a flow joins on that id, so a section many flows bind can no
    // longer smear one flow's authoring failure across its neighbours.
    it('joins a flow-attributed error by flow id, not by its section', async () => {
      seed();
      writeJson('.truecourse/guard/result.json', {
        ...RESULT,
        errors: [
          {
            doc: DOC,
            anchor: 'tasks/creating-tasks',
            kind: 'authoring',
            flowId: 'task-export',
            message: 'authoring (cli) invalid yaml',
          },
        ],
      });

      const owner = await request(app).get(url('flows/task-export')).expect(200);
      expect(owner.body.errors).toHaveLength(1);
      // FLOW_ID binds that very section, and still does not inherit the error.
      const neighbour = await request(app).get(url(`flows/${FLOW_ID}`)).expect(200);
      expect(neighbour.body.errors).toEqual([]);
    });

    it('serves a Manual pseudo-flow, and 404s an unknown id', async () => {
      seed();
      const manual = await request(app).get(url(`flows/${encodeURIComponent(`manual:${MANUAL_ID}`)}`)).expect(200);
      expect(manual.body).toMatchObject({ manual: true, title: '`tasks --help` prints usage', milestones: [], status: 'pass' });
      expect(manual.body.surfaces[0]).toMatchObject({ surface: 'cli', scenarioId: MANUAL_ID, birthPassed: true, outcome: 'pass' });

      await request(app).get(url('flows/nope')).expect(404);
    });
  });

  // --- The RAW artifact behind an entity: the store file's own bytes ---------
  //
  // Every artifact-backed entity offers two readings, and the second one must be
  // the FILE — not a re-serialization of the view the first one composed. These
  // pin that: the slice is the stored entry, taken from the real store path.

  describe('raw artifact slices', () => {
    it('serves one flow entry out of scenarios/flows.json, pretty-printed', async () => {
      seed();
      const res = await request(app).get(url(`flow/raw?id=${FLOW_ID}`)).expect(200);
      expect(res.body).toMatchObject({
        id: FLOW_ID,
        file: path.join('.truecourse', 'scenarios', 'flows.json'),
      });
      // The ENTRY, not the whole file: this flow's object and no sibling's.
      expect(JSON.parse(res.body.content)).toEqual(FLOWS_FILE.flows[0]);
      expect(res.body.content).not.toContain('task-export');
      // Pretty-printed — the pane shows a file a human can read.
      expect(res.body.content.split('\n').length).toBeGreaterThan(5);
    });

    it('serves one interface entry out of guard/interfaces.json', async () => {
      seed();
      const res = await request(app).get(url('interface/raw?id=cli/tasks-add')).expect(200);
      expect(res.body).toMatchObject({
        id: 'cli/tasks-add',
        file: path.join('.truecourse', 'guard', 'interfaces.json'),
      });
      expect(JSON.parse(res.body.content)).toEqual(INTERFACES.interfaces[0]);
    });

    it('404s an id the store has no entry for, and 400s a missing id', async () => {
      seed();
      await request(app).get(url('flow/raw?id=nope')).expect(404);
      await request(app).get(url('interface/raw?id=cli/nope')).expect(404);
      await request(app).get(url('flow/raw')).expect(400);
      await request(app).get(url('interface/raw')).expect(400);
    });

    it('404s when the store file itself is absent — never an empty pane', async () => {
      // Nothing seeded: no flows.json, no interfaces.json.
      await request(app).get(url(`flow/raw?id=${FLOW_ID}`)).expect(404);
      await request(app).get(url('interface/raw?id=cli/tasks-add')).expect(404);
    });

    it('reads the file, not the view — a field the view drops still shows', async () => {
      seed();
      // A key no `GuardFlow` view carries. The raw read is plain JSON, so it
      // survives; a schema-parsed read would have silently eaten it.
      writeJson('.truecourse/scenarios/flows.json', {
        ...FLOWS_FILE,
        flows: [{ ...FLOWS_FILE.flows[0], authoredBy: 'a-human' }, FLOWS_FILE.flows[1]],
      });
      const res = await request(app).get(url(`flow/raw?id=${FLOW_ID}`)).expect(200);
      expect(JSON.parse(res.body.content).authoredBy).toBe('a-human');
    });
  });

  // --- The RECIPE artifact: one per repo, and secrets never leave the file ----
  //
  // The recipe is the SINGLETON raw read — a repo has one, so it is addressed by
  // nothing. It is also the only artifact that can carry a secret, and it is
  // COMMITTED: what may be read of it here is exactly what `truecourse guard
  // recipe` prints, which is everything except an inline credential value.

  describe('the recipe artifact', () => {
    const RECIPE_FILE = '.truecourse/scenarios/recipe.json';
    const SECRET = 'sk-live-9f2c-super-secret';
    const recipeWith = (over: Record<string, unknown> = {}) => ({
      build: 'pnpm build',
      entry: ['node', 'dist/tasks.js'],
      env: { TASKS_HOME: '.tmp/tasks' },
      ...over,
    });

    it('serves recipe.json itself, pretty-printed, with NO id required', async () => {
      seed();
      writeJson(RECIPE_FILE, recipeWith());
      const res = await request(app).get(url('recipe/raw')).expect(200);
      expect(res.body.file).toBe(path.join('.truecourse', 'scenarios', 'recipe.json'));
      expect(JSON.parse(res.body.content)).toEqual(recipeWith());
      expect(res.body.content.split('\n').length).toBeGreaterThan(3);
    });

    it('MASKS an inline credential value — the raw read is never the secret door', async () => {
      seed();
      writeJson(
        RECIPE_FILE,
        recipeWith({
          api: {
            serve: ['node', 'server.js'],
            healthPath: '/health',
            credentials: { 'api-key': { header: 'Authorization', value: SECRET } },
            externals: {
              'hit-pay': {
                baseUrlEnv: 'HITPAY_BASE_URL',
                env: { HITPAY_API_KEY: { value: 'hp-live-secret' } },
              },
            },
          },
        }),
      );
      const res = await request(app).get(url('recipe/raw')).expect(200);
      expect(res.body.content).not.toContain(SECRET);
      expect(res.body.content).not.toContain('hp-live-secret');
      const parsed = JSON.parse(res.body.content);
      expect(parsed.api.credentials['api-key'].value).toContain('masked');
      expect(parsed.api.externals['hit-pay'].env.HITPAY_API_KEY.value).toContain('masked');
      // The CAPABILITIES around the secret are not secrets — they all survive.
      expect(parsed.api.credentials['api-key'].header).toBe('Authorization');
      expect(parsed.api.externals['hit-pay'].baseUrlEnv).toBe('HITPAY_BASE_URL');
      expect(parsed.env).toEqual({ TASKS_HOME: '.tmp/tasks' });
    });

    /**
     * The CARD (the flows envelope's `recipe`) carries every surface's
     * preparation, because the Interfaces catalog opens it per surface: the cli's
     * install/build/entrypoint, the api block, and the web block.
     */
    it('carries the install step and the web block on the card, per surface', async () => {
      seed();
      writeJson(
        RECIPE_FILE,
        recipeWith({
          install: 'pnpm install --frozen-lockfile',
          web: { build: 'pnpm build:web', serve: ['node', 'dist/web.js'], healthPath: '/health' },
        }),
      );
      const res = await request(app).get(url('flows')).expect(200);
      expect(res.body.recipe).toMatchObject({
        install: 'pnpm install --frozen-lockfile',
        build: 'pnpm build',
        entry: ['node', 'dist/tasks.js'],
        web: { build: 'pnpm build:web', serve: ['node', 'dist/web.js'], healthPath: '/health' },
      });
    });

    it('reports no install and no web surface when the recipe declares neither', async () => {
      seed();
      writeJson(RECIPE_FILE, recipeWith());
      const res = await request(app).get(url('flows')).expect(200);
      expect(res.body.recipe).toMatchObject({ install: null, web: null });
    });

    it('404s with no recipe at all, and for one that does not parse', async () => {
      seed();
      await request(app).get(url('recipe/raw')).expect(404);
      write(RECIPE_FILE, '{ "build": ');
      // Unparseable ⇒ absent, never shown: a secret in it could not be found to hide.
      await request(app).get(url('recipe/raw')).expect(404);
    });
  });

  // --- An orphaned flow: kept for its test, no longer derived from the specs ---

  describe('a flow no synthesized flow claims any more', () => {
    const ORPHAN_ID = 'task-purge';
    const ORPHAN_SCENARIO = `${ORPHAN_ID}.cli.1`;
    const ORPHAN_FILE = path.join('.truecourse', 'scenarios', 'tasks', `${ORPHAN_SCENARIO}.yaml`);
    const ORPHAN_YAML = [
      'guard: 3',
      `id: ${ORPHAN_SCENARIO}`,
      'title: Purged tasks leave the list',
      `flow: { id: ${ORPHAN_ID}, fingerprint: "sha256:purge" }`,
      'binds:',
      `  - { doc: ${DOC}, section: tasks/listing-tasks, fingerprint: "${FP.listing}" }`,
      'driver: cli',
      'steps:',
      '  - run: [purge, --force]',
      '    expect: { exit: 0 }',
      '',
    ].join('\n');

    /**
     * The generate that recomposed the corpus left this entry behind, marked: it
     * is not in `flows.json` (so no title, goal or milestones), but its committed
     * test is real coverage. The lifecycle flow is marked TOO — and must not read
     * as orphaned, because synthesis still produces it.
     */
    function seedOrphan() {
      seed();
      writeJson('.truecourse/scenarios/manifest.json', {
        ...MANIFEST,
        flows: [
          { ...MANIFEST.flows[0], orphaned: true },
          MANIFEST.flows[1],
          {
            flowId: ORPHAN_ID,
            flowFingerprint: 'sha256:purge',
            bindings: [{ doc: DOC, anchor: 'tasks/listing-tasks', fingerprint: FP.listing }],
            scenarios: [{ id: ORPHAN_SCENARIO, surface: 'cli', status: 'passing' }],
            generationInputsHash: 'sha256:gen',
            gaps: [],
            orphaned: true,
          },
        ],
      });
      write(ORPHAN_FILE, ORPHAN_YAML);
    }

    it('flags the row on the list — and never one the flow corpus still carries', async () => {
      seedOrphan();
      const res = await request(app).get(url('flows')).expect(200);
      const byId = new Map<string, any>(res.body.flows.map((f: any) => [f.flowId, f]));

      // No corpus entry ⇒ no goal and no milestones: the flag is what lets the row
      // say why. The TITLE still reads as prose — its committed test names it, and
      // a flow id is an engine handle, never UI copy.
      expect(byId.get(ORPHAN_ID)).toMatchObject({
        orphaned: true,
        title: 'Purged tasks leave the list',
        goal: '',
        milestoneCount: 0,
      });
      // Still synthesized ⇒ derived, whatever a stale manifest entry says.
      expect(byId.get(FLOW_ID).orphaned).toBeUndefined();
      expect(byId.get(`manual:${MANUAL_ID}`).orphaned).toBeUndefined();
    });

    it('flags the detail, where the empty goal and milestone chain need explaining', async () => {
      seedOrphan();
      const res = await request(app).get(url(`flows/${ORPHAN_ID}`)).expect(200);
      expect(() => GuardFlowDetailSchema.parse(res.body)).not.toThrow();
      expect(res.body).toMatchObject({ flowId: ORPHAN_ID, orphaned: true, goal: '', milestones: [], gaps: [] });
      // Its test rides the payload exactly like any other flow's.
      expect(res.body.surfaces).toEqual([
        expect.objectContaining({
          surface: 'cli',
          scenarioId: ORPHAN_SCENARIO,
          file: ORPHAN_FILE,
          title: 'Purged tasks leave the list',
          birthPassed: true,
        }),
      ]);

      const derived = await request(app).get(url(`flows/${FLOW_ID}`)).expect(200);
      expect(derived.body.orphaned).toBeUndefined();
    });
  });

  // --- Interfaces tab --------------------------------------------------------

  describe('interfaces', () => {
    it('returns the catalog with the reverse index onto the flows', async () => {
      seed();
      const res = await request(app).get(url('interfaces')).expect(200);
      expect(res.body).toMatchObject({ mapped: true, generatedAt: INTERFACES.generatedAt, recipeFingerprint: 'sha256:r' });
      const byId = new Map<string, any>(res.body.interfaces.map((j: any) => [j.id, j]));
      expect(byId.get('cli/tasks-add')).toMatchObject({
        type: 'cli',
        title: 'tasks add',
        // This manifest carries no per-surface plan record — usage falls back to
        // the committed scenario's own interface path, and reads as realized.
        flows: [{ flowId: FLOW_ID, title: FLOWS_FILE.flows[0].title, realized: true }],
        scenarioIds: [SCENARIO_ID],
        source: 'tree',
      });
      // NOTHING references `tasks purge` — no scenario, no plan. The candidate spec gap.
      expect(byId.get('cli/tasks-purge').flows).toEqual([]);
      expect(res.body.totals).toEqual({ interfaces: 4, detectedSurfaces: 1, grounded: 3, ungrounded: 1 });
    });

    it('counts a flow that MATCHED the interface but was blocked before authoring', async () => {
      seed();
      // `task-export` matched `tasks purge`, then authoring refused: no scenario
      // exists, but the plan record proves the spec reaches this code path.
      writeJson('.truecourse/scenarios/manifest.json', {
        ...MANIFEST,
        flows: [
          MANIFEST.flows[0],
          {
            ...MANIFEST.flows[1],
            interfaces: [{ surface: 'cli', interfaceIds: ['cli/tasks-purge'] }],
            gaps: [
              {
                surface: 'cli',
                kind: 'blocked-on',
                reason: 'blocked on credentials: A user exports the task list',
              },
            ],
          },
        ],
      });

      const res = await request(app).get(url('interfaces')).expect(200);
      const purge = res.body.interfaces.find((j: any) => j.id === 'cli/tasks-purge');
      expect(purge.flows).toEqual([
        {
          flowId: 'task-export',
          title: FLOWS_FILE.flows[1].title,
          realized: false,
          gap: {
            kind: 'blocked-on',
            reason: 'blocked on credentials: A user exports the task list',
            label: 'blocked on',
          },
        },
      ]);
      // No scenario was written — the interface is used, not exercised.
      expect(purge.scenarioIds).toEqual([]);
      // …and it no longer counts as code the spec never mentions.
      expect(res.body.totals).toMatchObject({ grounded: 4, ungrounded: 0 });
    });

    it('a written scenario wins over the plan record — the usage is realized, not blocked', async () => {
      seed();
      // The plan says cli/tasks-add was matched AND a gap exists on that surface;
      // the committed scenario grounds on it, so the union reads realized.
      writeJson('.truecourse/scenarios/manifest.json', {
        ...MANIFEST,
        flows: [
          {
            ...MANIFEST.flows[0],
            interfaces: [{ surface: 'cli', interfaceIds: ['cli/tasks-add'] }],
            gaps: [{ surface: 'cli', kind: 'blocked-on', reason: 'blocked on db: lifecycle' }],
          },
          MANIFEST.flows[1],
        ],
      });

      const res = await request(app).get(url('interfaces')).expect(200);
      const add = res.body.interfaces.find((j: any) => j.id === 'cli/tasks-add');
      expect(add.flows).toEqual([{ flowId: FLOW_ID, title: FLOWS_FILE.flows[0].title, realized: true }]);
    });

    it('banners every registry surface with its runnable flag', async () => {
      seed();
      const res = await request(app).get(url('interfaces')).expect(200);
      const bySurface = new Map<string, any>(res.body.surfaces.map((s: any) => [s.surface, s]));
      expect(bySurface.get('cli')).toMatchObject({ label: 'CLI', runnable: true, interfaces: 4, detected: true, source: 'tree' });
      expect(bySurface.get('web')).toMatchObject({ label: 'Web', runnable: false, waitingLabel: 'Needs web driver', interfaces: 0, detected: false });
    });

    it('is 200 with a clean empty payload when nothing was mapped', async () => {
      const res = await request(app).get(url('interfaces')).expect(200);
      expect(res.body).toMatchObject({ mapped: false, generatedAt: null, recipeFingerprint: null, interfaces: [] });
      expect(res.body.totals).toEqual({ interfaces: 0, detectedSurfaces: 0, grounded: 0, ungrounded: 0 });
      // The banner still lists every surface so the tab renders without a null check.
      expect(res.body.surfaces.length).toBeGreaterThan(0);
      expect(res.body.surfaces.every((s: any) => s.detected === false)).toBe(true);
    });
  });

  // --- Run payloads: the flow instance -------------------------------------

  describe('run payloads carry the flow instance join', () => {
    it('joins the run flows onto /latest so a result paints without a second fetch', async () => {
      seed();
      const res = await request(app).get(url('latest')).expect(200);
      expect(res.body.run.runId).toBe(RUN_ID);
      expect(res.body.scenarios[0]).toMatchObject({ flowId: FLOW_ID, failedMilestone: 3, interfaceDrifted: true });
      expect(res.body.runFlows).toHaveLength(1);
      expect(res.body.runFlows[0]).toMatchObject({ flowId: FLOW_ID, title: FLOWS_FILE.flows[0].title, epic: false });
      expect(res.body.runFlows[0].milestones.map((m: any) => m.order)).toEqual([1, 2, 3, 4]);
      expect(res.body.runFlows[0].milestones[2]).toMatchObject({
        anchor: 'tasks/completing-tasks',
        claimTitle: 'A task can be marked done',
      });
    });

    it('joins the same flows onto a past run snapshot', async () => {
      seed();
      const res = await request(app).get(url(`runs/${RUN_ID}`)).expect(200);
      expect(res.body.runFlows.map((f: any) => f.flowId)).toEqual([FLOW_ID]);
    });

    it('joins nothing when the run references no flow (hand-written only)', async () => {
      seed();
      writeJson('.truecourse/guard/LATEST.json', {
        ...LATEST,
        scenarios: LATEST.scenarios.filter((s) => s.id === MANUAL_ID),
      });
      const res = await request(app).get(url('latest')).expect(200);
      expect(res.body.runFlows).toEqual([]);
    });
  });

  // --- A test committed FAILING at birth, before any run -------------------
  //
  // The dogfood shape that used to read as an EMPTY flow: the generate authored a
  // scenario, birth failed, and nothing was committed — so the flow's surfaces
  // list was `[]` and the red was reachable only through the report's findings.
  // Guard commits the failing test now, so the surface row exists from generate
  // time and carries its own failure.

  describe('a flow whose test was committed red at birth', () => {
    const RED_FLOW = 'handle-pathological-files-without-freezing-analyze';
    const RED_SCENARIO = `${RED_FLOW}.cli.1`;
    const RED_FILE = path.join('.truecourse', 'scenarios', 'tasks', `${RED_SCENARIO}.yaml`);
    const RED_EVIDENCE = `.truecourse/guard/evidence/birth/${RED_SCENARIO}`;

    function seedBornRed() {
      write(DOC, DOC_CONTENT);
      writeJson('.truecourse/scenarios/flows.json', {
        version: 1,
        generatedAt: '2026-07-26T09:00:00.000Z',
        flows: [
          {
            id: RED_FLOW,
            title: 'Analyze survives a pathological file',
            goal: 'Analyze a repo containing a minified bundle without freezing',
            fingerprint: 'sha256:red',
            milestones: [
              { order: 1, doc: DOC, anchor: 'tasks/listing-tasks', claimTitle: 'The list shows tasks newest-first' },
            ],
            bindings: [{ doc: DOC, anchor: 'tasks/listing-tasks', fingerprint: FP.listing }],
            composedOf: [],
            synthesisInputsHash: 'sha256:inputs',
          },
        ],
        noFlowClaims: [],
      });
      writeJson('.truecourse/scenarios/manifest.json', {
        version: 3,
        flows: [
          {
            flowId: RED_FLOW,
            flowFingerprint: 'sha256:red',
            bindings: [{ doc: DOC, anchor: 'tasks/listing-tasks', fingerprint: FP.listing }],
            // Committed with the status its birth execution gave it.
            scenarios: [{ id: RED_SCENARIO, surface: 'cli', status: 'failing' }],
            generationInputsHash: 'sha256:gen',
            gaps: [],
          },
        ],
      });
      write(
        RED_FILE,
        [
          'guard: 3',
          `id: ${RED_SCENARIO}`,
          'title: Analyze survives a pathological file',
          `flow: { id: ${RED_FLOW}, fingerprint: "sha256:red" }`,
          'binds:',
          `  - { doc: ${DOC}, section: tasks/listing-tasks, fingerprint: "${FP.listing}" }`,
          'driver: cli',
          'steps:',
          '  - run: [list]',
          '    expect: { exit: 0 }',
          '    milestone: 1',
          '',
        ].join('\n'),
      );
      writeJson('.truecourse/guard/result.json', {
        generatedAt: '2026-07-26T09:00:00.000Z',
        status: 'ok',
        sectionsTotal: 4,
        sectionsChanged: 1,
        skippedUnchanged: 3,
        noChanges: false,
        written: [
          {
            id: RED_SCENARIO,
            title: 'Analyze survives a pathological file',
            doc: DOC,
            anchor: 'tasks/listing-tasks',
            file: RED_FILE,
            flowId: RED_FLOW,
            surface: 'cli',
            status: 'failing',
          },
        ],
        coverageGaps: [],
        birthFindings: [
          {
            doc: DOC,
            anchor: 'tasks/listing-tasks',
            scenarioId: RED_SCENARIO,
            committed: true,
            file: RED_FILE,
            title: 'Analyze survives a pathological file',
            step: 1,
            expected: 'exit 0',
            actual: 'exit 1: analyze hung on the bundle',
            stderr: 'timeout after 120s',
            evidencePath: RED_EVIDENCE,
            flowId: RED_FLOW,
            surface: 'cli',
            failedMilestone: 1,
            triage: {
              verdict: 'code-drift',
              confidence: 'high',
              brief: 'The doc promises analyze finishes; the run hung on a bundle.',
              recommendation: 'Bound the per-file work, or document the limit.',
            },
          },
        ],
        errors: [],
        extractionFailures: [],
        orphaned: [],
        flows: {
          total: 1,
          settled: 1,
          unsettled: 0,
          skipped: 0,
          dismissed: 0,
          orphaned: 0,
          subsumed: 0,
          noFlowClaims: 0,
          unsettledAreas: [],
        },
      });
      // No LATEST.json: the test has never been through a `guard run`.
    }

    it('gives the section a NON-EMPTY surface list painted from the birth status', async () => {
      seedBornRed();
      const res = await request(app).get(url(`coverage?doc=${encodeURIComponent(DOC)}`)).expect(200);
      const listing = res.body.sections.find((s: any) => s.anchor === 'tasks/listing-tasks');

      expect(listing.flows).toHaveLength(1);
      expect(listing.flows[0].surfaces).toEqual([
        expect.objectContaining({ surface: 'cli', scenarioId: RED_SCENARIO, status: 'fail', stage: 'birth' }),
      ]);
      // No run has an outcome for it, so the row carries none — only the status.
      expect(listing.flows[0].surfaces[0].outcome).toBeUndefined();
      expect(listing.flows[0].status).toBe('fail');
      expect(listing.status).toBe('fail');
      expect(listing.scenarioIds).toEqual([RED_SCENARIO]);
    });

    it('renders the flow detail row with the BIRTH failure and its evidence pointer', async () => {
      seedBornRed();
      const res = await request(app).get(url(`flows/${RED_FLOW}`)).expect(200);
      expect(() => GuardFlowDetailSchema.parse(res.body)).not.toThrow();

      expect(res.body).toMatchObject({ status: 'fail', bucket: 'guarded' });
      expect(res.body.surfaces).toHaveLength(1);
      expect(res.body.surfaces[0]).toMatchObject({
        surface: 'cli',
        scenarioId: RED_SCENARIO,
        file: RED_FILE,
        status: 'fail',
        stage: 'birth',
        // A committed test is NOT green by construction any more.
        birthPassed: false,
        failedMilestone: 1,
        hasEvidence: true,
        evidencePath: RED_EVIDENCE,
      });
      expect(res.body.surfaces[0].failure).toEqual({
        step: 1,
        expected: 'exit 0',
        actual: 'exit 1: analyze hung on the bundle',
        stderr: 'timeout after 120s',
      });
      // Transitional: the same result still rides `findings`, now naming its test.
      expect(res.body.findings[0]).toMatchObject({ scenarioId: RED_SCENARIO, committed: true });
    });

    // The failure's row carries WHOSE fault it is, so the detail can
    // say "code drift" beside the status instead of only "it failed".
    it('carries the triage verdict on the birth row', async () => {
      seedBornRed();
      const res = await request(app).get(url(`flows/${RED_FLOW}`)).expect(200);
      expect(res.body.surfaces[0].triage).toMatchObject({ verdict: 'code-drift', confidence: 'high' });
    });

    it('reads the verdict off the MANIFEST diagnosis when the report is gone', async () => {
      seedBornRed();
      // `guard/result.json` is gitignored: a fresh clone has the committed manifest
      // and the committed test, and nothing else. The diagnosis rides the manifest
      // for exactly this reason, so the verdict survives.
      const manifest = JSON.parse(
        fs.readFileSync(path.join(fixture.repoPath, '.truecourse/scenarios/manifest.json'), 'utf-8'),
      );
      manifest.flows[0].scenarios[0].diagnosis = {
        doc: DOC,
        anchor: 'tasks/listing-tasks',
        title: 'Analyze survives a pathological file',
        step: 1,
        expected: 'exit 0',
        actual: 'exit 1: analyze hung on the bundle',
        file: RED_FILE,
        failedMilestone: 1,
        triage: {
          verdict: 'doc-drift',
          confidence: 'medium',
          brief: 'The section overstates what analyze guarantees.',
          recommendation: 'Soften the promise, or bound the work.',
        },
      };
      writeJson('.truecourse/scenarios/manifest.json', manifest);
      fs.rmSync(path.join(fixture.repoPath, '.truecourse/guard/result.json'));

      const res = await request(app).get(url(`flows/${RED_FLOW}`)).expect(200);
      expect(res.body.surfaces[0].triage).toMatchObject({ verdict: 'doc-drift', confidence: 'medium' });
    });

    it('lets a later RUN outcome override the stored birth status', async () => {
      seedBornRed();
      // The code got fixed and the committed red test now passes.
      writeJson('.truecourse/guard/LATEST.json', {
        run: {
          runId: RUN_ID,
          ranAt: '2026-07-26T10:00:00.000Z',
          branch: 'main',
          commit: 'c0ffee',
          recipeFingerprint: 'sha256:r',
          scenarioFormat: 3,
        },
        summary: { total: 1, pass: 1, fail: 0, stale: 0, orphaned: 0, error: 0 },
        scenarios: [
          {
            id: RED_SCENARIO,
            title: 'Analyze survives a pathological file',
            binds: { doc: DOC, section: 'tasks/listing-tasks', fingerprint: FP.listing },
            outcome: 'pass',
            durationMs: 40,
            flowId: RED_FLOW,
          },
        ],
        sections: [],
      });

      const res = await request(app).get(url(`flows/${RED_FLOW}`)).expect(200);
      expect(res.body.status).toBe('pass');
      expect(res.body.surfaces[0]).toMatchObject({ status: 'pass', outcome: 'pass', stage: 'run' });
      // The birth failure no longer speaks for the row — the run does.
      expect(res.body.surfaces[0].failure).toBeUndefined();
    });

    // --- A test that never executed AT ALL ---------------------------------
    //
    // A hand-authored corpus has no birth execution behind it. `passing` would be
    // a green nothing ever earned, so the manifest says `never-run` and every
    // surface that reads it says so too.

    describe('and its sibling that has NEVER executed', () => {
      function seedNeverRun() {
        seedBornRed();
        const manifest = JSON.parse(
          fs.readFileSync(path.join(fixture.repoPath, '.truecourse/scenarios/manifest.json'), 'utf-8'),
        );
        manifest.flows[0].scenarios[0].status = 'never-run';
        writeJson('.truecourse/scenarios/manifest.json', manifest);
        // Nothing else claims a verdict: no generate report, no run.
        fs.rmSync(path.join(fixture.repoPath, '.truecourse/guard/result.json'));
      }

      it('paints the surface `never-run` — never `guarded`, which reads as passing', async () => {
        seedNeverRun();
        const res = await request(app).get(url(`flows/${RED_FLOW}`)).expect(200);
        expect(() => GuardFlowDetailSchema.parse(res.body)).not.toThrow();
        expect(res.body.surfaces[0]).toMatchObject({
          scenarioId: RED_SCENARIO,
          status: 'never-run',
          // No execution decided it, so no birth pass either.
          birthPassed: false,
        });
        expect(res.body.status).toBe('never-run');
      });

      it('rolls the section up as never-run, and the FIRST run overrides it', async () => {
        seedNeverRun();
        const coverage = await request(app).get(url(`coverage?doc=${encodeURIComponent(DOC)}`)).expect(200);
        const listing = coverage.body.sections.find((s: any) => s.anchor === 'tasks/listing-tasks');
        expect(listing.status).toBe('never-run');

        writeJson('.truecourse/guard/LATEST.json', {
          run: {
            runId: RUN_ID,
            ranAt: '2026-07-26T10:00:00.000Z',
            branch: 'main',
            commit: 'c0ffee',
            recipeFingerprint: 'sha256:r',
            scenarioFormat: 3,
          },
          summary: { total: 1, pass: 1, fail: 0, stale: 0, orphaned: 0, error: 0 },
          scenarios: [
            {
              id: RED_SCENARIO,
              title: 'Analyze survives a pathological file',
              binds: { doc: DOC, section: 'tasks/listing-tasks', fingerprint: FP.listing },
              outcome: 'pass',
              durationMs: 40,
              flowId: RED_FLOW,
            },
          ],
          sections: [],
        });
        const res = await request(app).get(url(`flows/${RED_FLOW}`)).expect(200);
        expect(res.body.surfaces[0]).toMatchObject({ status: 'pass', stage: 'run' });
      });
    });
  });
});
