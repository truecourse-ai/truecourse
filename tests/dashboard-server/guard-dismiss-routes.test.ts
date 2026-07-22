import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { type Express } from 'express';
import { createApp } from '../../apps/dashboard/server/src/app';
import { setupTestFixture, teardownTestFixture, type TestFixture } from '../helpers/test-db';
import { scenarioHashFromYaml } from '../../packages/shared/src/guard/scenario-hash';

/**
 * Guard dismiss + finding-evidence routes (items 19/20). Temp-repo fixture +
 * supertest over the real app; the guard decisions file and evidence dir are
 * seeded/inspected on disk under `.truecourse/`.
 */

const DOC = 'docs/cli.md';
const RUN_ID = '2026-07-08T00-00-00Z_abc12345';
const SCN = 'version.1';

describe('Guard dismiss + finding-evidence routes', () => {
  let app: Express;
  let fixture: TestFixture;
  let root: string;

  const url = (suffix: string) => `/api/repos/${fixture.project.slug}/guard/${suffix}`;
  const decisionsFile = () => path.join(root, '.truecourse', 'scenarios', 'decisions.json');

  beforeEach(async () => {
    fixture = await setupTestFixture();
    root = fixture.repoPath;
    app = createApp({ serveStatic: false });
  });
  afterEach(async () => {
    await teardownTestFixture(fixture.project.slug);
  });

  const claim = { doc: DOC, anchor: 'version', title: 'the --version flag prints the semver' };

  it('decisions is empty until something is dismissed', async () => {
    const res = await request(app).get(url('decisions')).expect(200);
    expect(res.body).toEqual({ version: 1, dismissedClaims: [], dismissedFindings: [] });
  });

  it('dismiss writes decisions.json and undismiss reverses it', async () => {
    const dismissed = await request(app).post(url('dismiss')).send({ ...claim, note: 'wont fix' }).expect(200);
    expect(dismissed.body.dismissedClaims).toHaveLength(1);
    expect(dismissed.body.dismissedClaims[0]).toMatchObject({ ...claim, note: 'wont fix' });
    expect(dismissed.body.dismissedClaims[0].dismissedAt).toEqual(expect.any(String));

    // Persisted to the committable file next to recipe/manifest.
    expect(fs.existsSync(decisionsFile())).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(decisionsFile(), 'utf-8'));
    expect(onDisk.dismissedClaims[0]).toMatchObject(claim);

    // GET reflects it.
    const get = await request(app).get(url('decisions')).expect(200);
    expect(get.body.dismissedClaims).toHaveLength(1);

    // Undismiss removes it.
    const undismissed = await request(app).post(url('undismiss')).send(claim).expect(200);
    expect(undismissed.body.dismissedClaims).toEqual([]);
  });

  it('dismiss rejects a body missing doc/anchor/title', async () => {
    await request(app).post(url('dismiss')).send({ doc: DOC, anchor: 'version' }).expect(400);
  });

  it('finding-evidence serves a birth-evidence transcript addressed by its path', async () => {
    const evDir = `.truecourse/guard/evidence/${RUN_ID}/${SCN}`;
    const abs = path.join(root, evDir);
    fs.mkdirSync(abs, { recursive: true });
    fs.writeFileSync(path.join(abs, 'transcript.txt'), 'the full birth transcript\n');

    const res = await request(app).get(url('finding-evidence')).query({ path: evDir }).expect(200);
    expect(res.text).toBe('the full birth transcript\n');
    expect(res.type).toBe('text/plain');
  });

  it('finding-evidence 400s without ?path= and 404s for a missing transcript', async () => {
    await request(app).get(url('finding-evidence')).expect(400);
    await request(app)
      .get(url('finding-evidence'))
      .query({ path: `.truecourse/guard/evidence/${RUN_ID}/nope` })
      .expect(404);
  });

  it('legacy dismiss rejects a note over 2 000 chars with a 400 (never truncates silently)', async () => {
    await request(app)
      .post(url('dismiss'))
      .send({ ...claim, note: 'x'.repeat(2001) })
      .expect(400);
    // At the cap is fine.
    await request(app)
      .post(url('dismiss'))
      .send({ ...claim, note: 'x'.repeat(2000) })
      .expect(200);
  });
});

// --- Per-finding dismiss/undismiss (behavior-hash identity) -----------------

const SCENARIO_YAML = (run: string, title: string) =>
  [
    'guard: 1',
    'id: version.1',
    `title: ${title}`,
    'binds:',
    `  doc: ${DOC}`,
    '  section: version',
    '  fingerprint: sha256:abc',
    'driver: cli',
    'steps:',
    '  - run:',
    `      - ${run}`,
    '    expect:',
    '      exit: 0',
    'normalize: []',
    '',
  ].join('\n');

