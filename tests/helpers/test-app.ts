/**
 * Server-route test harness for the closed visibility model. A repository is
 * visible only when a link row ties it to the caller's workspace, so a bare
 * `createApp({ authVerifier: null, github: null, jobs: null })` sees nothing.
 * Route tests that are not ABOUT scoping use this instead: an auth verifier that
 * stamps one test org, a permissive link store that reads every registered repo
 * as linked to it — the file-registry analog of the gh_repos-derived registry the
 * production server runs on — and a job runner that records what a route enqueues
 * instead of running it.
 */

import { Router } from 'express';
import type { AuthVerifier } from '@truecourse/shared';
import type { EnqueueResult, JobsMount } from '../../apps/dashboard/server/src/jobs/index';
import type { OnboardingJobRequest } from '../../apps/dashboard/server/src/jobs/tasks/onboarding';
import type { GuardSetupJobRequest } from '../../apps/dashboard/server/src/jobs/tasks/repo-guard-setup';
import { readRegistry, unregisterProject } from '@truecourse/core/config/registry';
import { createApp, type CreateAppOptions } from '../../apps/dashboard/server/src/app';
import type { GithubMount } from '../../apps/dashboard/server/src/github/index';
import { setWorkTreeProvider } from '../../apps/dashboard/server/src/services/work-tree.service';
import {
  resetWorkspaceLlmBackend,
  resetWorkspaceLlmConfigStore,
  setWorkspaceLlmBackend,
  setWorkspaceLlmConfigStore,
} from '../../apps/dashboard/server/src/services/workspace-llm.service';

export const TEST_ORG = 'org_test';

export const testAuthVerifier =
  (orgId: string = TEST_ORG): AuthVerifier =>
  async () => ({
    user: { id: 'user_test', email: 'test@example.com', organizationId: orgId },
  });

/**
 * A GithubMount whose store links every registered repo to `orgId`. Unlinking
 * unregisters the entry, mirroring the derived registry (where deleting the
 * row IS the unregistration). Only the fields app.ts consumes are real; the
 * cast is confined to this helper.
 */
export function testGithubMount(orgId: string = TEST_ORG): GithubMount {
  const store = {
    getRepo: async () => ({ workspaceOrgId: orgId }),
    listReposForWorkspace: async () =>
      (await readRegistry()).map((e) => ({ repoFullName: e.name })),
    unlinkRepo: async (repoFullName: string) => {
      const entry = (await readRegistry()).find((e) => e.name === repoFullName);
      if (entry) await unregisterProject(entry.slug);
    },
  };
  return { webhook: Router(), connect: Router(), store: store as unknown as GithubMount['store'] };
}

/** A job runner that RECORDS enqueues instead of running anything — what a route
 *  test needs from the queue, since the work itself has its own suites. Only the
 *  enqueue surface is real; the cast is confined to this helper. */
export interface StubJobs {
  mount: JobsMount;
  scans: OnboardingJobRequest[];
  guardSetups: GuardSetupJobRequest[];
  guardGenerates: OnboardingJobRequest[];
  /** What the next enqueue answers — set it to `{ status: 'busy' }` for a 409. */
  answer: EnqueueResult;
}

export function stubJobs(): StubJobs {
  const stub: StubJobs = {
    scans: [],
    guardSetups: [],
    guardGenerates: [],
    answer: { status: 'queued', jobId: 'job_test' },
    mount: null as unknown as JobsMount,
  };
  stub.mount = {
    enqueueScan: async (request: OnboardingJobRequest) => {
      stub.scans.push(request);
      return stub.answer;
    },
    enqueueGuardSetup: async (request: GuardSetupJobRequest) => {
      stub.guardSetups.push(request);
      return stub.answer;
    },
    enqueueGuardGenerate: async (request: OnboardingJobRequest) => {
      stub.guardGenerates.push(request);
      return stub.answer;
    },
    cancelRepoJobs: async () => 'stopped' as const,
    routers: { events: Router(), jobs: Router(), notifications: Router() },
  } as unknown as JobsMount;
  return stub;
}

/** The provider a test workspace is configured with. */
export const TEST_LLM_CONFIG = {
  provider: 'anthropic' as const,
  model: 'claude-test',
  apiKey: 'sk-test',
};

/**
 * Give every workspace a provider that answers its pre-flight probe, so a route
 * test that is not ABOUT the provider reaches the pipeline. Nothing here builds
 * a real driver or transport — the seam hands back inert stand-ins. Tests that
 * ARE about the provider install their own store/backend afterwards.
 */
export function installTestWorkspaceLlm(): void {
  setWorkspaceLlmConfigStore({
    getConfig: async () => ({ ...TEST_LLM_CONFIG }),
    getView: async () => null,
    save: async () => {},
  });
  setWorkspaceLlmBackend({
    probe: async () => {},
    driver: () => ({}) as never,
    transport: (async () => '{}') as never,
  });
}

export function resetTestWorkspaceLlm(): void {
  resetWorkspaceLlmConfigStore();
  resetWorkspaceLlmBackend();
}

/** `createApp` wired for route tests: authenticated as TEST_ORG, all repos visible,
 *  and the workspace's LLM provider configured and answering.
 *  Runs "clone" in place: the fixture repos ARE local paths, so the work-tree
 *  provider hands the registered path back with a no-op dispose. */
export function createTestApp(overrides: Partial<CreateAppOptions> = {}) {
  setWorkTreeProvider(async (repoKey) => ({ dir: repoKey, dispose: () => {} }));
  installTestWorkspaceLlm();
  return createApp({
    serveStatic: false,
    authVerifier: testAuthVerifier(),
    github: testGithubMount(),
    // The routes that start work enqueue onto a runner; a test that is not ABOUT
    // the queue gets one that records the enqueue and runs nothing.
    jobs: stubJobs().mount,
    ...overrides,
  });
}
