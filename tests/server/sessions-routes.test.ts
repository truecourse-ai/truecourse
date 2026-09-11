import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { type Express } from 'express';
import { Router } from 'express';
import { createTestApp, TEST_ORG } from '../helpers/test-app';
import { setupTestFixture, teardownTestFixture, type TestFixture } from '../helpers/test-db';
import { readRegistry, unregisterProject } from '../../packages/core/src/config/registry';
import { createSessionRun, sessionRunDir } from '../../packages/core/src/lib/sessions-store';
import type { SessionCommand } from '../../packages/agent-loop/src/index';
import type { GithubMount } from '../../apps/dashboard/server/src/github/index';

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
    app = createTestApp();
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

  it.each(['spec-scan', 'guard-setup', 'guard-generate', 'guard-interfaces'] as const)('serves %s history using the AI SDK SSE protocol', async command => {
    const run = createSessionRun(root, { command, gitRef: 'abc', activityStream: true });
    run.setEndpoint({ url: 'http://localhost:1', token: 'DO-NOT-STREAM' });
    run.persistence.appendEvent('a', EVENT(0) as never);
    run.finish('completed');
    const res = await request(app).get(url(`runs/${command}/${run.runId}/stream`));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.headers['x-vercel-ai-ui-message-stream']).toBe('v1');
    expect(res.text).toContain('data-activity');
    expect(res.text).toContain('turn 0');
    expect(res.text).toContain('[DONE]');
    expect(res.text).not.toContain('DO-NOT-STREAM');
    const records = fs.readFileSync(path.join(run.dir, 'activity.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    const resumed = await request(app).get(url(`runs/${command}/${run.runId}/stream?after=${records.at(-1).cursor}`));
    expect(resumed.status).toBe(200);
    expect(resumed.text).not.toContain('data-activity');
    expect(resumed.text).toContain('"type":"finish"');
  });

  it('rejects invalid stream cursors, unsupported runs, unsafe IDs, and missing repositories', async () => {
    const run = createSessionRun(root, { command: 'spec-scan', gitRef: 'abc', activityStream: true });
    run.finish('completed');
    for (const cursor of ['NaN', '-2', '1.2', '999999999', '2']) {
      await request(app).get(url(`runs/spec-scan/${run.runId}/stream?after=${cursor}`)).expect(400);
    }
    const legacy = seedRun();
    await request(app).get(url(`runs/spec-scan/${legacy.runId}/stream`)).expect(409);
    await request(app).get(url('runs/unknown-command/anything/stream')).expect(400);
    await request(app).get(url('runs/spec-scan/missing/stream')).expect(404);
    await request(app).get(url('runs/spec-scan/..%2Foutside/stream')).expect(400);
    await request(app).get(`/api/repos/missing/sessions/runs/spec-scan/${run.runId}/stream`).expect(404);
  });

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

  const seedActivityRun = () => {
    const run = createSessionRun(root, { command: 'guard-setup', gitRef: 'abc', activityStream: true });
    run.setEndpoint({ url: 'http://127.0.0.1:9999', token: 'SECRET-TOKEN' });
    for (let seq = 0; seq < 4; seq++) run.persistence.appendEvent('ses-1', EVENT(seq) as never);
    run.finish('completed');
    return run;
  };

  it('pages the journal, says where the page stopped, and never serves the endpoint', async () => {
    const run = seedActivityRun();
    const events: { cursor: number; kind: string }[] = [];
    let after = -1;
    let pages = 0;
    for (;;) {
      const res = await request(app).get(url(`runs/guard-setup/${run.runId}/activity?after=${after}&limit=4`));
      expect(res.status).toBe(200);
      expect(res.text).not.toContain('SECRET-TOKEN');
      events.push(...res.body.events);
      expect(res.body.nextCursor).toBe(events.length ? events[events.length - 1].cursor : after);
      after = res.body.nextCursor;
      pages++;
      if (res.body.done) {
        expect(res.body.events.length).toBeLessThan(4);
        break;
      }
    }
    // The create snapshot, the endpoint and finish snapshots, and four turns.
    expect(pages).toBe(2);
    expect(events.filter(e => e.kind === 'session-event')).toHaveLength(4);
    expect(events.map(e => e.cursor)).toEqual([...events].sort((a, b) => a.cursor - b.cursor).map(e => e.cursor));
    // The whole journal in one page is done in one request.
    const whole = await request(app).get(url(`runs/guard-setup/${run.runId}/activity`));
    expect(whole.body.done).toBe(true);
    expect(whole.body.events).toHaveLength(events.length);
  });

  it('refuses bad activity cursors, limits, commands, run IDs, and legacy runs', async () => {
    const run = seedActivityRun();
    for (const query of ['after=NaN', 'after=-2', 'after=1.2', 'after=1', 'after=999999', 'limit=0', 'limit=1001', 'limit=x']) {
      const res = await request(app).get(url(`runs/guard-setup/${run.runId}/activity?${query}`));
      expect([query, res.status]).toEqual([query, 400]);
    }
    await request(app).get(url('runs/not-a-command/whatever/activity')).expect(400);
    await request(app).get(url('runs/guard-setup/..%2Foutside/activity')).expect(400);
    await request(app).get(url('runs/guard-setup/2026-01-01T00-00-00Z_00000000/activity')).expect(404);
    await request(app).get(url(`runs/spec-scan/${seedRun().runId}/activity`)).expect(409);
  });
});

