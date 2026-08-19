/**
 * The transport a run is FORCED onto decides its stage models.
 *
 * `--llm-transport` overrides the saved selection for a single run, but model
 * resolution used to read the saved selection alone — so a saved `api` selection
 * handed its provider model to a run forced onto `cli`, i.e. `claude --model
 * gpt-5.5`, a deterministic exit 1. These cases drive the two commands that were
 * missing the pin (`guard generate`, `spec scan`) in BOTH directions; `guard
 * setup` has the same pair in `tests/core/guard-setup.test.ts`.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetKvCacheStore } from '@truecourse/llm';
import { setDefaultTransport } from '@truecourse/shared/llm';

// The API transport, stubbed one step short of the provider: the saved config is
// still validated by the real builder, but the transport answers from a per-stage
// script and records the model each stage asked for.
const { apiTransport } = vi.hoisted(() => ({
  apiTransport: {
    requests: [] as { stage: string; model?: string }[],
    replies: {} as Record<string, unknown>,
  },
}));
vi.mock('../../packages/core/src/services/llm/install-transport.js', async (importOriginal) => {
  const real =
    await importOriginal<typeof import('../../packages/core/src/services/llm/install-transport.js')>();
  const { readApiLlmConfig } = await import('../../packages/core/src/config/global-config.js');
  return {
    ...real,
    createConfiguredApiTransport: () => {
      real.buildProviderConfig(readApiLlmConfig());
      return async (req: { stage: string; model?: string }) => {
        apiTransport.requests.push({ stage: req.stage, model: req.model });
        return JSON.stringify(apiTransport.replies[req.stage] ?? {});
      };
    },
  };
});

import { writeGlobalConfig } from '../../packages/core/src/config/global-config.js';
import { STAGE_DEFAULTS, resolveModel } from '../../packages/core/src/config/llm-models.js';
import {
  SESSION_MODEL_CLAUDE_CODE,
  createConfiguredSessionDriver,
} from '../../packages/core/src/services/llm/session-driver.js';
import { guardGenerateInProcess } from '../../packages/core/src/commands/guard-in-process.js';
import { estimateScanTokens } from '../../packages/core/src/services/llm/spec-estimate.js';
import { makeTempRepo, rmrf, writeCorpus, writeDoc, writeRecipe, DEFAULT_INTERFACES } from '../guard-generator/helpers.js';

const API_MODEL = 'gpt-5.5';
const DOC = 'docs/cli.md';
const DOC_CONTENT = '## version\n`relkit --version` prints the version and exits 0.\n';
const CLAIM = 'prints the version and exits 0';

/** What each stage answers — the shapes the runners parse. */
const REPLIES: Record<string, unknown> = {
  'guard.extract': {
    claims: [{ claim: CLAIM, driver: 'cli', sectionAnchor: 'version', reason: 'the exit code is observable' }],
    untestable: [],
  },
  'guard.flows': {
    flows: [
      {
        title: 'prints the version',
        goal: 'read the version off the CLI',
        milestones: [{ order: 1, doc: DOC, anchor: 'version', claimTitle: CLAIM }],
      },
    ],
    noFlowClaims: [],
  },
};

let home: string;
const dirs: string[] = [];
const repos: string[] = [];
const savedEnv = { ...process.env };

function saveSelection(transport: 'api' | 'claude-code'): void {
  writeGlobalConfig({
    llm: { transport, api: { provider: 'openai', model: API_MODEL, apiKey: 'sk-test' } },
  });
}

function guardRepo(): string {
  const r = makeTempRepo();
  repos.push(r);
  writeRecipe(r);
  writeCorpus(r, [{ ref: DOC }]);
  writeDoc(r, DOC, DOC_CONTENT);
  return r;
}

beforeEach(() => {
  resetKvCacheStore();
  setDefaultTransport(undefined);
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-transport-models-home-'));
  dirs.push(home);
  process.env.TRUECOURSE_HOME = home;
  delete process.env.TRUECOURSE_LLM_TRANSPORT;
  apiTransport.requests.length = 0;
  apiTransport.replies = REPLIES;
});

