/**
 * THE SEED AUTHORING SESSION — `guard-setup.seed` (plan 03 step 13), driven end
 * to end over the `seed-draft` fixture: a dependency-free node app whose
 * "database" is one JSON file named by `SEED_STORE`, so the whole lifecycle
 * (services up, the session's real `run_seed_draft`, the fold's fresh-world
 * proof) runs locally with no network and no docker.
 *
 * Only the MODEL is scripted. Everything the seam owns is real: the draft is
 * written to the scratch directory and actually spawned, the manifest is
 * validated by the runner's own resolver, the fold writes the two artifacts and
 * re-proves them in a world it tore down and booted again, and a refused proof
 * puts the tree back byte-for-byte.
 *
 * The last describe covers the engine half the seam cannot: `confirmSeedReplace`
 * is asked BEFORE the seam is reached, and a `false` answer means the seam is
 * never called at all.
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import type { SessionEvent, SessionRunInput } from '../../packages/agent-loop/src/index';
import {
  computeRecipeFingerprint,
  loadRecipe,
  recipePath,
  type Recipe,
} from '@truecourse/guard-runner';
import {
  ecosystemFingerprint,
  runGuardSetup,
  type GuardSetupOptions,
  type GuardSetupSeedSessionInput,
  type SeedDraftDatabase,
} from '@truecourse/guard-generator';
import { FINGERPRINT_INPUTS } from '@truecourse/guard-runner';
import {
  buildSeedSession,
  seedScriptTargetPath,
  seedSessionCacheKey,
  seedSessionDef,
  providesWarnings,
} from '../../packages/core/src/services/guard-setup/seed-session';
import type { GuardSetupSessionContext } from '../../packages/core/src/services/guard-setup/session-context';
import { memoryPersistence, stubDriver, outcome } from './spec-scan-session-stub';

const FIXTURE = fileURLToPath(new URL('../fixtures/seed-draft', import.meta.url));
const TARGET = '.truecourse/scenarios/guard-seed.mjs';

const repos: string[] = [];
afterEach(() => {
  while (repos.length) fs.rmSync(repos.pop()!, { recursive: true, force: true });
});

const DOC = 'docs/orgs.md';

/** The fixture app, copied out, with the corpus setup runs after. */
function fixtureRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-seed-session-'));
  repos.push(dir);
  fs.cpSync(FIXTURE, dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(dir, DOC), '## orgs\nAn org owner can list their orgs.\n');
  const corpus = path.join(dir, '.truecourse', 'specs', 'corpus.json');
  fs.mkdirSync(path.dirname(corpus), { recursive: true });
  fs.writeFileSync(
    corpus,
    JSON.stringify({
      version: 3,
      generatedAt: '2026-01-01T00:00:00Z',
      docs: [{ ref: DOC, kind: 'prd', lastTouched: '', areaTags: [] }],
      areas: [],
      relations: [],
      skippedDocs: [],
    }),
  );
  return dir;
}

/**
 * The recipe the seam runs against. `api.services` up/down are shell one-liners
 * that append to a log, so the world's lifecycle is observable without docker.
 */
function writeRecipe(r: string, over: Record<string, unknown> = {}): void {
  const recipe = {
    build: 'true',
    api: {
      serve: ['node', path.join(r, 'server.mjs')],
      healthPath: '/health',
      env: { SEED_STORE: path.join(r, 'store.json'), SERVICES_LOG: path.join(r, 'services.log') },
      services: {
        up: `printf 'up\\n' >> ${path.join(r, 'services.log')}`,
        down: `printf 'down\\n' >> ${path.join(r, 'services.log')}`,
      },
      ...over,
    },
  };
  const target = recipePath(r);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(recipe, null, 2) + '\n');
}

const recipeOf = (r: string): Recipe => loadRecipe(r, recipePath(r))!.recipe;

const servicesLog = (r: string): string[] => {
  const file = path.join(r, 'services.log');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf-8').trim().split('\n').filter(Boolean);
};

