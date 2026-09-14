/**
 * Per-workspace LLM credentials, threaded per run.
 *
 * The dashboard server holds no process-wide transport: every step that spends
 * — the Document scan, guard generate — loads the asking workspace's provider,
 * proves it answers, and hands the resulting driver/transport to the pipeline
 * call. What's asserted here is exactly that
 * handoff, plus the two ways a start can refuse: no provider configured (409,
 * machine-readable) and a provider that won't answer (502, with the failure on
 * the run record so Activity can show it).
 *
 * The spec scan runs on the job queue, so its ROUTE only pre-flights the
 * provider and enqueues (202); the pipeline half is driven directly here.
 *
 * The engines are mocked — nothing here reaches a model.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import request from 'supertest';
import { type Express } from 'express';

vi.mock('../../apps/dashboard/server/src/socket/handlers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../apps/dashboard/server/src/socket/handlers')>();
  const tracker = () => ({ start() {}, done() {}, error() {}, detail() {} });
  return {
    ...actual,
    createSocketSpecTracker: tracker,
    emitSpecProgress: vi.fn(),
    emitSpecComplete: vi.fn(),
  };
});

vi.mock('@truecourse/core/commands/guard-in-process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@truecourse/core/commands/guard-in-process')>()),
  guardGenerateInProcess: vi.fn(),
}));

vi.mock('@truecourse/core/commands/spec-in-process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@truecourse/core/commands/spec-in-process')>()),
  curateInProcess: vi.fn(),
}));

// The dist entries the dashboard server itself imports — the source copies would
// be different module instances with their own stores.
import { guardGenerateInProcess } from '@truecourse/core/commands/guard-in-process';
import { curateInProcess } from '@truecourse/core/commands/spec-in-process';
import { listSessionRuns } from '@truecourse/core/lib/sessions-store';
import { workspaceSessionsKey } from '@truecourse/core/commands/context-scan';
import type { SessionDriver } from '@truecourse/agent-loop';
import type { LlmTransport } from '@truecourse/shared/llm';
import type { GlobalApiLlmConfig } from '@truecourse/core/config/global-config';
import { createTestApp, stubJobs, TEST_ORG, type StubJobs } from '../helpers/test-app';
import {
  resetWorkspaceLlmBackend,
  resetWorkspaceLlmConfigStore,
  setWorkspaceLlmBackend,
  setWorkspaceLlmConfigStore,
  type WorkspaceLlmConfigStore,
} from '../../apps/dashboard/server/src/services/workspace-llm.service';
import { setupTestFixture, teardownTestFixture, type TestFixture } from '../helpers/test-db';

const WORKSPACE_CONFIG: GlobalApiLlmConfig = {
  provider: 'anthropic',
  model: 'claude-workspace',
  apiKey: 'sk-workspace',
};

/** The driver/transport a start is expected to hand to the pipeline. */
const driver = { attribution: { provider: 'anthropic', model: 'claude-workspace' } } as unknown as SessionDriver;
const transport = (async () => '{}') as LlmTransport;

/** An in-memory stand-in for the Postgres config store (that has its own suite). */
function configStore(configs: Record<string, GlobalApiLlmConfig>): WorkspaceLlmConfigStore {
  return {
    getConfig: async (orgId) => configs[orgId] ?? null,
    getView: async () => null,
    save: async () => {},
  };
}

let app: Express;
let fixture: TestFixture;
let probe: ReturnType<typeof vi.fn>;
let jobs: StubJobs;

beforeEach(async () => {
  probe = vi.fn(async () => {});

  vi.mocked(guardGenerateInProcess).mockReset().mockResolvedValue({
    guard: { status: 'ok', noChanges: false, written: [], birthFindings: [] },
  } as never);
  vi.mocked(curateInProcess).mockReset().mockResolvedValue({ noChanges: false } as never);

  fixture = await setupTestFixture();
  execFileSync('git', ['init'], { cwd: fixture.repoPath, stdio: 'ignore' });
  jobs = stubJobs();
  app = createTestApp({ jobs: jobs.mount });
  // After createTestApp — it installs the permissive default this suite replaces.
  setWorkspaceLlmConfigStore(configStore({ [TEST_ORG]: WORKSPACE_CONFIG }));
  setWorkspaceLlmBackend({
    probe: probe as never,
    driver: () => driver,
    transport: () => transport,
  });
});

afterEach(async () => {
  await teardownTestFixture(fixture.project.slug);
  resetWorkspaceLlmBackend();
  resetWorkspaceLlmConfigStore();
});

const url = (suffix: string) => `/api/repos/${fixture.project.slug}/${suffix}`;

const start = (suffix: string) => {
  switch (suffix) {
    // The Document scan belongs to the WORKSPACE: it is started at the
    // workspace address, not under a repository.
    case 'spec scan':
      return request(app).post('/api/context/scan');
    default:
      return request(app).post(url('guard/generate')).send({ confirmed: true });
  }
};

const ENTRIES = ['spec scan', 'guard generate'];

