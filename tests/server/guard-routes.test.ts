import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { type Express } from 'express';
import { createApp } from '../../apps/dashboard/server/src/app';
import { setupTestFixture, teardownTestFixture, type TestFixture } from '../helpers/test-db';

/**
 * Guard dashboard read routes (OSS). Temp-repo fixture + supertest over the real
 * app; the guard store is seeded by writing files under `.truecourse/`.
 */

const RUN_ID = '2026-07-07T00-00-00Z_abc12345';
const DOC = 'docs/spec.md';

const LATEST = {
  run: { runId: RUN_ID, ranAt: '2026-07-07T00:00:00.000Z', branch: 'main', commit: 'abc', recipeFingerprint: 'sha256:r', scenarioFormat: 1 },
  summary: { total: 1, pass: 0, fail: 1, stale: 0, orphaned: 0, error: 0 },
  scenarios: [
    { id: 'a1', title: 'alpha claim', binds: { doc: DOC, section: 'alpha', fingerprint: 'sha256:x' }, outcome: 'fail', durationMs: 3, failure: { step: 1, expected: 'x', actual: 'y' }, evidencePath: `.truecourse/guard/evidence/${RUN_ID}/a1` },
  ],
  sections: [{ doc: DOC, section: 'alpha', status: 'fail', scenarioIds: ['a1'] }],
};

const MANIFEST = {
  guard: 1,
  sections: [{ doc: DOC, anchor: 'alpha', fingerprint: 'sha256:x', scenarioIds: ['a1'], generationInputsHash: null }],
};

const RESULT = {
  generatedAt: '2026-07-06T00:00:00.000Z',
  status: 'ok',
  sectionsTotal: 2,
  sectionsChanged: 0,
  skippedUnchanged: 2,
  noChanges: false,
  written: [],
  coverageGaps: [{ doc: DOC, anchor: 'beta', kind: 'no-claim', reason: 'no assertable claim' }],
  birthFindings: [],
  errors: [],
  extractionFailures: [],
  orphaned: [],
};

const HISTORY = {
  runs: [{ runId: RUN_ID, ranAt: '2026-07-07T00:00:00.000Z', branch: 'main', commit: 'abc', summary: LATEST.summary }],
};

const scenarioYaml = (id: string, section: string) =>
  [
    'guard: 1',
    `id: ${id}`,
    `title: ${section} claim`,
    'binds:',
    `  doc: ${DOC}`,
    `  section: ${section}`,
    '  fingerprint: sha256:x',
    'driver: cli',
    'steps:',
    '  - run: []',
    '    expect:',
    '      exit: 0',
    '',
  ].join('\n');

const SCENARIO_YAML = scenarioYaml('a1', 'alpha');

// A recipe.json and a hand-written scenario (`h1` — no manifest section binds it).
const RECIPE = { build: 'pnpm build', entry: ['node', 'dist/index.js'], env: { APP_MODE: 'test' } };

