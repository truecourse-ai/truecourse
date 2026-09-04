/**
 * The DEPENDENCIES read/write surface the dashboard drives.
 *
 * The VIEW is the committed catalog joined with this machine's instances, plus the
 * external-service half where a row is one: the rolled-up requirement with each
 * contributing flow named, when the dependency applies, what it holds back right
 * now (committed tests that cannot run + flows the last generate never wrote), and
 * per-field resolution WITH the registered value — the readable ones as they were
 * registered, a secret only as a mask, so the raw one never leaves the process.
 *
 * The WRITE registers ONE instance: values to the gitignored
 * `dependencies.local.json`, and only the variables the committed registration
 * declares. A recipe-declared service keeps its api-shaped writer, so the
 * committed/secret split of a declaration lives in exactly one place.
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { maskStoredSecret } from '@truecourse/guard-runner';
import {
  readGuardDependenciesView,
  writeGuardDependency,
  GuardDependencyWriteError,
} from '../../packages/core/src/commands/guard-dependencies';

const repos: string[] = [];
afterEach(() => {
  while (repos.length) fs.rmSync(repos.pop()!, { recursive: true, force: true });
});

function repo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-dependencies-'));
  repos.push(dir);
  return dir;
}

const scenarios = (r: string, ...rel: string[]): string =>
  path.join(r, '.truecourse', 'scenarios', ...rel);

function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}
const readJson = (file: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(file, 'utf-8'));

/** A supplied project (a path) and an env-registered account — the two shapes. */
function writeCatalog(r: string, dependencies: unknown[]): void {
  writeJson(scenarios(r, 'dependencies.json'), { dependencies });
}

const SUPPLIED_PROJECT = {
  name: 'supplied-project',
  class: 'supplied' as const,
  summary: 'a real codebase to analyze',
  registration: { kind: 'path' as const, description: 'a checkout of a real project' },
  needs: [
    { flowId: 'analyze-a-repo', need: 'a TypeScript project with at least one violation' },
    { flowId: 'diff-a-repo', need: 'a git repository with a committed baseline' },
  ],
  condition: {
    predicates: [{ kind: 'config-value' as const, key: 'llm.transport', value: 'api' }],
    sentence: 'only when the LLM transport is the provider API',
  },
};

const LLM_ACCOUNT = {
  name: 'anthropic',
  class: 'supplied' as const,
  services: ['anthropic'],
  summary: 'an Anthropic account the LLM rules run against',
  registration: {
    kind: 'env' as const,
    vars: [
      { name: 'ANTHROPIC_BASE_URL', description: 'the base URL the program reads', secret: false },
      { name: 'ANTHROPIC_API_KEY', description: 'the credential the program reads', secret: true },
    ],
  },
  needs: [{ flowId: 'run-llm-rules', need: 'a key with model access' }],
};

const SEEDED_TASKS = {
  name: 'seeded-tasks',
  class: 'seedable' as const,
  summary: 'rows the list flow reads',
  obtain: 'the runner seeds three tasks before the steps run',
};

/** What `guard setup` saw in the tree — the detection half every service row joins. */
function writeDetection(r: string, externalServices: unknown[]): void {
  writeJson(path.join(r, '.truecourse', 'guard', 'setup.json'), {
    ranAt: '2026-08-07T00:00:00.000Z',
    status: 'ok',
    recipe: { status: 'ok', outcome: 'exists' },
    detection: { externalServices, database: null, datastoreUrls: [] },
  });
}

/** The last generate's report — the source of the flows it could not author. */
function writeResult(r: string, coverageGaps: unknown[]): void {
  writeJson(path.join(r, '.truecourse', 'guard', 'result.json'), {
    generatedAt: '2026-08-07T00:00:00.000Z',
    status: 'ok',
    noChanges: false,
    sectionsTotal: 1,
    sectionsChanged: 1,
    skippedUnchanged: 0,
    written: [],
    coverageGaps,
    birthFindings: [],
    errors: [],
    extractionFailures: [],
    orphaned: [],
  });
}

