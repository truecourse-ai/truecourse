import { observeApiExpect } from '../../packages/guard-runner/src/api/expect';
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  prepareScenario,
  validateScenarioPreparation,
  RecipeSchema,
  computeRecipeFingerprint,
  runGuard,
  type Recipe,
} from '@truecourse/guard-runner';
import { GuardScenarioSchema, GuardSetupSchema } from '@truecourse/shared';
import { app } from '../fixtures/guard-preparation/server.mjs';
import { scenario, specBinds, writeSpecDoc, writeScenario } from './helpers.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function fixture(): { root: string; recipe: Recipe } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-preparation-test-'));
  roots.push(root);
  fs.cpSync(
    fileURLToPath(new URL('../fixtures/guard-preparation', import.meta.url)),
    path.join(root, 'scripts'),
    { recursive: true },
  );
  const preparation = {
    baseline: 'seeded' as const,
    scope: 'instance' as const,
    baselineChecks: [{ path: '/rows', credential: 'owner', counts: { count: 8 }, totals: { total: 36 } }],
    env: { DATA_FILE: '${directory}/ledger.json' },
    seed: {
      script: 'scripts/seed.mjs',
      provides: {
        credentials: { owner: { header: 'x-world-token' } },
        fixtures: { inputs: ['count', 'total', 'rows'] },
      },
    },
    verify: { script: 'scripts/verify.mjs' },
    cleanup: { script: 'scripts/cleanup.mjs' },
  };
  const recipe: Recipe = {
    build: 'true',
    api: { serve: ['node', 'scripts/server.mjs'], healthPath: '/health' },
    web: {
      serve: ['node', 'scripts/server.mjs'],
      healthPath: '/health',
      env: { DATA_FILE: '/wrong/shared.json' },
    },
    preparations: {
      ledger: preparation,
      empty: { ...preparation, baseline: 'empty', baselineChecks: [{ path: '/rows', credential: 'owner', counts: { count: 0 }, totals: { total: 0 } }] },
    },
  };
  return { root, recipe };
}
async function serve(world: Awaited<ReturnType<typeof prepareScenario>>) {
  const server = app(world.env);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'x-world-token': world.credentials.get('owner')!.value };
  return {
    read: async (query = '') =>
      (await fetch(base + '/rows' + query, { headers })).json(),
    add: async (rows: unknown[]) =>
      (
        await fetch(base + '/rows', {
          method: 'POST',
          headers,
          body: JSON.stringify(rows),
        })
      ).json(),
    close: () => new Promise<void>((resolve) => server.close(resolve)),
  };
}
const rows = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: 100 + i,
    amount: 1,
    date: '2100-01-01',
  }));

