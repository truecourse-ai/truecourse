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
import { fileURLToPath } from 'node:url';
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
import { STAGE_DEFAULTS } from '../../packages/core/src/config/llm-models.js';
import { guardGenerateInProcess } from '../../packages/core/src/commands/guard-in-process.js';
import { estimateScanTokens } from '../../packages/core/src/services/llm/spec-estimate.js';
import { makeTempRepo, rmrf, writeCorpus, writeDoc, writeRecipe, DEFAULT_INTERFACES } from '../guard-generator/helpers.js';

const FAKE_CLAUDE = fileURLToPath(new URL('../fixtures/fake-claude/claude.mjs', import.meta.url));
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

interface FakeCall {
  stage: string;
  model: string;
}

let home: string;
const dirs: string[] = [];
const repos: string[] = [];
const savedEnv = { ...process.env };

function saveSelection(transport: 'api' | 'claude-code'): void {
  writeGlobalConfig({
    llm: { transport, api: { provider: 'openai', model: API_MODEL, apiKey: 'sk-test' } },
  });
}

/** Point `claude` at the fake binary for one case, scripted + logging its argv model. */
function scriptFakeClaude(): () => FakeCall[] {
  const io = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-fake-claude-'));
  dirs.push(io);
  const script = path.join(io, 'script.json');
  const log = path.join(io, 'calls.ndjson');
  fs.writeFileSync(
    script,
    JSON.stringify(Object.fromEntries(Object.entries(REPLIES).map(([stage, reply]) => [stage, [{ reply }]]))),
  );
  process.env.CLAUDE_CODE_BINARY = FAKE_CLAUDE;
  process.env.FAKE_CLAUDE_SCRIPT = script;
  process.env.FAKE_CLAUDE_LOG = log;
  return () =>
    fs.existsSync(log)
      ? fs.readFileSync(log, 'utf-8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as FakeCall)
      : [];
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

describe('guard generate — the models follow the run transport', () => {
  // The api model must never reach the `claude` argv: this drives the REAL cli
  // transport (a fake binary that records the `--model` it was spawned with).
  it('spawns claude on the tier models when `cli` overrides a saved api selection', async () => {
    const r = guardRepo();
    saveSelection('api');
    const calls = scriptFakeClaude();

    await guardGenerateInProcess(r, {
      llm: 'cli',
      interfaces: DEFAULT_INTERFACES(r),
      stopAfterFlows: true,
    });

    const seen = calls();
    const tiers = new Set([STAGE_DEFAULTS['guard.extract'], STAGE_DEFAULTS['guard.flows']]);
    expect(seen.map((c) => c.stage)).toContain('guard.extract');
    expect(seen.map((c) => c.stage)).toContain('guard.flows');
    expect(seen.every((c) => tiers.has(c.model))).toBe(true);
    expect(seen.some((c) => c.model === API_MODEL)).toBe(false);
    // Nothing built the provider transport either — one config, read once, or not at all.
    expect(apiTransport.requests).toEqual([]);
  }, 120_000);

  it('runs the api model when `api` overrides a saved Claude Code selection', async () => {
    const r = guardRepo();
    saveSelection('claude-code');

    await guardGenerateInProcess(r, {
      llm: 'api',
      interfaces: DEFAULT_INTERFACES(r),
      stopAfterFlows: true,
    });

    expect(apiTransport.requests.map((q) => q.stage)).toContain('guard.extract');
    expect(apiTransport.requests.every((q) => q.model === API_MODEL)).toBe(true);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// spec scan
// ---------------------------------------------------------------------------

/**
 * SPEC SCAN runs agent SESSIONS on ONE model, so there are no per-stage
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
