/**
 * The fake dependency catalog (./orders-api.catalog.ts, ./other-repos.ts) folded
 * into the EXACT payload shape the vendored DEPENDENCIES pane consumes,
 * so the Dependencies tab renders the vendored `GuardDependenciesPane` /
 * `GuardDependencyDetail` unchanged.
 *
 * EVERY class of starting state is a row, which is the whole point of the page:
 * a step-creatable one is listed and has nothing to register (`state: null`), a
 * seedable one the same, and only a SUPPLIED one carries a registration the user
 * fills in. A supplied dependency that names a third-party service also carries
 * the external-service half, which is what turns its row into a base URL, a
 * token and the headers this machine sends.
 *
 * A row's `blocks` is read off the board: the blocked tests whose reason or facts
 * name it. Those are the same dependencies the Tests tab's needs-setup gaps name,
 * so a "Provide postmark" call to action lands on a row that exists.
 *
 * The write is a real merge held in memory for the life of the page: registering
 * an instance flips the row to provided (and its fields to resolved) exactly as
 * the engine's view would, and nothing is persisted. A reload starts over. A
 * secret comes back MASKED, never as its characters, the same rule the server
 * holds to.
 */

import type {
  GuardDependenciesView,
  GuardDependencyField,
  GuardDependencyPatch,
  GuardDependencyRow,
  GuardDependencyService,
  GuardDependencyState,
} from '@/preview/vendor/types/guard-dependencies';
import { flowIdFor } from './flow-fixtures';
import { REPO_GUARD } from './index';
import type { Dependency, GuardTest } from './types';

/** What the user has registered this session, per dependency name. */
interface Registered {
  env: Map<string, string>;
  path?: string;
  baseUrl?: string;
  token?: string;
  headers: Map<string, string>;
}

const OVERLAY = new Map<string, Map<string, Registered>>();

function overlay(repoId: string): Map<string, Registered> {
  let byName = OVERLAY.get(repoId);
  if (!byName) {
    byName = new Map();
    OVERLAY.set(repoId, byName);
  }
  return byName;
}

function registered(repoId: string, dep: Dependency): Registered | undefined {
  return overlay(repoId).get(dep.name);
}

function dependenciesOf(repoId: string): Dependency[] {
  return REPO_GUARD[repoId]?.dependencies ?? [];
}

/** `STRIPE_BASE_URL`, the variable a service's base URL is read from. */
function baseUrlEnvFor(dep: Dependency): string {
  return `${dep.service.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_BASE_URL`;
}

/** A secret is a reading, never its characters: what the server hands back. */
const MASK = '••••••••';

function isSecret(envVar: string): boolean {
  return /KEY|TOKEN|SECRET|PASSWORD/.test(envVar);
}

function mentions(test: GuardTest, dep: Dependency): boolean {
  const text = `${test.reason ?? ''} ${test.facts.map((f) => f.value).join(' ')}`.toLowerCase();
  return text.includes(dep.service.toLowerCase()) || text.includes(dep.name.toLowerCase());
}

/** The board's blocked tests waiting on this dependency. */
function blockedTests(repoId: string, dep: Dependency): GuardTest[] {
  return (REPO_GUARD[repoId]?.tests ?? []).filter((t) => t.status === 'blocked' && mentions(t, dep));
}

/** The env fields a supplied dependency is registered through. */
function fieldsFor(repoId: string, dep: Dependency): GuardDependencyField[] {
  if (dep.klass !== 'supplied') return [];
  const given = registered(repoId, dep);
  const stored = Boolean(dep.storedHint);
  return dep.envVars.map((envVar) => {
    const secret = isSecret(envVar);
    const value = given?.env.get(envVar) ?? (stored ? `${dep.service}-sandbox` : undefined);
    const resolved = value !== undefined;
    return {
      field: envVar,
      resolved,
      ...(resolved ? {} : { reason: `${envVar} has no value on this machine.` }),
      secret,
      description: `${dep.about} Read from ${envVar}.`,
      ...(resolved ? { value: secret ? MASK : value } : {}),
    };
  });
}

function stateOf(fields: GuardDependencyField[]): GuardDependencyState | null {
  if (fields.length === 0) return null;
  const resolved = fields.filter((f) => f.resolved).length;
  if (resolved === 0) return 'unprovided';
  return resolved === fields.length ? 'provided' : 'incomplete';
}

