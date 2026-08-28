/**
 * Server-route test harness for the closed visibility model. A repository is
 * visible only when a link row ties it to the caller's workspace, so a bare
 * `createApp({ authVerifier: null, github: null })` sees nothing. Route tests
 * that are not ABOUT scoping use this instead: an auth verifier that stamps
 * one test org, and a permissive link store that reads every registered repo
 * as linked to it — the file-registry analog of the gh_repos-derived registry
 * the production server runs on.
 */

import { Router } from 'express';
import type { AuthVerifier } from '@truecourse/shared';
import { readRegistry, unregisterProject } from '@truecourse/core/config/registry';
import { createApp, type CreateAppOptions } from '../../apps/dashboard/server/src/app';
import type { GithubMount } from '../../apps/dashboard/server/src/github/index';
import { setWorkTreeProvider } from '../../apps/dashboard/server/src/services/work-tree.service';

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

/** `createApp` wired for route tests: authenticated as TEST_ORG, all repos visible.
 *  Runs "clone" in place: the fixture repos ARE local paths, so the work-tree
 *  provider hands the registered path back with a no-op dispose. */
export function createTestApp(overrides: Partial<CreateAppOptions> = {}) {
  setWorkTreeProvider(async (repoKey) => ({ dir: repoKey, dispose: () => {} }));
  return createApp({
    serveStatic: false,
    authVerifier: testAuthVerifier(),
    github: testGithubMount(),
    ...overrides,
  });
}
