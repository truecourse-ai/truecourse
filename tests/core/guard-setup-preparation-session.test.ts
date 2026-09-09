import {
  memoryPersistence,
  stubDriver,
  outcome,
} from './spec-scan-session-stub';
import type { GuardSetupSessionContext } from '../../packages/core/src/services/guard-setup/session-context';
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  verifyPreparationDraft,
  buildPreparationSession,
  PreparationDraftSchema,
  type PreparationDraft,
} from '../../packages/core/src/services/guard-setup/preparation-session';
import {
  collectGuardSetupBundle,
  materializeGuardSetupBundle,
} from '../../packages/core/src/services/guard-setup/bundle';
import {
  prepareScenario,
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
    draft.profiles[0].name = '../escape';
    await expect(
      verifyPreparationDraft(input, draft, { persist: true }),
    ).rejects.toThrow();
    expect(fs.readFileSync(recipePath(root), 'utf8')).toBe(original);
  });
});
