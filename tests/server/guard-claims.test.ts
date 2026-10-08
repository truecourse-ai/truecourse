import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { type Express } from 'express';
import { createTestApp } from '../helpers/test-app';
import { GuardClaimsViewSchema, claimId, parseDocTree, sentenceKey, type Claim } from '../../packages/shared/src/index';
import { setupTestFixture, teardownTestFixture, type TestFixture } from '../helpers/test-fixture';
import { installWorkTreeGuardStore, resetGuardStore } from '../helpers/work-tree-guard-store';
import { installMemoryGuardOverlays, resetGuardOverlayStore } from '../helpers/memory-guard-overlays';
import { installWorkTreeDocReader, resetRepoDocReader } from '../helpers/work-tree-doc-reader';

/**
 * The Claims read surface: the claim corpus with the trace from a claim to the
 * flows that carry it and the scenario steps that prove it, plus the claims
 * judged untestable beside it.
 *
 * The fixture is a frontmatter-titled spec doc whose claims are read from its
 * own sentences, the lead's and a section's alike.
 */

const DOC = 'docs/specs/tasks.md';
const DOC_CONTENT = [
  '---',
  'title: "Tasks"',
  '---',
  '',
  '`tasks add <title>` creates a task and prints its id.',
  '',
  'Tasks are the heart of the product.',
  '',
  '## Listing tasks',
  '',
  '`tasks list` prints every open task.',
  '',
  'Overdue tasks print in red.',
  '',
].join('\n');

const TREE = parseDocTree(DOC, DOC_CONTENT);
/** The key of the doc's sentence that starts with `prefix`. */
const keyOf = (prefix: string): string => {
  const s = TREE.sentences.find((x) => x.text.startsWith(prefix));
  if (!s) throw new Error(`no sentence starts with "${prefix}"`);
  return sentenceKey(s.text, s.repeat);
};

const claimOf = (prefix: string, statement: string, testable: Claim['testable'] = true): Claim => {
  const sentences = [keyOf(prefix)];
  return { id: claimId(DOC, sentences), doc: DOC, sentences, subject: 'tasks', statement, areas: [], testable };
};

const ADD = claimOf('`tasks add', 'add creates a task and prints its id');
const LIST = claimOf('`tasks list', 'list prints every open task');
const COLOUR = claimOf('Overdue', 'overdue tasks print in red');
const HEART = claimOf('Tasks are', 'Tasks are the heart of the product.', { reason: 'not-observable' });

const CLAIMS = {
  version: 1,
  generatedAt: '2026-08-07T00:00:00.000Z',
  claims: [ADD, LIST, COLOUR, HEART],
};

const FLOWS = {
  version: 1,
  generatedAt: '2026-08-07T00:00:00.000Z',
  flows: [
    {
      id: 'add-then-list',
      title: 'A developer adds a task and lists it',
      goal: 'Add a task, then see it',
      fingerprint: 'sha256:f',
      milestones: [
        { order: 1, doc: DOC, claimId: ADD.id, claimTitle: ADD.statement, sentences: ADD.sentences, note: 'the create half' },
        { order: 2, doc: DOC, claimId: LIST.id, claimTitle: LIST.statement, sentences: LIST.sentences },
      ],
      bindings: [{ doc: DOC, sentences: [...ADD.sentences, ...LIST.sentences] }],
      composedOf: [],
      synthesisInputsHash: 'sha256:i',
    },
  ],
  noFlowClaims: [{ claimId: COLOUR.id, reason: 'colour is not observable in a pipe' }],
};

const MANIFEST = {
  version: 1,
  flows: [
    {
      flowId: 'add-then-list',
      flowFingerprint: 'sha256:f',
      bindings: FLOWS.flows[0].bindings,
      scenarios: [{ id: 'add-then-list.cli.1', drivers: ['cli'], status: 'never-run', milestoneCoverage: [{ milestone: 1, driver: 'cli' }, { milestone: 2, driver: 'cli' }] }],
      interfaces: [],
      generationInputsHash: null,
      gaps: [],
    },
  ],
};