describe('runner-owned preparation profiles', () => {
  it('rejects a seeded empty world even when its generated verifier claims empty', async () => {
    const { root, recipe } = fixture();
    const seed = path.join(root, 'scripts/seed.mjs');
    fs.writeFileSync(seed, fs.readFileSync(seed, 'utf8').replace("process.env.GUARD_PREPARATION_BASELINE==='empty'?[]:", ''));
    fs.writeFileSync(path.join(root, 'scripts/verify.mjs'), "import fs from 'node:fs'; fs.writeFileSync(process.env.GUARD_SEED_OUT,JSON.stringify({fixtures:{verification:{baseline:'empty',isolated:true}}}))");
    await expect(prepareScenario({ repoRoot: root, recipe, profile: 'empty' })).rejects.toThrow('count expected 0, observed 8');
    writeSpecDoc(root);
    writeScenario(root, 'false-empty.yaml', GuardScenarioSchema.parse({
      id: 'false-empty', title: 'An empty ledger has no rows', binds: specBinds('spec/section'),
      setup: { preparation: 'empty' }, steps: [{ request: { method: 'GET', path: '/rows', headers: { 'x-world-token': '{{cred:owner}}' } },
        expect: { status: 200, json: { count: { equals: 0 } } } }],
    }));
    const result = await runGuard({ repoRoot: root, recipe, skipBuild: true });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw Error(JSON.stringify(result));
    expect(result.latest.scenarios[0]).toMatchObject({ outcome: 'error', preparationFailure: { profile: 'empty', stage: 'prepare' } });
    // Calling a known nonempty count an empty baseline cannot weaken the gate.
    recipe.preparations!.empty.baselineChecks![0].counts.count = 8;
    await expect(prepareScenario({ repoRoot: root, recipe, profile: 'empty' })).rejects.toThrow('nonzero business counts');
  });
  it('refuses legacy baseline markers and invalid observations before allocating a world', async () => {
    const { root, recipe } = fixture();
    delete recipe.preparations!.ledger.baselineChecks;
    await expect(prepareScenario({ repoRoot: root, recipe, profile: 'ledger' })).rejects.toThrow('refresh Guard Setup');
    for (const query of ['/rows?q=none', '//foreign/rows']) {
      expect(RecipeSchema.safeParse({ ...recipe, preparations: { ledger: { ...recipe.preparations!.ledger,
        baselineChecks: [{ path: query, counts: { count: 0 } }] } } }).success).toBe(false);
    }
  });
  it('checks the real baseline again after a verifier mutates the primary', async () => {
    const { root, recipe } = fixture();
    fs.writeFileSync(path.join(root, 'scripts/verify.mjs'), `import fs from 'node:fs';
      const data=JSON.parse(fs.readFileSync(process.env.DATA_FILE)); data.rows.push({id:999,amount:1,date:'2100-01-01'});
      fs.writeFileSync(process.env.DATA_FILE,JSON.stringify(data));
      fs.writeFileSync(process.env.GUARD_SEED_OUT,JSON.stringify({fixtures:{verification:{baseline:'empty',isolated:true}}}));`);
    await expect(prepareScenario({ repoRoot: root, recipe, profile: 'empty' })).rejects.toThrow('count expected 0, observed 1');
  });
  it('validates stable selection and rejects malformed or conflicting ownership', () => {
    const { recipe } = fixture();
    expect(RecipeSchema.safeParse(recipe).success).toBe(true);
    expect(GuardSetupSchema.parse({ preparation: 'empty' })).toEqual({
      preparation: 'empty',
    });
    expect(
      GuardSetupSchema.safeParse({ preparation: '../other' }).success,
    ).toBe(false);
    for (const value of [
      '/shared.db',
      '${PORT}/x',
      '${directory}/${unknown}',
    ]) {
      expect(
        RecipeSchema.safeParse({
          ...recipe,
          preparations: {
            bad: { ...recipe.preparations!.ledger, env: { DATA_FILE: value } },
          },
        }).success,
      ).toBe(false);
    }
    const test = scenario({
      id: 'conflict',
      steps: [],
      setup: { preparation: 'ledger', env: { DATA_FILE: '/shared' } },
    });
    expect(validateScenarioPreparation(recipe, test)).toContain(
      'owns DATA_FILE',
    );
    for (const key of ['DATA_FILE', 'GUARD_PREPARATION_DIRECTORY', 'GUARD_PREPARATION_NAMESPACE', 'GUARD_PREPARATION_BASELINE', 'GUARD_REPO_ROOT']) {
      for (const teardown of [false, true]) {
        const restart = { boot: { env: { [key]: '/foreign' } } };
        expect(validateScenarioPreparation(recipe, scenario({
          id: 'redirected-restart', setup: { preparation: 'ledger' },
          steps: teardown ? [] : [restart], ...(teardown ? { teardown: [restart] } : {}),
        }))).toContain(`owns ${key}`);
      }
    }
    expect(validateScenarioPreparation(recipe, scenario({
      id: 'unrelated-restart-config', setup: { preparation: 'ledger' },
      steps: [{ boot: { env: { LOG_LEVEL: 'debug' } } }],
    }))).toBeUndefined();
    expect(
      validateScenarioPreparation(
        recipe,
        scenario({
          id: 'unknown',
          steps: [],
          setup: { preparation: 'absent' },
        }),
      ),
    ).toContain('Unknown preparation');
    expect(
      validateScenarioPreparation(
        recipe,
        scenario({ id: 'legacy', steps: [] }),
      ),
    ).toBeUndefined();
  });
  it('keeps 8 + 6 = 14 while a sibling inserts 8 and an empty ledger remains empty', async () => {
    const { root, recipe } = fixture();
    const worlds = await Promise.all(
      ['ledger', 'ledger', 'empty'].map((profile) =>
        prepareScenario({ repoRoot: root, recipe, profile }),
      ),
    );
    const servers = await Promise.all(worlds.map(serve));
    try {
      const baseline = await servers[0].read();
      expect(baseline.count).toBe(8);
      // Both writers reach this barrier before either mutates; no timing sleeps.
      await Promise.all([servers[0].add(rows(6)), servers[1].add(rows(8))]);
      expect((await servers[0].read()).count).toBe(14);
      expect((await servers[0].read()).total).toBe(42);
      expect((await servers[1].read()).count).toBe(16);
      expect((await servers[2].read()).count).toBe(0);
      const checkOrder = (body: unknown, page: boolean) =>
        observeApiExpect({
          expect: {
            status: 200,
            json: page
              ? { 'rows[0].id': { equals: 8 }, 'rows[5].id': { equals: 3 } }
              : {
                  'rows[0].id': { equals: 105 },
                  'rows[5].id': { equals: 100 },
                  'rows[6].id': { equals: 8 },
                },
          },
          status: 200,
          headers: {},
          bodyText: JSON.stringify(body),
          rawBodyText: JSON.stringify(body),
          normalizeText: (text) => text,
        }).mismatch;
      expect(checkOrder(await servers[0].read(), false)).toBeNull();
      expect(
        checkOrder(await servers[0].read('?page=2&limit=6'), true),
      ).toBeNull();
      for (const defect of ['BROKEN_ORDER', 'BROKEN_PAGE']) {
        const broken = await serve({
          ...worlds[0],
          env: { ...worlds[0].env, [defect]: 'yes' },
        });
        try {
          expect(
            checkOrder(
              await broken.read(
                defect === 'BROKEN_PAGE' ? '?page=2&limit=6' : '',
              ),
              defect === 'BROKEN_PAGE',
            ),
          ).not.toBeNull();
          expect((await servers[2].read()).count).toBe(0);
        } finally {
          await broken.close();
        }
      }

      expect(new Set(worlds.map((w) => w.env.DATA_FILE)).size).toBe(3);
      expect(
        new Set(worlds.map((w) => w.credentials.get('owner')!.value)).size,
      ).toBe(3);
    } finally {
      await Promise.all(servers.map((s) => s.close()));
      await Promise.all(worlds.map((w) => w.close()));
    }
    expect(
      worlds.every((w) => !fs.existsSync(path.dirname(w.env.DATA_FILE))),
    ).toBe(true);
  }, 30_000);
  it('keeps records over server restart but allocates a new baseline on replay', async () => {
    const { root, recipe } = fixture();
    const world = await prepareScenario({
      repoRoot: root,
      recipe,
      profile: 'ledger',
    });
    let server = await serve(world);
    await server.add(rows(6));
    await server.close();
    server = await serve(world);
    expect((await server.read()).count).toBe(14);
    await server.close();
    await world.close();
    const replay = await prepareScenario({
      repoRoot: root,
      recipe,
      profile: 'ledger',
    });
    const replayServer = await serve(replay);
    try {
      expect((await replayServer.read()).count).toBe(8);
      expect(replay.env.DATA_FILE).not.toBe(world.env.DATA_FILE);
    } finally {
      await replayServer.close();
      await replay.close();
    }
  }, 30_000);
  it('refuses false isolation and actual aggregate defects during app verification', async () => {
    const { root, recipe } = fixture();
    // A lying binding points both namespaces at the same file; the authenticated app reveals it.
    const profile = recipe.preparations!.ledger;
    const seed = path.join(root, 'scripts/seed.mjs');
    fs.writeFileSync(
      seed,
      fs
        .readFileSync(seed, 'utf8')
        .replace('process.env.DATA_FILE', `'${path.join(root, 'shared.json')}'`)
        .replace(
          'const token = process.env.GUARD_PREPARATION_NAMESPACE',
          "const token = 'same-credential'",
        ),
    );
    const server = path.join(root, 'scripts/server.mjs');
    fs.writeFileSync(
      server,
      fs
        .readFileSync(server, 'utf8')
        .replace(
          'const file = env.DATA_FILE',
          `const file = '${path.join(root, 'shared.json')}'`,
        ),
    );
    await expect(
      prepareScenario({ repoRoot: root, recipe, profile: 'ledger' }),
    ).rejects.toThrow();
    const healthy = fixture();
    healthy.recipe.env = { BROKEN_TOTAL: 'yes' };
    await expect(
      prepareScenario({
        repoRoot: healthy.root,
        recipe: healthy.recipe,
        profile: 'ledger',
      }),
    ).rejects.toThrow();
  }, 30_000);
  it('cleans allocations when seeding fails before manifest publication without touching a sibling', async () => {
    const { root, recipe } = fixture();
    recipe.env = { CLEANUP_LOG: path.join(root, 'cleanup.jsonl') };
    const sibling = await prepareScenario({
      repoRoot: root,
      recipe,
      profile: 'ledger',
    });
    fs.writeFileSync(
      path.join(root, 'scripts/fail.mjs'),
      "throw new Error('seed failure')",
    );
    recipe.preparations!.empty.seed.script = 'scripts/fail.mjs';
    await expect(
      prepareScenario({ repoRoot: root, recipe, profile: 'empty' }),
    ).rejects.toThrow('seed failure');
    expect(fs.existsSync(sibling.env.DATA_FILE)).toBe(true);
    const log = fs
      .readFileSync(path.join(root, 'cleanup.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(log).toHaveLength(3); // sibling peer, both failed allocations
    expect(log.every((row) => row.namespace && row.directory)).toBe(true);
    expect(log.every((row) => !fs.existsSync(row.directory))).toBe(true);
    await sibling.close();
  }, 30_000);
  it('aborts during provisioning, cleans both allocations, and leaves an active sibling usable', async () => {
    const { root, recipe } = fixture();
    recipe.env = {
      CLEANUP_LOG: path.join(root, 'cleanup.jsonl'),
      READY_FILE: path.join(root, 'ready'),
    };
    const sibling = await prepareScenario({
      repoRoot: root,
      recipe,
      profile: 'ledger',
    });
    fs.writeFileSync(
      path.join(root, 'scripts/wait.mjs'),
      "import fs from 'node:fs';fs.writeFileSync(process.env.READY_FILE,'ready');setInterval(()=>{},1000)",
    );
    recipe.preparations!.empty.seed.script = 'scripts/wait.mjs';
    const controller = new AbortController();
    const watcher = fs.watch(root, () => {
      if (fs.existsSync(path.join(root, 'ready'))) controller.abort();
    });
    try {
      await expect(
        prepareScenario({
          repoRoot: root,
          recipe,
          profile: 'empty',
          signal: controller.signal,
        }),
      ).rejects.toThrow();
    } finally {
      watcher.close();
    }
    const server = await serve(sibling);
    try {
      expect((await server.read()).count).toBe(8);
    } finally {
      await server.close();
      await sibling.close();
    }
    const log = fs
      .readFileSync(path.join(root, 'cleanup.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(log).toHaveLength(4);
    expect(
      log.every(
        (row) =>
          row.namespace && row.directory && !fs.existsSync(row.directory),
      ),
    ).toBe(true);
  }, 30_000);
  it('reports cleanup failure once per allocation, removes owned directories and leaves siblings alive', async () => {
    const { root, recipe } = fixture();
    recipe.env = { CLEANUP_LOG: path.join(root, 'cleanup.jsonl') };
    const sibling = await prepareScenario({
      repoRoot: root,
      recipe,
      profile: 'ledger',
    });
    const cleanup = fs.readFileSync(
      path.join(root, 'scripts/cleanup.mjs'),
      'utf8',
    );
    fs.writeFileSync(
      path.join(root, 'scripts/fail-cleanup.mjs'),
      cleanup + "\nthrow new Error('cleanup failed')",
    );
    recipe.preparations!.empty.cleanup = { script: 'scripts/fail-cleanup.mjs' };
    await expect(
      prepareScenario({ repoRoot: root, recipe, profile: 'empty' }),
    ).rejects.toThrow('cleanup failed');
    const log = fs
      .readFileSync(path.join(root, 'cleanup.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(log).toHaveLength(3);
    expect(new Set(log.map((row) => row.namespace)).size).toBe(3);
    expect(log.every((row) => !fs.existsSync(row.directory))).toBe(true);
    expect(fs.existsSync(sibling.env.DATA_FILE)).toBe(true);
    await sibling.close();
  }, 30_000);

  it('fingerprints every script content and rejects missing or escaped scripts', async () => {
    const { root, recipe } = fixture();
    fs.mkdirSync(path.join(root, '.truecourse/scenarios'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.truecourse/scenarios/recipe.json'),
      JSON.stringify(recipe),
    );
    let previous = computeRecipeFingerprint(root);
    for (const name of ['seed', 'verify', 'cleanup']) {
      fs.appendFileSync(
        path.join(root, `scripts/${name}.mjs`),
        '\n// changed\n',
      );
      const next = computeRecipeFingerprint(root);
      expect(next).not.toBe(previous);
      previous = next;
    }
    fs.rmSync(path.join(root, 'scripts/verify.mjs'));
    await expect(
      prepareScenario({ repoRoot: root, recipe, profile: 'ledger' }),
    ).rejects.toThrow('Missing preparation script');
    recipe.preparations!.ledger.verify.script = '../escape.mjs';
    await expect(
      prepareScenario({ repoRoot: root, recipe, profile: 'ledger' }),
    ).rejects.toThrow('inside the repository');
  });
  it('runs authenticated API and mixed browser/request scenarios with profile env above conflicting web env', async () => {
    const { root, recipe } = fixture();
    writeSpecDoc(root);
    writeScenario(
      root,
      'api.yaml',
      GuardScenarioSchema.parse({
        id: 'private-api',
        title: 'private api',
        binds: specBinds('spec/section'),
        setup: { preparation: 'ledger' },
        steps: [
          {
            request: {
              method: 'POST',
              path: '/rows',
              headers: { 'x-world-token': '{{cred:owner}}' },
              json: rows(6),
            },
            expect: {
              status: 200,
              json: { count: { equals: 14 }, total: { equals: 42 } },
            },
          },
          {
            request: {
              method: 'GET',
              path: '/rows',
              headers: { 'x-world-token': '{{cred:owner}}' },
            },
            expect: { status: 200, json: { count: { equals: 14 } } },
          },
        ],
      }),
    );
    writeScenario(
      root,
      'browser.yaml',
      scenario({
        id: 'private-browser',
        binds: specBinds('spec/section'),
        setup: { preparation: 'ledger' },
        steps: [
          { driver: 'web', credential: 'owner' },
          {
            driver: 'web',
            navigate: '/',
            expect: { text: { contains: 'Count: 8' } },
          },
          {
            request: {
              method: 'POST',
              path: '/rows',
              headers: { 'x-world-token': '{{cred:owner}}' },
              json: rows(6),
            },
            expect: { status: 200, json: { count: { equals: 14 } } },
          },
          {
            driver: 'web',
            navigate: '/',
            expect: { text: { contains: 'Total: 42' } },
          },
        ],
      }),
    );
    const result = await runGuard({
      repoRoot: root,
      recipe,
      skipBuild: true,
      concurrency: 3,
    });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error(JSON.stringify(result));
    expect(
      result.latest.scenarios.map((s) => ({
        id: s.id,
        outcome: s.outcome,
        failure: s.failure,
      })),
    ).toEqual([
      { id: 'private-api', outcome: 'pass', failure: undefined },
      { id: 'private-browser', outcome: 'pass', failure: undefined },
    ]);
    expect(
      result.latest.scenarios.every((s) => s.preparation?.profile === 'ledger'),
    ).toBe(true);
  }, 60_000);
});