const DATABASE: SeedDraftDatabase = {
  type: 'sqlite',
  driver: 'prisma',
  tables: [
    {
      name: 'Org',
      columns: [
        { name: 'id', type: 'Int', isPrimaryKey: true },
        { name: 'slug', type: 'String', isUnique: true },
      ],
    },
  ],
  relations: [],
  appImports: ["src/db.js: import { PrismaClient } from '@prisma/client'"],
};

function seedInput(r: string, over: Partial<GuardSetupSeedSessionInput> = {}): GuardSetupSeedSessionInput {
  return {
    repoRoot: r,
    recipe: recipeOf(r),
    database: DATABASE,
    routes: [{ method: 'GET', path: '/orgs' }],
    securitySchemes: [],
    roles: [],
    specExcerpts: [],
    ecosystem: 'js',
    replaceExisting: false,
    fingerprint: 'seed-fp-1',
    ...over,
  };
}

/** A seed script that appends `seed` to the services log and writes the manifest. */
function goodScript(): string {
  return [
    '// Idempotent: the store is one JSON document, rewritten wholesale.',
    "import fs from 'node:fs'",
    "fs.appendFileSync(process.env.SERVICES_LOG, 'seed\\n')",
    'const org = { id: 42, slug: "acme" }',
    'fs.writeFileSync(process.env.SEED_STORE, JSON.stringify({ orgs: [org] }))',
    'fs.writeFileSync(process.env.GUARD_SEED_OUT, JSON.stringify({ fixtures: { org } }))',
    '',
  ].join('\n');
}

/** A script that succeeds against an empty store and refuses a second time. */
function nonIdempotentScript(): string {
  return [
    "import fs from 'node:fs'",
    'const prior = fs.existsSync(process.env.SEED_STORE) ? JSON.parse(fs.readFileSync(process.env.SEED_STORE, "utf-8")) : { orgs: [] }',
    'if (prior.orgs.length > 0) { console.error("duplicate key value violates unique constraint \\"Org_slug_key\\""); process.exit(1) }',
    'const org = { id: 42, slug: "acme" }',
    'fs.writeFileSync(process.env.SEED_STORE, JSON.stringify({ orgs: [org] }))',
    'fs.writeFileSync(process.env.GUARD_SEED_OUT, JSON.stringify({ fixtures: { org } }))',
    '',
  ].join('\n');
}

const PROVIDES = { fixtures: { org: ['id', 'slug'] } };
const COMMAND = `node ${TARGET}`;

/** Call a session tool the way a driver does — the tool-result event is what the
 *  shell's outcome precondition reads off the transcript. */
async function callTool(input: SessionRunInput, name: string, args: unknown): Promise<{ content: string; isError?: boolean }> {
  const tool = input.def.tools.find((t) => t.name === name)!;
  const result = await tool.execute(args, {
    workItem: 'seed',
    signal: input.signal,
    dispatchChild: () => {
      throw new Error('not used');
    },
  });
  input.onEvent({ type: 'tool-result', toolName: name, content: result.content, isError: result.isError });
  return result;
}

interface Harness {
  context: GuardSetupSessionContext;
  events: Map<string, SessionEvent[]>;
  acquires: () => number;
  spend: () => number;
}

function harness(driver: ReturnType<typeof stubDriver>['driver'] | null): Harness {
  const persistence = memoryPersistence();
  let acquires = 0;
  let sessions = 0;
  return {
    events: persistence.events,
    acquires: () => acquires,
    spend: () => sessions,
    context: {
      async acquire() {
        acquires++;
        if (!driver) throw new Error('no session should have been started');
        return { runId: 'setup-run-1', driver, persistence: persistence.persistence };
      },
      runId: () => (acquires > 0 ? 'setup-run-1' : undefined),
      note: () => {
        sessions++;
      },
      addSpend: () => {},
      usageTotals: () => null,
      finish: () => {},
    },
  };
}

// ---------------------------------------------------------------------------
// The scratch discipline + the fold
// ---------------------------------------------------------------------------

