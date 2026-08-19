/**
 * THE RECIPE REPAIR SESSION — `guard-setup.recipe-repair` (plan 03 step 9),
 * core's half: the session definition (its tools and its done-check
 * precondition) and `buildRecipeRepair`, the `RecipeRepairFn` the command
 * adapter injects into `discoverRecipe`.
 *
 * The ENGINE half — that the loop runs only on the failure path, that the fold
 * re-verifies whatever comes back, and the `{error}` precedence rule — lives in
 * `tests/guard-generator/recipe-discovery.test.ts`, beside the discovery it is
 * a seam of. What matters here is that a session's claim is validated by the
 * tools it was given, that a settled proposal still comes out of the LEGACY
 * `guard/recipe` cache entry without a driver ever being built, and that the
 * working sandbox never outlives the session.
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SessionDriver, SessionTool, ToolContext } from '@truecourse/agent-loop';
import {
  discoverRecipe,
  recipeCacheKey,
  RECIPE_CACHE_NAME,
  type RecipeProposal,
} from '@truecourse/guard-generator';
import { computeRecipeFingerprint, createWorkingSandbox } from '@truecourse/guard-runner';
import { setCacheEntry, getCacheEntry } from '@truecourse/llm';
import {
  buildRecipeRepair,
  recipeRepairBriefing,
  recipeRepairSessionDef,
  RECIPE_REPAIR_BUDGET,
  RECIPE_REPAIR_SESSION_KIND,
  type GuardSetupSessionContext,
} from '../../packages/core/src/services/guard-setup/index.js';
import { stubDriver, forbiddenDriver, memoryPersistence, outcome, toolResult, transportFailure } from './spec-scan-session-stub.js';

const FIXTURE_BIN = fileURLToPath(
  new URL('../fixtures/guard-fixture-cli/bin.mjs', import.meta.url),
);

const cleanup: (() => void)[] = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

/** A temp repo the deterministic proposer cannot decide (a `bin` that is absent). */
function repo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-repair-'));
  cleanup.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'tmp-fixture-repo', version: '0.0.0', bin: { relkit: 'bin.mjs' } }, null, 2),
  );
  return dir;
}

const GOOD: RecipeProposal = { build: 'true', entry: ['node', FIXTURE_BIN] };

/** One assistant turn, priced — what the loop counts `spent.turns` off. */
const turn = (text: string) =>
  ({
    type: 'assistant-turn' as const,
    text,
    usage: {
      inputTokens: 500,
      outputTokens: 20,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
      costUsd: 0.02,
      costSource: 'computed' as const,
    },
  });

/** The session context the adapter builds, with a driver a test decides. */
function stubContext(driver: SessionDriver | (() => never)): {
  context: GuardSetupSessionContext;
  acquires: number;
  spend: { sessions: number; turns: number };
} {
  const state = { acquires: 0, spend: { sessions: 0, turns: 0 } };
  const { persistence } = memoryPersistence();
  const context: GuardSetupSessionContext = {
    async acquire() {
      state.acquires++;
      if (typeof driver === 'function') driver();
      return { runId: 'run-repair', driver: driver as SessionDriver, persistence };
    },
    runId: () => (state.acquires > 0 ? 'run-repair' : undefined),
    note: () => {},
    addSpend: (sessions, spent) => {
      state.spend.sessions += sessions;
      state.spend.turns += spent.turns;
    },
    usageTotals: () =>
      state.spend.sessions > 0 ? { count: state.spend.sessions, turns: state.spend.turns, tokens: 0, costUsd: 0 } : null,
    finish: () => {},
  };
  return {
    context,
    get acquires() {
      return state.acquires;
    },
    get spend() {
      return state.spend;
    },
  };
}

const toolOf = (name: string): SessionTool => {
  const sandbox = createWorkingSandbox();
  cleanup.push(() => sandbox.cleanup());
  const tool = recipeRepairSessionDef({ repoRoot: process.cwd(), sandbox }).tools.find(
    (t) => t.name === name,
  );
  if (!tool) throw new Error(`no ${name} tool on the repair session`);
  return tool;
};

const ctx = { workItem: 'recipe-repair', signal: undefined, dispatchChild: async () => {
  throw new Error('no children');
} } as unknown as ToolContext;

// ---------------------------------------------------------------------------
// The session definition
// ---------------------------------------------------------------------------

