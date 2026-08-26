/**
 * The one door onto the fake data. Every preview screen imports from here, so a
 * screen never has to know which module a constant lives in, and the joins the
 * screens actually make (a repo by slug, a pull request's runs, the gate feed
 * across repos) are written once.
 */

import {
  ORDERS_API_INTERFACES,
  ORDERS_API_RECIPES,
  ORDERS_API_SOURCES,
  ORDERS_API_DEPENDENCIES,
} from './orders-api.catalog';
import { ORDERS_API_AREAS, ORDERS_API_TESTS, ORDERS_API_COVERAGE } from './orders-api.tests';
import { OTHER_REPO_GUARD } from './other-repos';
import { PULL_REQUESTS, REPOS, RUNS_BY_REPO } from './repos';
import type {
  GuardInterface,
  GuardTest,
  PullRequest,
  Repo,
  RepoGuardData,
  Run,
  RunOrigin,
  CheckConclusion,
} from './types';

export * from './types';
export * from './workspace';
export { PULL_REQUESTS, REPOS } from './repos';
export { ORDERS_API_AREAS } from './orders-api.tests';

const ORDERS_API_GUARD: RepoGuardData = {
  areas: ORDERS_API_AREAS,
  tests: ORDERS_API_TESTS,
  interfaces: ORDERS_API_INTERFACES,
  recipes: ORDERS_API_RECIPES,
  runs: RUNS_BY_REPO['orders-api'] ?? [],
  sources: ORDERS_API_SOURCES,
  dependencies: ORDERS_API_DEPENDENCIES,
  coverage: ORDERS_API_COVERAGE,
};

/** Every repo's guard data, keyed by the slug the repo console is addressed by. */
export const REPO_GUARD: Record<string, RepoGuardData> = {
  'orders-api': ORDERS_API_GUARD,
  'web-console': { ...OTHER_REPO_GUARD['web-console']!, runs: RUNS_BY_REPO['web-console'] ?? [] },
  billing: OTHER_REPO_GUARD['billing']!,
  'devops-tools': {
    ...OTHER_REPO_GUARD['devops-tools']!,
    runs: RUNS_BY_REPO['devops-tools'] ?? [],
  },
};

export function repoBySlug(slug: string | undefined): Repo | undefined {
  return REPOS.find((r) => r.id === slug);
}

export function guardForRepo(slug: string | undefined): RepoGuardData | undefined {
  return slug ? REPO_GUARD[slug] : undefined;
}

export function pullRequestsForRepo(repoId: string): PullRequest[] {
  return PULL_REQUESTS.filter((pr) => pr.repoId === repoId);
}

export function runsForRepo(repoId: string): Run[] {
  return REPO_GUARD[repoId]?.runs ?? [];
}

export function runsForPullRequest(repoId: string, number: number): Run[] {
  return runsForRepo(repoId).filter((r) => r.prNumber === number);
}

export function testById(repoId: string, testId: string | null): GuardTest | undefined {
  if (!testId) return undefined;
  return REPO_GUARD[repoId]?.tests.find((t) => t.id === testId);
}

export function interfaceById(repoId: string, id: string): GuardInterface | undefined {
  return REPO_GUARD[repoId]?.interfaces.find((i) => i.id === id);
}


/**
 * The cross-repo feed the workspace home leads with: the latest runs of every
 * repo, hosted and local, in the order the repos list them. It is the feed that
 * used to be a top-level Pull requests page.
 */
