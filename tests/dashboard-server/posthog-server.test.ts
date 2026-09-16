/**
 * Server-side product analytics: the finish of a background job.
 *
 * What is pinned is the mapping (which job types are someone's action and what
 * each is called), the shape of what leaves the process — the workspace group,
 * no person profile, and nothing from the payload — and the opt-out, which must
 * create no client at all rather than be trusted to stay quiet.
 *
 * Each case loads a FRESH copy of the module (`vi.resetModules`), because the
 * client is module state and a test that inherited it would prove nothing.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { JobSettledInfo } from '@truecourse/jobs';

const client = vi.hoisted(() => ({
  capture: vi.fn(),
  shutdown: vi.fn(async () => undefined),
}));
const PostHog = vi.hoisted(() => vi.fn());

vi.mock('posthog-node', () => ({
  PostHog: PostHog.mockImplementation(() => client),
}));

const DEFAULT_KEY = 'phc_ys9Ykf49KmNqAC3fhq3jugTejc4BDqyKqRS8qRoYZYew';

/** A fresh module, so the client starts uncreated. */
async function load() {
  vi.resetModules();
  return import('../../apps/dashboard/server/src/observability/posthog');
}

const settled = (over: Partial<JobSettledInfo> = {}): JobSettledInfo => ({
  type: 'repo.guard-run',
  jobId: 'job_1',
  org: 'org_A',
  outcome: 'succeeded',
  durationMs: 92_400,
  payload: { jobId: 'job_1' },
  meta: { repoFullName: 'acme/app', commitSha: 'c0ffee' },
  ...over,
});

/** The single event the mocked client was handed. */
function capturedEvent(): Record<string, unknown> {
  return client.capture.mock.calls[0]?.[0] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  // The suite disables analytics globally (tests/setup.ts); these cases are
  // about what the enabled module does.
  vi.stubEnv('POSTHOG_DISABLED', '');
});

describe('captureJobFinished — the mapping', () => {
  it.each([
    ['context.scan', 'scan_finished'],
    ['repo.guard-setup', 'setup_finished'],
    ['repo.guard-generate', 'generate_finished'],
    ['repo.guard-run', 'run_finished'],
  ])('sends %s as %s', async (type, event) => {
    const { captureJobFinished } = await load();
    captureJobFinished(settled({ type }));

    expect(client.capture).toHaveBeenCalledTimes(1);
    expect(capturedEvent()).toMatchObject({ event });
  });

  it('says nothing about a job nobody started', async () => {
    const { captureJobFinished } = await load();
    captureJobFinished(settled({ type: 'context.sync' }));

    expect(PostHog).not.toHaveBeenCalled();
    expect(client.capture).not.toHaveBeenCalled();
  });
});

describe('captureJobFinished — what leaves the process', () => {
  it('attributes the workspace, without minting a person for it', async () => {
    const { captureJobFinished } = await load();
    captureJobFinished(settled());

    expect(capturedEvent()).toEqual({
      distinctId: 'org_A',
      event: 'run_finished',
      properties: {
        source: 'server',
        outcome: 'succeeded',
        durationSeconds: 92.4,
        jobId: 'job_1',
        repo: 'acme/app',
        commit: 'c0ffee',
        $process_person_profile: false,
      },
      groups: { workspace: 'org_A' },
    });
  });

  it('carries the outcome of a job that failed or was cancelled', async () => {
    const { captureJobFinished } = await load();
    captureJobFinished(settled({ outcome: 'failed', jobId: 'job_2' }));
    captureJobFinished(settled({ outcome: 'cancelled', jobId: 'job_3' }));

    expect(client.capture.mock.calls.map((c) => (c[0] as { properties: { outcome: string } }).properties.outcome))
      .toEqual(['failed', 'cancelled']);
  });

  it('leaves the repository out when the job has no trace metadata', async () => {
    const { captureJobFinished } = await load();
    captureJobFinished(settled({ type: 'context.scan', meta: undefined }));

    const properties = capturedEvent().properties as Record<string, unknown>;
    expect(properties.repo).toBeUndefined();
    expect(properties.commit).toBeUndefined();
  });
});

