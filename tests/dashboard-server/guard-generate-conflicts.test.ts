import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { type Express } from 'express';
import { createApp } from '../../apps/dashboard/server/src/app';
import { setupTestFixture, teardownTestFixture, type TestFixture } from '../helpers/test-db';

/**
 * The dashboard `guard generate` action hits the SAME open-conflict gate the CLI
 * does (guardGenerateInProcess, before the estimate). An open overlap → the POST
 * returns the full conflict report as an error and no job is started — a second
 * POST is gated again (422), never blocked as already-running (409).
 */

const NOTE = 'auth0_id vs auth0_sub for the user identity';

describe('guard generate route — open-conflict gate', () => {
  let app: Express;
  let fixture: TestFixture;
  let root: string;

  const url = () => `/api/repos/${fixture.project.slug}/guard/generate`;

  beforeEach(async () => {
    fixture = await setupTestFixture();
    root = fixture.repoPath;
    app = createApp({ serveStatic: false, authVerifier: null, github: null });

    fs.mkdirSync(path.join(root, '.truecourse', 'specs'), { recursive: true });
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'v1.md'), '# Users v1\nThe user identity is auth0_id.');
    fs.writeFileSync(path.join(root, 'docs', 'v2.md'), '# Users v2\nThe user identity is auth0_sub.');
    fs.writeFileSync(
      path.join(root, '.truecourse', 'specs', 'corpus.json'),
      JSON.stringify({
        version: 3,
        generatedAt: '2026-01-01T00:00:00Z',
        docs: [
          { ref: 'docs/v1.md', kind: 'prd', lastTouched: '2026-01-01T00:00:00Z', areaTags: ['booking/users-entity'] },
          { ref: 'docs/v2.md', kind: 'prd', lastTouched: '2026-02-01T00:00:00Z', areaTags: ['booking/users-entity'] },
        ],
        areas: [
          {
            id: 'booking/users-entity',
            product: 'booking',
            concern: 'users-entity',
            docRefs: ['docs/v1.md', 'docs/v2.md'],
            overlaps: [{ docs: ['docs/v1.md', 'docs/v2.md'], note: NOTE, sections: [] }],
          },
        ],
        relations: [],
        skippedDocs: [],
      }),
    );
  });
  afterEach(async () => {
    await teardownTestFixture(fixture.project.slug);
  });

  it('returns the conflict report as an error and starts no job', async () => {
    const res = await request(app).post(url()).send({ confirmed: true }).expect(422);
    expect(res.body.error).toContain('docs/v1.md');
    expect(res.body.error).toContain('docs/v2.md');
    expect(res.body.error).toContain(NOTE);
    expect(res.body.error).toContain('truecourse spec conflicts list');

    // The job never started — the second POST is gated again (422), never 409.
    await request(app).post(url()).send({ confirmed: true }).expect(422);
  });
});
