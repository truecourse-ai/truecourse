/**
 * Server-route test harness for the closed visibility model. A repository is
 * visible only when a row ties it to the caller's workspace, so a bare
 * `createApp({ authVerifier: null, repoLinks: null, github: null, jobs: null })`
 * sees nothing. Route tests that are not ABOUT scoping use this instead: an auth
 * verifier that stamps one test org, a permissive repository store that reads
 * every registered repo as connected to it — the fixture analog of the
 * `repositories`-derived registry the production server runs on — and a job
 * runner that records what a route enqueues instead of running it.
 */

import { Router } from 'express';
import type { AuthVerifier } from '@truecourse/shared';
import type { EnqueueResult, JobsMount, LinksChangedRequest } from '../../apps/dashboard/server/src/jobs/index';
import type { RippleStart } from '../../apps/dashboard/server/src/jobs/context-ripple';
import type { OnboardingJobRequest } from '../../apps/dashboard/server/src/jobs/tasks/onboarding';
import type { GuardSetupJobRequest } from '../../apps/dashboard/server/src/jobs/tasks/repo-guard-setup';
import type { ContextScanJobRequest } from '../../apps/dashboard/server/src/jobs/tasks/context-scan';
import type { ContextSyncJobRequest } from '../../apps/dashboard/server/src/jobs/tasks/context-sync';
import { readRegistry } from '@truecourse/core/config/registry';
import { unregisterTestRepo } from './test-fixture';
import { createApp, type CreateAppOptions } from '../../apps/dashboard/server/src/app';
import type { GithubMount } from '../../apps/dashboard/server/src/github/index';
import type { RepoLinkStore } from '../../apps/dashboard/server/src/routes/repos';
import { setWorkTreeProvider } from '../../apps/dashboard/server/src/services/work-tree.service';
import {
  resetWorkspaceLlmBackend,
  resetWorkspaceLlmConfigStore,
  setWorkspaceLlmBackend,
  setWorkspaceLlmConfigStore,
} from '../../apps/dashboard/server/src/services/workspace-llm.service';
import { installDescribedWorkspaces } from './workspace-profile';

export const TEST_ORG = 'org_test';
/** The signed-in person every route test runs as. */
export const TEST_USER = 'user_test';

export const testAuthVerifier =
  (orgId: string = TEST_ORG): AuthVerifier =>
  async () => ({
    user: { id: TEST_USER, email: 'test@example.com', organizationId: orgId },
  });

/**
 * A workspace with no GitHub account at all: nothing to install through, no
 * links, nothing reachable. A test about installations passes its own.
 */
export const noGithubAccess: GithubMount['access'] = {
  listInstallations: async () => [],
  linkFor: async () => null,
  reachRepository: async () => null,
};

/**
 * A repository store that reads every registered repo as connected to `orgId`.
 * Unlinking unregisters the entry, mirroring the derived registry (where
 * deleting the row IS the unregistration). Only the fields the routes consume
 * are real; the cast is confined to this helper.
 */
export function testRepoLinks(orgId: string = TEST_ORG): RepoLinkStore {
  return {
    getRepo: async () => ({ workspaceOrgId: orgId }),
    listReposForWorkspace: async () =>
      (await readRegistry(orgId)).map((e) => ({ repoFullName: e.name })),
    unlinkRepo: async (repoFullName: string) => {
      const entry = (await readRegistry(orgId)).find((e) => e.name === repoFullName);
      if (entry) unregisterTestRepo(entry.slug);
    },
  };
}

/** A GithubMount with no routes of its own: what a test that is not about connecting needs. */
export function testGithubMount(
  _orgId: string = TEST_ORG,
  access: GithubMount['access'] = noGithubAccess,
): GithubMount {
  return {
    webhook: Router(),
    connect: Router(),
    store: {} as unknown as GithubMount['store'],
    access,
  };
}

/** A job runner that RECORDS enqueues instead of running anything — what a route
 *  test needs from the queue, since the work itself has its own suites. Only the
 *  enqueue surface is real; the cast is confined to this helper. */
export interface StubJobs {
  mount: JobsMount;
  guardSetups: GuardSetupJobRequest[];
  guardGenerates: OnboardingJobRequest[];
  guardRuns: OnboardingJobRequest[];
  /** Workspace Document scans — what every Scan button enqueues now. */
  contextScans: ContextScanJobRequest[];
  contextSyncs: ContextSyncJobRequest[];
  /** The link changes handed to the mount; each answers `linksAnswer`. */
  linkChanges: LinksChangedRequest[];
  linksAnswer: RippleStart | null;
  /** What the next enqueue answers — set it to `{ status: 'busy' }` for a 409. */
  answer: EnqueueResult;
}

export function stubJobs(): StubJobs {
  const stub: StubJobs = {
    guardSetups: [],
    guardGenerates: [],
    guardRuns: [],
    contextScans: [],
    contextSyncs: [],
    linkChanges: [],
    linksAnswer: null,
    answer: { status: 'queued', jobId: 'job_test' },
    mount: null as unknown as JobsMount,
  };
  stub.mount = {
    enqueueContextScan: async (request: ContextScanJobRequest) => {
      stub.contextScans.push(request);
      return stub.answer;
    },
    enqueueContextSync: async (request: ContextSyncJobRequest) => {
      stub.contextSyncs.push(request);
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
    enqueueGuardRun: async (request: OnboardingJobRequest) => {
      stub.guardRuns.push(request);
      return stub.answer;
    },
    startForLinks: async (request: LinksChangedRequest) => {
      stub.linkChanges.push(request);
      return stub.linksAnswer;
    },
    cancelRepoJobs: async () => 'stopped' as const,
    // Paused jobs are the credits surface's; a queue that runs nothing has none.
    resumePaused: async () => null,
    jobStore: {
      listPaused: async () => [],
      pausedCounts: async () => new Map<string, number>(),
      markResumed: async () => {},
    },
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
    getSelection: async () => ({ kind: 'api', config: { ...TEST_LLM_CONFIG } }),
    getConfig: async () => ({ ...TEST_LLM_CONFIG }),
    getView: async () => null,
    save: async () => {},
  });
  setWorkspaceLlmBackend({
    probe: async () => {},
    driver: () => ({ attribution: { provider: 'test', model: 'test-model' } }) as never,
  });
}

export function resetTestWorkspaceLlm(): void {
  resetWorkspaceLlmConfigStore();
  resetWorkspaceLlmBackend();
}

/** `createApp` wired for route tests: authenticated as TEST_ORG, all repos visible,
 *  the workspace's LLM provider configured and answering, and the workspace
 *  having said what its product is (without which it connects nothing).
 *  Runs "clone" in place: the fixture repos ARE local paths, so the work-tree
 *  provider hands the registered path back with a no-op dispose. */
export function createTestApp(overrides: Partial<CreateAppOptions> = {}) {
  setWorkTreeProvider('github', async (repoKey) => ({ dir: repoKey, dispose: () => {} }));
  installTestWorkspaceLlm();
  installDescribedWorkspaces();
  return createApp({
    serveStatic: false,
    authVerifier: testAuthVerifier(),
    repoLinks: testRepoLinks(),
    github: testGithubMount(),
    // The routes that start work enqueue onto a runner; a test that is not ABOUT
    // the queue gets one that records the enqueue and runs nothing.
    jobs: stubJobs().mount,
    ...overrides,
  });
}