describe('captureWorkspaceCreated', () => {
  it('is the person, under the id the browser identifies them by, with the workspace as the group', async () => {
    const { captureWorkspaceCreated } = await load();
    captureWorkspaceCreated({
      userId: 'user_1',
      email: 'dana@acme.dev',
      name: 'Dana Rees',
      workspaceId: 'org_new',
      workspaceName: 'Acme Inc.',
    });

    expect(capturedEvent()).toEqual({
      distinctId: 'user_1',
      event: 'workspace_created',
      properties: {
        source: 'server',
        workspaceId: 'org_new',
        workspaceName: 'Acme Inc.',
        $set: { email: 'dana@acme.dev', name: 'Dana Rees' },
      },
      groups: { workspace: 'org_new' },
    });
  });

  it('sets no name on a person who has none', async () => {
    const { captureWorkspaceCreated } = await load();
    captureWorkspaceCreated({
      userId: 'user_1',
      email: 'dana@acme.dev',
      workspaceId: 'org_new',
      workspaceName: 'Acme Inc.',
    });

    expect((capturedEvent().properties as { $set: unknown }).$set).toEqual({ email: 'dana@acme.dev' });
  });

  it('sends nothing with the opt-out set', async () => {
    vi.stubEnv('POSTHOG_DISABLED', '1');
    const { captureWorkspaceCreated } = await load();
    captureWorkspaceCreated({ userId: 'user_1', email: 'dana@acme.dev', workspaceId: 'org_new', workspaceName: 'Acme' });

    expect(PostHog).not.toHaveBeenCalled();
    expect(client.capture).not.toHaveBeenCalled();
  });
});

describe('the deployment environment', () => {
  it('starts one client per process, on the shared project', async () => {
    const { captureJobFinished } = await load();
    captureJobFinished(settled());
    captureJobFinished(settled({ jobId: 'job_2' }));

    expect(PostHog).toHaveBeenCalledTimes(1);
    expect(PostHog.mock.calls[0]?.[0]).toBe(DEFAULT_KEY);
    expect(PostHog.mock.calls[0]?.[1]).toMatchObject({ host: 'https://us.i.posthog.com' });
  });

  it('takes another project from the environment', async () => {
    vi.stubEnv('POSTHOG_KEY', 'phc_staging');
    vi.stubEnv('POSTHOG_HOST', 'https://posthog.internal');
    const { captureJobFinished } = await load();
    captureJobFinished(settled());

    expect(PostHog.mock.calls[0]?.[0]).toBe('phc_staging');
    expect(PostHog.mock.calls[0]?.[1]).toMatchObject({ host: 'https://posthog.internal' });
  });

  it('creates no client at all with the opt-out set', async () => {
    vi.stubEnv('POSTHOG_DISABLED', '1');
    const mod = await load();
    mod.captureJobFinished(settled());
    await mod.shutdownServerAnalytics();

    expect(PostHog).not.toHaveBeenCalled();
    expect(client.capture).not.toHaveBeenCalled();
    expect(client.shutdown).not.toHaveBeenCalled();
  });
});

describe('shutdownServerAnalytics', () => {
  it('waits for the batched events to leave', async () => {
    let flushed = false;
    client.shutdown.mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      flushed = true;
      return undefined;
    });

    const mod = await load();
    mod.captureJobFinished(settled());
    await mod.shutdownServerAnalytics();

    expect(client.shutdown).toHaveBeenCalledTimes(1);
    expect(flushed).toBe(true);
  });

  it('is a no-op when nothing was ever sent, and the process stays quiet after one', async () => {
    const mod = await load();
    await mod.shutdownServerAnalytics();
    expect(client.shutdown).not.toHaveBeenCalled();

    mod.captureJobFinished(settled());
    await mod.shutdownServerAnalytics();
    expect(client.shutdown).toHaveBeenCalledTimes(1);

    // Shut down means shut down: a job settling during the teardown reopens nothing.
    mod.captureJobFinished(settled({ jobId: 'job_late' }));
    expect(client.capture).toHaveBeenCalledTimes(1);
    expect(PostHog).toHaveBeenCalledTimes(1);
  });

  it('a flush that fails does not stop the process', async () => {
    client.shutdown.mockRejectedValueOnce(new Error('network down'));
    const mod = await load();
    mod.captureJobFinished(settled());

    await expect(mod.shutdownServerAnalytics()).resolves.toBeUndefined();
  });
});