const SCENARIO = {
  id: 'add-then-list.cli.1',
  title: 'A developer adds a task and lists it',
  driver: 'cli',
  flow: { id: 'add-then-list', fingerprint: 'sha256:f' },
  binds: [{ doc: DOC, sentences: [...ADD.sentences, ...LIST.sentences] }],
  steps: [
    { run: ['add', 'write the docs'], expect: { exit: 0 }, milestone: [1, ADD.id] },
    { run: ['list'], expect: { exit: 0 }, milestone: [2, LIST.id] },
    { run: ['list', '--all'], expect: { exit: 0 } },
  ],
  normalize: [],
};

/** A minimal run store marking the one scenario with `outcome` — the ledger is
 *  RUN-AWARE, so "proven" needs a green run behind it, not just an authored step. */
const latestWith = (outcome: 'pass' | 'fail') => ({
  run: {
    runId: '2026-08-14T00-00-00Z_test',
    ranAt: '2026-08-14T00:00:00.000Z',
    branch: 'main',
    commit: null,
    recipeFingerprint: 'sha256:r',
  },
  summary: {
    total: 1,
    pass: outcome === 'pass' ? 1 : 0,
    fail: outcome === 'fail' ? 1 : 0,
    stale: 0,
    orphaned: 0,
    error: 0,
    blocked: 0,
  },
  scenarios: [
    {
      id: SCENARIO.id,
      title: SCENARIO.title,
      binds: SCENARIO.binds[0],
      outcome,
      durationMs: 5,
    },
  ],
});