/** The workspace's own scan runs, newest first — the Document scan's records. */
const workspaceScanRuns = () => listSessionRuns(workspaceSessionsKey(TEST_ORG), 'spec-scan');

describe('a workspace with no provider configured', () => {
  beforeEach(() => {
    setWorkspaceLlmConfigStore(configStore({}));
  });

  it.each(ENTRIES)('answers %s with the machine-readable not-configured code', async (entry) => {
    const res = await start(entry).expect(409);
    expect(res.body.error).toBe('llm-not-configured');
    expect(res.body.message).toMatch(/Settings/);
  });

  it('spends nothing and starts nothing', async () => {
    await start('spec scan').expect(409);
    await start('guard generate').expect(409);
    expect(probe).not.toHaveBeenCalled();
    expect(jobs.contextScans).toEqual([]);
    expect(jobs.guardGenerates).toEqual([]);
    expect(workspaceScanRuns()).toHaveLength(0);
  });
});

describe('a provider that will not answer', () => {
  beforeEach(() => {
    probe.mockRejectedValue(new Error('401 invalid x-api-key'));
  });

  it.each(ENTRIES)('answers %s with the probe failure, before any spend', async (entry) => {
    const res = await start(entry).expect(502);
    expect(res.body).toMatchObject({ error: 'llm-probe-failed', message: '401 invalid x-api-key' });
    expect(jobs.contextScans).toEqual([]);
    expect(jobs.guardGenerates).toEqual([]);
  });

  // The scan is the WORKSPACE's now, so the run it leaves is the workspace's.
  it('leaves the scan a failed run that says why, so Activity can show it', async () => {
    const before = workspaceScanRuns().length;
    await start('spec scan').expect(502);

    const runs = workspaceScanRuns();
    expect(runs).toHaveLength(before + 1);
    expect(runs[0]).toMatchObject({
      status: 'failed',
      error: { message: '401 invalid x-api-key', kind: 'llm-probe' },
    });
  });
});

describe('a configured, answering provider', () => {
  // The scan runs on the queue, so the route's job is the PRE-FLIGHT: prove the
  // workspace's provider, then hand the WORKSPACE to the runner — the scan is
  // the workspace's Document scan, whatever surface pressed it.
  it('proves the workspace provider, then queues the scan', async () => {
    const res = await start('spec scan').expect(202);

    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe.mock.calls[0][0]).toEqual(WORKSPACE_CONFIG);
    expect(res.body).toEqual({ jobId: 'job_test' });
    expect(jobs.contextScans).toEqual([{ workspaceOrgId: TEST_ORG, source: 'manual' }]);
  });

  it('answers 409 when a scan is already running', async () => {
    jobs.answer = { status: 'busy' };

    const res = await start('spec scan').expect(409);
    expect(res.body.error).toMatch(/already running/i);
  });

  it('proves the workspace provider, then queues the generate', async () => {
    const res = await start('guard generate').expect(202);

    expect(probe).toHaveBeenCalledTimes(1);
    expect(res.body).toEqual({ jobId: 'job_test' });
    expect(jobs.guardGenerates).toEqual([
      {
        repoId: fixture.project.slug,
        repoFullName: fixture.repoPath,
        workspaceOrgId: TEST_ORG,
        source: 'manual',
      },
    ]);
    // The job body, not the route, runs the engine on the workspace transport.
    expect(vi.mocked(guardGenerateInProcess)).not.toHaveBeenCalled();
  });
});

describe("operator mode — the server's own Claude Code", () => {
  const claudeDriver = { attribution: { provider: 'claude-code', model: 'opus' } } as unknown as SessionDriver;
  const claudeTransport = (async () => '{}') as LlmTransport;
  let claudeProbe: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv('TRUECOURSE_LLM_TRANSPORT', 'claude-code');
    claudeProbe = vi.fn(async () => {});
    // No workspace has a provider — operator mode must never need one.
    setWorkspaceLlmConfigStore(configStore({}));
    setWorkspaceLlmBackend({
      probe: probe as never,
      claudeCode: { probe: claudeProbe as never, driver: () => claudeDriver, transport: () => claudeTransport },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('queues the spec scan on the operator’s login, with no workspace provider', async () => {
    await start('spec scan').expect(202);

    expect(claudeProbe).toHaveBeenCalledTimes(1);
    expect(probe).not.toHaveBeenCalled();
    expect(jobs.contextScans).toHaveLength(1);
  });

  it('queues the generate on the operator’s login too', async () => {
    await start('guard generate').expect(202);

    expect(claudeProbe).toHaveBeenCalledTimes(1);
    expect(probe).not.toHaveBeenCalled();
    expect(jobs.guardGenerates).toHaveLength(1);
  });

  it('answers a logged-out `claude` with the probe failure, before any spend', async () => {
    claudeProbe.mockRejectedValue(new Error('Not logged in · run claude login'));

    const res = await start('spec scan').expect(502);
    expect(res.body).toMatchObject({ error: 'llm-probe-failed', message: 'Not logged in · run claude login' });
    expect(jobs.contextScans).toEqual([]);
  });
});