describe('Guard routes', () => {
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
    write(DOC, '# Alpha\nbody a\n# Beta\nbody b\n');
    writeJson('.truecourse/scenarios/manifest.json', MANIFEST);
    write('.truecourse/scenarios/core/a1.yaml', SCENARIO_YAML);
    writeJson('.truecourse/guard/LATEST.json', LATEST);
    writeJson(`.truecourse/guard/runs/${RUN_ID}.json`, LATEST);
    writeJson('.truecourse/guard/history.json', HISTORY);
    writeJson('.truecourse/guard/result.json', RESULT);
    write(`.truecourse/guard/evidence/${RUN_ID}/a1/transcript.txt`, 'hello evidence\n');
    writeJson('.truecourse/specs/corpus.json', {});
  }

  // Adds a recipe + a hand-written scenario on top of the base seed (kept out of
  // `seed()` so the staleness tests' mtime bookkeeping stays exact).
  function seedInventory() {
    seed();
    writeJson('.truecourse/scenarios/recipe.json', RECIPE);
    write('.truecourse/scenarios/core/h1.yaml', scenarioYaml('h1', 'beta'));
  }

  beforeEach(async () => {
    fixture = await setupTestFixture();
    root = fixture.repoPath;
    app = createApp({ serveStatic: false });
  });
  afterEach(async () => {
    await teardownTestFixture(fixture.project.slug);
  });

  // --- Happy paths ---------------------------------------------------------

  it('status composes coverage / last run / last generate', async () => {
    seed();
    const res = await request(app).get(url('status')).expect(200);
    expect(res.body.coverage).toMatchObject({ totalSections: 1, withScenarios: 1 });
    expect(res.body.lastRun).toMatchObject({ ranAt: '2026-07-07T00:00:00.000Z', summary: LATEST.summary });
    expect(res.body.lastGenerate).toMatchObject({ generatedAt: '2026-07-06T00:00:00.000Z', status: 'ok' });
  });

  it('latest returns the run with failure detail + evidence pointer', async () => {
    seed();
    const res = await request(app).get(url('latest')).expect(200);
    expect(res.body.run.runId).toBe(RUN_ID);
    expect(res.body.scenarios[0]).toMatchObject({ id: 'a1', outcome: 'fail', evidencePath: `.truecourse/guard/evidence/${RUN_ID}/a1` });
  });

  it('history returns the append-only run list', async () => {
    seed();
    const res = await request(app).get(url('history')).expect(200);
    expect(res.body.runs).toHaveLength(1);
    expect(res.body.runs[0].runId).toBe(RUN_ID);
  });

  it('runs/:runId returns one past snapshot', async () => {
    seed();
    const res = await request(app).get(url(`runs/${RUN_ID}`)).expect(200);
    expect(res.body.run.runId).toBe(RUN_ID);
  });

  it('report passes the generate result through', async () => {
    seed();
    const res = await request(app).get(url('report')).expect(200);
    expect(res.body.coverageGaps).toEqual(RESULT.coverageGaps);
  });

  it('report enriches each birth finding with the live section heading; a gone section carries none', async () => {
    seed();
    // A finding bound to a live section (docs/spec.md § alpha, heading "Alpha") and
    // one bound to a section that no longer exists — the join is tolerant, so the
    // gone section contributes no headingText (never a slug in UI copy).
    writeJson('.truecourse/guard/result.json', {
      ...RESULT,
      birthFindings: [
        { doc: DOC, anchor: 'alpha', title: 'alpha finding', step: 1, expected: 'x', actual: 'y' },
        { doc: DOC, anchor: 'ghost', title: 'ghost finding', step: 2, expected: 'a', actual: 'b' },
      ],
    });
    const res = await request(app).get(url('report')).expect(200);
    expect(res.body.birthFindings[0]).toMatchObject({ anchor: 'alpha', headingText: 'Alpha' });
    expect(res.body.birthFindings[1].anchor).toBe('ghost');
    expect(res.body.birthFindings[1].headingText).toBeUndefined();
  });

  it('coverage joins each live section to its status', async () => {
    seed();
    const res = await request(app).get(url(`coverage?doc=${encodeURIComponent(DOC)}`)).expect(200);
    expect(res.body.sections.map((s: { anchor: string; status: string }) => [s.anchor, s.status])).toEqual([
      ['alpha', 'fail'],
      ['beta', 'no-claim'],
    ]);
    expect(res.body.runId).toBe(RUN_ID);
  });

  it('scenarios lists the corpus with hand-written flag + recipe card', async () => {
    seedInventory();
    const res = await request(app).get(url('scenarios')).expect(200);
    // Sorted by doc, then anchor: alpha (generated a1) before beta (hand-written h1).
    expect(res.body.scenarios.map((s: { id: string; handWritten: boolean }) => [s.id, s.handWritten])).toEqual([
      ['a1', false],
      ['h1', true],
    ]);
    expect(res.body.scenarios[0]).toMatchObject({
      id: 'a1',
      title: 'alpha claim',
      doc: DOC,
      anchor: 'alpha',
      // The human heading text joined from the live doc's section index — the
      // dashboard groups by this, never by the anchor slug.
      headingText: 'Alpha',
      file: path.join('.truecourse', 'scenarios', 'core', 'a1.yaml'),
    });
    expect(res.body.scenarios[1].headingText).toBe('Beta');
    // Recipe card: build/entry/env pass through; a fresh fingerprint is computed;
    // stale is true because it differs from the last run's recorded fingerprint.
    expect(res.body.recipe).toMatchObject({ build: 'pnpm build', entry: ['node', 'dist/index.js'], env: { APP_MODE: 'test' }, stale: true });
    expect(res.body.recipe.fingerprint).toMatch(/^sha256:/);
  });

  it('scenarios recipe stale is null when there is no run to compare', async () => {
    write('.truecourse/scenarios/core/a1.yaml', SCENARIO_YAML);
    writeJson('.truecourse/scenarios/recipe.json', RECIPE);
    const res = await request(app).get(url('scenarios')).expect(200);
    expect(res.body.recipe.stale).toBeNull();
    // No manifest → every committed scenario reads as hand-written. The bound doc
    // was never written here, so no heading text joins (the row carries none).
    expect(res.body.scenarios).toEqual([
      expect.objectContaining({ id: 'a1', handWritten: true }),
    ]);
    expect(res.body.scenarios[0].headingText).toBeUndefined();
  });

  it('scenario returns a YAML source by id', async () => {
    seed();
    const res = await request(app).get(url('scenario?id=a1')).expect(200);
    expect(res.body).toMatchObject({ id: 'a1', file: path.join('.truecourse', 'scenarios', 'core', 'a1.yaml') });
    expect(res.body.content).toContain('id: a1');
  });

  it('evidence returns the transcript text', async () => {
    seed();
    const res = await request(app).get(url(`evidence?runId=${RUN_ID}&scenarioId=a1`)).expect(200);
    expect(res.text).toBe('hello evidence\n');
  });

  it('staleness lights both dots when spec + scenarios lead the store', async () => {
    seed();
    const now = Date.now() / 1000;
    const old = now - 100;
    const touch = (rel: string, secs: number) => fs.utimesSync(path.join(root, rel), secs, secs);
    touch('.truecourse/specs/corpus.json', now); // spec ahead of generate
    touch('.truecourse/guard/result.json', old);
    touch('.truecourse/scenarios/manifest.json', now); // scenarios ahead of run
    touch('.truecourse/scenarios/core/a1.yaml', now);
    touch('.truecourse/guard/LATEST.json', old);
    const res = await request(app).get(url('staleness')).expect(200);
    expect(res.body).toMatchObject({ generateStale: true, runStale: true, hasCorpus: true, hasScenarios: true, hasGenerated: true, hasRun: true });
  });

  it('staleness stays dark when the store leads spec + scenarios', async () => {
    seed();
    const now = Date.now() / 1000;
    const old = now - 100;
    const touch = (rel: string, secs: number) => fs.utimesSync(path.join(root, rel), secs, secs);
    touch('.truecourse/specs/corpus.json', old);
    touch('.truecourse/guard/result.json', now);
    touch('.truecourse/scenarios/manifest.json', old);
    touch('.truecourse/scenarios/core/a1.yaml', old);
    touch('.truecourse/guard/LATEST.json', now);
    const res = await request(app).get(url('staleness')).expect(200);
    expect(res.body).toMatchObject({ generateStale: false, runStale: false });
  });

  // --- Absent store --------------------------------------------------------

  it('status is 200 with all-null on a fresh repo', async () => {
    const res = await request(app).get(url('status')).expect(200);
    expect(res.body).toEqual({ coverage: null, lastRun: null, lastGenerate: null });
  });

  it('history is 200 with an empty list on a fresh repo', async () => {
    const res = await request(app).get(url('history')).expect(200);
    expect(res.body).toEqual({ runs: [] });
  });

  it('staleness is 200 all-false on a fresh repo', async () => {
    const res = await request(app).get(url('staleness')).expect(200);
    expect(res.body).toEqual({ generateStale: false, runStale: false, hasCorpus: false, hasScenarios: false, hasGenerated: false, hasRun: false });
  });

  it('scenarios is 200 with empty list + null recipe on a fresh repo', async () => {
    const res = await request(app).get(url('scenarios')).expect(200);
    expect(res.body).toEqual({ recipe: null, scenarios: [] });
  });

  it('latest / report / run 404 on a fresh repo', async () => {
    await request(app).get(url('latest')).expect(404);
    await request(app).get(url('report')).expect(404);
    await request(app).get(url(`runs/${RUN_ID}`)).expect(404);
  });

  it('scenario / evidence 404 when the id or file is absent', async () => {
    seed();
    await request(app).get(url('scenario?id=nope')).expect(404);
    await request(app).get(url(`evidence?runId=${RUN_ID}&scenarioId=nope`)).expect(404);
  });

  // --- Request validation --------------------------------------------------

  it('coverage 400s on a missing or traversing doc, 404 on not-found', async () => {
    seed();
    await request(app).get(url('coverage')).expect(400);
    await request(app).get(url('coverage?doc=../secrets.md')).expect(400);
    await request(app).get(url('coverage?doc=/etc/passwd')).expect(400);
    await request(app).get(url(`coverage?doc=${encodeURIComponent('docs/missing.md')}`)).expect(404);
  });

  it('scenario / evidence 400 on missing params', async () => {
    await request(app).get(url('scenario')).expect(400);
    await request(app).get(url(`evidence?runId=${RUN_ID}`)).expect(400);
  });

  // --- Evidence path-traversal rejection -----------------------------------

  it('evidence rejects a traversing runId or file (404, no escape)', async () => {
    seed();
    // A runId that would climb out of the evidence dir.
    await request(app).get(url(`evidence?runId=${encodeURIComponent('../../..')}&scenarioId=a1`)).expect(404);
    // A file that would climb out (SAFE_SEGMENT forbids separators / `..`).
    await request(app).get(url(`evidence?runId=${RUN_ID}&scenarioId=a1&file=${encodeURIComponent('../../../../etc/passwd')}`)).expect(404);
    // A dotted-but-benign scenarioId is sanitized, not a traversal vector.
    await request(app).get(url(`evidence?runId=${RUN_ID}&scenarioId=${encodeURIComponent('../a1')}`)).expect(404);
  });
});
