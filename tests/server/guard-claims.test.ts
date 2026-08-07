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
  return { id, ...body, contentHash: claimContentHash(body), needs: [], ...over };
};

const ADD = claimOf('add-creates-a-task', 'tasks', 'add creates a task and prints its id', {
  verifyVia: 'stdout: the new task id',
  needs: ['none'],
  notes: 'The id format is not asserted.',
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
      journeys: [],
      generationInputsHash: null,
      gaps: [],
    },
  ],
};

const SCENARIO = {
  guard: 3,
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
      needs: ['none'],
      notes: ADD.notes,
      // The frontmatter-titled lead resolves as a live section.
      headingText: 'Tasks',
      anchorLive: true,
    });
  });

  it('traces a claim to the flow that carries it and the steps that prove it', async () => {
    seed();
    const res = await request(app).get(url('claims')).expect(200);
    const add = res.body.claims.find((c: { id: string }) => c.id === ADD.id);
    expect(add.flows).toEqual([
      { flowId: 'add-then-list', title: FLOWS.flows[0].title, milestoneOrder: 1, note: 'the create half' },
    ]);
    expect(add.scenarios).toEqual([
      { scenarioId: 'add-then-list.cli.1', title: SCENARIO.title, steps: [1] },
    ]);
    expect(add.coverage).toBe('proven');
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
    const res = await request(app).get(url('claims')).expect(200);
    expect(res.body.totals).toEqual({
      claims: 3,
      proven: 2,
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
});
