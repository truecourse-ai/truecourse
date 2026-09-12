import {
  memoryPersistence,
  stubDriver,
  outcome,
} from './spec-scan-session-stub';
import type { GuardSetupSessionContext } from '../../packages/core/src/services/guard-setup/session-context';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  verifyPreparationDraft,
  buildPreparationSession,
  PreparationDraftSchema,
  PREPARATION_PROMPT,
  type PreparationDraft,
} from '../../packages/core/src/services/guard-setup/preparation-session';
import {
  collectGuardSetupBundle,
  materializeGuardSetupBundle,
} from '../../packages/core/src/services/guard-setup/bundle';
import {
  prepareScenario,
  PREPARATION_VERIFY_INPUTS_SOURCE,
  loadRecipe,
  recipePath,
  type Recipe,
} from '@truecourse/guard-runner';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-preparation-fold-'));
  roots.push(root);
  fs.cpSync(
    fileURLToPath(new URL('../fixtures/guard-preparation', import.meta.url)),
    path.join(root, 'scripts'),
    { recursive: true },
  );
  const recipe: Recipe = {
    build: 'true',
    api: {
      serve: ['node', 'scripts/server.mjs'],
      healthPath: '/health',
      seed: {
        command: 'original seed',
        provides: { fixtures: { original: ['id'] } },
      },
    },
    env: { UNRELATED: 'preserved' },
  };
  fs.mkdirSync(path.dirname(recipePath(root)), { recursive: true });
  fs.writeFileSync(recipePath(root), JSON.stringify(recipe));
  const source = (name: string) =>
    fs.readFileSync(path.join(root, `scripts/${name}.mjs`), 'utf8');
  const draft: PreparationDraft = {
    profiles: [
      {
        name: 'ledger',
        baseline: 'seeded',
        needs: [],
        baselineChecks: [{ path: '/rows', credential: 'owner', counts: { count: 8 }, totals: { total: 36 } }],
        env: { DATA_FILE: '${directory}/ledger.json' },
        seed: source('seed'),
        provides: {
          credentials: { owner: { header: 'x-world-token' } },
          fixtures: { inputs: ['count', 'total', 'rows'] },
        },
        verify: source('verify').replace(
          "import { app } from './server.mjs'",
          "import { pathToFileURL } from 'node:url'\nconst { app } = await import(pathToFileURL(process.env.GUARD_REPO_ROOT + '/scripts/server.mjs').href)",
        ),
        cleanup: source('cleanup'),
      },
    ],
    findings: [],
  };
  return {
    root,
    recipe,
    draft,
    input: { repoRoot: root, recipe, specExcerpts: [], fingerprint: 'test' },
  };
}
describe('targeted preparation authoring and hosted bundle protocol', () => {
  it('authenticates both worlds with the verifier input example supplied to the author', async () => {
    const { input, draft } = fixture();
    expect(PREPARATION_PROMPT).toContain(PREPARATION_VERIFY_INPUTS_SOURCE);
    draft.profiles[0].verify = draft.profiles[0].verify
      .replace('const env=process.env, peer=JSON.parse(env.GUARD_PREPARATION_PEER_ENV)',
        PREPARATION_VERIFY_INPUTS_SOURCE + '\nconst env=process.env')
      .replace('const creds=JSON.parse(env.GUARD_PREPARATION_CREDENTIALS),peerCreds=JSON.parse(env.GUARD_PREPARATION_PEER_CREDENTIALS)',
        "assert.equal(fixtures.inputs.count,8);assert.equal(peerFixtures.inputs.count,8);assert.notEqual(credentials.owner.value,peerCredentials.owner.value)")
      .replace('creds.owner.value', "requiredPreparationCredential(credentials,'owner')")
      .replace('peerCreds.owner.value', "requiredPreparationCredential(peerCredentials,'owner')");
    await expect(verifyPreparationDraft(input, draft)).resolves.toBeUndefined();
  }, 30_000);

  it('checks dependencies for every profile before staging or executing any draft', async () => {
    const { root, input, draft } = fixture();
    const before = collectGuardSetupBundle(root);
    draft.profiles[0].seed = "throw new Error('must not execute the first profile')";
    draft.profiles.push({ ...draft.profiles[0], name: 'requires-aws', needs: ['aws'] });
    await expect(verifyPreparationDraft(input, draft, { persist: true })).rejects.toThrow('Preparation dependency "aws"');
    expect(collectGuardSetupBundle(root)).toEqual(before);
    expect(fs.existsSync(path.join(root, '.truecourse/scenarios/preparations'))).toBe(false);
  });

  it('proves a draft without saved writes, then persists while retaining existing setup', async () => {
    const { root, recipe, draft, input } = fixture();
    const original = fs.readFileSync(recipePath(root), 'utf8');
    await verifyPreparationDraft(input, draft);
    expect(fs.readFileSync(recipePath(root), 'utf8')).toBe(original);
    expect(
      fs.existsSync(
        path.join(root, '.truecourse/scenarios/preparations/ledger/seed.mjs'),
      ),
    ).toBe(false);
    await verifyPreparationDraft(input, draft, { persist: true });
    const saved = loadRecipe(root, recipePath(root))!.recipe;
    expect(saved.api?.seed).toEqual(recipe.api?.seed);
    expect(saved.env).toEqual(recipe.env);
    expect(saved.preparations?.ledger.baseline).toBe('seeded');
  }, 30_000);
  it('refuses false app verification and restores prior recipe and scripts byte-for-byte', async () => {
    const { root, draft, input } = fixture();
    await verifyPreparationDraft(input, draft, { persist: true });
    const before = collectGuardSetupBundle(root);
    const existing = loadRecipe(root, recipePath(root))!.recipe;
    draft.profiles[0].verify =
      "throw new Error('peer mutation changed primary')";
    await expect(
      verifyPreparationDraft({ ...input, recipe: existing }, draft, {
        persist: true,
      }),
    ).rejects.toThrow('peer mutation changed primary');
    expect(collectGuardSetupBundle(root)).toEqual(before);
  }, 30_000);
  it('transports seed, verifier, cleanup into a hosted-shaped fresh checkout and refuses a missing member', async () => {
    const { root, draft, input } = fixture();
    await verifyPreparationDraft(input, draft, { persist: true });
    const bundle = JSON.parse(JSON.stringify(collectGuardSetupBundle(root)));
    for (const name of ['seed', 'verify', 'cleanup'])
      expect(
        bundle[`.truecourse/scenarios/preparations/ledger/${name}.mjs`],
        JSON.stringify(Object.keys(bundle)),
      ).toBeTypeOf('string');
    const clone = fixture();
    materializeGuardSetupBundle(clone.root, bundle);
    const recipe = loadRecipe(clone.root, recipePath(clone.root))!.recipe;
    const world = await prepareScenario({
      repoRoot: clone.root,
      recipe: JSON.parse(JSON.stringify(recipe)),
      profile: 'ledger',
    });
    expect(world.fixtures.get('inputs')?.count).toBe(8);
    await world.close();
    fs.rmSync(
      path.join(clone.root, recipe.preparations!.ledger.cleanup!.script),
    );
    await expect(
      prepareScenario({ repoRoot: clone.root, recipe, profile: 'ledger' }),
    ).rejects.toThrow('Missing preparation script');
  }, 30_000);
});

