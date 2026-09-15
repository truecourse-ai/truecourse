import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { type Express } from 'express';
import { Router } from 'express';
import { createTestApp, noGithubAccess, TEST_ORG } from '../helpers/test-app';
import { setupTestFixture, teardownTestFixture, type TestFixture } from '../helpers/test-fixture';
import { clearTestRegistry } from '../helpers/test-fixture';
import { installMemorySessionRuns, resetSessionRuns } from '../helpers/memory-session-runs';
import {
  createStoredSessionRun,
  workspaceSessionsKey,
} from '@truecourse/core/lib/sessions-store';
import type { SessionCommand } from '../../packages/agent-loop/src/index';
import type { GithubMount } from '../../apps/dashboard/server/src/github/index';

/**
 * Sessions routes — the dashboard read surface over the agent-sessions store.
 * Temp-repo fixture + supertest over the real app; runs are seeded through the
 * store seam itself, over the in-memory backend, so the shapes are the store's
 * own and not hand-rolled.
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
    installMemorySessionRuns();
    fixture = await setupTestFixture();
    root = fixture.repoPath;
    app = createTestApp();
  });

  afterEach(async () => {
    await teardownTestFixture();
    resetSessionRuns();
  });

  const seedRun = async () => {
    const run = await createStoredSessionRun(root, { command: 'spec-scan', gitRef: 'abc123' });
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

  /** A run recorded before the SDK stream existed — the one shape the routes refuse. */
  const seedLegacyRun = async () => {
    const run = await seedRun();
    delete (run.record() as { activityStream?: string }).activityStream;
    return run;
  };

  it.each(['spec-scan', 'guard-setup', 'guard-generate', 'guard-interfaces'] as const)('serves %s history using the AI SDK SSE protocol', async command => {
    const run = await createStoredSessionRun(root, { command, gitRef: 'abc' });
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
    const run = await createStoredSessionRun(root, { command: 'spec-scan', gitRef: 'abc' });
    run.finish('completed');
    for (const cursor of ['NaN', '-2', '1.2', '999999999', '2']) {
      await request(app).get(url(`runs/spec-scan/${run.runId}/stream?after=${cursor}`)).expect(400);
    }
    const legacy = await seedLegacyRun();
    await request(app).get(url(`runs/spec-scan/${legacy.runId}/stream`)).expect(409);
    await request(app).get(url('runs/unknown-command/anything/stream')).expect(400);
    await request(app).get(url('runs/spec-scan/missing/stream')).expect(404);
    await request(app).get(url('runs/spec-scan/..%2Foutside/stream')).expect(400);
    await request(app).get(`/api/repos/missing/sessions/runs/spec-scan/${run.runId}/stream`).expect(404);
  });

  it('lists runs newest-first with endpoint and pid stripped', async () => {
    const run = await seedRun();
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

  it('serves one run and 404s an unknown one', async () => {
    const run = await seedRun();
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

  it('serves bounded newest, older, and live transcript pages', async () => {
    const run = await seedRun();
    run.persistence.appendEvent('sibling', EVENT(0, { text: 'Not requested' }) as never);
    const base = url(`runs/spec-scan/${run.runId}/transcript/ses-1`);
    const latest = await request(app).get(`${base}?limit=2`);
    expect(latest.status).toBe(200);
    expect(latest.body.events.map((e: { seq: number }) => e.seq)).toEqual([1, 2]);
    expect(latest.body.hasMore).toBe(true);
    expect(latest.text).not.toContain('Not requested');
    const older = await request(app).get(`${base}?limit=2&before=1`);
    expect(older.body.events.map((e: { seq: number }) => e.seq)).toEqual([0]);
    expect(older.body.hasMore).toBe(false);
    const newer = await request(app).get(`${base}?limit=1&since=0`);
    expect(newer.body.events.map((e: { seq: number }) => e.seq)).toEqual([1]);
    expect(newer.body.hasMore).toBe(true);
    for (const query of ['limit=101', 'limit=0', 'limit=2&before=-1', 'limit=2&since=0.5', 'limit=2&before=2&since=0']) {
      expect((await request(app).get(`${base}?${query}`)).status).toBe(400);
    }
  });

  it('serves a transcript, and only past the ?since cursor', async () => {
    const run = await seedRun();
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

  const seedActivityRun = async () => {
    const run = await createStoredSessionRun(root, { command: 'guard-setup', gitRef: 'abc' });
    run.setEndpoint({ url: 'http://127.0.0.1:9999', token: 'SECRET-TOKEN' });
    for (let seq = 0; seq < 4; seq++) run.persistence.appendEvent('ses-1', EVENT(seq) as never);
    run.finish('completed');
    return run;
  };

  it('pages the journal, says where the page stopped, and never serves the endpoint', async () => {
    const run = await seedActivityRun();
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
    const run = await seedActivityRun();
    for (const query of ['after=NaN', 'after=-2', 'after=1.2', 'after=1', 'after=999999', 'limit=0', 'limit=1001', 'limit=x', 'compact=bad']) {
      const res = await request(app).get(url(`runs/guard-setup/${run.runId}/activity?${query}`));
      expect([query, res.status]).toEqual([query, 400]);
    }
    await request(app).get(url('runs/not-a-command/whatever/activity')).expect(400);
    await request(app).get(url('runs/guard-setup/..%2Foutside/activity')).expect(400);
    await request(app).get(url('runs/guard-setup/2026-01-01T00-00-00Z_00000000/activity')).expect(404);
    await request(app).get(url(`runs/spec-scan/${(await seedLegacyRun()).runId}/activity`)).expect(409);
  });

  it('serves compact pages with the original cursor window and every transcript event', async () => {
    const run = await seedActivityRun();
    let after = -1;
    const transcripts: unknown[] = [];
    for (;;) {
      const endpoint = url(`runs/guard-setup/${run.runId}/activity?after=${after}&limit=2`);
      const full = await request(app).get(endpoint).expect(200);
      const compact = await request(app).get(`${endpoint}&compact=1`).expect(200);
      const snapshots = full.body.events.filter((e: { kind: string }) => e.kind === 'run');
      expect(compact.body).toEqual({
        ...full.body,
        events: full.body.events.filter((e: { kind: string; cursor: number }) => e.kind !== 'run' || e.cursor === snapshots.at(-1)?.cursor),
      });
      expect(compact.text).not.toContain('SECRET-TOKEN');
      transcripts.push(...compact.body.events.filter((e: { kind: string }) => e.kind === 'session-event'));
      after = compact.body.nextCursor;
      if (compact.body.done) break;
    }
    expect(transcripts).toHaveLength(4);
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
    createStoredSessionRun(repoPath, { command, gitRef: 'main', now: () => new Date(iso) });

  beforeEach(async () => {
    installMemorySessionRuns();
    // Earlier suites leave their registrations behind; the workspace is
    // exactly the repositories this test registers.
    clearTestRegistry();
    repos = [await setupTestFixture(), await setupTestFixture()];
    app = createTestApp();
  });

  afterEach(async () => {
    clearTestRegistry();
    await teardownTestFixture();
    resetSessionRuns();
  });

  /** One failed setup and one completed scan in the first repository, one
   *  running generate in the second: three runs, three statuses. */
  const seedWorkspace = async () => {
    const setup = await seed(repos[0].repoPath, 'guard-setup', '2026-01-01T00:00:01.000Z');
    setup.setEndpoint({ url: 'http://127.0.0.1:9999', token: 'SECRET-TOKEN' });
    setup.finish('failed', { error: { message: 'recipe gate' } });
    const generate = await seed(repos[1].repoPath, 'guard-generate', '2026-01-01T00:00:02.000Z');
    const scan = await seed(repos[0].repoPath, 'spec-scan', '2026-01-01T00:00:03.000Z');
    scan.finish('completed');
    return { setup, generate, scan };
  };

  it('lists every repository newest first, tagged with the repository, endpoint and pid stripped', async () => {
    const { setup, generate, scan } = await seedWorkspace();
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
    const { setup, generate, scan } = await seedWorkspace();
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
    const { setup, generate, scan } = await seedWorkspace();
    const first = await request(app).get('/api/sessions/runs?limit=2');
    expect(first.body.runs.map((r: { runId: string }) => r.runId)).toEqual([scan.runId, generate.runId]);
    expect(first.body.nextCursor).toBe(`${generate.record().startedAt}|${generate.runId}`);

    const second = await request(app).get(`/api/sessions/runs?limit=2&before=${encodeURIComponent(first.body.nextCursor)}`);
    expect(second.body.runs.map((r: { runId: string }) => r.runId)).toEqual([setup.runId]);
    expect(second.body.nextCursor).toBeUndefined();
  });

  it('refuses a query it cannot honour and 404s an unknown repository', async () => {
    await seedWorkspace();
    for (const query of ['kind=nope', 'status=nope', 'limit=0', 'limit=201', 'limit=x', 'before=nope', 'before=']) {
      const res = await request(app).get(`/api/sessions/runs?${query}`);
      expect([query, res.status]).toEqual([query, 400]);
    }
    await request(app).get('/api/sessions/runs?repo=not-a-repo').expect(404);
  });

  it('serves one run by id and 404s a run of no repository of the workspace', async () => {
    const { scan } = await seedWorkspace();
    const ok = await request(app).get(`/api/sessions/runs/${scan.runId}`);
    expect(ok.status).toBe(200);
    expect(ok.body.run.runId).toBe(scan.runId);
    expect(ok.body.run.repo).toEqual({ id: repos[0].project.slug, fullName: repos[0].project.name });
    expect(ok.body.run.endpoint).toBeUndefined();

    await request(app).get('/api/sessions/runs/2026-01-01T00-00-00Z_00000000').expect(404);
  });

  it('shows only the repositories the workspace connected', async () => {
    const { generate, scan } = await seedWorkspace();
    const store = {
      getRepo: async () => ({ workspaceOrgId: TEST_ORG }),
      listReposForWorkspace: async () => [{ repoFullName: repos[1].project.name }],
      unlinkRepo: async () => {},
    };
    const scoped = createTestApp({ repoLinks: store });
    const res = await request(scoped).get('/api/sessions/runs');
    expect(res.body.runs.map((r: { runId: string }) => r.runId)).toEqual([generate.runId]);
    await request(scoped).get(`/api/sessions/runs/${scan.runId}`).expect(404);
  });

  // -------------------------------------------------------------------------
  // The workspace's OWN runs: a Document scan belongs to no repository.
  // -------------------------------------------------------------------------

  /** One Document scan of the workspace, with one piece of work on it. */
  const seedWorkspaceScan = async (iso = '2026-01-01T00:00:04.000Z') => {
    const run = await createStoredSessionRun(workspaceSessionsKey(TEST_ORG), {
      command: 'spec-scan',
      gitRef: 'workspace',
      now: () => new Date(iso),
    });
    run.persistence.updateIndex({
      sessionId: 'ses-ws',
      kind: 'spec-scan.curate-doc',
      workItem: 'doc:context/site-acme/one.md',
      status: 'completed',
      spent: { turns: 1, tokens: 10, costUsd: 0 },
    });
    run.persistence.appendEvent('ses-ws', EVENT(0) as never);
    run.finish('completed');
    return run;
  };

  it("lists the workspace's own runs, which name no repository", async () => {
    const { scan } = await seedWorkspace();
    const workspaceScan = await seedWorkspaceScan();

    const res = await request(app).get('/api/sessions/runs');
    expect(res.status).toBe(200);
    const listed = res.body.runs as { runId: string; repo: unknown }[];
    expect(listed[0]).toMatchObject({ runId: workspaceScan.runId, repo: null });
    // The repositories' runs still name theirs.
    expect(listed.find((r) => r.runId === scan.runId)!.repo).toEqual({
      id: repos[0].project.slug,
      fullName: repos[0].project.name,
    });
  });

  it("leaves the workspace's own runs out when narrowed to one repository", async () => {
    await seedWorkspace();
    const workspaceScan = await seedWorkspaceScan();
    const res = await request(app).get(`/api/sessions/runs?repo=${repos[0].project.slug}`);
    expect(res.body.runs.map((r: { runId: string }) => r.runId)).not.toContain(workspaceScan.runId);
  });

  it('opens a workspace run: the record, its journal and one piece of work', async () => {
    const workspaceScan = await seedWorkspaceScan();

    const one = await request(app).get(`/api/sessions/runs/${workspaceScan.runId}`).expect(200);
    expect(one.body.run).toMatchObject({ runId: workspaceScan.runId, repo: null });

    const activity = await request(app)
      .get(`/api/sessions/runs/${workspaceScan.runId}/activity`)
      .expect(200);
    expect(activity.body.done).toBe(true);
    expect(activity.body.events.length).toBeGreaterThan(0);

    const transcript = await request(app)
      .get(`/api/sessions/runs/${workspaceScan.runId}/transcript/ses-ws`)
      .expect(200);
    expect(transcript.body.events.map((e: { seq: number }) => e.seq)).toEqual([0]);
  });

  it('404s a conversation this workspace has nothing at', async () => {
    await seedWorkspaceScan();
    await request(app).get('/api/sessions/runs/2026-01-01T00-00-00Z_00000000/activity').expect(404);
    await request(app)
      .get('/api/sessions/runs/2026-01-01T00-00-00Z_00000000/transcript/ses-ws')
      .expect(404);
  });

  it('refuses a session with no workspace — the registry is read as one, so there is nothing to list', async () => {
    const { scan } = await seedWorkspace();
    const noWorkspace = createTestApp({ authVerifier: async () => ({ user: { id: 'u', email: 'u@example.com' } }) });
    await request(noWorkspace).get('/api/sessions/runs').expect(401);
    await request(noWorkspace).get(`/api/sessions/runs/${scan.runId}`).expect(401);

    const unscoped = createTestApp({ authVerifier: null, repoLinks: null, github: null });
    await request(unscoped).get('/api/sessions/runs').expect(401);
  });
});
