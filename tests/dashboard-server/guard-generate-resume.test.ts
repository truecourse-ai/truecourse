import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import request from 'supertest';
import path from 'node:path';
import type { Express } from 'express';
import { createSessionRun } from '@truecourse/core/lib/sessions-store';
import { createTestApp, stubJobs, type StubJobs } from '../helpers/test-app';
import { setupTestFixture, teardownTestFixture, type TestFixture } from '../helpers/test-db';

describe('guard generate resume route', () => {
  let fixture: TestFixture;
  let app: Express;
  let jobs: StubJobs;
  const url = () => `/api/repos/${fixture.project.slug}/guard/generate`;
  beforeEach(async () => {
    fixture = await setupTestFixture();
    jobs = stubJobs();
    app = createTestApp({ jobs: jobs.mount });
  });
  afterEach(async () => { await teardownTestFixture(fixture.project.slug); });

  it('enqueues the saved run identity, ignoring client-supplied completed steps', async () => {
    const run = createSessionRun(fixture.repoPath, { command: 'guard-generate', gitRef: 'a'.repeat(40) });
    run.finish('interrupted');
    await request(app).post(url()).send({ resumeRunId: run.runId, completedSteps: ['author'] }).expect(202);
    expect(jobs.guardGenerates).toEqual([expect.objectContaining({ resumeRunId: run.runId })]);
    expect(jobs.guardGenerates[0]).not.toHaveProperty('completedSteps');
  });

  it.each(['running', 'completed'] as const)('does not resume a %s run', async status => {
    const run = createSessionRun(fixture.repoPath, { command: 'guard-generate', gitRef: 'a'.repeat(40) });
    if (status === 'completed') run.finish(status);
    await request(app).post(url()).send({ resumeRunId: run.runId }).expect(422);
    expect(jobs.guardGenerates).toEqual([]);
  });

  it('does not find another command under the generation namespace', async () => {
    const run = createSessionRun(fixture.repoPath, { command: 'spec-scan', gitRef: 'a'.repeat(40) });
    run.finish('interrupted');
    await request(app).post(url()).send({ resumeRunId: run.runId }).expect(404);
    expect(jobs.guardGenerates).toEqual([]);
  });

  it('does not resume a run owned by another repository', async () => {
    const run = createSessionRun(path.join(fixture.repoPath, 'another-repo'), { command: 'guard-generate', gitRef: 'a'.repeat(40) });
    run.finish('interrupted');
    await request(app).post(url()).send({ resumeRunId: run.runId }).expect(404);
    expect(jobs.guardGenerates).toEqual([]);
  });

  it.each([null, 7, '../other-repo/run', ''])('rejects malformed identity %j', async resumeRunId => {
    await request(app).post(url()).send({ resumeRunId }).expect(400);
    expect(jobs.guardGenerates).toEqual([]);
  });

  it('still permits an explicitly fresh generation', async () => {
    await request(app).post(url()).send({}).expect(202);
    expect(jobs.guardGenerates).toHaveLength(1);
    expect(jobs.guardGenerates[0]).not.toHaveProperty('resumeRunId');
  });
});