afterEach(() => {
  process.env = { ...savedEnv };
  setDefaultTransport(undefined);
  while (repos.length) rmrf(repos.pop()!);
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// guard generate
// ---------------------------------------------------------------------------

/**
 * GUARD GENERATE now runs its content stages as agent SESSIONS on ONE model
 * (§3.4; plan 04 steps 15–18), so the per-stage tiers those cases pinned
 * (`guard.extract`, `guard.flows`) no longer exist — `resolveGuardModels`
 * carries `match` + `recipe` + `fallback` and nothing else. What survives the
 * move is the question the cases were written for: a run FORCED onto one
 * transport must never resolve the other one's model. It is pinned in both
 * directions on the two seams that still decide it — the session driver for the
 * session stages, the per-stage table for the two remaining one-shots.
 */
describe('guard generate — the models follow the run transport', () => {
  it('pins the claude-code session model when `cli` overrides a saved api selection', () => {
    saveSelection('api');
    const { mode, attribution } = createConfiguredSessionDriver({ transport: 'cli' });
    expect(mode).toBe('claude-code');
    expect(attribution.model).toBe(SESSION_MODEL_CLAUDE_CODE);
    expect(attribution.model).not.toBe(API_MODEL);
  });

  it('resolves the api model when `api` overrides a saved Claude Code selection', () => {
    saveSelection('claude-code');
    const { mode, attribution } = createConfiguredSessionDriver({ transport: 'api' });
    expect(mode).toBe('api');
    expect(attribution.model).toBe(API_MODEL);
  });

  it('keeps the two remaining ONE-SHOT stages on the run’s transport too', () => {
    saveSelection('api');
    const r = guardRepo();
    // `GuardGenerateModels` is down to the one-shots: match, recipe, fallback.
    // Every session stage runs on the driver's one model instead.
    for (const stage of ['guard.match', 'guard.recipe'] as const) {
      expect(resolveModel(stage, undefined, r, 'claude-code')).toBe(STAGE_DEFAULTS[stage]);
      expect(resolveModel(stage, undefined, r, 'api')).toBe(API_MODEL);
    }
  });

  // The `agent` (filesystem mailbox) transport has no session driver, so a
  // generate run on it is refused BEFORE anything is spent.
  it('refuses the `agent` transport before the run spends anything', async () => {
    const r = guardRepo();
    const io = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-agent-io-'));
    dirs.push(io);
    await expect(guardGenerateInProcess(r, { llm: 'agent', io, interfaces: DEFAULT_INTERFACES(r) })).rejects.toThrow(
      /session driver/i,
    );
  });
});

// ---------------------------------------------------------------------------
// spec scan
// ---------------------------------------------------------------------------

/**
 * SPEC SCAN runs agent SESSIONS on ONE model (§3.4), so there are no per-stage
 * tiers left to leak — the whole question collapses to "which model does the run
 * resolve". The pre-flight estimate is where that resolution surfaces to the
 * user (the CLI panel and the dashboard modal both render it), so it is what the
 * override is pinned on, in both directions.
 */
describe('spec scan — the model follows the run transport', () => {
  function scanRepo(): string {
    const r = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-transport-models-scan-'));
    dirs.push(r);
    fs.mkdirSync(path.join(r, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(r, 'docs', 'alpha.md'), '# Orders alpha\nbody');
    fs.writeFileSync(path.join(r, 'docs', 'beta.md'), '# Orders beta\nbody');
    return r;
  }

  const models = async (repo: string, mode: 'claude-code' | 'api'): Promise<string[]> => {
    const est = await estimateScanTokens(repo, undefined, { mode });
    return [...new Set((est.stages ?? []).map((s) => s.model))];
  };

  it('resolves the pinned session tier when `cli` overrides a saved api selection', async () => {
    saveSelection('api');
    expect(await models(scanRepo(), 'claude-code')).toEqual(['opus']);
  });

  it('resolves the api model when `api` overrides a saved Claude Code selection', async () => {
    saveSelection('claude-code');
    expect(await models(scanRepo(), 'api')).toEqual([API_MODEL]);
  });

  it('quotes ONE model for every scan stage, whichever transport wins', async () => {
    saveSelection('api');
    const repo = scanRepo();
    const est = await estimateScanTokens(repo, undefined, { mode: 'api' });
    expect((est.stages ?? []).length).toBeGreaterThan(1);
    expect(new Set((est.stages ?? []).map((s) => s.model)).size).toBe(1);
  });
});
