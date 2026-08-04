import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { type Express } from 'express';
import { createApp } from '../../apps/dashboard/server/src/app';
import { setupTestFixture, teardownTestFixture, type TestFixture } from '../helpers/test-db';

/**
 * Guard dismiss + finding-evidence routes — persisting a user's dismissal and
 * serving a finding's birth evidence. Temp-repo fixture +
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
    expect(res.body).toEqual({ version: 1, dismissedClaims: [], dismissedFlows: [] });
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
});
