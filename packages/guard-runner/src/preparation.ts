/** Runner-owned private data lifetimes, independent of shared service ownership. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import type {
  GuardScenario,
  GuardPreparationEvidence,
} from '@truecourse/shared';
import { runSeed, type SeedResult } from './api/seed.js';
import { runBuild } from './build.js';
import { resolveApiServers, resolveWebSurface, resolveEntry, credentialServers, type Recipe, type RecipePreparation } from './recipe.js';
import { startApiServer } from './api/server.js';
import { lookupJsonPath } from './api/vars.js';
import { constructChildEnv, BUILD_PASSTHROUGH } from './child-env.js';

export interface PreparedScenarioWorld extends SeedResult {
  env: Record<string, string>;
  evidence: GuardPreparationEvidence;
  close(): Promise<void>;
}

/** Authoring sees capabilities, never concrete paths, fixture IDs or credentials. */
export function preparationCatalog(recipe: Recipe) {
  return Object.entries(recipe.preparations ?? {}).filter(([name, p]) => !baselineDefect(name, p)).map(([name, p]) => ({
    name,
    baseline: p.baseline,
    scope: p.scope,
    baselineChecks: p.baselineChecks,
    fixtures: p.seed.provides.fixtures ?? {},
    credentials: p.seed.provides.credentials ?? {},
  }));
}

function baselineDefect(name: string, profile: RecipePreparation): string | undefined {
  if (!profile.baselineChecks?.length)
    return `Preparation "${name}" lacks runner-verified baseline checks; refresh Guard Setup preparations.`;
  if (profile.baseline === 'empty' && profile.baselineChecks.some(c =>
    [...Object.values(c.counts), ...Object.values(c.totals ?? {})].some(value => value !== 0)))
    return `Preparation "${name}" declares an empty baseline with nonzero business counts or totals.`;
  if (profile.baselineChecks.some(c => Object.keys(c.totals ?? {}).some(key => key in c.counts)))
    return `Preparation "${name}" baseline count and total paths must be distinct.`;
  return undefined;
}

export function validateScenarioPreparation(
  recipe: Recipe,
  scenario: Pick<GuardScenario, 'setup' | 'steps' | 'teardown'>,
): string | undefined {
  const name = scenario.setup?.preparation;
  if (!name) return undefined;
  const profile = recipe.preparations?.[name];
  if (!profile)
    return `Unknown preparation profile "${name}"; refresh Guard Setup to provide the required private starting state.`;
  const invalidBaseline = baselineDefect(name, profile);
  if (invalidBaseline) return invalidBaseline;
  const owned = new Set([
    ...Object.keys(profile.env),
    'GUARD_PREPARATION_DIRECTORY',
    'GUARD_PREPARATION_NAMESPACE',
    'GUARD_PREPARATION_BASELINE',
    'GUARD_REPO_ROOT',
  ]);
  const conflicts = Object.keys(scenario.setup?.env ?? {}).filter((key) =>
    owned.has(key),
  );
  for (const step of [...scenario.steps, ...(scenario.teardown ?? [])]) {
    if (typeof step === 'object' && 'env' in step && step.env) {
      conflicts.push(...Object.keys(step.env).filter((key) => owned.has(key)));
    }
    if (typeof step === 'object' && 'boot' in step && step.boot.env) {
      conflicts.push(...Object.keys(step.boot.env).filter((key) => owned.has(key)));
    }
  }
  if (conflicts.length)
    return `Preparation "${name}" owns ${[...new Set(conflicts)].join(', ')}; scenario environment overrides would split its private world.`;
  return undefined;
}