function writeFlows(r: string, flows: { id: string; title: string }[]): void {
  writeJson(scenarios(r, 'flows.json'), {
    version: 1,
    generatedAt: '2026-08-07T00:00:00.000Z',
    flows: flows.map((f) => ({
      id: f.id,
      title: f.title,
      goal: `${f.title}.`,
      fingerprint: 'sha256:aa',
      milestones: [{ order: 1, doc: 'docs/spec.md', anchor: 'a', claimTitle: `${f.title} works` }],
      bindings: [{ doc: 'docs/spec.md', anchor: 'a', fingerprint: 'sha256:bb' }],
      composedOf: [],
      synthesisInputsHash: 'sha256:cc',
    })),
    noFlowClaims: [],
  });
}

/** A committed scenario that BINDS a dependency — what "it blocks this" is read from. */
function writeScenario(r: string, id: string, flowId: string, needs: string[]): void {
  const file = scenarios(r, 'area', `${id}.yaml`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    yaml.dump({
      id,
      title: `${id} runs`,
      flow: { id: flowId, fingerprint: 'sha256:aa' },
      binds: [{ doc: 'docs/spec.md', section: 'a', fingerprint: 'sha256:bb' }],
      needs,
      driver: 'cli',
      steps: [{ run: ['bin', '--help'], expect: { exit: 0 } }],
    }),
  );
}