describe('buildSeedSession — the draft never lands in the repo until the fold', () => {
  it('runs the draft from scratch, then writes the script and patches the recipe', async () => {
    const r = fixtureRepo();
    writeRecipe(r);
    const seen = { targetDuringSession: false, scratchDrafts: [] as string[] };
    const stub = stubDriver(async (call) => {
      await callTool(call.input, 'run_seed_draft', {
        script: goodScript(),
        command: COMMAND,
        provides: PROVIDES,
      });
      seen.targetDuringSession = fs.existsSync(path.join(r, TARGET));
      const scratchRoot = path.join(r, '.truecourse', '.cache', 'guard', 'seed-drafts');
      seen.scratchDrafts = fs.existsSync(scratchRoot)
        ? fs.readdirSync(scratchRoot).flatMap((dir) => fs.readdirSync(path.join(scratchRoot, dir)))
        : [];
      return outcome({ script: goodScript(), command: COMMAND, provides: PROVIDES, findings: [] });
    });
    const h = harness(stub.driver);

    const result = await buildSeedSession(h.context)(seedInput(r));

    // During the session: the draft exists ONLY in scratch.
    expect(seen.targetDuringSession).toBe(false);
    expect(seen.scratchDrafts).toEqual(['draft-1.mjs']);
    // After the fold: both artifacts, at the committed paths.
    expect(result).toMatchObject({ status: 'ok', scriptPath: TARGET, command: COMMAND, fixtures: ['org'] });
    expect(fs.readFileSync(path.join(r, TARGET), 'utf-8')).toBe(goodScript());
    expect(recipeOf(r).api?.seed).toEqual({ command: COMMAND, script: TARGET, provides: PROVIDES });
    // The session's scratch directory is gone with the session.
    expect(fs.readdirSync(path.join(r, '.truecourse', '.cache', 'guard', 'seed-drafts'))).toEqual([]);
  }, 60_000);

  it('proves the fold in a FRESH world — down, up, then the real run', async () => {
    const r = fixtureRepo();
    writeRecipe(r);
    const stub = stubDriver(async (call) => {
      await callTool(call.input, 'run_seed_draft', { script: goodScript(), command: COMMAND, provides: PROVIDES });
      return outcome({ script: goodScript(), command: COMMAND, provides: PROVIDES, findings: [] });
    });

    const result = await buildSeedSession(harness(stub.driver).context)(seedInput(r));

    expect(result.status).toBe('ok');
    // The session's world, its draft run, the teardown — then a world that was
    // booted again for the proof, and torn down after it.
    expect(servicesLog(r)).toEqual(['up', 'seed', 'down', 'up', 'seed', 'down']);
  }, 60_000);

  it('refuses a draft the fresh world will not accept, and restores the tree', async () => {
    const r = fixtureRepo();
    writeRecipe(r);
    const recipeBefore = fs.readFileSync(recipePath(r), 'utf-8');
    const script = nonIdempotentScript();
    const stub = stubDriver(async (call) => {
      // The first run is against a pristine store, so the session sees green…
      const verdict = await callTool(call.input, 'run_seed_draft', { script, command: COMMAND, provides: PROVIDES });
      expect(verdict.isError).toBeUndefined();
      return outcome({ script, command: COMMAND, provides: PROVIDES, findings: [] });
    });

    const result = await buildSeedSession(harness(stub.driver).context)(seedInput(r));

    // …and the fold's fresh-world proof is what catches it.
    expect(result.status).toBe('failed');
    expect(result.status === 'failed' && result.reason).toMatch(/fresh-world proof/);
    expect(result.status === 'failed' && result.reason).toMatch(/Org_slug_key/);
    expect(fs.existsSync(path.join(r, TARGET))).toBe(false);
    expect(fs.readFileSync(recipePath(r), 'utf-8')).toBe(recipeBefore);
  }, 60_000);

  it('refuses to overwrite a file already sitting at the target path', async () => {
    const r = fixtureRepo();
    writeRecipe(r);
    fs.mkdirSync(path.dirname(path.join(r, TARGET)), { recursive: true });
    fs.writeFileSync(path.join(r, TARGET), '// somebody else wrote this\n');
    const stub = stubDriver(async (call) => {
      await callTool(call.input, 'run_seed_draft', { script: goodScript(), command: COMMAND, provides: PROVIDES });
      return outcome({ script: goodScript(), command: COMMAND, provides: PROVIDES, findings: [] });
    });

    const result = await buildSeedSession(harness(stub.driver).context)(seedInput(r));

    expect(result.status).toBe('failed');
    expect(result.status === 'failed' && result.reason).toMatch(/already exists/);
    expect(fs.readFileSync(path.join(r, TARGET), 'utf-8')).toBe('// somebody else wrote this\n');
  }, 60_000);

  it('refuses an outcome whose command does not run the target path', async () => {
    const r = fixtureRepo();
    writeRecipe(r);
    const stub = stubDriver(async (call) => {
      await callTool(call.input, 'run_seed_draft', { script: goodScript(), command: COMMAND, provides: PROVIDES });
      return outcome({ script: goodScript(), command: 'node somewhere/else.mjs', provides: PROVIDES, findings: [] });
    });

    const result = await buildSeedSession(harness(stub.driver).context)(seedInput(r));

    expect(result.status).toBe('failed');
    expect(result.status === 'failed' && result.reason).toMatch(/does not run the target script/);
    expect(fs.existsSync(path.join(r, TARGET))).toBe(false);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Secret hygiene
// ---------------------------------------------------------------------------

describe('buildSeedSession — minted credentials never enter a transcript', () => {
  it('redacts a value the draft minted out of every later tool result', async () => {
    const r = fixtureRepo();
    writeRecipe(r);
    // The secret is COMPUTED by the script, so the only place it exists is the
    // manifest the run harvests — exactly how a real seed mints a token.
    const script = [
      "import fs from 'node:fs'",
      "const token = ['secret', 'xyz'].join('-')",
      'const org = { id: 42, slug: "acme" }',
      'fs.writeFileSync(process.env.SEED_STORE, JSON.stringify({ orgs: [org] }))',
      'fs.writeFileSync(process.env.GUARD_SEED_OUT, JSON.stringify({',
      '  fixtures: { org },',
      '  credentials: { owner: { value: token } },',
      '}))',
      '',
    ].join('\n');
    const provides = {
      fixtures: { org: ['id', 'slug'] },
      credentials: { owner: { header: 'Authorization', description: 'org owner' } },
    };
    // A repo file that happens to carry the same value — the leak channel a
    // growing redactor exists to close.
    fs.writeFileSync(path.join(r, 'notes.txt'), 'the last run left secret-xyz behind\n');

    let readBack = '';
    const stub = stubDriver(async (call) => {
      await callTool(call.input, 'run_seed_draft', { script, command: COMMAND, provides });
      readBack = (await callTool(call.input, 'read_file', { path: 'notes.txt' })).content;
      return outcome({ script, command: COMMAND, provides, findings: [] });
    });
    const h = harness(stub.driver);

    const result = await buildSeedSession(h.context)(seedInput(r));

    expect(result.status).toBe('ok');
    expect(readBack).toContain('«cred:owner»');
    expect(readBack).not.toContain('secret-xyz');
    const transcript = JSON.stringify([...h.events.values()]);
    expect(transcript).not.toContain('secret-xyz');
  }, 60_000);
});

// ---------------------------------------------------------------------------
// The cache — a cached script is a draft to re-prove, never a proof
// ---------------------------------------------------------------------------

describe('buildSeedSession — the cache', () => {
  it('spends no session on a hit, and still proves the seed in a fresh world', async () => {
    const r = fixtureRepo();
    writeRecipe(r);
    const stub = stubDriver(async (call) => {
      await callTool(call.input, 'run_seed_draft', { script: goodScript(), command: COMMAND, provides: PROVIDES });
      return outcome({ script: goodScript(), command: COMMAND, provides: PROVIDES, findings: [] });
    });
    expect((await buildSeedSession(harness(stub.driver).context)(seedInput(r))).status).toBe('ok');
    expect(stub.calls).toHaveLength(1);

    // Undo the WRITE, not the cache: the step would run again, and the only thing
    // that must not be paid for twice is the session.
    fs.rmSync(path.join(r, TARGET));
    writeRecipe(r);
    fs.rmSync(path.join(r, 'services.log'));
    const second = harness(null); // any acquire throws

    const again = await buildSeedSession(second.context)(seedInput(r));

    expect(again).toMatchObject({ status: 'ok', fromCache: true, scriptPath: TARGET });
    expect(second.acquires()).toBe(0);
    // The proof is not cached: a full world cycle ran for it.
    expect(servicesLog(r)).toEqual(['up', 'seed', 'down']);
    expect(fs.existsSync(path.join(r, TARGET))).toBe(true);
  }, 60_000);

  it('keys the outcome on the step fingerprint and the prompt', () => {
    expect(seedSessionCacheKey('seed-fp-1')).not.toBe(seedSessionCacheKey('seed-fp-2'));
    expect(seedSessionCacheKey('seed-fp-1')).toBe(seedSessionCacheKey('seed-fp-1'));
  });
});

// ---------------------------------------------------------------------------
// The session definition + its static half
// ---------------------------------------------------------------------------

describe('the seed session definition', () => {
  it('cannot produce an outcome before the draft ever ran', async () => {
    const r = fixtureRepo();
    writeRecipe(r);
    const def = seedSessionDef({
      input: seedInput(r),
      server: { name: 'default', serve: ['node', 'x'], cwd: 'sandbox', healthPath: '/health', readyTimeoutMs: 1, env: {} },
      targetPath: TARGET,
      scratchDir: path.join(r, 'scratch'),
      knownSchemes: new Set(),
      secrets: new Map(),
    } as never);

    expect(def.kind).toBe('guard-setup.seed');
    expect(def.outcomePrecondition?.tool).toBe('run_seed_draft');
    expect(def.tools.map((t) => t.name).sort()).toEqual([
      'check_provides',
      'db_query',
      'read_file',
      'run_seed_draft',
      'search_repo',
    ]);
  });

  it('warns about the credential shapes that become silent 401s', () => {
    const warnings = providesWarnings(
      {
        credentials: { owner: { header: 'Authorization', satisfies: 'nope' } },
        fixtures: { org: ['id'] },
      },
      { securitySchemes: [{ name: 'bearerAuth', summary: 'JWT' }], roles: [{ name: 'admin', source: 'User.role' }] },
    );

    expect(warnings.join('\n')).toMatch(/not a declared security scheme/);
    expect(warnings.join('\n')).toMatch(/must carry the full header value/);
  });

  it('writes an edit back to the script it is replacing, and a new one to the scenarios dir', () => {
    expect(seedScriptTargetPath({ ecosystem: 'js' })).toBe(TARGET);
    expect(seedScriptTargetPath({ ecosystem: 'python' })).toBe('.truecourse/scenarios/guard_seed.py');
    expect(
      seedScriptTargetPath({ ecosystem: 'js', existingScript: { scriptPath: 'scripts/mine.mjs' } }),
    ).toBe('scripts/mine.mjs');
  });
});

// ---------------------------------------------------------------------------
// The engine half: `--refresh` asks before it replaces
// ---------------------------------------------------------------------------

describe('runGuardSetup — the seed step honors confirmSeedReplace', () => {
  const interfaces = () => async () => ({
    interfaces: [],
    externalServices: [],
    database: DATABASE,
    datastoreUrls: [],
  });

  /** The seed seam, recorded — the question is whether it is reached at all. */
  function recordingSeam() {
    const inputs: GuardSetupSeedSessionInput[] = [];
    return {
      inputs,
      seam: async (input: GuardSetupSeedSessionInput) => {
        inputs.push(input);
        return { status: 'failed' as const, reason: 'stub' };
      },
    };
  }

  function opts(r: string, over: Partial<GuardSetupOptions>): GuardSetupOptions {
    return {
      repoRoot: r,
      interfaces: interfaces(),
      recipeRunner: async () => {
        throw new Error('the recipe runner must not be called');
      },
      probe: async () => [{ server: 'default', path: '/health', status: 200, ok: true }],
      // `--refresh` RE-DERIVES the recipe, and the dependency-free fixture declares
      // no start script the deterministic proposer can read — so the repair session
      // stands in for the model, and the engine still verifies what it returns.
      repair: async () => ({
        proposal: {
          build: 'true',
          api: {
            serve: ['node', path.join(r, 'server.mjs')],
            healthPath: '/health',
            env: { SEED_STORE: path.join(r, 'store.json'), SERVICES_LOG: path.join(r, 'services.log') },
          },
        },
      }),
      ...over,
    };
  }

  it('never reaches the seam when the replacement is declined', async () => {
    const r = fixtureRepo();
    writeRecipe(r, { seed: { command: 'node mine.mjs', provides: { fixtures: { org: ['id'] } } } });
    fs.writeFileSync(path.join(r, 'mine.mjs'), '// hand written\n');
    const seed = recordingSeam();

    const { report } = await runGuardSetup(
      opts(r, { refresh: true, confirmSeedReplace: async () => false, seedSession: seed.seam }),
    );

    expect(seed.inputs).toHaveLength(0);
    expect(report.seed?.status).toBe('skipped');
    expect(report.seed?.reason).toMatch(/replacing it was not confirmed/);
    expect(fs.readFileSync(path.join(r, 'mine.mjs'), 'utf-8')).toBe('// hand written\n');
  }, 120_000);

  it('passes the confirmation and the script being replaced into the seam', async () => {
    const r = fixtureRepo();
    writeRecipe(r, {
      seed: { command: 'node mine.mjs', script: 'mine.mjs', provides: { fixtures: { org: ['id'] } } },
    });
    fs.writeFileSync(path.join(r, 'mine.mjs'), '// hand written\n');
    const seed = recordingSeam();

    await runGuardSetup(
      opts(r, { refresh: true, confirmSeedReplace: async () => true, seedSession: seed.seam }),
    );

    expect(seed.inputs).toHaveLength(1);
    expect(seed.inputs[0].replaceExisting).toBe(true);
    expect(seed.inputs[0].existingScript).toEqual({
      scriptPath: 'mine.mjs',
      scriptContent: '// hand written\n',
    });
    // The step's cache key is the fingerprint the engine computed for it.
    expect(seed.inputs[0].fingerprint).toHaveLength(64);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Root-cause cleanup (plan 03, subpoint 6): one FINGERPRINT_INPUTS list
// ---------------------------------------------------------------------------

describe('ecosystemFingerprint', () => {
  // `FINGERPRINT_INPUTS` used to be mirrored privately in two packages. It is
  // exported now, and this pins that the setup step really hashes THAT list —
  // path-tagged, present files only, and never the recipe (whose own edits are
  // the step's OUTPUT, not its subject).
  it('is the runner’s own input list, hashed directly', () => {
    const r = fixtureRepo();
    writeRecipe(r);
    fs.writeFileSync(path.join(r, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');

    const expected = createHash('sha256');
    for (const rel of FINGERPRINT_INPUTS) {
      const abs = path.join(r, rel);
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
      expected.update(rel);
      expected.update('\0');
      expected.update(fs.readFileSync(abs));
      expected.update('\0');
    }

    expect(ecosystemFingerprint(r)).toBe(expected.digest('hex'));
    // The recipe is folded by `computeRecipeFingerprint`, never here.
    const before = ecosystemFingerprint(r);
    writeRecipe(r, { readyTimeoutMs: 9000 });
    expect(ecosystemFingerprint(r)).toBe(before);
    expect(computeRecipeFingerprint(r)).not.toBe(before);
  });
});
