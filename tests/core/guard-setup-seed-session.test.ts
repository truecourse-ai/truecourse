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
  collectProbeCandidates,
  ecosystemFingerprint,
  runGuardSetup,
  type GuardSetupOptions,
  type GuardSetupSeedSessionInput,
  type SeedDraftDatabase,
} from '@truecourse/guard-generator';
import { FINGERPRINT_INPUTS } from '@truecourse/guard-runner';
import {
  buildSeedSession,
  existingSeedMachinery,
  missingPrincipalSurfaces,
  requiredPrincipalSurfaces,
  seedScriptTargetPath,
  seedSessionBriefing,
  seedSessionCacheKey,
  seedSessionDef,
  providesWarnings,
} from '../../packages/core/src/services/guard-setup/seed-session';
import type { GuardSetupSessionContext } from '../../packages/core/src/services/guard-setup/session-context';
import { memoryPersistence, stubDriver, outcome, malformedFailure } from './spec-scan-session-stub';

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
function writeRecipe(r: string, over: Record<string, unknown> = {}, top: Record<string, unknown> = {}): void {
  const recipe = {
    build: 'true',
    ...top,
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

/** DATABASE plus a login-principal table — the web surface's "this app
 *  authenticates" evidence. */
const PRINCIPAL_DATABASE: SeedDraftDatabase = {
  ...DATABASE,
  tables: [
    ...DATABASE.tables,
    {
      name: 'User',
      columns: [
        { name: 'id', type: 'Int', isPrimaryKey: true },
        { name: 'email', type: 'String', isUnique: true },
        { name: 'password', type: 'String' },
      ],
    },
  ],
};

/** A recipe `web` block serving the fixture app's web routes (same server). */
const webBlock = (r: string) => ({
  web: {
    serve: ['node', path.join(r, 'server.mjs')],
    healthPath: '/signin',
    env: { SEED_STORE: path.join(r, 'store.json') },
  },
});

function seedInput(r: string, over: Partial<GuardSetupSeedSessionInput> = {}): GuardSetupSeedSessionInput {
  return {
    repoRoot: r,
    recipe: recipeOf(r),
    database: DATABASE,
    routes: [{ method: 'GET', path: '/orgs' }],
    securitySchemes: [],
    probeCandidates: [],
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
// The app is built before anything boots it
// (2026-08-24 bench, cal.diy: the draft verified but the credential probe was
// dead on a missing dist — the checkout had never run `recipe.build`, and a
// heavy-build repo cannot self-rescue from inside the session)
// ---------------------------------------------------------------------------

describe('buildSeedSession — builds the app before the world boots', () => {
  it('runs `recipe.build` once, before services.up', async () => {
    const r = fixtureRepo();
    writeRecipe(r, {}, { build: `printf 'build\\n' >> ${path.join(r, 'services.log')}` });
    const stub = stubDriver(async (call) => {
      await callTool(call.input, 'run_seed_draft', { script: goodScript(), command: COMMAND, provides: PROVIDES });
      return outcome({ script: goodScript(), command: COMMAND, provides: PROVIDES, findings: [] });
    });

    const result = await buildSeedSession(harness(stub.driver).context)(seedInput(r));

    expect(result.status).toBe('ok');
    // ONE build, then the session's world, then the fold's fresh world — the
    // fold resets the datastore, never the app binary.
    expect(servicesLog(r)).toEqual(['build', 'up', 'seed', 'down', 'up', 'seed', 'down']);
  }, 60_000);

  it('fails the step honestly when the build fails, before any session starts', async () => {
    const r = fixtureRepo();
    writeRecipe(r, {}, { build: "printf 'tsc: dist is on fire\\n' >&2 && false" });
    const h = harness(null); // any session start throws

    const result = await buildSeedSession(h.context)(seedInput(r));

    expect(result.status).toBe('failed');
    expect(result.status === 'failed' && result.reason).toMatch(/`build` failed/);
    expect(result.status === 'failed' && result.reason).toMatch(/dist is on fire/);
    expect(h.acquires()).toBe(0);
    expect(servicesLog(r)).toEqual([]);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Credential probes — a minted credential proves itself against the live server
// (2026-08-23 bench: a `Bearer `-prefixed token sailed through two runs because
// the verify never made an authenticated request)
// ---------------------------------------------------------------------------

/** A script that mints a token into the store (what the server checks) AND the
 *  manifest (what the runner injects) — `emitted` lets a test drift the two. */
function mintingScript(stored = 'tok-guard-1', emitted = stored): string {
  return [
    '// Idempotent: the store is one JSON document, rewritten wholesale.',
    "import fs from 'node:fs'",
    'const org = { id: 42, slug: "acme" }',
    `fs.writeFileSync(process.env.SEED_STORE, JSON.stringify({ orgs: [org], tokens: [${JSON.stringify(stored)}] }))`,
    'fs.writeFileSync(process.env.GUARD_SEED_OUT, JSON.stringify({',
    '  fixtures: { org },',
    `  credentials: { owner: { value: ${JSON.stringify(emitted)} } },`,
    '}))',
    '',
  ].join('\n');
}

const MINT_PROVIDES = {
  fixtures: { org: ['id', 'slug'] },
  credentials: { owner: { header: 'Authorization', description: 'org owner' } },
};
const PROBES = { owner: { path: '/me' } };

describe('buildSeedSession — credential probes', () => {
  it('refuses a draft that mints credentials without declaring probes', async () => {
    const r = fixtureRepo();
    writeRecipe(r);
    const stub = stubDriver(async (call) => {
      const refusal = await callTool(call.input, 'run_seed_draft', {
        script: mintingScript(),
        command: COMMAND,
        provides: MINT_PROVIDES,
      });
      expect(refusal.isError).toBe(true);
      expect(refusal.content).toMatch(/probes/);
      expect(refusal.content).toMatch(/owner/);
      // Comply, so the session ends green and nothing else is under test here.
      await callTool(call.input, 'run_seed_draft', {
        script: mintingScript(),
        command: COMMAND,
        provides: MINT_PROVIDES,
        probes: PROBES,
      });
      return outcome({ script: mintingScript(), command: COMMAND, provides: MINT_PROVIDES, probes: PROBES, findings: [] });
    });

    const result = await buildSeedSession(harness(stub.driver).context)(seedInput(r));
    expect(result.status).toBe('ok');
  }, 60_000);

  it('proves a minted credential against the live server, in-session and at the fold', async () => {
    const r = fixtureRepo();
    writeRecipe(r);
    const stub = stubDriver(async (call) => {
      const verdict = await callTool(call.input, 'run_seed_draft', {
        script: mintingScript(),
        command: COMMAND,
        provides: MINT_PROVIDES,
        probes: PROBES,
      });
      expect(verdict.isError).toBeUndefined();
      expect(verdict.content).toMatch(/probe/i);
      return outcome({ script: mintingScript(), command: COMMAND, provides: MINT_PROVIDES, probes: PROBES, findings: [] });
    });

    const result = await buildSeedSession(harness(stub.driver).context)(seedInput(r));

    expect(result).toMatchObject({ status: 'ok', scriptPath: TARGET, credentials: ['owner'] });
    // The probes are session-side verification, never part of the committed recipe.
    expect(recipeOf(r).api?.seed).toEqual({ command: COMMAND, script: TARGET, provides: MINT_PROVIDES });
  }, 60_000);

  it('fails the probe when the minted value does not authenticate (the Bearer drift)', async () => {
    const r = fixtureRepo();
    writeRecipe(r);
    const stub = stubDriver(async (call) => {
      // The store holds the raw token; the manifest emits a `Bearer `-prefixed
      // value the server matches VERBATIM — exactly the 2026-08-23 incident.
      const refusal = await callTool(call.input, 'run_seed_draft', {
        script: mintingScript('tok-guard-1', 'Bearer tok-guard-1'),
        command: COMMAND,
        provides: MINT_PROVIDES,
        probes: PROBES,
      });
      expect(refusal.isError).toBe(true);
      expect(refusal.content).toMatch(/401|refused/);
      // Fix the drift and finish green.
      await callTool(call.input, 'run_seed_draft', {
        script: mintingScript(),
        command: COMMAND,
        provides: MINT_PROVIDES,
        probes: PROBES,
      });
      return outcome({ script: mintingScript(), command: COMMAND, provides: MINT_PROVIDES, probes: PROBES, findings: [] });
    });

    const result = await buildSeedSession(harness(stub.driver).context)(seedInput(r));
    expect(result.status).toBe('ok');
  }, 60_000);

  it('refuses a probe endpoint that answers without the credential', async () => {
    const r = fixtureRepo();
    writeRecipe(r);
    const stub = stubDriver(async (call) => {
      const refusal = await callTool(call.input, 'run_seed_draft', {
        script: mintingScript(),
        command: COMMAND,
        provides: MINT_PROVIDES,
        probes: { owner: { path: '/orgs' } },
      });
      expect(refusal.isError).toBe(true);
      expect(refusal.content).toMatch(/does not gate/);
      await callTool(call.input, 'run_seed_draft', {
        script: mintingScript(),
        command: COMMAND,
        provides: MINT_PROVIDES,
        probes: PROBES,
      });
      return outcome({ script: mintingScript(), command: COMMAND, provides: MINT_PROVIDES, probes: PROBES, findings: [] });
    });

    const result = await buildSeedSession(harness(stub.driver).context)(seedInput(r));
    expect(result.status).toBe('ok');
  }, 60_000);

  it('the fold refuses an outcome whose credentials carry no probes, and restores the tree', async () => {
    const r = fixtureRepo();
    writeRecipe(r);
    const recipeBefore = fs.readFileSync(recipePath(r), 'utf-8');
    const stub = stubDriver(async (call) => {
      await callTool(call.input, 'run_seed_draft', {
        script: mintingScript(),
        command: COMMAND,
        provides: MINT_PROVIDES,
        probes: PROBES,
      });
      // The outcome drops the probes — the fold must not accept unproven credentials.
      return outcome({ script: mintingScript(), command: COMMAND, provides: MINT_PROVIDES, findings: [] });
    });

    const result = await buildSeedSession(harness(stub.driver).context)(seedInput(r));

    expect(result.status).toBe('failed');
    expect(result.status === 'failed' && result.reason).toMatch(/probe/);
    expect(fs.existsSync(path.join(r, TARGET))).toBe(false);
    expect(fs.readFileSync(recipePath(r), 'utf-8')).toBe(recipeBefore);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// The binding fitness check — a runnable surface that authenticates gets a
// probed principal, or the step fails naming it
// (2026-08-27 documenso: a seed declaring ZERO credentials matched its own
// empty `provides` trivially, and 34% of the next generate blocked on auth)
// ---------------------------------------------------------------------------

describe('buildSeedSession — every authenticating surface must get a probed principal', () => {
  const SCHEMES = [{ name: 'bearerAuth', summary: 'http bearer' }];

  it('refuses a fixtures-only draft when the api declares security schemes, then passes once principals land', async () => {
    const r = fixtureRepo();
    writeRecipe(r);
    const stub = stubDriver(async (call) => {
      const refusal = await callTool(call.input, 'run_seed_draft', {
        script: goodScript(),
        command: COMMAND,
        provides: PROVIDES,
      });
      expect(refusal.isError).toBe(true);
      expect(refusal.content).toMatch(/api surface requires an authenticated principal/);
      expect(refusal.content).toMatch(/bearerAuth/);
      await callTool(call.input, 'run_seed_draft', {
        script: mintingScript(),
        command: COMMAND,
        provides: MINT_PROVIDES,
        probes: PROBES,
      });
      return outcome({ script: mintingScript(), command: COMMAND, provides: MINT_PROVIDES, probes: PROBES, findings: [] });
    });

    const result = await buildSeedSession(harness(stub.driver).context)(
      seedInput(r, { securitySchemes: SCHEMES }),
    );
    expect(result).toMatchObject({ status: 'ok', credentials: ['owner'] });
  }, 60_000);

  it('the fold refuses an outcome that dropped the principals, naming the surface, and restores the tree', async () => {
    const r = fixtureRepo();
    writeRecipe(r);
    const recipeBefore = fs.readFileSync(recipePath(r), 'utf-8');
    const stub = stubDriver(async (call) => {
      await callTool(call.input, 'run_seed_draft', {
        script: mintingScript(),
        command: COMMAND,
        provides: MINT_PROVIDES,
        probes: PROBES,
      });
      // The outcome keeps only the fixtures — exactly the declaration gap the
      // check exists to refuse.
      return outcome({ script: goodScript(), command: COMMAND, provides: PROVIDES, findings: [] });
    });

    const result = await buildSeedSession(harness(stub.driver).context)(
      seedInput(r, { securitySchemes: SCHEMES }),
    );

    expect(result.status).toBe('failed');
    expect(result.status === 'failed' && result.reason).toMatch(/api surface requires an authenticated principal/);
    expect(fs.existsSync(path.join(r, TARGET))).toBe(false);
    expect(fs.readFileSync(recipePath(r), 'utf-8')).toBe(recipeBefore);
  }, 60_000);

  it('a budget death after the principal draft salvages a seed WITH principals', async () => {
    const r = fixtureRepo();
    writeRecipe(r);
    const stub = stubDriver(async (call) => {
      const verdict = await callTool(call.input, 'run_seed_draft', {
        script: mintingScript(),
        command: COMMAND,
        provides: MINT_PROVIDES,
        probes: PROBES,
      });
      expect(verdict.isError).toBeUndefined();
      return malformedFailure('budget exhausted after the principal draft');
    });

    const result = await buildSeedSession(harness(stub.driver).context)(
      seedInput(r, { securitySchemes: SCHEMES }),
    );
    expect(result).toMatchObject({ status: 'ok', salvaged: true, credentials: ['owner'] });
  }, 60_000);

  it('a session that never got past fixtures salvages nothing — the step fails', async () => {
    const r = fixtureRepo();
    writeRecipe(r);
    const stub = stubDriver(async (call) => {
      const refusal = await callTool(call.input, 'run_seed_draft', {
        script: goodScript(),
        command: COMMAND,
        provides: PROVIDES,
      });
      expect(refusal.isError).toBe(true);
      return malformedFailure('budget exhausted with only a fixtures draft');
    });

    const result = await buildSeedSession(harness(stub.driver).context)(
      seedInput(r, { securitySchemes: SCHEMES }),
    );
    expect(result.status).toBe('failed');
    expect(fs.existsSync(path.join(r, TARGET))).toBe(false);
  }, 60_000);

  it('a genuinely unauthenticated API still passes with a fixtures-only seed', async () => {
    const r = fixtureRepo();
    writeRecipe(r);
    const stub = stubDriver(async (call) => {
      const verdict = await callTool(call.input, 'run_seed_draft', {
        script: goodScript(),
        command: COMMAND,
        provides: PROVIDES,
      });
      expect(verdict.isError).toBeUndefined();
      return outcome({ script: goodScript(), command: COMMAND, provides: PROVIDES, findings: [] });
    });

    // No security schemes, no roles, no login table: nothing requires a principal.
    const result = await buildSeedSession(harness(stub.driver).context)(seedInput(r));
    expect(result).toMatchObject({ status: 'ok', fixtures: ['org'] });
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Web principals — a prepared `recipe.web` on an app with logins means a
// browser-session principal, proven by an authenticated page load
// ---------------------------------------------------------------------------

/** Mints a user (login fields → fixture) and a durable session (cookie →
 *  credential). `emitted` lets a test drift the manifest cookie from the store;
 *  `storedPassword` drifts the STORED secret from the published one — the
 *  stale-world shape the login probe exists to refuse. */
function webMintingScript(stored = 'session=tok-web-1', emitted = stored, storedPassword = 'pw-guard-1'): string {
  return [
    '// Idempotent: the store is one JSON document, rewritten wholesale.',
    "import fs from 'node:fs'",
    `const user = { id: 7, email: "owner@acme.test", password: ${JSON.stringify(storedPassword)} }`,
    'const org = { id: 42, slug: "acme" }',
    `fs.writeFileSync(process.env.SEED_STORE, JSON.stringify({ orgs: [org], users: [user], sessions: [${JSON.stringify(stored)}] }))`,
    'fs.writeFileSync(process.env.GUARD_SEED_OUT, JSON.stringify({',
    '  fixtures: { org: { id: org.id, slug: org.slug }, webUser: { email: user.email, password: "pw-guard-1" } },',
    `  credentials: { webSession: { value: ${JSON.stringify(emitted)} } },`,
    '}))',
    '',
  ].join('\n');
}

const WEB_PROVIDES = {
  fixtures: { org: ['id', 'slug'], webUser: ['email', 'password'] },
  credentials: { webSession: { header: 'Cookie', description: 'signed-in browser session' } },
};
const WEB_LOGIN = {
  path: '/api/login',
  body: { email: '{{fixture:webUser.email}}', password: '{{fixture:webUser.password}}' },
};
const WEB_PROBES = { webSession: { surface: 'web', path: '/dashboard', login: WEB_LOGIN } };

describe('buildSeedSession — web principals prove themselves by an authenticated page load', () => {
  it('proves the session cookie against the booted web surface, in-session and at the fold', async () => {
    const r = fixtureRepo();
    writeRecipe(r, {}, webBlock(r));
    const stub = stubDriver(async (call) => {
      const verdict = await callTool(call.input, 'run_seed_draft', {
        script: webMintingScript(),
        command: COMMAND,
        provides: WEB_PROVIDES,
        probes: WEB_PROBES,
      });
      expect(verdict.isError).toBeUndefined();
      expect(verdict.content).toMatch(/probes passed/);
      expect(verdict.content).toMatch(/dashboard/);
      // The login proof ran first, with the published fixture values.
      expect(verdict.content).toMatch(/login POST \/api\/login → 200/);
      return outcome({ script: webMintingScript(), command: COMMAND, provides: WEB_PROVIDES, probes: WEB_PROBES, findings: [] });
    });

    const result = await buildSeedSession(harness(stub.driver).context)(
      seedInput(r, { database: PRINCIPAL_DATABASE }),
    );

    expect(result).toMatchObject({
      status: 'ok',
      credentials: ['webSession'],
      fixtures: ['org', 'webUser'],
    });
  }, 60_000);

  // The documenso idiom: session routes answer an ANONYMOUS request with HTTP
  // 500 (an UNAUTHORIZED body), not 401/403 or a redirect — any non-2xx is the
  // anonymous refusal when the credentialed request was accepted.
  it('accepts a gate whose anonymous refusal is a 500, not 401/403', async () => {
    const r = fixtureRepo();
    writeRecipe(r, {}, webBlock(r));
    const probes = { webSession: { surface: 'web', path: '/dashboard-500', login: WEB_LOGIN } };
    const stub = stubDriver(async (call) => {
      const verdict = await callTool(call.input, 'run_seed_draft', {
        script: webMintingScript(),
        command: COMMAND,
        provides: WEB_PROVIDES,
        probes,
      });
      expect(verdict.isError).toBeUndefined();
      expect(verdict.content).toMatch(/dashboard-500 → 200 with the credential, 500 without/);
      return outcome({ script: webMintingScript(), command: COMMAND, provides: WEB_PROVIDES, probes, findings: [] });
    });

    const result = await buildSeedSession(harness(stub.driver).context)(
      seedInput(r, { database: PRINCIPAL_DATABASE }),
    );
    expect(result).toMatchObject({ status: 'ok', credentials: ['webSession'] });
  }, 60_000);

  // The documenso shape (2026-08-30): the login route compares body.csrfToken
  // to a cookie the mint route set — a static token can never pass, the engine
  // must run the two-step itself, fresh, before each POST.
  it('runs the declared csrf two-step — mint, cookie, injected token — before each login POST', async () => {
    const r = fixtureRepo();
    writeRecipe(r, {}, webBlock(r));
    const csrfLogin = { ...WEB_LOGIN, path: '/api/login-csrf', csrf: { path: '/api/csrf' } };
    const probes = { webSession: { surface: 'web', path: '/dashboard', login: csrfLogin } };
    const stub = stubDriver(async (call) => {
      const verdict = await callTool(call.input, 'run_seed_draft', {
        script: webMintingScript(),
        command: COMMAND,
        provides: WEB_PROVIDES,
        probes,
      });
      expect(verdict.isError).toBeUndefined();
      // The accepted POST carried a fresh minted token; the control's fresh
      // token still rode along, so the 401 is the PASSWORD refusal, not csrf.
      expect(verdict.content).toMatch(/login POST \/api\/login-csrf → 200/);
      expect(verdict.content).toMatch(/401 with a corrupted password/);
      return outcome({ script: webMintingScript(), command: COMMAND, provides: WEB_PROVIDES, probes, findings: [] });
    });

    const result = await buildSeedSession(harness(stub.driver).context)(
      seedInput(r, { database: PRINCIPAL_DATABASE }),
    );
    expect(result).toMatchObject({ status: 'ok', credentials: ['webSession'] });
  }, 60_000);

  it('a csrf-guarded endpoint without the declaration is refused, steering to `login.csrf`', async () => {
    const r = fixtureRepo();
    writeRecipe(r, {}, webBlock(r));
    const bare = { ...WEB_LOGIN, path: '/api/login-csrf' };
    const stub = stubDriver(async (call) => {
      const verdict = await callTool(call.input, 'run_seed_draft', {
        script: webMintingScript(),
        command: COMMAND,
        provides: WEB_PROVIDES,
        probes: { webSession: { surface: 'web', path: '/dashboard', login: bare } },
      });
      expect(verdict.isError).toBe(true);
      expect(verdict.content).toMatch(/HTTP 500/);
      expect(verdict.content).toMatch(/login\.csrf/);
      return outcome({
        script: webMintingScript(),
        command: COMMAND,
        provides: WEB_PROVIDES,
        probes: { webSession: { surface: 'web', path: '/dashboard', login: { ...bare, csrf: { path: '/api/csrf' } } } },
        findings: [],
      });
    });

    const result = await buildSeedSession(harness(stub.driver).context)(
      seedInput(r, { database: PRINCIPAL_DATABASE }),
    );
    expect(result.status).toBe('ok');
  }, 60_000);

  it('refuses a published password the login endpoint rejects (the stale-world drift)', async () => {
    const r = fixtureRepo();
    writeRecipe(r, {}, webBlock(r));
    const stub = stubDriver(async (call) => {
      // The store holds an OLDER run's password; the manifest publishes the new
      // one. The cookie still validates — only the login probe can catch this.
      const refusal = await callTool(call.input, 'run_seed_draft', {
        script: webMintingScript('session=tok-web-1', 'session=tok-web-1', 'stale-pw'),
        command: COMMAND,
        provides: WEB_PROVIDES,
        probes: WEB_PROBES,
      });
      expect(refusal.isError).toBe(true);
      expect(refusal.content).toMatch(/refused the PUBLISHED fixture credentials/);
      expect(refusal.content).toMatch(/CONVERGE/);
      await callTool(call.input, 'run_seed_draft', {
        script: webMintingScript(),
        command: COMMAND,
        provides: WEB_PROVIDES,
        probes: WEB_PROBES,
      });
      return outcome({ script: webMintingScript(), command: COMMAND, provides: WEB_PROVIDES, probes: WEB_PROBES, findings: [] });
    });

    const result = await buildSeedSession(harness(stub.driver).context)(
      seedInput(r, { database: PRINCIPAL_DATABASE }),
    );
    expect(result.status).toBe('ok');
  }, 60_000);

  it('refuses a login endpoint that accepts a corrupted secret', async () => {
    const r = fixtureRepo();
    writeRecipe(r, {}, webBlock(r));
    const stub = stubDriver(async (call) => {
      const refusal = await callTool(call.input, 'run_seed_draft', {
        script: webMintingScript(),
        command: COMMAND,
        provides: WEB_PROVIDES,
        probes: { webSession: { surface: 'web', path: '/dashboard', login: { ...WEB_LOGIN, path: '/api/login-always' } } },
      });
      expect(refusal.isError).toBe(true);
      expect(refusal.content).toMatch(/corrupted/);
      await callTool(call.input, 'run_seed_draft', {
        script: webMintingScript(),
        command: COMMAND,
        provides: WEB_PROVIDES,
        probes: WEB_PROBES,
      });
      return outcome({ script: webMintingScript(), command: COMMAND, provides: WEB_PROVIDES, probes: WEB_PROBES, findings: [] });
    });

    const result = await buildSeedSession(harness(stub.driver).context)(
      seedInput(r, { database: PRINCIPAL_DATABASE }),
    );
    expect(result.status).toBe('ok');
  }, 60_000);

  it('refuses a required web principal whose probe carries no login proof, before running', async () => {
    const r = fixtureRepo();
    writeRecipe(r, {}, webBlock(r));
    const stub = stubDriver(async (call) => {
      const refusal = await callTool(call.input, 'run_seed_draft', {
        script: webMintingScript(),
        command: COMMAND,
        provides: WEB_PROVIDES,
        probes: { webSession: { surface: 'web', path: '/dashboard' } },
      });
      expect(refusal.isError).toBe(true);
      expect(refusal.content).toMatch(/login/);
      await callTool(call.input, 'run_seed_draft', {
        script: webMintingScript(),
        command: COMMAND,
        provides: WEB_PROVIDES,
        probes: WEB_PROBES,
      });
      return outcome({ script: webMintingScript(), command: COMMAND, provides: WEB_PROVIDES, probes: WEB_PROBES, findings: [] });
    });

    const result = await buildSeedSession(harness(stub.driver).context)(
      seedInput(r, { database: PRINCIPAL_DATABASE }),
    );
    expect(result.status).toBe('ok');
  }, 60_000);

  it('refuses a session value the web surface redirects to the login page', async () => {
    const r = fixtureRepo();
    writeRecipe(r, {}, webBlock(r));
    const stub = stubDriver(async (call) => {
      const refusal = await callTool(call.input, 'run_seed_draft', {
        script: webMintingScript('session=tok-web-1', 'session=WRONG'),
        command: COMMAND,
        provides: WEB_PROVIDES,
        probes: WEB_PROBES,
      });
      expect(refusal.isError).toBe(true);
      expect(refusal.content).toMatch(/did not authenticate the web surface/);
      await callTool(call.input, 'run_seed_draft', {
        script: webMintingScript(),
        command: COMMAND,
        provides: WEB_PROVIDES,
        probes: WEB_PROBES,
      });
      return outcome({ script: webMintingScript(), command: COMMAND, provides: WEB_PROVIDES, probes: WEB_PROBES, findings: [] });
    });

    const result = await buildSeedSession(harness(stub.driver).context)(
      seedInput(r, { database: PRINCIPAL_DATABASE }),
    );
    expect(result.status).toBe('ok');
  }, 60_000);

  it('refuses a probe page an anonymous load can reach', async () => {
    const r = fixtureRepo();
    writeRecipe(r, {}, webBlock(r));
    const stub = stubDriver(async (call) => {
      const refusal = await callTool(call.input, 'run_seed_draft', {
        script: webMintingScript(),
        command: COMMAND,
        provides: WEB_PROVIDES,
        probes: { webSession: { surface: 'web', path: '/signin', login: WEB_LOGIN } },
      });
      expect(refusal.isError).toBe(true);
      expect(refusal.content).toMatch(/does not gate/);
      expect(refusal.content).toMatch(/signed-in/);
      await callTool(call.input, 'run_seed_draft', {
        script: webMintingScript(),
        command: COMMAND,
        provides: WEB_PROVIDES,
        probes: WEB_PROBES,
      });
      return outcome({ script: webMintingScript(), command: COMMAND, provides: WEB_PROVIDES, probes: WEB_PROBES, findings: [] });
    });

    const result = await buildSeedSession(harness(stub.driver).context)(
      seedInput(r, { database: PRINCIPAL_DATABASE }),
    );
    expect(result.status).toBe('ok');
  }, 60_000);

  it('refuses a `surface: "web"` probe when the recipe prepares no web surface', async () => {
    const r = fixtureRepo();
    writeRecipe(r); // no `web` block
    const stub = stubDriver(async (call) => {
      const refusal = await callTool(call.input, 'run_seed_draft', {
        script: webMintingScript(),
        command: COMMAND,
        provides: WEB_PROVIDES,
        probes: WEB_PROBES,
      });
      expect(refusal.isError).toBe(true);
      expect(refusal.content).toMatch(/no `web` block/);
      await callTool(call.input, 'run_seed_draft', { script: goodScript(), command: COMMAND, provides: PROVIDES });
      return outcome({ script: goodScript(), command: COMMAND, provides: PROVIDES, findings: [] });
    });

    const result = await buildSeedSession(harness(stub.driver).context)(seedInput(r));
    expect(result.status).toBe('ok');
  }, 60_000);

  it('the fold refuses an outcome whose probes abandon the required web surface', async () => {
    const r = fixtureRepo();
    writeRecipe(r, {}, webBlock(r));
    const recipeBefore = fs.readFileSync(recipePath(r), 'utf-8');
    const stub = stubDriver(async (call) => {
      await callTool(call.input, 'run_seed_draft', {
        script: webMintingScript(),
        command: COMMAND,
        provides: WEB_PROVIDES,
        probes: WEB_PROBES,
      });
      // The outcome re-declares the probe as an api one — the web surface is
      // left with no proven principal.
      return outcome({
        script: webMintingScript(),
        command: COMMAND,
        provides: WEB_PROVIDES,
        probes: { webSession: { path: '/me' } },
        findings: [],
      });
    });

    const result = await buildSeedSession(harness(stub.driver).context)(
      seedInput(r, { database: PRINCIPAL_DATABASE }),
    );

    expect(result.status).toBe('failed');
    expect(result.status === 'failed' && result.reason).toMatch(/web surface requires an authenticated principal/);
    expect(fs.readFileSync(recipePath(r), 'utf-8')).toBe(recipeBefore);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Salvage — a draft the tool itself verified is an implicit outcome
// (2026-08-23 bench: the session died budget-exhausted holding a draft the
// engine had ALREADY run and verified, and the engine threw it away)
// ---------------------------------------------------------------------------

describe('buildSeedSession — salvages the last verified draft when the session dies', () => {
  it('folds the verified draft after a session failure, marked salvaged', async () => {
    const r = fixtureRepo();
    writeRecipe(r);
    const stub = stubDriver(async (call) => {
      const verdict = await callTool(call.input, 'run_seed_draft', {
        script: goodScript(),
        command: COMMAND,
        provides: PROVIDES,
      });
      expect(verdict.isError).toBeUndefined();
      // The session dies without ever producing the outcome — the incident shape.
      return malformedFailure('the model never produced an outcome');
    });

    const result = await buildSeedSession(harness(stub.driver).context)(seedInput(r));

    expect(result).toMatchObject({ status: 'ok', scriptPath: TARGET, command: COMMAND, salvaged: true });
    expect(fs.readFileSync(path.join(r, TARGET), 'utf-8')).toBe(goodScript());
    expect(recipeOf(r).api?.seed).toEqual({ command: COMMAND, script: TARGET, provides: PROVIDES });
    // The salvaged draft still went through the fresh-world proof.
    expect(servicesLog(r)).toEqual(['up', 'seed', 'down', 'up', 'seed', 'down']);
  }, 60_000);

  it('does not salvage a draft that never verified', async () => {
    const r = fixtureRepo();
    writeRecipe(r);
    const stub = stubDriver(async (call) => {
      const verdict = await callTool(call.input, 'run_seed_draft', {
        script: 'throw new Error("boom")',
        command: COMMAND,
        provides: PROVIDES,
      });
      expect(verdict.isError).toBe(true);
      return malformedFailure();
    });

    const result = await buildSeedSession(harness(stub.driver).context)(seedInput(r));

    expect(result.status).toBe('failed');
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
      'fs.writeFileSync(process.env.SEED_STORE, JSON.stringify({ orgs: [org], tokens: [token] }))',
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
      await callTool(call.input, 'run_seed_draft', { script, command: COMMAND, provides, probes: PROBES });
      readBack = (await callTool(call.input, 'read_file', { path: 'notes.txt' })).content;
      return outcome({ script, command: COMMAND, provides, probes: PROBES, findings: [] });
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
    // The item-118 checkpoint, extended to the seed session (2026-08-23 bench:
    // two sessions spent their whole first grant exploring with zero drafts).
    expect(def.draftCheckpoint).toMatchObject({ tool: 'run_seed_draft', afterTurn: 10 });
    expect(def.draftCheckpoint?.message).toMatch(/run_seed_draft/);
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
// The briefing carries the repo's own seed machinery
// (2026-08-23 bench: both sessions spent ~10 turns re-finding the app's seed
// helpers by search — grounding every session must read is briefing material)
// ---------------------------------------------------------------------------

describe('seedSessionBriefing — the repository’s own seed machinery', () => {
  const worldFor = (r: string) =>
    ({
      input: seedInput(r),
      server: { name: 'default', serve: ['node', 'x'], cwd: 'sandbox', healthPath: '/health', readyTimeoutMs: 1, env: {} },
      targetPath: TARGET,
      scratchDir: path.join(r, 'scratch'),
      knownSchemes: new Set(),
      secrets: new Map(),
    }) as never;

  it('lists and excerpts seed-named files, skipping dependency dirs', () => {
    const r = fixtureRepo();
    writeRecipe(r);
    fs.mkdirSync(path.join(r, 'packages/prisma/seed'), { recursive: true });
    fs.writeFileSync(
      path.join(r, 'packages/prisma/seed/users.ts'),
      'export const seedUser = async () => {};\n',
    );
    fs.writeFileSync(path.join(r, 'packages/prisma/seed.ts'), 'export const main = 1;\n');
    fs.mkdirSync(path.join(r, 'node_modules/dep/seed'), { recursive: true });
    fs.writeFileSync(path.join(r, 'node_modules/dep/seed/index.js'), 'nope\n');

    const machinery = existingSeedMachinery(r);
    expect(machinery.map((m) => m.path)).toEqual(['packages/prisma/seed.ts', 'packages/prisma/seed/users.ts']);

    const briefing = seedSessionBriefing(worldFor(r));
    expect(briefing).toMatch(/own seed machinery/i);
    expect(briefing).toContain('packages/prisma/seed/users.ts');
    expect(briefing).toContain('export const seedUser');
    expect(briefing).not.toContain('node_modules');
  });

  it('renders no machinery section when the repo has none', () => {
    const r = fixtureRepo();
    writeRecipe(r);
    expect(existingSeedMachinery(r)).toEqual([]);
    expect(seedSessionBriefing(worldFor(r))).not.toMatch(/own seed machinery/i);
  });
});

// ---------------------------------------------------------------------------
// The binding-check signals + the briefing sections they drive
// ---------------------------------------------------------------------------

describe('requiredPrincipalSurfaces — which surfaces demand a probed principal', () => {
  it('requires an api principal when the corpus declares security schemes, and none when nothing authenticates', () => {
    const r = fixtureRepo();
    writeRecipe(r);
    expect(requiredPrincipalSurfaces(seedInput(r))).toEqual([]);
    const required = requiredPrincipalSurfaces(
      seedInput(r, { securitySchemes: [{ name: 'bearerAuth', summary: 'http bearer' }] }),
    );
    expect(required).toHaveLength(1);
    expect(required[0]).toMatchObject({ surface: 'api' });
    expect(required[0].why).toMatch(/bearerAuth/);
  });

  it('requires a web principal when the recipe prepares a web surface and the schema holds login principals', () => {
    const r = fixtureRepo();
    writeRecipe(r, {}, webBlock(r));
    const required = requiredPrincipalSurfaces(seedInput(r, { database: PRINCIPAL_DATABASE }));
    expect(required).toHaveLength(1);
    expect(required[0]).toMatchObject({ surface: 'web' });
    expect(required[0].why).toMatch(/User/);
    // No web block ⇒ no web requirement, whatever the schema says.
    writeRecipe(r);
    expect(requiredPrincipalSurfaces(seedInput(r, { database: PRINCIPAL_DATABASE }))).toEqual([]);
    // A web block over a schema with no login table (and no schemes/roles)
    // requires nothing — a public site stays seedable with fixtures alone.
    writeRecipe(r, {}, webBlock(r));
    expect(requiredPrincipalSurfaces(seedInput(r))).toEqual([]);
  });

  it('missingPrincipalSurfaces is satisfied only by a web probe carrying its login proof', () => {
    const required = [{ surface: 'web' as const, why: 'the schema holds login principals (User)' }];
    const provides = {
      fixtures: { org: ['id'] },
      credentials: { webSession: { header: 'Cookie' } },
    };
    // An api probe does not satisfy the web surface…
    const missing = missingPrincipalSurfaces(provides, { webSession: { path: '/me' } }, required);
    expect(missing).toHaveLength(1);
    expect(missing[0].reason).toMatch(/web surface requires an authenticated principal/);
    // …nor does a web probe with no login proof (the cookie proves a page, not
    // that the published password mints a session)…
    const loginless = missingPrincipalSurfaces(
      provides,
      { webSession: { surface: 'web', path: '/dashboard' } },
      required,
    );
    expect(loginless).toHaveLength(1);
    expect(loginless[0].reason).toMatch(/login/);
    // …a web probe WITH its login proof does.
    expect(
      missingPrincipalSurfaces(
        provides,
        {
          webSession: {
            surface: 'web',
            path: '/dashboard',
            login: { path: '/api/login', body: { email: 'x', password: 'y' } },
          },
        },
        required,
      ),
    ).toEqual([]);
  });
});

describe('seedSessionBriefing — runnable surfaces and probe candidates', () => {
  const worldFor = (r: string, over: Partial<GuardSetupSeedSessionInput> = {}) =>
    ({
      input: seedInput(r, over),
      server: { name: 'default', serve: ['node', 'x'], cwd: 'sandbox', healthPath: '/health', readyTimeoutMs: 1, env: {} },
      targetPath: TARGET,
      scratchDir: path.join(r, 'scratch'),
      knownSchemes: new Set(),
      secrets: new Map(),
    }) as never;

  it('briefs the web principal mandate when the recipe prepares a web surface', () => {
    const r = fixtureRepo();
    writeRecipe(r, {}, webBlock(r));
    const briefing = seedSessionBriefing(worldFor(r, { database: PRINCIPAL_DATABASE }));
    expect(briefing).toMatch(/Runnable surfaces/);
    expect(briefing).toMatch(/SIGN IN to the web UI/);
    expect(briefing).toContain('{{fixture:webUser.password}}');
    expect(briefing).toContain('"surface": "web"');
    expect(briefing).toContain('header: "Cookie"');
  });

  it('lists the spec-derived candidate probe endpoints as a lookup, not a search', () => {
    const r = fixtureRepo();
    writeRecipe(r);
    const briefing = seedSessionBriefing(
      worldFor(r, {
        securitySchemes: [{ name: 'apiKey', summary: 'apiKey in header Authorization' }],
        probeCandidates: [{ method: 'GET', path: '/api/v1/me', schemes: ['apiKey'] }],
      }),
    );
    expect(briefing).toMatch(/Candidate probe endpoints/);
    expect(briefing).toContain('- GET /api/v1/me (requires: apiKey)');
    expect(briefing).toMatch(/CONFIRM one/);
  });

  it('states the fixtures-only allowance when nothing authenticates', () => {
    const r = fixtureRepo();
    writeRecipe(r);
    const briefing = seedSessionBriefing(worldFor(r));
    expect(briefing).toMatch(/fixtures-only seed passes/);
    expect(briefing).not.toMatch(/Candidate probe endpoints/);
  });
});

describe('collectProbeCandidates — probe endpoints are a lookup, not a search', () => {
  it('keeps only operations whose security requires a scheme, cheapest first, base path applied', () => {
    const spec = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 't', version: '1' },
      servers: [{ url: 'https://api.acme.test/api/v1' }],
      components: { securitySchemes: { apiKey: { type: 'apiKey', in: 'header', name: 'Authorization' } } },
      security: [{ apiKey: [] }],
      paths: {
        '/public': { get: { security: [] } }, // explicitly public
        '/optional': { get: { security: [{ apiKey: [] }, {}] } }, // public alternative gates nothing
        '/me': { get: {} }, // inherits the doc-level requirement
        '/documents/{id}': { get: {} }, // templated → after the parameter-free GET
        '/documents': { post: {} }, // write → after the GETs
      },
    });
    const out = collectProbeCandidates([{ doc: 'api.json', content: spec }]);
    expect(out.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /api/v1/me',
      'GET /api/v1/documents/{id}',
      'POST /api/v1/documents',
    ]);
    expect(out[0].schemes).toEqual(['apiKey']);
    // A non-OpenAPI doc contributes nothing.
    expect(collectProbeCandidates([{ doc: 'notes.md', content: '# notes' }])).toEqual([]);
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

  it('hands the corpus-derived security schemes and probe candidates to the seam', async () => {
    const r = fixtureRepo();
    writeRecipe(r);
    fs.writeFileSync(
      path.join(r, 'docs/api.json'),
      JSON.stringify({
        openapi: '3.0.0',
        info: { title: 't', version: '1' },
        components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } },
        paths: { '/me': { get: { security: [{ bearerAuth: [] }] } } },
      }),
    );
    fs.writeFileSync(
      path.join(r, '.truecourse', 'specs', 'corpus.json'),
      JSON.stringify({
        version: 3,
        generatedAt: '2026-01-01T00:00:00Z',
        docs: [
          { ref: DOC, kind: 'prd', lastTouched: '', areaTags: [] },
          { ref: 'docs/api.json', kind: 'api', lastTouched: '', areaTags: [] },
        ],
        areas: [],
        relations: [],
        skippedDocs: [],
      }),
    );
    const seed = recordingSeam();

    await runGuardSetup(opts(r, { seedSession: seed.seam }));

    expect(seed.inputs).toHaveLength(1);
    expect(seed.inputs[0].securitySchemes.map((s) => s.name)).toEqual(['bearerAuth']);
    expect(seed.inputs[0].probeCandidates).toEqual([
      { method: 'GET', path: '/me', schemes: ['bearerAuth'] },
    ]);
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