describe('preparation authoring session completion gate', () => {
  function contextFor(stub = stubDriver(() => outcome({ profiles: [], findings: ['No private state needed by this fixture'] }))) {
    const persistence = memoryPersistence();
    const acquire = vi.fn(async () => ({ runId: 'preparation-run', driver: stub.driver, persistence: persistence.persistence }));
    const context: GuardSetupSessionContext = {
      acquire, runId: () => 'preparation-run', note: () => {}, addSpend: () => {}, usageTotals: () => null, finish: () => {},
    };
    return { context, acquire };
  }

  it('briefs unavailable catalog-only AWS and provided accounts without their values', async () => {
    const { root, input, draft } = fixture();
    fs.writeFileSync(path.join(root, '.truecourse/scenarios/dependencies.json'), JSON.stringify({ dependencies: [
      { name: 'aws', class: 'supplied', summary: 'S3 object storage', services: ['s3'], needs: [], registration: { kind: 'env', vars: [{ name: 'AWS_SECRET_ACCESS_KEY', description: 'Secret', secret: true }] } },
      { name: 'database', class: 'supplied', summary: 'Database', needs: [], registration: { kind: 'env', vars: [{ name: 'DATABASE_URL', description: 'Connection', secret: true }] } },
    ] }));
    fs.writeFileSync(path.join(root, '.truecourse/scenarios/dependencies.local.json'), JSON.stringify({ database: { env: { DATABASE_URL: 'postgres://secret-briefing-test' } } }));
    input.recipe.api!.env = { NEXT_PUBLIC_UPLOAD_TRANSPORT: 'database' };
    const stub = stubDriver(call => {
      const briefing = JSON.parse(call.briefing);
      expect(briefing.dependencyAvailability.catalog).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'aws', state: 'unprovided', services: ['s3'] }),
        expect.objectContaining({ name: 'database', state: 'provided' }),
      ]));
      expect(briefing.recipe.api.env.NEXT_PUBLIC_UPLOAD_TRANSPORT).toBe('database');
      expect(call.briefing).not.toContain('secret-briefing-test');
      expect(call.def.systemPrompt).toContain('read its IMPLEMENTATION');
      return outcome({ profiles: [], findings: ['No isolation required'] });
    });
    const { context } = contextFor(stub);
    expect(await buildPreparationSession(context)(input)).toMatchObject({ status: 'skipped' });
    expect(stub.calls).toHaveLength(1);
    draft.profiles[0].needs = ['database'];
    await expect(verifyPreparationDraft(input, draft, { persist: true })).resolves.toBeUndefined();
    expect(loadRecipe(root, recipePath(root))!.recipe.preparations!.ledger.needs).toEqual(['database']);
  });

  it('installs a local package before building and opening authoring on a fresh checkout', async () => {
    const { root, input } = fixture();
    fs.mkdirSync(path.join(root, 'local-package'));
    fs.writeFileSync(path.join(root, 'local-package/package.json'), JSON.stringify({ name: 'preparation-fixture', version: '1.0.0', main: 'index.cjs' }));
    fs.writeFileSync(path.join(root, 'local-package/index.cjs'), 'module.exports = 42;');
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ private: true, dependencies: { 'preparation-fixture': 'file:./local-package' } }));
    fs.writeFileSync(path.join(root, 'build.cjs'), "require('node:assert').equal(require('preparation-fixture'), 42); require('node:fs').writeFileSync('built', 'ok');");
    input.recipe.install = 'npm install --offline --ignore-scripts --package-lock=false --no-audit --no-fund --cache .npm-cache';
    input.recipe.build = 'node build.cjs';
    const phases: string[] = [];
    const { context, acquire } = contextFor(stubDriver(() => {
      expect(fs.readFileSync(path.join(root, 'built'), 'utf8')).toBe('ok');
      return outcome({ profiles: [], findings: ['No private state needed by this fixture'] });
    }));
    expect(fs.existsSync(path.join(root, 'node_modules'))).toBe(false);
    const result = await buildPreparationSession(context)({ ...input, onPhase: (_running, done) => phases.push(done) });
    expect(result.status).toBe('skipped');
    expect(acquire).toHaveBeenCalledOnce();
    expect(phases).toEqual(['install', 'build', 'preparations']);
  });

  it.each(['install', 'build', 'services'] as const)('retains redacted %s diagnostics and never starts authoring after failure', async stage => {
    const { root, input } = fixture();
    const secret = 'local-password-for-test';
    input.recipe.env = { DATABASE_URL: `postgres://user:${secret}@localhost/private` };
    fs.writeFileSync(path.join(root, 'fail.cjs'), "console.error('fixture dependency missing', process.env.DATABASE_URL, new URL(process.env.DATABASE_URL).password); process.exit(7);");
    fs.writeFileSync(path.join(root, 'build.cjs'), "require('node:fs').writeFileSync('built', 'ok');");
    input.recipe.install = stage === 'install' ? 'node fail.cjs' : 'true';
    input.recipe.build = stage === 'build' ? 'node fail.cjs' : 'node build.cjs';
    if (stage === 'services') input.recipe.api!.services = { up: 'node fail.cjs', down: 'true' };
    const { context, acquire } = contextFor();
    const result = await buildPreparationSession(context)(input);
    expect(result.status).toBe('failed');
    expect(result.reason).toContain('exit 7');
    expect(result.reason).toContain('fixture dependency missing');
    expect(result.reason).not.toContain(secret);
    expect(acquire).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(root, 'built'))).toBe(stage === 'services');
  });

  it('does not install, build, or open authoring when already cancelled', async () => {
    const { root, input } = fixture();
    input.recipe.install = "node -e \"require('fs').writeFileSync('installed', 'yes')\"";
    const { context, acquire } = contextFor();
    const result = await buildPreparationSession(context, { signal: AbortSignal.abort() })(input);
    expect(result).toMatchObject({ status: 'failed', reason: expect.stringContaining('cancelled') });
    expect(fs.existsSync(path.join(root, 'installed'))).toBe(false);
    expect(acquire).not.toHaveBeenCalled();
  });

  it('rejects an unverified outcome, verifies the exact draft on resume, then persists', async () => {
    const { root, draft, input } = fixture();
    const persistence = memoryPersistence();
    let calls = 0;
    const stub = stubDriver(async (call) => {
      calls++;
      if (calls === 1) return outcome(draft);
      expect(call.input.initialMessages.join(' ')).toContain(
        'verify_preparations',
      );
      const tool = call.def.tools.find(
        (tool) => tool.name === 'verify_preparations',
      )!;
      const checked = await tool.execute(draft, {
        workItem: 'preparations',
        signal: new AbortController().signal,
        dispatchChild: async () => {
          throw new Error('no child');
        },
      });
      expect(checked.isError).not.toBe(true);
      expect(
        fs.existsSync(
          path.join(root, '.truecourse/scenarios/preparations/ledger/seed.mjs'),
        ),
      ).toBe(false);
      return outcome(draft);
    });
    const context: GuardSetupSessionContext = {
      acquire: async () => ({
        runId: 'preparation-run',
        driver: stub.driver,
        persistence: persistence.persistence,
      }),
      runId: () => 'preparation-run',
      note: () => {},
      addSpend: () => {},
      usageTotals: () => null,
      finish: () => {},
    };
    expect(await buildPreparationSession(context)(input)).toMatchObject({
      status: 'ok',
      sessionRunId: 'preparation-run',
    });
    expect(calls).toBe(2);
    expect(
      loadRecipe(root, recipePath(root))!.recipe.preparations?.ledger,
    ).toBeDefined();
  }, 30_000);
  it.each([false, true])('fails instead of caching an empty outcome after verification refusal (empty tool call: %s)', async emptyToolCall => {
    const { root, input, draft } = fixture();
    const original = collectGuardSetupBundle(root);
    draft.profiles[0].verify = "throw new Error('peer credential lookup failed')";
    const empty = { profiles: [], findings: ['Unable to verify private credentials'] };
    let calls = 0;
    const stub = stubDriver(async call => {
      const tool = call.def.tools.find(tool => tool.name === 'verify_preparations')!;
      const toolContext = { workItem: 'preparations', signal: new AbortController().signal, dispatchChild: async () => { throw new Error('no child'); } };
      if (++calls === 1) {
        const result = await tool.execute(draft, toolContext);
        expect(result).toMatchObject({ isError: true, content: expect.stringContaining('peer credential lookup failed') });
        if (emptyToolCall) expect(await tool.execute(empty, toolContext)).toMatchObject({ isError: true });
      } else {
        expect(call.input.initialMessages.join(' ')).toContain('peer credential lookup failed');
      }
      return outcome(empty);
    });
    const { context } = contextFor(stub);
    expect(await buildPreparationSession(context)(input)).toMatchObject({ status: 'failed', reason: expect.stringContaining('peer credential lookup failed') });
    expect(calls).toBeGreaterThan(1);
    expect(collectGuardSetupBundle(root)).toEqual(original);
  }, 30_000);

  it('rejects an empty outcome that discards a successfully verified draft', async () => {
    const { root, input, draft } = fixture();
    const original = collectGuardSetupBundle(root);
    let calls = 0;
    const stub = stubDriver(async call => {
      if (++calls === 1) {
        const tool = call.def.tools.find(tool => tool.name === 'verify_preparations')!;
        const checked = await tool.execute(draft, { workItem: 'preparations', signal: new AbortController().signal, dispatchChild: async () => { throw new Error('no child'); } });
        expect(checked.isError).not.toBe(true);
      }
      return outcome({ profiles: [], findings: ['Discarded profiles'] });
    });
    const { context } = contextFor(stub);
    expect(await buildPreparationSession(context)(input)).toMatchObject({ status: 'failed' });
    expect(calls).toBeGreaterThan(1);
    expect(collectGuardSetupBundle(root)).toEqual(original);
  }, 30_000);

  it('allows a repaired draft to resolve the verification failure and persist', async () => {
    const { root, input, draft } = fixture();
    let calls = 0;
    const stub = stubDriver(async call => {
      const tool = call.def.tools.find(tool => tool.name === 'verify_preparations')!;
      const toolContext = { workItem: 'preparations', signal: new AbortController().signal, dispatchChild: async () => { throw new Error('no child'); } };
      if (++calls === 1) {
        const broken = structuredClone(draft);
        broken.profiles[0].verify = "throw new Error('missing peer credential')";
        expect(await tool.execute(broken, toolContext)).toMatchObject({ isError: true });
        return outcome({ profiles: [], findings: ['Unable to verify'] });
      }
      expect((await tool.execute(draft, toolContext)).isError).not.toBe(true);
      return outcome(draft);
    });
    const { context } = contextFor(stub);
    expect(await buildPreparationSession(context)(input)).toMatchObject({ status: 'ok' });
    expect(calls).toBe(2);
    expect(loadRecipe(root, recipePath(root))!.recipe.preparations?.ledger).toBeDefined();
  }, 30_000);

  it('rejects missing Postgres cleanup before writes and keeps a valid declaration through persistence', async () => {
    const { root, input, draft } = fixture();
    const original = fs.readFileSync(recipePath(root), 'utf8');
    draft.profiles[0].postgres = { isolation: 'database', urlEnvs: ['DATABASE_URL', 'DIRECT_URL'] };
    const cleanup = draft.profiles[0].cleanup;
    delete draft.profiles[0].cleanup;
    await expect(verifyPreparationDraft(input, draft, { persist: true })).rejects.toThrow('cleanup');
    expect(fs.readFileSync(recipePath(root), 'utf8')).toBe(original);
    draft.profiles[0].cleanup = cleanup;
    input.recipe.api!.env = { DATABASE_URL: 'postgres://local/shared', DIRECT_URL: 'postgres://direct/shared' };
    await verifyPreparationDraft(input, draft, { persist: true });
    expect(loadRecipe(root, recipePath(root))!.recipe.preparations!.ledger.postgres).toEqual(draft.profiles[0].postgres);
    const bundle = collectGuardSetupBundle(root);
    expect(Object.keys(bundle)).toContain('.truecourse/scenarios/preparations/ledger/cleanup.mjs');
    const before = JSON.stringify(bundle);
    draft.profiles[0].seed = "throw new Error('migration failed')";
    await expect(verifyPreparationDraft(input, draft, { persist: true })).rejects.toThrow('migration failed');
    expect(JSON.stringify(collectGuardSetupBundle(root))).toBe(before);
  }, 30_000);
  it('rejects malformed drafts before any repository writes and requires reasons for unavailable isolation', async () => {
    const { root, input, draft } = fixture();
    const original = fs.readFileSync(recipePath(root), 'utf8');
    expect(
      PreparationDraftSchema.safeParse({ profiles: [], findings: [] }).success,
    ).toBe(false);
    expect(
      PreparationDraftSchema.safeParse({
        profiles: [],
        findings: ['The application exposes no instance-wide namespace'],
      }).success,
    ).toBe(true);
    const undeclared = structuredClone(draft);
    delete (undeclared.profiles[0] as Partial<PreparationDraft['profiles'][number]>).needs;
    expect(PreparationDraftSchema.safeParse(undeclared).success).toBe(false);
    draft.profiles[0].name = '../escape';
    await expect(
      verifyPreparationDraft(input, draft, { persist: true }),
    ).rejects.toThrow();
    expect(fs.readFileSync(recipePath(root), 'utf8')).toBe(original);
  });
});