describe('readGuardDependenciesView', () => {
  it('is an honest empty view on a repo with nothing declared', () => {
    const view = readGuardDependenciesView(repo());
    expect(view.dependencies).toEqual([]);
    expect(view.invalidReason).toBeNull();
    expect(view.detectionAvailable).toBe(false);
    expect(view.catalogPath).toMatch(/dependencies\.json$/);
    expect(view.localPath).toMatch(/dependencies\.local\.json$/);
  });

  it('lists every class, with its registration shape and its state', () => {
    const r = repo();
    writeCatalog(r, [SUPPLIED_PROJECT, SEEDED_TASKS, LLM_ACCOUNT]);
    const view = readGuardDependenciesView(r);

    expect(view.dependencies.map((d) => [d.name, d.class, d.state])).toEqual([
      ['supplied-project', 'supplied', 'unprovided'],
      // Nothing to register: the runner materializes it, so it has NO state.
      ['seeded-tasks', 'seedable', null],
      ['anthropic', 'supplied', 'unprovided'],
    ]);
    expect(view.dependencies[0].registration).toEqual(SUPPLIED_PROJECT.registration);
    expect(view.dependencies[1].registration).toBeUndefined();
    expect(view.dependencies[1].obtain).toBe(SEEDED_TASKS.obtain);
    expect(view.dependencies[2].registration).toEqual(LLM_ACCOUNT.registration);
  });

  it('rolls the requirement up and attributes each part to the flow that wants it', () => {
    const r = repo();
    writeCatalog(r, [SUPPLIED_PROJECT]);
    writeFlows(r, [
      { id: 'analyze-a-repo', title: 'A user analyzes a repository' },
      { id: 'diff-a-repo', title: 'A user diffs a working tree' },
    ]);
    const [dependency] = readGuardDependenciesView(r).dependencies;

    expect(dependency.requirement).toBe(
      'a TypeScript project with at least one violation; a git repository with a committed baseline',
    );
    expect(dependency.needs).toEqual([
      {
        flowId: 'analyze-a-repo',
        title: 'A user analyzes a repository',
        need: 'a TypeScript project with at least one violation',
      },
      {
        flowId: 'diff-a-repo',
        title: 'A user diffs a working tree',
        need: 'a git repository with a committed baseline',
      },
    ]);
    // WHEN it applies is the catalog's own sentence, never a derived one.
    expect(dependency.when).toBe('only when the LLM transport is the provider API');
  });

  it('drops a dismissed flow’s need — its expectation dies with it', () => {
    const r = repo();
    writeCatalog(r, [SUPPLIED_PROJECT]);
    writeJson(scenarios(r, 'decisions.json'), {
      version: 1,
      dismissedClaims: [],
      dismissedFlows: [{ flowId: 'diff-a-repo', title: 'x', dismissedAt: '2026-08-07T00:00:00.000Z' }],
    });
    const [dependency] = readGuardDependenciesView(r).dependencies;
    expect(dependency.needs.map((n) => n.flowId)).toEqual(['analyze-a-repo']);
    expect(dependency.requirement).toBe('a TypeScript project with at least one violation');
  });

  it('names the flows it blocks: committed tests that cannot run, and tests never written', () => {
    const r = repo();
    writeCatalog(r, [SUPPLIED_PROJECT, LLM_ACCOUNT]);
    writeFlows(r, [{ id: 'analyze-a-repo', title: 'A user analyzes a repository' }]);
    writeScenario(r, 'analyze-a-repo.cli.1', 'analyze-a-repo', ['supplied-project']);
    writeJson(path.join(r, '.truecourse', 'guard', 'result.json'), {
      generatedAt: '2026-08-07T00:00:00.000Z',
      status: 'ok',
      noChanges: false,
      sectionsTotal: 1,
      sectionsChanged: 1,
      skippedUnchanged: 0,
      written: [],
      coverageGaps: [
        {
          doc: 'docs/spec.md',
          anchor: 'llm',
          kind: 'blocked-on',
          reason: 'blocked on anthropic: the LLM rules need a key',
          flowId: 'run-llm-rules',
        },
      ],
      birthFindings: [],
      errors: [],
      extractionFailures: [],
      orphaned: [],
    });

    const view = readGuardDependenciesView(r);
    expect(view.dependencies[0].blocks).toEqual([
      { flowId: 'analyze-a-repo', title: 'A user analyzes a repository', kind: 'test-blocked' },
    ]);
    expect(view.dependencies[1].blocks).toEqual([
      { flowId: 'run-llm-rules', title: 'run-llm-rules', kind: 'not-authored' },
    ]);
  });

  it('blocks NOTHING once the instance is registered', () => {
    const r = repo();
    writeCatalog(r, [SUPPLIED_PROJECT]);
    writeFlows(r, [{ id: 'analyze-a-repo', title: 'A user analyzes a repository' }]);
    writeScenario(r, 'analyze-a-repo.cli.1', 'analyze-a-repo', ['supplied-project']);
    writeJson(scenarios(r, 'dependencies.local.json'), { 'supplied-project': { path: r } });

    const [dependency] = readGuardDependenciesView(r).dependencies;
    expect(dependency.state).toBe('provided');
    expect(dependency.blocks).toEqual([]);
    // A path is not a secret: it IS the registered thing, so the form shows it.
    expect(dependency.hostPath).toBe(r);
  });

  it('reports each unregistered field with its own reason, and a registered secret as a mask', () => {
    const r = repo();
    writeCatalog(r, [LLM_ACCOUNT]);
    writeJson(scenarios(r, 'dependencies.local.json'), {
      anthropic: { env: { ANTHROPIC_API_KEY: 'sk-super-secret' } },
    });
    const [dependency] = readGuardDependenciesView(r).dependencies;

    expect(dependency.state).toBe('incomplete');
    expect(dependency.fields).toEqual([
      {
        field: 'ANTHROPIC_BASE_URL',
        resolved: false,
        reason: 'no value registered for `ANTHROPIC_BASE_URL`',
        secret: false,
        description: 'the base URL the program reads',
      },
      {
        field: 'ANTHROPIC_API_KEY',
        resolved: true,
        secret: true,
        description: 'the credential the program reads',
        // Registered, and readable as exactly that much: bullets to its length, said
        // in words that can never be mistaken for the key itself.
        value: `${'•'.repeat(12)} (stored locally, masked)`,
      },
    ]);
    // An UNREGISTERED field carries no value at all — blank is what "nothing here
    // yet" looks like, and a form's own sample fills the space instead.
    expect(dependency.fields[0].value).toBeUndefined();
    // The whole view, serialized, never carries the stored key.
    expect(JSON.stringify(readGuardDependenciesView(r))).not.toContain('sk-super-secret');
  });

  /**
   * A registered value that never comes back leaves a filled-in entry looking exactly
   * like an empty one: the form renders blanks, and a reader cannot see what this
   * machine is pointed at. Everything that is not a secret therefore reads back as it
   * was registered — and the secret half is withheld by MASKING here, in the view
   * composition, so the raw value never crosses a wire at all.
   */
  it('hands every registered NON-SECRET value back, and a secret only as a mask', () => {
    const r = repo();
    writeCatalog(r, [LLM_ACCOUNT]);
    writeJson(scenarios(r, 'dependencies.local.json'), {
      anthropic: {
        env: {
          ANTHROPIC_BASE_URL: 'https://llm.internal',
          ANTHROPIC_API_KEY: 'test-key-not-a-real-one',
        },
      },
    });
    const [dependency] = readGuardDependenciesView(r).dependencies;

    expect(dependency.state).toBe('provided');
    expect(dependency.fields.map((f) => [f.field, f.value])).toEqual([
      ['ANTHROPIC_BASE_URL', 'https://llm.internal'],
      ['ANTHROPIC_API_KEY', maskStoredSecret('test-key-not-a-real-one')],
    ]);
    expect(JSON.stringify(readGuardDependenciesView(r))).not.toContain('test-key-not-a-real-one');
  });

  it('shows a path registration’s path — it IS the registered thing, and no secret', () => {
    const r = repo();
    writeCatalog(r, [SUPPLIED_PROJECT]);
    writeJson(scenarios(r, 'dependencies.local.json'), { 'supplied-project': { path: r } });
    const [dependency] = readGuardDependenciesView(r).dependencies;
    expect(dependency.fields).toEqual([
      { field: 'path', resolved: true, secret: false, description: 'a checkout of a real project', value: r },
    ]);
  });

  /**
   * A path this machine no longer has is still the path somebody registered: showing
   * it is what lets a reader see the typo and fix it, where blanking the field asks
   * them to remember what they meant.
   */
  it('keeps showing a registered path the machine no longer has', () => {
    const r = repo();
    writeCatalog(r, [SUPPLIED_PROJECT]);
    const gone = path.join(r, 'moved-away');
    writeJson(scenarios(r, 'dependencies.local.json'), { 'supplied-project': { path: gone } });
    const [dependency] = readGuardDependenciesView(r).dependencies;
    expect(dependency.fields[0]).toMatchObject({ resolved: false, value: gone });
    expect(dependency.hostPath).toBeUndefined();
  });

  /**
   * The overlay holds an instance in a shape this registration no longer reads. It is
   * ignored for the state, and it must be just as ignored for the VALUE — filling
   * today's field with yesterday's instance would register it by accident.
   */
  it('shows nothing from an instance stored in the shape the registration abandoned', () => {
    const r = repo();
    writeCatalog(r, [LLM_ACCOUNT]);
    writeJson(scenarios(r, 'dependencies.local.json'), {
      anthropic: { path: '/Users/dev/yesterday' },
    });
    const [dependency] = readGuardDependenciesView(r).dependencies;
    expect(dependency.fields.every((f) => f.value === undefined)).toBe(true);
    expect(JSON.stringify(readGuardDependenciesView(r))).not.toContain('/Users/dev/yesterday');
  });

  /**
   * A service's own base URL is not a secret and is what the row is reached at, so it
   * reads back beside the variable that carries it. Its KEY is held by the externals
   * engine and never enters this view — resolved is the whole of what it says.
   */
  it('shows a recipe-declared service’s base URLs, and nothing of its key', () => {
    const r = repo();
    writeJson(scenarios(r, 'recipe.json'), {
      build: 'true',
      api: {
        serve: ['node', 'server.mjs'],
        externals: {
          stripe: {
            baseUrlEnv: 'STRIPE_BASE_URL',
            baseUrl: 'https://api.stripe.test',
            endpoints: { STRIPE_FILES_URL: 'https://files.stripe.test' },
            env: { STRIPE_KEY: {} },
          },
        },
      },
    });
    writeJson(scenarios(r, 'externals.local.json'), {
      stripe: { env: { STRIPE_KEY: 'test-key-not-a-real-one' } },
    });
    const [dependency] = readGuardDependenciesView(r).dependencies;

    expect(dependency.fields.map((f) => [f.field, f.value])).toEqual([
      ['STRIPE_BASE_URL', 'https://api.stripe.test'],
      ['STRIPE_FILES_URL', 'https://files.stripe.test'],
      ['STRIPE_KEY', undefined],
    ]);
    expect(JSON.stringify(readGuardDependenciesView(r))).not.toContain('test-key-not-a-real-one');
  });

  it('never renders an instruction: a reason says what is missing, not what to edit', () => {
    const r = repo();
    writeCatalog(r, [SUPPLIED_PROJECT, LLM_ACCOUNT]);
    const reasons = readGuardDependenciesView(r)
      .dependencies.flatMap((d) => d.fields)
      .map((f) => f.reason ?? '');
    expect(reasons.length).toBeGreaterThan(0);
    for (const reason of reasons) {
      expect(reason).not.toMatch(/dependencies\.local\.json|set it under|add one to/i);
    }
  });

  it('lists a recipe-declared service the catalog does not, as a supplied row', () => {
    const r = repo();
    writeJson(scenarios(r, 'recipe.json'), {
      build: 'true',
      api: {
        serve: ['node', 'server.mjs'],
        externals: { stripe: { baseUrlEnv: 'STRIPE_BASE_URL', env: { STRIPE_KEY: {} } } },
      },
    });
    const [dependency] = readGuardDependenciesView(r).dependencies;
    expect(dependency).toMatchObject({
      name: 'stripe',
      class: 'supplied',
      state: 'unprovided',
      inCatalog: false,
      service: { service: 'stripe', declaredInRecipe: true, baseUrlEnv: 'STRIPE_BASE_URL' },
    });
    // No catalog entry, so no registration shape — the service form answers instead.
    expect(dependency.registration).toBeUndefined();
  });

  it('folds the service half onto the catalog entry that names it — one row, not two', () => {
    const r = repo();
    writeCatalog(r, [LLM_ACCOUNT]);
    writeJson(path.join(r, '.truecourse', 'guard', 'setup.json'), {
      ranAt: '2026-08-07T00:00:00.000Z',
      status: 'ok',
      recipe: { status: 'ok', outcome: 'exists' },
      detection: {
        externalServices: [
          {
            service: 'anthropic',
            category: 'ai',
            source: 'sdk',
            evidence: [{ filePath: 'src/llm.ts', importSource: '@anthropic-ai/sdk' }],
          },
        ],
        database: null,
        datastoreUrls: [],
      },
    });
    const view = readGuardDependenciesView(r);
    expect(view.dependencies).toHaveLength(1);
    expect(view.dependencies[0]).toMatchObject({
      name: 'anthropic',
      inCatalog: true,
      registration: { kind: 'env' },
      service: { detected: true, category: 'ai', services: ['anthropic'] },
    });
    expect(view.dependencies[0].service!.evidence).toEqual([
      { service: 'anthropic', filePath: 'src/llm.ts', importSource: '@anthropic-ai/sdk' },
    ]);
    expect(view.detectionAvailable).toBe(true);
  });

  /**
   * One class of starting state, four third parties: the api transport reaches the
   * model through whichever provider it is configured for, and ONE credential
   * registration answers for all of them. Four look-alike rows carrying the evidence
   * while the row a user can actually act on carries none is the bug this closes.
   */
  it('folds EVERY service an entry names into it — evidence merged, attributed, no twin rows', () => {
    const r = repo();
    writeCatalog(r, [
      {
        ...LLM_ACCOUNT,
        name: 'llm-api-credentials',
        services: ['anthropic', 'openai', 'aws-bedrock', 'githubcopilot'],
      },
    ]);
    writeDetection(r, [
      { service: 'anthropic', source: 'sdk', evidence: [{ filePath: 'src/a.ts', importSource: '@anthropic-ai/sdk' }] },
      { service: 'openai', source: 'sdk', evidence: [{ filePath: 'src/o.ts', importSource: '@ai-sdk/openai' }] },
      { service: 'aws-bedrock', source: 'sdk', evidence: [{ filePath: 'src/b.ts', importSource: '@ai-sdk/amazon-bedrock' }] },
      { service: 'githubcopilot', source: 'http', evidence: [{ filePath: 'src/c.ts', url: 'https://api.githubcopilot.com' }] },
    ]);

    const view = readGuardDependenciesView(r);
    expect(view.dependencies.map((d) => d.name)).toEqual(['llm-api-credentials']);

    const service = view.dependencies[0].service!;
    expect(service.services).toEqual(['anthropic', 'openai', 'aws-bedrock', 'githubcopilot']);
    expect(service.detected).toBe(true);
    // Every hit says WHICH third party it is for — a merged list of file paths that
    // does not is unreadable.
    expect(service.evidence).toEqual([
      { service: 'anthropic', filePath: 'src/a.ts', importSource: '@anthropic-ai/sdk' },
      { service: 'openai', filePath: 'src/o.ts', importSource: '@ai-sdk/openai' },
      { service: 'aws-bedrock', filePath: 'src/b.ts', importSource: '@ai-sdk/amazon-bedrock' },
      { service: 'githubcopilot', filePath: 'src/c.ts', url: 'https://api.githubcopilot.com' },
    ]);
    // Three said `sdk` and one said `http`: there is no single answer, so the view
    // gives none rather than picking the majority.
    expect(service.detectedVia).toBeUndefined();
  });

  /**
   * A detection is not a question until somebody can answer it. One that no catalog
   * entry names, that nothing declares, and that holds nothing back offers a reader
   * neither something to register nor something to clear — it stays machine data.
   */
  it('lists NO row for a detected service nothing folds and nothing can register', () => {
    const r = repo();
    writeCatalog(r, [LLM_ACCOUNT]);
    writeDetection(r, [
      { service: 'anthropic', source: 'sdk', evidence: [{ filePath: 'src/a.ts', importSource: '@anthropic-ai/sdk' }] },
      { service: 'posthog', source: 'sdk', evidence: [{ filePath: 'src/t.ts', importSource: 'posthog-node' }] },
      { service: 'git', source: 'binary', evidence: [{ filePath: 'src/g.ts' }] },
    ]);
    expect(readGuardDependenciesView(r).dependencies.map((d) => d.name)).toEqual(['anthropic']);
  });

  /**
   * The other half of that rule: a service the RECIPE declares is a real declaration
   * with an account to register, so it keeps its row whether or not detection ever
   * saw it. Only unfolded detections disappear.
   */
  it('keeps the row of a recipe-declared service, folded by nothing and detected by nothing', () => {
    const r = repo();
    writeCatalog(r, [LLM_ACCOUNT]);
    writeJson(scenarios(r, 'recipe.json'), {
      build: 'true',
      api: {
        serve: ['node', 'server.mjs'],
        externals: { stripe: { baseUrlEnv: 'STRIPE_BASE_URL', env: { STRIPE_KEY: {} } } },
      },
    });
    writeDetection(r, [
      { service: 'posthog', source: 'sdk', evidence: [{ filePath: 'src/t.ts', importSource: 'posthog-node' }] },
    ]);

    const view = readGuardDependenciesView(r);
    expect(view.dependencies.map((d) => d.name)).toEqual(['anthropic', 'stripe']);
    expect(view.dependencies[1]).toMatchObject({
      inCatalog: false,
      service: { service: 'stripe', services: ['stripe'], declaredInRecipe: true, detected: false },
    });
  });

  /**
   * A detected service the last generate left flows BLOCKED on is not machine data:
   * providing it is the to-do that clears them, so it lists even though no entry
   * folds it and no recipe declares it.
   */
  it('keeps the row of an unfolded detection that holds flows back', () => {
    const r = repo();
    writeDetection(r, [
      { service: 'posthog', source: 'sdk', evidence: [{ filePath: 'src/t.ts', importSource: 'posthog-node' }] },
      { service: 'git', source: 'binary', evidence: [{ filePath: 'src/g.ts' }] },
    ]);
    writeResult(r, [
      {
        doc: 'docs/spec.md',
        anchor: 'events',
        kind: 'blocked-on',
        reason: 'blocked on posthog: the analytics flow needs a project key',
        flowId: 'emit-an-event',
      },
    ]);
    const view = readGuardDependenciesView(r);
    expect(view.dependencies.map((d) => d.name)).toEqual(['posthog']);
    expect(view.dependencies[0].blocks).toEqual([
      { flowId: 'emit-an-event', title: 'emit-an-event', kind: 'not-authored' },
    ]);
  });

  /**
   * How much RIDES on a dependency, which is not the same question as what it is
   * holding back: a flow that contributed a need uses it, a committed scenario that
   * binds it uses it, and registering an instance changes neither.
   */
  it('counts the flows that rely on it — needs plus binding scenarios, provided or not', () => {
    const r = repo();
    writeCatalog(r, [SUPPLIED_PROJECT]);
    writeFlows(r, [{ id: 'analyze-a-repo', title: 'A user analyzes a repository' }]);
    // `analyze-a-repo` both contributed a need AND binds it — one flow, counted once;
    // `diff-a-repo` contributed only a need; `list-violations` only binds it.
    writeScenario(r, 'analyze-a-repo.cli.1', 'analyze-a-repo', ['supplied-project']);
    writeScenario(r, 'list-violations.cli.1', 'list-violations', ['supplied-project']);

    expect(readGuardDependenciesView(r).dependencies[0]).toMatchObject({
      state: 'unprovided',
      usedBy: 3,
    });

    writeJson(scenarios(r, 'dependencies.local.json'), { 'supplied-project': { path: r } });
    const provided = readGuardDependenciesView(r).dependencies[0];
    // Nothing is blocked any more, and exactly as many flows still rely on it.
    expect(provided).toMatchObject({ state: 'provided', blocks: [], usedBy: 3 });
  });

  it('drops a dismissed flow from the count, like it drops it from the requirement', () => {
    const r = repo();
    writeCatalog(r, [SUPPLIED_PROJECT]);
    writeJson(scenarios(r, 'decisions.json'), {
      version: 1,
      dismissedClaims: [],
      dismissedFlows: [{ flowId: 'diff-a-repo', title: 'x', dismissedAt: '2026-08-07T00:00:00.000Z' }],
    });
    expect(readGuardDependenciesView(r).dependencies[0].usedBy).toBe(1);
  });

  it('a broken catalog blanks the catalog half only, with its reason', () => {
    const r = repo();
    fs.mkdirSync(scenarios(r), { recursive: true });
    fs.writeFileSync(scenarios(r, 'dependencies.json'), '{ not json');
    const view = readGuardDependenciesView(r);
    expect(view.invalidReason).toMatch(/dependencies\.json/);
    expect(view.dependencies).toEqual([]);
  });

  it('surfaces overlay keys the catalog never declares rather than honoring them', () => {
    const r = repo();
    writeCatalog(r, [SUPPLIED_PROJECT]);
    writeJson(scenarios(r, 'dependencies.local.json'), { 'who-is-this': { path: '/tmp' } });
    expect(readGuardDependenciesView(r).unknownLocalNames).toEqual(['who-is-this']);
  });
});