/**
 * The workspace surface: every run of every repository the caller's workspace
 * connected, as one newest-first page. The registry is file-backed here, so a
 * repository's key is its path and `repo.id` is the slug the console addresses.
 */
describe('Workspace sessions routes', () => {
  let app: Express;
  let repos: TestFixture[];

  const seed = (repoPath: string, command: SessionCommand, iso: string) =>
    createSessionRun(repoPath, { command, gitRef: 'main', now: () => new Date(iso) });

  beforeEach(async () => {
    // Earlier suites leave their registrations behind; the workspace is
    // exactly the repositories this test registers.
    for (const entry of await readRegistry()) await unregisterProject(entry.slug);
    repos = [await setupTestFixture(), await setupTestFixture()];
    app = createTestApp();
  });

  afterEach(async () => {
    for (const repo of repos) await unregisterProject(repo.project.slug);
    await teardownTestFixture();
  });

  /** One failed setup and one completed scan in the first repository, one
   *  running generate in the second: three runs, three statuses. */
  const seedWorkspace = () => {
    const setup = seed(repos[0].repoPath, 'guard-setup', '2026-01-01T00:00:01.000Z');
    setup.setEndpoint({ url: 'http://127.0.0.1:9999', token: 'SECRET-TOKEN' });
    setup.finish('failed', { error: { message: 'recipe gate' } });
    const generate = seed(repos[1].repoPath, 'guard-generate', '2026-01-01T00:00:02.000Z');
    const scan = seed(repos[0].repoPath, 'spec-scan', '2026-01-01T00:00:03.000Z');
    scan.finish('completed');
    return { setup, generate, scan };
  };

  it('lists every repository newest first, tagged with the repository, endpoint and pid stripped', async () => {
    const { setup, generate, scan } = seedWorkspace();
    const res = await request(app).get('/api/sessions/runs');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('SECRET-TOKEN');
    expect(res.body.runs.map((r: { runId: string }) => r.runId)).toEqual([scan.runId, generate.runId, setup.runId]);
    expect(res.body.runs.map((r: { repo: { id: string; fullName: string } }) => r.repo)).toEqual([
      { id: repos[0].project.slug, fullName: repos[0].project.name },
      { id: repos[1].project.slug, fullName: repos[1].project.name },
      { id: repos[0].project.slug, fullName: repos[0].project.name },
    ]);
    for (const run of res.body.runs) {
      expect(run.endpoint).toBeUndefined();
      expect(run.pid).toBeUndefined();
      expect(run.repoKey).toBeUndefined();
    }
    expect(res.body.nextCursor).toBeUndefined();
  });

  it('narrows by repository, kind and status', async () => {
    const { setup, generate, scan } = seedWorkspace();
    const byRepo = await request(app).get(`/api/sessions/runs?repo=${repos[1].project.slug}`);
    expect(byRepo.body.runs.map((r: { runId: string }) => r.runId)).toEqual([generate.runId]);

    const byKind = await request(app).get('/api/sessions/runs?kind=spec-scan');
    expect(byKind.body.runs.map((r: { runId: string }) => r.runId)).toEqual([scan.runId]);

    const byStatus = await request(app).get('/api/sessions/runs?status=failed');
    expect(byStatus.body.runs.map((r: { runId: string }) => r.runId)).toEqual([setup.runId]);
    expect(byStatus.body.runs[0].error).toEqual({ message: 'recipe gate' });

    const running = await request(app).get('/api/sessions/runs?status=running&kind=guard-generate');
    expect(running.body.runs.map((r: { runId: string }) => r.runId)).toEqual([generate.runId]);
  });

  it('pages with ?before, ending without a cursor', async () => {
    const { setup, generate, scan } = seedWorkspace();
    const first = await request(app).get('/api/sessions/runs?limit=2');
    expect(first.body.runs.map((r: { runId: string }) => r.runId)).toEqual([scan.runId, generate.runId]);
    expect(first.body.nextCursor).toBe(`${generate.record().startedAt}|${generate.runId}`);

    const second = await request(app).get(`/api/sessions/runs?limit=2&before=${encodeURIComponent(first.body.nextCursor)}`);
    expect(second.body.runs.map((r: { runId: string }) => r.runId)).toEqual([setup.runId]);
    expect(second.body.nextCursor).toBeUndefined();
  });

  it('refuses a query it cannot honour and 404s an unknown repository', async () => {
    seedWorkspace();
    for (const query of ['kind=nope', 'status=nope', 'limit=0', 'limit=201', 'limit=x', 'before=nope', 'before=']) {
      const res = await request(app).get(`/api/sessions/runs?${query}`);
      expect([query, res.status]).toEqual([query, 400]);
    }
    await request(app).get('/api/sessions/runs?repo=not-a-repo').expect(404);
  });

  it('serves one run by id and 404s a run of no repository of the workspace', async () => {
    const { scan } = seedWorkspace();
    const ok = await request(app).get(`/api/sessions/runs/${scan.runId}`);
    expect(ok.status).toBe(200);
    expect(ok.body.run.runId).toBe(scan.runId);
    expect(ok.body.run.repo).toEqual({ id: repos[0].project.slug, fullName: repos[0].project.name });
    expect(ok.body.run.endpoint).toBeUndefined();

    await request(app).get('/api/sessions/runs/2026-01-01T00-00-00Z_00000000').expect(404);
  });

  it('shows only the repositories the workspace connected', async () => {
    const { generate, scan } = seedWorkspace();
    const store = {
      getRepo: async () => ({ workspaceOrgId: TEST_ORG }),
      listReposForWorkspace: async () => [{ repoFullName: repos[1].project.name }],
      unlinkRepo: async () => {},
    };
    const scoped = createTestApp({
      github: { webhook: Router(), connect: Router(), store: store as unknown as GithubMount['store'] },
    });
    const res = await request(scoped).get('/api/sessions/runs');
    expect(res.body.runs.map((r: { runId: string }) => r.runId)).toEqual([generate.runId]);
    await request(scoped).get(`/api/sessions/runs/${scan.runId}`).expect(404);
  });

  it('refuses a session with no workspace, and reads the whole registry when the server has none', async () => {
    const { setup, generate, scan } = seedWorkspace();
    const noWorkspace = createTestApp({ authVerifier: async () => ({ user: { id: 'u', email: 'u@example.com' } }) });
    await request(noWorkspace).get('/api/sessions/runs').expect(401);
    await request(noWorkspace).get(`/api/sessions/runs/${scan.runId}`).expect(401);

    const fileMode = createTestApp({ authVerifier: null, github: null });
    const res = await request(fileMode).get('/api/sessions/runs');
    expect(res.body.runs.map((r: { runId: string }) => r.runId)).toEqual([scan.runId, generate.runId, setup.runId]);
  });
});