function serviceHalf(repoId: string, dep: Dependency): GuardDependencyService | undefined {
  if (dep.klass !== 'supplied') return undefined;
  const given = registered(repoId, dep);
  const baseUrl = given?.baseUrl ?? (dep.storedHint ? `https://sandbox.${dep.service}.test` : null);
  return {
    service: dep.service,
    services: [dep.service],
    detected: true,
    declaredInRecipe: true,
    category: 'third-party',
    detectedVia: dep.evidence.some((e) => e.startsWith('import of')) ? 'sdk' : 'http',
    baseUrlEnv: baseUrlEnvFor(dep),
    baseUrlEnvSource: 'recipe',
    baseUrl,
    mode: 'sandbox',
    endpoints: {},
    tokenSet: Boolean(given?.token) || Boolean(dep.storedHint),
    headers: [...(given?.headers ?? new Map())].map(([name, value]) => {
      const secret = isSecret(name.toUpperCase());
      return { name, secret, ...(secret ? {} : { value }) };
    }),
    evidence: dep.evidence.map((e) => ({ service: dep.service, filePath: e })),
    undeclaredLocalEnv: [],
  };
}

/** How the class states what a scenario must do about it. */
const REQUIREMENT: Record<Dependency['klass'], string> = {
  'step-creatable': 'A step of the test creates it before it is needed.',
  seedable: 'The runner seeds it into the sandbox before the test starts.',
  supplied: 'An instance must be registered on this machine before a test can run.',
};

const OBTAIN: Record<Dependency['klass'], string | undefined> = {
  'step-creatable': undefined,
  seedable: undefined,
  supplied: 'Create a sandbox account with the provider and register its values here.',
};

function dependencyRow(repoId: string, dep: Dependency): GuardDependencyRow {
  const fields = fieldsFor(repoId, dep);
  const blocked = blockedTests(repoId, dep);
  const service = serviceHalf(repoId, dep);
  return {
    name: dep.name,
    class: dep.klass,
    summary: dep.about,
    requirement: REQUIREMENT[dep.klass],
    needs: blocked.map((t) => ({
      flowId: flowIdFor(t),
      title: t.flow,
      need: t.reason ?? `${t.flow} needs ${dep.name}.`,
    })),
    ...(OBTAIN[dep.klass] ? { obtain: OBTAIN[dep.klass]! } : {}),
    state: stateOf(fields),
    ...(dep.klass === 'supplied'
      ? {
          registration: {
            kind: 'env' as const,
            vars: dep.envVars.map((envVar) => ({
              name: envVar,
              description: `${dep.about} Read from ${envVar}.`,
              secret: isSecret(envVar),
            })),
          },
        }
      : {}),
    fields,
    blocks: blocked.map((t) => ({ flowId: flowIdFor(t), title: t.flow, kind: 'test-blocked' as const })),
    usedBy: (REPO_GUARD[repoId]?.tests ?? []).filter((t) => mentions(t, dep)).length,
    ...(service ? { service } : {}),
    inCatalog: true,
  };
}

/** The Dependencies page in one read. */
export function dependenciesView(repoId: string): GuardDependenciesView {
  return {
    catalogPath: 'scenarios/dependencies.json',
    localPath: 'scenarios/dependencies.local.json',
    recipePath: 'scenarios/recipe.json',
    invalidReason: null,
    detectionAvailable: true,
    dependencies: dependenciesOf(repoId).map((dep) => dependencyRow(repoId, dep)),
    unknownLocalNames: [],
  };
}

/** Register ONE dependency's instance; the response IS the fresh view. */
export function saveDependency(
  repoId: string,
  name: string,
  patch: GuardDependencyPatch,
): GuardDependenciesView {
  const byName = overlay(repoId);
  const given: Registered = byName.get(name) ?? { env: new Map(), headers: new Map() };
  for (const [envVar, value] of Object.entries(patch.env ?? {})) {
    if (value === null || value === '') given.env.delete(envVar);
    else given.env.set(envVar, value);
  }
  if (patch.path !== undefined) {
    if (patch.path === null || patch.path === '') delete given.path;
    else given.path = patch.path;
  }
  if (patch.baseUrl !== undefined) given.baseUrl = patch.baseUrl;
  if (patch.token !== undefined) {
    if (patch.token === null || patch.token === '') delete given.token;
    else given.token = patch.token;
  }
  for (const [header, value] of Object.entries(patch.headers ?? {})) {
    if (value === null || value === '') given.headers.delete(header);
    else given.headers.set(header, value);
  }
  byName.set(name, given);
  return dependenciesView(repoId);
}
