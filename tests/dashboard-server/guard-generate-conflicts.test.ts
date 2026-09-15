import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { type Express } from 'express';
import { createTestApp, TEST_ORG } from '../helpers/test-app';
import { setupTestFixture, teardownTestFixture, type TestFixture } from '../helpers/test-fixture';
import { installMemorySpecStore, resetSpecStore } from '../helpers/memory-spec-store';
import { memoryContextStore } from '../helpers/memory-context-store';
import {
  setContextBindings,
  setContextStore,
  resetContextStore,
} from '@truecourse/core/lib/context-store';
import { saveWorkspaceSpec } from '@truecourse/core/lib/spec-store';

/**
 * The dashboard `guard generate` action hits the SAME open-conflict gate the
 * engine does, over the repository's SLICE of the workspace corpus folded with
 * the workspace's decisions. An open overlap → the POST returns the full
 * conflict report as an error and no job is started — a second POST is gated
 * again (422), never blocked as already-running (409).
 */

const NOTE = 'auth0_id vs auth0_sub for the user identity';
const SOURCE = 'repo-src';
const V1 = `context/${SOURCE}/docs/v1.md`;
const V2 = `context/${SOURCE}/docs/v2.md`;

describe('guard generate route — open-conflict gate', () => {
  let app: Express;
  let fixture: TestFixture;

  const url = () => `/api/repos/${fixture.project.slug}/guard/generate`;

  beforeEach(async () => {
    installMemorySpecStore();
    setContextStore(memoryContextStore());
    fixture = await setupTestFixture();
    app = createTestApp();

    await setContextBindings(TEST_ORG, fixture.repoPath, [SOURCE]);
    await saveWorkspaceSpec({ workspaceOrgId: TEST_ORG }, 'corpus', {
      version: 3,
      generatedAt: '2026-01-01T00:00:00Z',
      docs: [
        { ref: V1, kind: 'prd', lastTouched: '2026-01-01T00:00:00Z', areaTags: ['booking/users-entity'], sourceId: SOURCE },
        { ref: V2, kind: 'prd', lastTouched: '2026-02-01T00:00:00Z', areaTags: ['booking/users-entity'], sourceId: SOURCE },
      ],
      areas: [
        {
          id: 'booking/users-entity',
          product: 'booking',
          concern: 'users-entity',
          docRefs: [V1, V2],
          overlaps: [{ docs: [V1, V2], note: NOTE, sections: [] }],
        },
      ],
      relations: [],
      skippedDocs: [],
    });
  });
  afterEach(async () => {
    await teardownTestFixture(fixture.project.slug);
    resetSpecStore();
    resetContextStore();
  });

  it('returns the conflict report as an error and starts no job', async () => {
    const res = await request(app).post(url()).send({ confirmed: true }).expect(422);
    expect(res.body.error).toContain(V1);
    expect(res.body.error).toContain(V2);
    expect(res.body.error).toContain(NOTE);
    expect(res.body.error).toContain('Conflicts group');

    // The job never started — the second POST is gated again (422), never 409.
    await request(app).post(url()).send({ confirmed: true }).expect(422);
  });
});