function scriptPath(repoRoot: string, rel: string): string {
  if (path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..'))
    throw new Error(
      `Preparation script must stay inside the repository: ${rel}`,
    );
  const root = fs.realpathSync(repoRoot);
  let abs: string;
  try {
    abs = fs.realpathSync(path.resolve(root, rel));
  } catch {
    throw new Error(`Missing preparation script: ${rel}`);
  }
  if (!abs.startsWith(root + path.sep) || !fs.statSync(abs).isFile())
    throw new Error(`Preparation script escapes the repository: ${rel}`);
  return abs;
}
const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
const nodeScript = (script: string) =>
  `${quote(process.execPath)} ${quote(script)}`;

interface Allocation {
  directory: string;
  namespace: string;
  env: Record<string, string>;
}

/** A fresh namespace for EVERY call. Polls/restarts inside the caller retain the returned world. */
export async function prepareScenario(opts: {
  repoRoot: string;
  recipe: Recipe;
  profile: string;
  accountEnv?: Record<string, string>;
  externalSecrets?: ReadonlyMap<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<PreparedScenarioWorld> {
  const profile = opts.recipe.preparations?.[opts.profile];
  if (!profile)
    throw new Error(`Unknown preparation profile "${opts.profile}"`);
  const invalidBaseline = baselineDefect(opts.profile, profile);
  if (invalidBaseline) throw new Error(invalidBaseline);
  const checks = profile.baselineChecks!;
  const seedScript = scriptPath(opts.repoRoot, profile.seed.script);
  const verifyScript = scriptPath(opts.repoRoot, profile.verify.script);
  const cleanupScript =
    profile.cleanup && scriptPath(opts.repoRoot, profile.cleanup.script);
  const allocations: Allocation[] = [];
  const secrets = new Map<string, string>();
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const cleanup = async (allocation: Allocation) => {
    // Ownership is registered BEFORE provisioning and never inferred from its output.
    try {
      if (cleanupScript) {
        const result = await runBuild(
          opts.repoRoot,
          nodeScript(cleanupScript),
          allocation.env,
          timeoutMs,
        );
        if (!result.ok)
          throw new Error(
            `Preparation "${opts.profile}" cleanup failed for its owned namespace`,
          );
      }
    } finally {
      fs.rmSync(allocation.directory, { recursive: true, force: true });
    }
  };
  const close = async () => {
    const errors: unknown[] = [];
    for (const allocation of allocations.splice(0).reverse()) {
      try {
        await cleanup(allocation);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length)
      throw new AggregateError(
        errors,
        `Preparation "${opts.profile}" cleanup failed`,
      );
  };
  const allocate = (): Allocation => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-world-'));
    const namespace = `guard_${crypto.randomUUID().replaceAll('-', '')}`;
    const env = {
      ...(opts.recipe.env ?? {}),
      ...(opts.recipe.api?.env ?? {}),
      ...opts.accountEnv,
      ...Object.fromEntries(
        Object.entries(profile.env).map(([key, value]) => [
          key,
          value
            .replaceAll('${directory}', directory)
            .replaceAll('${namespace}', namespace),
        ]),
      ),
      GUARD_REPO_ROOT: opts.repoRoot,
      GUARD_PREPARATION_DIRECTORY: directory,
      GUARD_PREPARATION_NAMESPACE: namespace,
      GUARD_PREPARATION_BASELINE: profile.baseline,
    };
    const allocation = { directory, namespace, env };
    allocations.push(allocation);
    return allocation;
  };
  const seed = async (allocation: Allocation) => {
    const result = await runSeed({
      repoRoot: opts.repoRoot,
      seed: { ...profile.seed, command: nodeScript(seedScript) },
      env: allocation.env,
      signal: opts.signal,
      timeoutMs,
      knownCredentials: secrets,
      externalSecrets: opts.externalSecrets,
    });
    for (const [name, credential] of result.credentials)
      secrets.set(`${allocation.namespace}.${name}`, credential.value);
    return result;
  };
  const checkBaseline = async (allocation: Allocation, seeded: SeedResult) => {
    const servers = resolveApiServers(opts.recipe);
    for (const check of checks) {
      const serverName = check.server ?? servers.defaultServer;
      const server = servers.servers.get(serverName) ??
        (!check.server && servers.servers.size === 0 ? resolveWebSurface(opts.recipe) : null);
      if (!server) throw new Error(`Preparation "${opts.profile}" baseline check has no declared server "${serverName}".`);
      const headers: Record<string, string> = {};
      if (check.credential) {
        const credential = seeded.credentials.get(check.credential);
        const declaration = profile.seed.provides.credentials?.[check.credential];
        if (!credential || !declaration || (servers.servers.size > 0 && !credentialServers(declaration, servers).includes(serverName)))
          throw new Error(`Preparation "${opts.profile}" baseline credential "${check.credential}" is unavailable for ${serverName}.`);
        headers[credential.header] = credential.value;
      }
      const started = await startApiServer({
        resolvedServe: resolveEntry(opts.repoRoot, server.serve),
        cwd: server.cwd === 'repo' ? opts.repoRoot : allocation.directory,
        env: constructChildEnv({ passthrough: BUILD_PASSTHROUGH, recipeEnv: { ...server.env, ...opts.accountEnv,
          ...Object.fromEntries(Object.entries(allocation.env).filter(([key]) => key in profile.env || key.startsWith('GUARD_'))) } }),
        healthPath: server.healthPath, readyTimeoutMs: server.readyTimeoutMs, signal: opts.signal,
      });
      if (!started.ok) throw new Error(`Preparation "${opts.profile}" baseline server failed: ${started.reason}`);
      try {
        const signal = opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
        const response = await fetch(started.server.baseUrl + check.path, { headers, signal, redirect: 'error' });
        if (!response.ok) throw new Error(`Preparation "${opts.profile}" baseline read ${check.path} returned ${response.status}.`);
        const body: unknown = await response.json();
        for (const [key, expected] of Object.entries({ ...check.counts, ...check.totals })) {
          const actual = lookupJsonPath(body, key);
          if (actual !== expected) throw new Error(`Preparation "${opts.profile}" baseline ${check.path} ${key} expected ${expected}, observed ${typeof actual === 'number' ? actual : 'a missing or nonnumeric value'}. This is a preparation failure, not application drift.`);
        }
      } finally { await started.server.stop(); }
    }
  };
  try {
    const primary = allocate();
    const peer = allocate();
    const primarySeed = await seed(primary);
    const peerSeed = await seed(peer);
    const baselines = await Promise.allSettled([checkBaseline(primary, primarySeed), checkBaseline(peer, peerSeed)]);
    const failedBaseline = baselines.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failedBaseline) throw failedBaseline.reason;
    // This is an executable app-level verifier, not a persisted boolean capability.
    // It sees two independently seeded worlds mutates the peer and proves primary remains at its baseline.
    const verification = await runSeed({
      repoRoot: opts.repoRoot,
      seed: {
        command: nodeScript(verifyScript),
        provides: { fixtures: { verification: ['baseline', 'isolated'] } },
      },
      env: {
        ...primary.env,
        GUARD_PREPARATION_BASELINE: profile.baseline,
        GUARD_PREPARATION_PEER_ENV: JSON.stringify(peer.env),
        GUARD_PREPARATION_FIXTURES: JSON.stringify(
          Object.fromEntries(primarySeed.fixtures),
        ),
        GUARD_PREPARATION_PEER_FIXTURES: JSON.stringify(
          Object.fromEntries(peerSeed.fixtures),
        ),
        GUARD_PREPARATION_CREDENTIALS: JSON.stringify(
          Object.fromEntries(primarySeed.credentials),
        ),
        GUARD_PREPARATION_PEER_CREDENTIALS: JSON.stringify(
          Object.fromEntries(peerSeed.credentials),
        ),
      },
      signal: opts.signal,
      timeoutMs,
      knownCredentials: secrets,
      externalSecrets: opts.externalSecrets,
    });
    const proof = verification.fixtures.get('verification');
    if (proof?.baseline !== profile.baseline || proof?.isolated !== true) {
      throw new Error(
        `Preparation "${opts.profile}" did not verify its ${profile.baseline} baseline and independence through the app`,
      );
    }
    await checkBaseline(primary, primarySeed);
    allocations.splice(allocations.indexOf(peer), 1);
    await cleanup(peer);
    return {
      ...primarySeed,
      env: Object.fromEntries(
        Object.entries(primary.env).filter(
          ([key]) => key in profile.env || key.startsWith('GUARD_PREPARATION_'),
        ),
      ),
      evidence: {
        profile: opts.profile,
        baseline: profile.baseline,
        scope: 'instance',
      },
      close,
    };
  } catch (error) {
    try {
      await close();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `Preparation "${opts.profile}" failed and its owned cleanup failed`,
      );
    }
    throw error;
  }
}