describe('recipeRepairSessionDef', () => {
  it('refuses an outcome the real verification never saw', () => {
    const sandbox = createWorkingSandbox();
    cleanup.push(() => sandbox.cleanup());

    const def = recipeRepairSessionDef({ repoRoot: process.cwd(), sandbox });

    expect(def.kind).toBe(RECIPE_REPAIR_SESSION_KIND);
    expect(def.budget).toEqual(RECIPE_REPAIR_BUDGET);
    expect(def.outcomePrecondition?.tool).toBe('verify_recipe');
    expect(def.outcomePrecondition?.message).toMatch(/verify_recipe/);
    expect(def.tools.map((t) => t.name)).toEqual([
      'read_file',
      'search_repo',
      'sandbox_exec',
      'sandbox_shell',
      'check_recipe',
      'verify_recipe',
    ]);
  });

  // `check_recipe` is the FREE half of the done-check: the engine's own static
  // refusals, run on a draft, so a shell operator costs a turn and not a build.
  it('check_recipe refuses a shell-composed argv and a dev/watch server', async () => {
    const check = toolOf('check_recipe');

    const composed = await check.execute({ build: 'true', entry: ['sh', '-c', 'a && b'] }, ctx);
    expect(composed.isError).toBe(true);
    expect(composed.content).toMatch(/&&/);

    const watching = await check.execute(
      { build: 'true', api: { serve: ['pnpm', 'dev', '--watch'] } },
      ctx,
    );
    expect(watching.isError).toBe(true);
    expect(watching.content).toMatch(/dev|watch/i);

    const clean = await check.execute(GOOD, ctx);
    expect(clean.isError).toBeUndefined();
    expect(clean.content).toMatch(/verify_recipe/);
  });

  // Sandbox containment: the session's world is its own, and a cwd that climbs
  // out of it is refused rather than silently resolved against the checkout.
  it('sandbox_exec refuses a cwd that escapes the sandbox', async () => {
    const exec = toolOf('sandbox_exec');

    const result = await exec.execute({ argv: ['node', '--version'], cwd: '../..' }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/escape|outside|sandbox/i);
  });
});

describe('recipeRepairBriefing', () => {
  it('leads with the failed proposal and the engine verdict, and states a generated compose', () => {
    const text = recipeRepairBriefing({
      repoRoot: '/tmp/x',
      inputs: { packageJson: '{"name":"x"}', presentInputs: ['package.json'] },
      inputsFingerprint: 'sha256:abc',
      failed: { proposal: '{"build":"true"}', stage: 'server boot', reason: 'the server never became healthy' },
      database: { type: 'postgres', driver: 'prisma' },
      datastoreUrls: [],
      composeGenerated: true,
    });

    expect(text).toMatch(/rejected at the `server boot` stage/);
    expect(text).toContain('the server never became healthy');
    expect(text).toMatch(/Do not advise adding a compose file/);
    expect(text).toMatch(/postgres/);
  });

  it('says so when there was no prior proposal at all', () => {
    const text = recipeRepairBriefing({
      repoRoot: '/tmp/x',
      inputs: { packageJson: '{}', presentInputs: [] },
      inputsFingerprint: 'sha256:abc',
      database: null,
      datastoreUrls: [],
      composeGenerated: false,
    });

    expect(text).toMatch(/could not derive a recipe/);
  });
});

// ---------------------------------------------------------------------------
// The seam
// ---------------------------------------------------------------------------

