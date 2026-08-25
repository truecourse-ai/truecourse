import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { type Express } from 'express';
import { createApp } from '../../apps/dashboard/server/src/app';
import { GuardClaimsViewSchema } from '../../packages/shared/src/index';
import { claimContentHash } from '../../packages/shared/src/guard/claims';
import { setupTestFixture, teardownTestFixture, type TestFixture } from '../helpers/test-db';

/**
 * The Claims read surface: the extracted claim corpus with the trace from a claim
 * to the flows that carry it and the scenario steps that prove it, plus the
 * refused statements beside it.
 *
 * The fixture is a frontmatter-titled spec doc, so the LEAD region is one of the
 * two bound sections — the shape published documentation actually has.
 */

const DOC = 'docs/specs/tasks.md';
const DOC_CONTENT = [
  '---',
  'title: "Tasks"',
  '---',
  '',
  '`tasks add <title>` creates a task and prints its id.',
  '',
  '## Listing tasks',
  '',
  '`tasks list` prints every open task.',
  '',
].join('\n');

const claimOf = (id: string, anchor: string, title: string, over: Record<string, unknown> = {}) => {
  const body = { doc: DOC, anchor, title, claim: `${title}.` };
  return { id, ...body, contentHash: claimContentHash(body), ...over };
};

const ADD = claimOf('add-creates-a-task', 'tasks', 'add creates a task and prints its id', {
  verifyVia: 'stdout: the new task id',
});
const LIST = claimOf('list-prints-open-tasks', 'listing-tasks', 'list prints every open task');
const COLOUR = claimOf('list-colours-overdue', 'listing-tasks', 'overdue tasks print in red');

const CLAIMS = {
  version: 1,
  generatedAt: '2026-08-07T00:00:00.000Z',
  claims: [ADD, LIST, COLOUR],
  untestable: [
    {
      doc: DOC,
      anchor: 'tasks',
      text: 'Tasks are the heart of the product.',
      reason: 'Marketing; states no behaviour.',
    },
  ],
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
        { order: 1, doc: DOC, anchor: 'tasks', claimTitle: ADD.title, note: 'the create half' },
        { order: 2, doc: DOC, anchor: 'listing-tasks', claimTitle: LIST.title },
      ],
      bindings: [
        { doc: DOC, anchor: 'tasks', fingerprint: 'sha256:s1' },
        { doc: DOC, anchor: 'listing-tasks', fingerprint: 'sha256:s2' },
      ],
      composedOf: [],
      synthesisInputsHash: 'sha256:i',
    },
  ],
  noFlowClaims: [
    { doc: DOC, anchor: 'listing-tasks', claimTitle: COLOUR.title, reason: 'colour is not observable in a pipe' },
  ],
};