describe('writeGuardDependency', () => {
  it('registers an env instance in the gitignored overlay and re-reads it as provided', () => {
    const r = repo();
    writeCatalog(r, [LLM_ACCOUNT]);
    const view = writeGuardDependency(r, 'anthropic', {
      env: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com', ANTHROPIC_API_KEY: 'sk-secret' },
    });

    expect(view.dependencies[0].state).toBe('provided');
    expect(readJson(scenarios(r, 'dependencies.local.json'))).toEqual({
      anthropic: {
        env: { ANTHROPIC_API_KEY: 'sk-secret', ANTHROPIC_BASE_URL: 'https://api.anthropic.com' },
      },
    });
    // The committed catalog is untouched — the declaration said all of this already.
    expect(readJson(scenarios(r, 'dependencies.json'))).toEqual({ dependencies: [LLM_ACCOUNT] });
    // And the fresh view hands nothing back: resolution, never the key.
    expect(JSON.stringify(view)).not.toContain('sk-secret');
  });

  it('registers a path instance, and clears it with a blank one', () => {
    const r = repo();
    writeCatalog(r, [SUPPLIED_PROJECT]);
    const provided = writeGuardDependency(r, 'supplied-project', { path: r });
    expect(provided.dependencies[0].state).toBe('provided');
    expect(readJson(scenarios(r, 'dependencies.local.json'))).toEqual({
      'supplied-project': { path: r },
    });

    const cleared = writeGuardDependency(r, 'supplied-project', { path: '' });
    expect(cleared.dependencies[0].state).toBe('unprovided');
    // Nothing left to hold: the overlay file goes away rather than lingering empty.
    expect(fs.existsSync(scenarios(r, 'dependencies.local.json'))).toBe(false);
  });

  it('refuses a variable the committed registration does not declare', () => {
    const r = repo();
    writeCatalog(r, [LLM_ACCOUNT]);
    expect(() => writeGuardDependency(r, 'anthropic', { env: { SNEAKY: 'x' } })).toThrow(
      GuardDependencyWriteError,
    );
    expect(fs.existsSync(scenarios(r, 'dependencies.local.json'))).toBe(false);
  });

  it('refuses the wrong shape for the registration, and a class with nothing to register', () => {
    const r = repo();
    writeCatalog(r, [SUPPLIED_PROJECT, SEEDED_TASKS, LLM_ACCOUNT]);
    expect(() => writeGuardDependency(r, 'supplied-project', { env: { A: 'b' } })).toThrow(
      /path, not variables/,
    );
    expect(() => writeGuardDependency(r, 'anthropic', { path: '/tmp' })).toThrow(
      /environment variables, not a path/,
    );
    expect(() => writeGuardDependency(r, 'seeded-tasks', { path: '/tmp' })).toThrow(
      /no instance to register/,
    );
    expect(() => writeGuardDependency(r, 'nope', { path: '/tmp' })).toThrow(/No dependency named/);
  });

  it('sends a recipe-declared service through the api-shaped writer: declaration committed, key not', () => {
    const r = repo();
    writeJson(scenarios(r, 'recipe.json'), {
      build: 'true',
      api: { serve: ['node', 'server.mjs'], externals: { stripe: { baseUrlEnv: 'STRIPE_BASE_URL' } } },
    });
    const view = writeGuardDependency(r, 'stripe', {
      baseUrlEnv: 'STRIPE_BASE_URL',
      baseUrl: 'https://api.stripe.test',
      mode: 'sandbox',
      env: { STRIPE_KEY: 'sk-live-nope' },
    });

    expect(view.dependencies[0]).toMatchObject({
      name: 'stripe',
      state: 'provided',
      service: { baseUrl: 'https://api.stripe.test', mode: 'sandbox' },
    });
    const recipe = readJson(scenarios(r, 'recipe.json')) as {
      api: { externals: Record<string, unknown> };
    };
    expect(recipe.api.externals.stripe).toEqual({
      baseUrlEnv: 'STRIPE_BASE_URL',
      baseUrl: 'https://api.stripe.test',
      mode: 'sandbox',
      env: { STRIPE_KEY: {} },
    });
    expect(fs.readFileSync(scenarios(r, 'recipe.json'), 'utf-8')).not.toContain('sk-live-nope');
    expect(readJson(scenarios(r, 'externals.local.json'))).toEqual({
      stripe: { env: { STRIPE_KEY: 'sk-live-nope' } },
    });
  });
});