describe('Guard finding dismiss/undismiss routes (per-finding identity)', () => {
  let app: Express;
  let fixture: TestFixture;
  let root: string;

  const url = (suffix: string) => `/api/repos/${fixture.project.slug}/guard/${suffix}`;
  const decisionsFile = () => path.join(root, '.truecourse', 'scenarios', 'decisions.json');

  const finding = (over: Record<string, unknown> = {}) => ({
    doc: DOC,
    anchor: 'version',
    title: 'the served scenario title',
    step: 1,
    expected: 'e',
    actual: 'a',
    yaml: SCENARIO_YAML('--version', 'the served scenario title'),
    claim: 'the --version flag prints the semver',
    ...over,
  });

  const seedReport = (findings: Record<string, unknown>[]) => {
    const guardDir = path.join(root, '.truecourse', 'guard');
    fs.mkdirSync(guardDir, { recursive: true });
    fs.writeFileSync(
      path.join(guardDir, 'result.json'),
      JSON.stringify({
        generatedAt: '2026-07-01T00:00:00Z',
        status: 'ok',
        sectionsTotal: 1,
        sectionsChanged: 1,
        skippedUnchanged: 0,
        noChanges: false,
        written: [],
        coverageGaps: [],
        birthFindings: findings,
        errors: [],
        extractionFailures: [],
        orphaned: [],
      }),
    );
  };

  beforeEach(async () => {
    fixture = await setupTestFixture();
    root = fixture.repoPath;
    app = createApp({ serveStatic: false });
  });
  afterEach(async () => {
    await teardownTestFixture(fixture.project.slug);
  });

  it('dismiss-finding resolves the served finding and persists the SERVER\'s copy of yaml/title/claim', async () => {
    const f = finding();
    seedReport([f]);
    const hash = scenarioHashFromYaml(f.yaml as string)!;

    const res = await request(app)
      .post(url('dismiss-finding'))
      .send({ doc: DOC, anchor: 'version', scenarioHash: hash, note: 'noise', yaml: 'CRAFTED — must be ignored' })
      .expect(200);
    expect(res.body.dismissedFindings).toHaveLength(1);
    const entry = res.body.dismissedFindings[0];
    expect(entry).toMatchObject({
      doc: DOC,
      anchor: 'version',
      scenarioHash: hash,
      yaml: f.yaml, // the server-sourced copy, never the client's
      title: f.title,
      claim: f.claim,
      note: 'noise',
    });
    expect(entry.dismissedAt).toEqual(expect.any(String));

    const onDisk = JSON.parse(fs.readFileSync(decisionsFile(), 'utf-8'));
    expect(onDisk.dismissedFindings[0].yaml).toBe(f.yaml);
  });

  it('409s with a machine-readable stale-report error when the key matches nothing', async () => {
    seedReport([finding()]);
    const res = await request(app)
      .post(url('dismiss-finding'))
      .send({ doc: DOC, anchor: 'version', scenarioHash: 'feedfacefeedface' })
      .expect(409);
    expect(res.body.error).toBe('stale-report');
    expect(fs.existsSync(decisionsFile())).toBe(false); // nothing written
  });

  it('first match wins when two byte-identical siblings share a key (not an error)', async () => {
    const first = finding({ title: 'first title' , yaml: SCENARIO_YAML('--version', 'first title') });
    const second = finding({ title: 'second title', yaml: SCENARIO_YAML('--version', 'second title') });
    seedReport([first, second]);
    // Identical behavior — same hash despite the differing titles.
    const hash = scenarioHashFromYaml(first.yaml as string)!;
    expect(scenarioHashFromYaml(second.yaml as string)).toBe(hash);

    const res = await request(app)
      .post(url('dismiss-finding'))
      .send({ doc: DOC, anchor: 'version', scenarioHash: hash })
      .expect(200);
    expect(res.body.dismissedFindings).toHaveLength(1);
    expect(res.body.dismissedFindings[0].title).toBe('first title'); // report array order
  });

  it('a claim-less finding is dismissible by key (§1a)', async () => {
    const f = finding({ claim: undefined });
    seedReport([f]);
    const hash = scenarioHashFromYaml(f.yaml as string)!;
    const res = await request(app)
      .post(url('dismiss-finding'))
      .send({ doc: DOC, anchor: 'version', scenarioHash: hash })
      .expect(200);
    expect(res.body.dismissedFindings[0].claim).toBeUndefined();
  });

  it('rejects a missing identity field and an over-cap note', async () => {
    seedReport([finding()]);
    await request(app).post(url('dismiss-finding')).send({ doc: DOC, anchor: 'version' }).expect(400);
    const hash = scenarioHashFromYaml(finding().yaml as string)!;
    await request(app)
      .post(url('dismiss-finding'))
      .send({ doc: DOC, anchor: 'version', scenarioHash: hash, note: 'x'.repeat(2001) })
      .expect(400);
  });

  it('undismiss-finding removes by identity, without needing a served finding', async () => {
    const f = finding();
    seedReport([f]);
    const hash = scenarioHashFromYaml(f.yaml as string)!;
    await request(app).post(url('dismiss-finding')).send({ doc: DOC, anchor: 'version', scenarioHash: hash }).expect(200);

    // The report may have moved on — undismiss is a pure identity removal.
    fs.rmSync(path.join(root, '.truecourse', 'guard', 'result.json'));
    const res = await request(app)
      .post(url('undismiss-finding'))
      .send({ doc: DOC, anchor: 'version', scenarioHash: hash })
      .expect(200);
    expect(res.body.dismissedFindings).toEqual([]);
  });
});