const MANIFEST = {
  version: 1,
  flows: [
    {
      flowId: 'add-then-list',
      flowFingerprint: 'sha256:f',
      bindings: FLOWS.flows[0].bindings,
      scenarios: [{ id: 'add-then-list.cli.1', surface: 'cli', status: 'never-run' }],
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
  binds: [
    { doc: DOC, section: 'tasks', fingerprint: 'sha256:s1' },
    { doc: DOC, section: 'listing-tasks', fingerprint: 'sha256:s2' },
  ],
  steps: [
    { run: ['add', 'write the docs'], expect: { exit: 0 }, milestone: ADD.id },
    { run: ['list'], expect: { exit: 0 }, milestone: [LIST.id] },
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
      binds: { doc: DOC, section: 'tasks', fingerprint: 'sha256:s1' },
      outcome,
      durationMs: 5,
    },
  ],
  sections: [],
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
    fixture = await setupTestFixture();
    root = fixture.repoPath;
    app = createApp({ serveStatic: false });
  });
  afterEach(async () => {
    await teardownTestFixture(fixture.project.slug);
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

  it('carries every stored field and joins the live section heading', async () => {
    seed();
    const res = await request(app).get(url('claims')).expect(200);
    const add = res.body.claims.find((c: { id: string }) => c.id === ADD.id);
    expect(add).toMatchObject({
      doc: DOC,
      anchor: 'tasks',
      title: ADD.title,
      claim: ADD.claim,
      contentHash: ADD.contentHash,
      verifyVia: ADD.verifyVia,
      // The frontmatter-titled lead resolves as a live section.
      headingText: 'Tasks',
      anchorLive: true,
    });
    // A claim is a sentence and its provenance — the retired `needs`/`notes`
    // reach no surface, and the compose has no field to put them in.
    expect(add).not.toHaveProperty('needs');
    expect(add).not.toHaveProperty('notes');
  });

  it('traces a claim to the flow that carries it and the steps that prove it', async () => {
    seed();
    writeJson('.truecourse/guard/LATEST.json', latestWith('pass'));
    const res = await request(app).get(url('claims')).expect(200);
    const add = res.body.claims.find((c: { id: string }) => c.id === ADD.id);
    expect(add.flows).toEqual([
      { flowId: 'add-then-list', title: FLOWS.flows[0].title, milestoneOrder: 1, note: 'the create half' },
    ]);
    expect(add.scenarios).toEqual([
      { scenarioId: 'add-then-list.cli.1', title: SCENARIO.title, steps: [1], outcome: 'pass' },
    ]);
    expect(add.coverage).toBe('proven');
  });

  it('RUN-AWARE: an authored proof with no run yet is planned, never proven', async () => {
    seed();
    const res = await request(app).get(url('claims')).expect(200);
    const add = res.body.claims.find((c: { id: string }) => c.id === ADD.id);
    // The proof step exists (the trace is intact) but nothing has executed it.
    expect(add.scenarios).toEqual([
      { scenarioId: 'add-then-list.cli.1', title: SCENARIO.title, steps: [1] },
    ]);
    expect(add.coverage).toBe('planned');
  });

  it('RUN-AWARE: a proof the latest run failed reads failing, never proven', async () => {
    seed();
    writeJson('.truecourse/guard/LATEST.json', latestWith('fail'));
    const res = await request(app).get(url('claims')).expect(200);
    const add = res.body.claims.find((c: { id: string }) => c.id === ADD.id);
    expect(add.coverage).toBe('failing');
    expect(add.scenarios[0].outcome).toBe('fail');
    expect(res.body.totals.failing).toBe(2);
    expect(res.body.totals.proven).toBe(0);
  });

  it('keys coverage on the claim, so a gapped claim carries its reason', async () => {
    seed();
    const res = await request(app).get(url('claims')).expect(200);
    const colour = res.body.claims.find((c: { id: string }) => c.id === COLOUR.id);
    expect(colour).toMatchObject({
      coverage: 'gapped',
      gapReason: 'colour is not observable in a pipe',
      flows: [],
      scenarios: [],
    });
  });

  it('lists the refused statements with their reasons', async () => {
    seed();
    const res = await request(app).get(url('claims')).expect(200);
    expect(res.body.untestable).toEqual([
      {
        doc: DOC,
        anchor: 'tasks',
        text: 'Tasks are the heart of the product.',
        reason: 'Marketing; states no behaviour.',
        headingText: 'Tasks',
        anchorLive: true,
      },
    ]);
  });

  it('totals every coverage state, so the denominator is always visible', async () => {
    seed();
    writeJson('.truecourse/guard/LATEST.json', latestWith('pass'));
    const res = await request(app).get(url('claims')).expect(200);
    expect(res.body.totals).toEqual({
      claims: 3,
      proven: 2,
      failing: 0,
      planned: 0,
      gapped: 1,
      unplanned: 0,
      dismissed: 0,
      untestable: 1,
      orphanedAnchors: 0,
    });
  });

  it('reports a claim whose section was removed instead of pointing at nothing', async () => {
    seed();
    write(DOC, ['---', 'title: "Tasks"', '---', '', 'Only a lead now.', ''].join('\n'));
    const res = await request(app).get(url('claims')).expect(200);
    const list = res.body.claims.find((c: { id: string }) => c.id === LIST.id);
    expect(list.anchorLive).toBe(false);
    expect(list.headingText).toBeUndefined();
    expect(res.body.totals.orphanedAnchors).toBe(2);
  });

  // The claim detail's second reading: the entry as `claims.json` stores it.
  describe('GET /guard/claim/raw', () => {
    it('serves one claim entry out of scenarios/claims.json', async () => {
      seed();
      const res = await request(app).get(url(`claim/raw?id=${ADD.id}`)).expect(200);
      expect(res.body).toMatchObject({
        id: ADD.id,
        file: path.join('.truecourse', 'scenarios', 'claims.json'),
      });
      // The ENTRY as stored — verbatim, with every field, and no sibling's.
      expect(JSON.parse(res.body.content)).toEqual(ADD);
      expect(res.body.content).not.toContain(LIST.id);
    });

    it('404s an unknown id, an absent store, and 400s a missing id', async () => {
      await request(app).get(url(`claim/raw?id=${ADD.id}`)).expect(404);
      seed();
      await request(app).get(url('claim/raw?id=nope')).expect(404);
      await request(app).get(url('claim/raw')).expect(400);
    });

    it('has no slice for a REFUSED statement — it carries no id to address', async () => {
      seed();
      // The untestable list is deliberately id-less: nothing binds to it, so the
      // detail beside it offers no raw mode either.
      await request(app).get(url('claim/raw?id=Tasks are the heart of the product.')).expect(404);
    });
  });
});
