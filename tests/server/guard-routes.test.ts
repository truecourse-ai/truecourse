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

/**
 * Bytes that are NOT valid UTF-8 (the PNG signature, and a WebM/EBML header) — a
 * read that decoded them as text would round-trip them into replacement characters,
 * so an exact buffer comparison is what proves the visual routes are binary-safe.
 */
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe, 0x01]);
const WEBM_BYTES = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0xff, 0x80, 0x42]);

const LATEST = {
  run: { runId: RUN_ID, ranAt: '2026-07-07T00:00:00.000Z', branch: 'main', commit: 'abc', recipeFingerprint: 'sha256:r' },
  summary: { total: 1, pass: 0, fail: 1, stale: 0, orphaned: 0, error: 0 },
  scenarios: [
    { id: 'a1', title: 'alpha claim', binds: { doc: DOC, section: 'alpha', fingerprint: 'sha256:x' }, outcome: 'fail', durationMs: 3, failure: { step: 1, expected: 'x', actual: 'y' }, evidencePath: `.truecourse/guard/evidence/${RUN_ID}/a1` },
  ],
  sections: [{ doc: DOC, section: 'alpha', status: 'fail', scenarioIds: ['a1'] }],
};

const MANIFEST = {
  flows: [
    {
      flowId: `${DOC}#alpha`,
      flowFingerprint: 'sha256:x',
      bindings: [{ doc: DOC, anchor: 'alpha', fingerprint: 'sha256:x' }],
      scenarios: [{ id: 'a1', surface: 'cli' }],
      generationInputsHash: null,
      gaps: [],
    },
  ],
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
    `id: ${id}`,
    `title: ${section} claim`,
    'binds:',
    `  - doc: ${DOC}`,
    `    section: ${section}`,
    '    fingerprint: sha256:x',
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
  const writeBytes = (rel: string, bytes: Buffer) => {
    const f = path.join(root, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, bytes);
  };
  const url = (suffix: string) => `/api/repos/${fixture.project.slug}/guard/${suffix}`;

  /**
   * A GET whose body is read as BYTES. superagent decodes a response as text by
   * default, which is exactly what a screenshot must never be put through — so the
   * binary routes are asserted against the raw buffer.
   */
  const binary = (suffix: string, headers?: Record<string, string>) =>
    request(app)
      .get(suffix)
      .set(headers ?? {})
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(Buffer.from(c)));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });

  /** The visual half of `a1`'s bundle — out of step order on disk, on purpose. */
  function seedVisuals() {
    const dir = `.truecourse/guard/evidence/${RUN_ID}/a1`;
    writeBytes(`${dir}/step-2.png`, PNG_BYTES);
    writeBytes(`${dir}/step-10.png`, PNG_BYTES);
    writeBytes(`${dir}/step-1.png`, PNG_BYTES);
    writeBytes(`${dir}/session.webm`, WEBM_BYTES);
    writeJson(`${dir}/invocation.json`, { scenarioId: 'a1', steps: [] });
  }

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
    // Recipe card: build/entry/env pass through on the surface that runs them; a
    // fresh fingerprint is computed; stale is true because it differs from the
    // last run's recorded fingerprint.
    expect(res.body.recipe).toMatchObject({
      surfaces: { cli: { build: 'pnpm build', entry: ['node', 'dist/index.js'], env: { APP_MODE: 'test' } } },
      stale: true,
    });
    expect(res.body.recipe.fingerprint).toMatch(/^sha256:/);
    // A cli-only recipe prepares no served surface at all — neither key exists.
    expect(Object.keys(res.body.recipe.surfaces)).toEqual(['cli']);
  });

  /**
   * The api surface of a repo whose recipe has a `web` block and no `api` block:
   * the runner serves ONE surface for both web steps and `request` steps, so the
   * wire hands the api scope that same server, marked as the web surface's.
   */
  it('scenarios recipe hands the api surface the web block’s server, marked shared', async () => {
    seed();
    writeJson('.truecourse/scenarios/recipe.json', {
      ...RECIPE,
      web: { build: 'pnpm build:web', serve: ['node', 'dist/web.js'], healthPath: '/health' },
    });
    const res = await request(app).get(url('scenarios')).expect(200);
    expect(res.body.recipe.surfaces.api).toEqual({
      build: 'pnpm build:web',
      serve: ['node', 'dist/web.js'],
      healthPath: '/health',
      sharedWithWeb: true,
    });
    expect(res.body.recipe.surfaces.web.sharedWithWeb).toBeUndefined();
  });

  it('scenarios recipe leaves a real api block as itself — no shared marker', async () => {
    seed();
    writeJson('.truecourse/scenarios/recipe.json', {
      ...RECIPE,
      api: { serve: ['node', 'dist/server.js'] },
      web: { serve: ['node', 'dist/web.js'] },
    });
    const res = await request(app).get(url('scenarios')).expect(200);
    expect(res.body.recipe.surfaces.api).toEqual({ serve: ['node', 'dist/server.js'] });
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

  // The starting world a test declares — read off the same parse as the steps, so
  // the detail never re-reads the file to learn what it began from.
  const SETUP_YAML = [
    'id: s1',
    'title: seeded world',
    'binds:',
    `  - doc: ${DOC}`,
    '    section: alpha',
    '    fingerprint: sha256:x',
    'setup:',
    '  files:',
    '    "tasks.json": "[]\\n"',
    '    "README.md": "# demo\\n"',
    '  env:',
    '    NO_COLOR: "1"',
    '  git:',
    '    root: repo',
    '    branch: trunk',
    '    identity:',
    '      name: Guard Runner',
    '      email: guard@example.com',
    '    commits:',
    '      - files: ["tasks.json"]',
    '        message: seed the store',
    '      - files: ["README.md"]',
    '    staged: ["README.md"]',
    'driver: cli',
    'steps:',
    '  - run: ["list"]',
    '    expect:',
    '      exit: 0',
    '',
  ].join('\n');

  it('scenario carries the declared setup — seeded files, git world and env', async () => {
    seed();
    write('.truecourse/scenarios/core/s1.yaml', SETUP_YAML);
    const res = await request(app).get(url('scenario?id=s1')).expect(200);
    expect(res.body.setup.files).toEqual([
      { path: 'tasks.json', content: '[]\n' },
      { path: 'README.md', content: '# demo\n' },
    ]);
    expect(res.body.setup.env).toEqual(['NO_COLOR=1']);
    expect(res.body.setup.git).toEqual([
      'initializes a git repository in repo',
      'on branch trunk',
      'commits as Guard Runner <guard@example.com>',
      'commit 1 “seed the store” — tasks.json',
      'commit 2 — README.md',
      'staged, uncommitted — README.md',
    ]);
  });

  it('scenario carries NO setup when the file declares none', async () => {
    seed();
    const res = await request(app).get(url('scenario?id=a1')).expect(200);
    expect(res.body.setup).toBeUndefined();
  });

  it('evidence returns the transcript text', async () => {
    seed();
    const res = await request(app).get(url(`evidence?runId=${RUN_ID}&scenarioId=a1`)).expect(200);
    expect(res.text).toBe('hello evidence\n');
  });

  // --- Visual evidence: a browser run's screenshots + session video ---------
  //
  // The bundle's non-text half. Listed (nothing names the video) and served as
  // BYTES with the media type its kind dictates — a screenshot round-tripped
  // through a text read would be a corrupted file, so these prove the bytes come
  // back identical. A bundle with none of them answers an empty list, which is
  // what keeps every pre-web run rendering exactly as it did.

  it('visuals lists the screenshots in STEP order with the video last', async () => {
    seed();
    seedVisuals();
    const res = await request(app)
      .get(url(`evidence/visuals?runId=${RUN_ID}&scenarioId=a1`))
      .expect(200);
    // Sorted by step, not by filename (`step-10` after `step-2`), and the text
    // files of the same bundle are not visuals.
    expect(res.body.visuals).toEqual([
      { file: 'step-1.png', kind: 'screenshot', step: 1 },
      { file: 'step-2.png', kind: 'screenshot', step: 2 },
      { file: 'step-10.png', kind: 'screenshot', step: 10 },
      { file: 'session.webm', kind: 'video' },
    ]);
  });

  it('visuals is EMPTY for a run that took none — the pre-web bundle is unchanged', async () => {
    seed();
    const res = await request(app)
      .get(url(`evidence/visuals?runId=${RUN_ID}&scenarioId=a1`))
      .expect(200);
    expect(res.body).toEqual({ visuals: [] });
    // …and the transcript it does have still reads.
    await request(app).get(url(`evidence?runId=${RUN_ID}&scenarioId=a1`)).expect(200);
  });

  it('visuals answers the same bundle by evidence PATH (a birth finding)', async () => {
    seed();
    seedVisuals();
    const dir = `.truecourse/guard/evidence/${RUN_ID}/a1`;
    const res = await request(app)
      .get(url(`evidence/visuals?evidencePath=${encodeURIComponent(dir)}`))
      .expect(200);
    expect(res.body.visuals.map((v: { file: string }) => v.file)).toEqual([
      'step-1.png',
      'step-2.png',
      'step-10.png',
      'session.webm',
    ]);
  });

  it('visual serves a screenshot as image/png, byte for byte', async () => {
    seed();
    seedVisuals();
    const res = await binary(url(`evidence/visual?runId=${RUN_ID}&scenarioId=a1&file=step-1.png`));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^image\/png/);
    expect(Buffer.compare(res.body as Buffer, PNG_BYTES)).toBe(0);
  });

  it('visual serves the session video as video/webm, byte for byte', async () => {
    seed();
    seedVisuals();
    const res = await binary(
      url(`evidence/visual?evidencePath=${encodeURIComponent(`.truecourse/guard/evidence/${RUN_ID}/a1`)}&file=session.webm`),
    );
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^video\/webm/);
    expect(Buffer.compare(res.body as Buffer, WEBM_BYTES)).toBe(0);
  });

  // --- Range reads: what makes the session video seekable -------------------
  //
  // A media element only offers seeking when the server answers byte ranges:
  // Chromium classifies a plain-200 resource as a stream and pins
  // `video.seekable` to zero even when the file's own metadata is complete. So
  // the video scrubber lives or dies on these headers, not on the bytes.

  it('visual advertises Accept-Ranges on the full read', async () => {
    seed();
    seedVisuals();
    const res = await binary(
      url(`evidence/visual?runId=${RUN_ID}&scenarioId=a1&file=session.webm`),
    );
    expect(res.status).toBe(200);
    expect(res.headers['accept-ranges']).toBe('bytes');
  });

  it('visual answers a Range request with 206 and exactly the asked-for slice', async () => {
    seed();
    seedVisuals();
    const res = await binary(
      url(`evidence/visual?runId=${RUN_ID}&scenarioId=a1&file=session.webm`),
      { Range: 'bytes=2-5' },
    );
    expect(res.status).toBe(206);
    expect(res.headers['content-type']).toMatch(/^video\/webm/);
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['content-range']).toBe(`bytes 2-5/${WEBM_BYTES.length}`);
    expect(Buffer.compare(res.body as Buffer, WEBM_BYTES.subarray(2, 6))).toBe(0);
    // An end past the file clamps to the last byte — the RFC's rule, and what
    // lets a player ask for "the rest" without knowing the size.
    const clamped = await binary(
      url(`evidence/visual?runId=${RUN_ID}&scenarioId=a1&file=session.webm`),
      { Range: 'bytes=4-99' },
    );
    expect(clamped.status).toBe(206);
    expect(clamped.headers['content-range']).toBe(`bytes 4-${WEBM_BYTES.length - 1}/${WEBM_BYTES.length}`);
    expect(Buffer.compare(clamped.body as Buffer, WEBM_BYTES.subarray(4))).toBe(0);
  });

  it('visual serves open-ended and suffix ranges to the end of the file', async () => {
    seed();
    seedVisuals();
    const len = WEBM_BYTES.length;
    const tail = await binary(
      url(`evidence/visual?runId=${RUN_ID}&scenarioId=a1&file=session.webm`),
      { Range: `bytes=${len - 3}-` },
    );
    expect(tail.status).toBe(206);
    expect(tail.headers['content-range']).toBe(`bytes ${len - 3}-${len - 1}/${len}`);
    expect(Buffer.compare(tail.body as Buffer, WEBM_BYTES.subarray(len - 3))).toBe(0);
    const suffix = await binary(
      url(`evidence/visual?runId=${RUN_ID}&scenarioId=a1&file=session.webm`),
      { Range: 'bytes=-3' },
    );
    expect(suffix.status).toBe(206);
    expect(suffix.headers['content-range']).toBe(`bytes ${len - 3}-${len - 1}/${len}`);
    expect(Buffer.compare(suffix.body as Buffer, WEBM_BYTES.subarray(len - 3))).toBe(0);
  });

  it('visual 416s an unsatisfiable range, naming the real size', async () => {
    seed();
    seedVisuals();
    // A start past the end, and a bytes-range that parses to nothing at all,
    // both read as "nothing satisfiable" — the same verdict express's own
    // sendFile machinery reaches.
    for (const range of [`bytes=${WEBM_BYTES.length}-`, 'bytes=nonsense']) {
      const res = await binary(
        url(`evidence/visual?runId=${RUN_ID}&scenarioId=a1&file=session.webm`),
        { Range: range },
      );
      expect(res.status).toBe(416);
      expect(res.headers['content-range']).toBe(`bytes */${WEBM_BYTES.length}`);
    }
  });

  it('visual ignores a malformed or non-bytes Range and serves the whole file', async () => {
    seed();
    seedVisuals();
    // A unit this route does not slice by, and a header with no unit at all,
    // are ignored rather than erred on: the whole file is always a valid answer.
    for (const range of ['chunks=0-1', 'bytes 0-1']) {
      const res = await binary(
        url(`evidence/visual?runId=${RUN_ID}&scenarioId=a1&file=session.webm`),
        { Range: range },
      );
      expect(res.status).toBe(200);
      expect(Buffer.compare(res.body as Buffer, WEBM_BYTES)).toBe(0);
    }
  });

  it('visual 404s on an absent file and on one that is not a visual', async () => {
    seed();
    seedVisuals();
    await request(app).get(url(`evidence/visual?runId=${RUN_ID}&scenarioId=a1&file=step-9.png`)).expect(404);
    // The transcript is text and is read through `/guard/evidence` — serving it
    // here would mean answering with a media type that is a lie.
    await request(app).get(url(`evidence/visual?runId=${RUN_ID}&scenarioId=a1&file=transcript.txt`)).expect(404);
  });

  it('the visual reads refuse to escape the evidence root', async () => {
    seed();
    seedVisuals();
    fs.writeFileSync(path.join(root, 'secret.png'), 'not yours');
    const traversals = [
      `runId=${encodeURIComponent('../../..')}&scenarioId=a1`,
      `runId=${RUN_ID}&scenarioId=${encodeURIComponent('../a1')}`,
      `evidencePath=${encodeURIComponent('.truecourse')}`,
      `evidencePath=${encodeURIComponent(`.truecourse/guard/evidence/${RUN_ID}/a1/../../../..`)}`,
    ];
    for (const where of traversals) {
      // Nothing outside the evidence root is ever listed…
      const listed = await request(app).get(url(`evidence/visuals?${where}`)).expect(200);
      expect(listed.body).toEqual({ visuals: [] });
      // …and nothing outside it is ever served.
      await request(app).get(url(`evidence/visual?${where}&file=secret.png`)).expect(404);
    }
    // A file name is a plain segment: separators and `..` never resolve.
    await request(app)
      .get(url(`evidence/visual?runId=${RUN_ID}&scenarioId=a1&file=${encodeURIComponent('../../../../etc/passwd')}`))
      .expect(404);
    await request(app)
      .get(url(`evidence/visual?runId=${RUN_ID}&scenarioId=a1&file=${encodeURIComponent('../secret.png')}`))
      .expect(404);
  });

  it('the visual reads 400 on a locator the query does not carry', async () => {
    seed();
    await request(app).get(url('evidence/visuals')).expect(400);
    await request(app).get(url(`evidence/visuals?runId=${RUN_ID}`)).expect(400);
    await request(app).get(url(`evidence/visual?runId=${RUN_ID}&scenarioId=a1`)).expect(400);
    await request(app).get(url('evidence/visual?file=step-1.png')).expect(400);
  });

  // --- The merged step list: authored expectations + the run's actuals -------

  /** A three-step committed test — enough for a run that stops at the second one. */
  const THREE_STEP_YAML = [
    'id: m1',
    'title: three steps',
    'binds:',
    `  - doc: ${DOC}`,
    '    section: alpha',
    '    fingerprint: sha256:x',
    'driver: cli',
    'steps:',
    '  - run: ["init"]',
    '    expect:',
    '      exit: 0',
    '  - run: ["boom"]',
    '    expect:',
    '      exit: 0',
    '  - run: ["done"]',
    '    expect:',
    '      exit: 0',
    '',
  ].join('\n');

  /** The bundle that run wrote: records for the two steps that executed, none after. */
  const INVOCATION = {
    scenarioId: 'm1',
    outcome: 'fail',
    steps: [
      { index: 1, argv: ['init'], exitCode: 0, timedOut: false, durationMs: 11, stdout: 'initialized' },
      {
        index: 2,
        argv: ['boom'],
        exitCode: 7,
        timedOut: false,
        durationMs: 24,
        stderr: 'fatal: intentional failure',
      },
    ],
  };

  function seedRunWithSteps() {
    seed();
    write('.truecourse/scenarios/core/m1.yaml', THREE_STEP_YAML);
    writeJson(`.truecourse/guard/evidence/${RUN_ID}/m1/invocation.json`, INVOCATION);
  }

  it('scenario merges the named run’s per-step actuals into the authored steps', async () => {
    seedRunWithSteps();
    const res = await request(app).get(url(`scenario?id=m1&runId=${RUN_ID}`)).expect(200);
    const steps = res.body.steps as { n: number; expectation: string; actual?: unknown }[];
    expect(steps).toHaveLength(3);
    // What it asserts is the FILE's; what it returned is the RUN's, on the same step.
    expect(steps[0]).toMatchObject({
      n: 1,
      expectation: 'exit 0',
      actual: { n: 1, actual: 'exit 0', durationMs: 11, stdout: 'initialized' },
    });
    expect(steps[1].actual).toMatchObject({ actual: 'exit 7', stderr: 'fatal: intentional failure' });
    // The step the run never reached carries the authored half alone — there is
    // nothing actual about a step that did not run.
    expect(steps[2].expectation).toBe('exit 0');
    expect(steps[2].actual).toBeUndefined();
  });

  it('scenario named with NO run stays the authored file — no actuals anywhere', async () => {
    seedRunWithSteps();
    const res = await request(app).get(url('scenario?id=m1')).expect(200);
    for (const step of res.body.steps as { actual?: unknown }[]) expect(step.actual).toBeUndefined();
  });

  it('scenario merges a BIRTH result’s actuals by evidence path', async () => {
    seedRunWithSteps();
    const dir = `.truecourse/guard/evidence/${RUN_ID}/m1`;
    const res = await request(app)
      .get(url(`scenario?id=m1&evidencePath=${encodeURIComponent(dir)}`))
      .expect(200);
    expect((res.body.steps as { actual?: { actual?: string } }[])[1].actual?.actual).toBe('exit 7');
  });

  it('scenario still answers when the named run kept no bundle for it', async () => {
    seed();
    write('.truecourse/scenarios/core/m1.yaml', THREE_STEP_YAML);
    const res = await request(app).get(url(`scenario?id=m1&runId=${RUN_ID}`)).expect(200);
    expect(res.body.steps).toHaveLength(3);
    for (const step of res.body.steps as { actual?: unknown }[]) expect(step.actual).toBeUndefined();
  });

  it('scenario refuses to read actuals from outside the evidence root', async () => {
    seedRunWithSteps();
    write('.truecourse/secrets.json', '{"steps":[]}');
    const res = await request(app)
      .get(url(`scenario?id=m1&evidencePath=${encodeURIComponent('.truecourse')}`))
      .expect(200);
    // The steps still read; the traversing pointer simply resolves to nothing.
    for (const step of res.body.steps as { actual?: unknown }[]) expect(step.actual).toBeUndefined();
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
    expect(res.body).toEqual({ coverage: null, sections: null, lastRun: null, lastGenerate: null });
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
