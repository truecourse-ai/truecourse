import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { type Express } from 'express';
import { createApp } from '../../apps/dashboard/server/src/app';
import { setupTestFixture, teardownTestFixture, type TestFixture } from '../helpers/test-db';
import { createSessionRun, sessionRunDir } from '../../packages/core/src/lib/sessions-store';

/**
 * Sessions routes — the dashboard read surface over the agent-sessions store.
 * Temp-repo fixture + supertest over the real app; runs are seeded through the
 * real `createSessionRun` (so the shapes are the store's own, not hand-rolled),
 * except the dead-pid run, which is written raw to exercise the listing sweep.
 */

const EVENT = (seq: number, extra: Record<string, unknown> = {}) => ({
  seq,
  ts: `2026-08-21T00:00:0${seq}.000Z`,
  type: 'assistant-turn',
  text: `turn ${seq}`,
  usage: {
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    costUsd: 0,
    costSource: 'unpriced',
  },
  ...extra,
});

describe('Sessions routes', () => {
  let app: Express;
  let fixture: TestFixture;
  let root: string;

  const url = (suffix: string) => `/api/repos/${fixture.project.slug}/sessions/${suffix}`;

  beforeEach(async () => {
    fixture = await setupTestFixture();
    root = fixture.repoPath;
    app = createApp({ serveStatic: false });
  });

  afterEach(async () => {
    await teardownTestFixture();
  });

  const seedRun = () => {
    const run = createSessionRun(root, { command: 'spec-scan', gitRef: 'abc123' });
    run.setEndpoint({ url: 'http://127.0.0.1:9999', token: 'SECRET-TOKEN' });
    run.persistence.updateIndex({
      sessionId: 'ses-1',
      kind: 'spec-scan.curate-doc',
      workItem: 'doc:README.md',
      status: 'completed',
      spent: { turns: 2, tokens: 100, costUsd: 0.01 },
    });
    run.persistence.appendEvent('ses-1', EVENT(0) as never);
    run.persistence.appendEvent('ses-1', EVENT(1) as never);
    run.persistence.appendEvent('ses-1', EVENT(2) as never);
    return run;
  };

  it('lists runs newest-first with endpoint and pid stripped', async () => {
    const run = seedRun();
    const res = await request(app).get(url('runs'));
    expect(res.status).toBe(200);
    expect(res.body.runs).toHaveLength(1);
    const listed = res.body.runs[0];
    expect(listed.runId).toBe(run.runId);
    expect(listed.command).toBe('spec-scan');
    expect(listed.sessions).toHaveLength(1);
    expect(listed.endpoint).toBeUndefined();
    expect(listed.pid).toBeUndefined();
  });

  it('sweeps a dead-pid run to interrupted (its sessions parked) on listing', async () => {
    // Raw record with a pid no live process holds — the store's own boot sweep
    // must repair it when the route lists.
    const runId = '2026-08-20T00-00-00Z_deadbeef';
    const dir = sessionRunDir(root, 'guard-generate', runId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'run.json'),
      JSON.stringify({
        command: 'guard-generate',
        runId,
        gitRef: 'abc',
        startedAt: '2026-08-20T00:00:00.000Z',
        status: 'running',
        pid: 2 ** 22 - 1,
        endpoint: { url: 'http://127.0.0.1:1', token: 'DEAD-TOKEN' },
        sessions: [
          {
            sessionId: 's',
            kind: 'k',
            workItem: 'w',
            status: 'running',
            spent: { turns: 0, tokens: 0, costUsd: 0 },
          },
        ],
      }),
    );
    const res = await request(app).get(url('runs'));
    expect(res.status).toBe(200);
    const listed = res.body.runs.find((r: { runId: string }) => r.runId === runId);
    expect(listed.status).toBe('interrupted');
    expect(listed.sessions[0].status).toBe('parked');
    expect(listed.endpoint).toBeUndefined();
  });

  it('serves one run and 404s an unknown one', async () => {
    const run = seedRun();
    const ok = await request(app).get(url(`runs/spec-scan/${run.runId}`));
    expect(ok.status).toBe(200);
    expect(ok.body.run.runId).toBe(run.runId);
    expect(ok.body.run.endpoint).toBeUndefined();

    const missing = await request(app).get(url('runs/spec-scan/2026-01-01T00-00-00Z_00000000'));
    expect(missing.status).toBe(404);
  });

  it('refuses a command the store never wrote', async () => {
    const res = await request(app).get(url('runs/not-a-command/whatever'));
    expect(res.status).toBe(400);
  });

  it('serves a transcript, and only past the ?since cursor', async () => {
    const run = seedRun();
    const all = await request(app).get(url(`runs/spec-scan/${run.runId}/transcript/ses-1`));
    expect(all.status).toBe(200);
    expect(all.body.events.map((e: { seq: number }) => e.seq)).toEqual([0, 1, 2]);

    const tail = await request(app).get(url(`runs/spec-scan/${run.runId}/transcript/ses-1?since=1`));
    expect(tail.body.events.map((e: { seq: number }) => e.seq)).toEqual([2]);

    // A session with no transcript yet is an empty list, not an error.
    const empty = await request(app).get(url(`runs/spec-scan/${run.runId}/transcript/nope`));
    expect(empty.status).toBe(200);
    expect(empty.body.events).toEqual([]);
  });
});