describe('buildRecipeRepair', () => {
  const briefing = (r: string) => ({
    repoRoot: r,
    inputs: { packageJson: '{}', presentInputs: ['package.json'] },
    inputsFingerprint: computeRecipeFingerprint(r),
    database: null,
    datastoreUrls: [] as const,
    composeGenerated: false,
  });

  it('returns the settled proposal and the run it ran under', async () => {
    const r = repo();
    const { driver, calls } = stubDriver(async (call) => {
      await call.emit(turn('verifying'));
      await call.emit(toolResult('verify_recipe', 'VERIFIED'));
      await call.emit(turn('done'));
      return outcome(GOOD);
    });
    const stub = stubContext(driver);

    const result = await buildRecipeRepair(stub.context)(briefing(r));

    expect(result).toEqual({ proposal: GOOD, sessionRunId: 'run-repair' });
    expect(calls).toHaveLength(1);
    expect(calls[0].kind).toBe(RECIPE_REPAIR_SESSION_KIND);
    // The spend is folded into the run's usage totals, in the loop's own units.
    expect(stub.spend).toEqual({ sessions: 1, turns: 2 });
  });

  // Never throws: `discoverRecipe` composes the diagnostic from `{error}`.
  it('reports a failed session as an error, never a throw', async () => {
    const r = repo();
    const { driver } = stubDriver(() => transportFailure('none'));

    const result = await buildRecipeRepair(stubContext(driver).context)(briefing(r));

    expect(result).toEqual({
      error: expect.stringContaining('the provider failed'),
      sessionRunId: 'run-repair',
    });
  });

  // The sandbox is created before the session and cleaned up in a `finally`, so a
  // failed session leaves nothing behind. TMPDIR is redirected for the call, which
  // is where `createWorkingSandbox` mkdtemps its root.
  it('cleans up its working sandbox even when the session fails', async () => {
    const r = repo();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-repair-tmp-'));
    cleanup.push(() => fs.rmSync(tmp, { recursive: true, force: true }));
    const { driver } = stubDriver(() => transportFailure('none'));
    const previous = process.env.TMPDIR;
    process.env.TMPDIR = tmp;
    try {
      await buildRecipeRepair(stubContext(driver).context)(briefing(r));
    } finally {
      if (previous === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = previous;
    }

    expect(fs.readdirSync(tmp)).toEqual([]);
  });

  // The cache keeps the LEGACY name and key: a proposal the one-shot era settled
  // is a hit, and a hit builds no driver at all.
  it('answers from a one-shot-era `guard/recipe` entry without building a driver', async () => {
    const r = repo();
    await setCacheEntry(r, RECIPE_CACHE_NAME, recipeCacheKey(computeRecipeFingerprint(r)), GOOD);
    const stub = stubContext(() => {
      throw new Error('a cache hit must not acquire a driver');
    });

    const result = await buildRecipeRepair(stub.context)(briefing(r));

    expect(result).toEqual({ proposal: GOOD });
    expect(stub.acquires).toBe(0);
    // No sessions-store run either — the whole context stayed lazy.
    expect(fs.existsSync(path.join(r, '.truecourse', 'sessions'))).toBe(false);
  });

  it('writes the settled proposal back under the same key', async () => {
    const r = repo();
    const { driver } = stubDriver(async (call) => {
      await call.emit(toolResult('verify_recipe', 'VERIFIED'));
      return outcome(GOOD);
    });

    await buildRecipeRepair(stubContext(driver).context)(briefing(r));

    expect(await getCacheEntry(r, RECIPE_CACHE_NAME, recipeCacheKey(computeRecipeFingerprint(r)))).toEqual(
      GOOD,
    );
  });

  it('never caches a failed session', async () => {
    const r = repo();
    const { driver } = stubDriver(() => transportFailure('none'));

    await buildRecipeRepair(stubContext(driver).context)(briefing(r));

    expect(
      await getCacheEntry(r, RECIPE_CACHE_NAME, recipeCacheKey(computeRecipeFingerprint(r))),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The two halves together — a cache hit is still VERIFIED by the fold
// ---------------------------------------------------------------------------

describe('discoverRecipe with the built repair seam', () => {
  it('verifies a cached proposal before writing it, spending no session', async () => {
    const r = repo();
    await setCacheEntry(r, RECIPE_CACHE_NAME, recipeCacheKey(computeRecipeFingerprint(r)), {
      // The build leaves a marker, so the fold's verification is observable.
      build: 'touch verified-marker',
      entry: ['node', FIXTURE_BIN],
    });
    const stub = stubContext(forbiddenDriver('a cache hit must spend no session'));

    const res = await discoverRecipe(r, neverRunner, { repair: buildRecipeRepair(stub.context) });

    expect(res.status).toBe('discovered');
    expect(stub.acquires).toBe(0);
    // Verification really ran on the way through — the gate of record is the fold.
    expect(fs.existsSync(path.join(r, 'verified-marker'))).toBe(true);
    expect(fs.existsSync(path.join(r, '.truecourse', 'scenarios', 'recipe.json'))).toBe(true);
  });
});

const neverRunner = async (): Promise<never> => {
  throw new Error('the one-shot recipe runner must not be called');
};