describe('GET /guard/claims', () => {
  let fixture: TestFixture;
  let root: string;
  let app: Express;

  const url = (suffix: string) => `/api/repos/${fixture.project.slug}/guard/${suffix}`;
  const write = (rel: string, body: string) => {
    const target = path.join(root, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
  };
  const writeJson = (rel: string, body: unknown) => write(rel, JSON.stringify(body, null, 2));

  function seed(): void {
    write(DOC, DOC_CONTENT);
    writeJson('.truecourse/scenarios/recipe.json', { build: 'true', entry: ['tasks'] });
    writeJson('.truecourse/scenarios/claims.json', CLAIMS);
    writeJson('.truecourse/scenarios/flows.json', FLOWS);
    writeJson('.truecourse/scenarios/manifest.json', MANIFEST);
    writeJson('.truecourse/scenarios/tasks/add-then-list.cli.1.yaml', SCENARIO);
  }

  beforeEach(async () => {
    installWorkTreeGuardStore();
    installMemoryGuardOverlays();
    installWorkTreeDocReader();
    fixture = await setupTestFixture();
    root = fixture.repoPath;
    app = createTestApp();
  });
  afterEach(async () => {
    await teardownTestFixture(fixture.project.slug);
    resetGuardStore();
    resetGuardOverlayStore();
    resetRepoDocReader();
  });

  it('answers 200 with the empty view when nothing has been extracted', async () => {
    const res = await request(app).get(url('claims')).expect(200);
    expect(() => GuardClaimsViewSchema.parse(res.body)).not.toThrow();
    expect(res.body.extracted).toBe(false);
    expect(res.body.claims).toEqual([]);
    expect(res.body.totals.claims).toBe(0);
  });

  it('validates against its published wire schema', async () => {
    seed();
    const res = await request(app).get(url('claims')).expect(200);
    expect(() => GuardClaimsViewSchema.parse(res.body)).not.toThrow();
  });

  it('carries the statement and the sentences it is read from, and no section', async () => {
    seed();
    const res = await request(app).get(url('claims')).expect(200);
    const add = res.body.claims.find((c: { id: string }) => c.id === ADD.id);
    expect(add).toMatchObject({
      doc: DOC,
      statement: ADD.statement,
      sentences: ADD.sentences,
    });
    expect(add).not.toHaveProperty('anchor');
    expect(add).not.toHaveProperty('headingText');
  });

  it('traces a claim to the flow that carries it and the steps that prove it', async () => {
    seed();
    writeJson('.truecourse/guard/LATEST.json', latestWith('pass'));
    const res = await request(app).get(url('claims')).expect(200);
    const add = res.body.claims.find((c: { id: string }) => c.id === ADD.id);
    expect(add.flows).toHaveLength(1);
    expect(add.flows[0]).toMatchObject({
      flowId: 'add-then-list',
      title: FLOWS.flows[0].title,
      status: 'pass',
      milestoneOrders: [1],
      milestoneCount: 2,
    });
    expect(add.scenarios).toEqual([
      { scenarioId: 'add-then-list.cli.1', title: SCENARIO.title, steps: [1], outcome: 'pass' },
    ]);
    expect(add.status).toBe('pass');
  });

  it('RUN-AWARE: an authored test with no run yet reads never-run, never proven', async () => {
    seed();
    const res = await request(app).get(url('claims')).expect(200);
    const add = res.body.claims.find((c: { id: string }) => c.id === ADD.id);
    // The proof step exists (the trace is intact) but nothing has executed it.
    expect(add.scenarios).toEqual([
      { scenarioId: 'add-then-list.cli.1', title: SCENARIO.title, steps: [1] },
    ]);
    expect(add.status).toBe('never-run');
  });

  it('RUN-AWARE: a test the latest run failed reads fail, never proven', async () => {
    seed();
    writeJson('.truecourse/guard/LATEST.json', latestWith('fail'));
    const res = await request(app).get(url('claims')).expect(200);
    const add = res.body.claims.find((c: { id: string }) => c.id === ADD.id);
    expect(add.status).toBe('fail');
    expect(add.scenarios[0].outcome).toBe('fail');
    expect(res.body.totals.byStatus.failed).toBe(2);
    expect(res.body.totals.byStatus.succeeded).toBe(0);
  });

  it('keys coverage on the claim, so a claim no flow carries wears the reason the corpus gave', async () => {
    seed();
    const res = await request(app).get(url('claims')).expect(200);
    const colour = res.body.claims.find((c: { id: string }) => c.id === COLOUR.id);
    expect(colour).toMatchObject({
      status: 'untestable',
      reason: 'colour is not observable in a pipe',
      flows: [],
      scenarios: [],
    });
  });

  it('lists the untestable claims with their reasons, apart from the testable ones', async () => {
    seed();
    const res = await request(app).get(url('claims')).expect(200);
    expect(res.body.untestable).toEqual([
      { id: HEART.id, doc: DOC, statement: HEART.statement, reason: 'not-observable' },
    ]);
    expect(res.body.claims.map((c: { id: string }) => c.id)).not.toContain(HEART.id);
  });

  it('totals the five words over every claim, so the denominator is always visible', async () => {
    seed();
    writeJson('.truecourse/guard/LATEST.json', latestWith('pass'));
    const res = await request(app).get(url('claims')).expect(200);
    expect(res.body.totals).toEqual({
      claims: 3,
      byStatus: { failed: 0, blocked: 0, 'never-run': 0, 'partially-succeeded': 0, succeeded: 2, 'not-testable': 1 },
      dismissed: 0,
      untestable: 1,
    });
  });

  it('narrows by status with ?status=', async () => {
    seed();
    writeJson('.truecourse/guard/LATEST.json', latestWith('pass'));
    const res = await request(app).get(url('claims?status=not-testable')).expect(200);
    expect(res.body.claims.map((c: { id: string }) => c.id)).toEqual([COLOUR.id]);
    // The totals stay the whole repository's.
    expect(res.body.totals.claims).toBe(3);
  });

  // The claim detail's second reading: the entry as `claims.json` stores it.
  describe('GET /guard/claim/raw', () => {
    it('serves one claim entry out of scenarios/claims.json', async () => {
      seed();
      const res = await request(app).get(url(`claim/raw?id=${encodeURIComponent(ADD.id)}`)).expect(200);
      expect(res.body).toMatchObject({
        id: ADD.id,
        file: path.join('.truecourse', 'scenarios', 'claims.json'),
      });
      // The ENTRY as stored — verbatim, with every field, and no sibling's.
      expect(JSON.parse(res.body.content)).toEqual(ADD);
      expect(res.body.content).not.toContain(LIST.id);
    });

    it('404s an unknown id, an absent store, and 400s a missing id', async () => {
      await request(app).get(url(`claim/raw?id=${encodeURIComponent(ADD.id)}`)).expect(404);
      seed();
      await request(app).get(url('claim/raw?id=nope')).expect(404);
      await request(app).get(url('claim/raw')).expect(400);
    });

    it('serves an untestable claim too — every claim carries an id', async () => {
      seed();
      const res = await request(app).get(url(`claim/raw?id=${encodeURIComponent(HEART.id)}`)).expect(200);
      expect(JSON.parse(res.body.content)).toEqual(HEART);
    });
  });
});
