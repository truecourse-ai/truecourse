/**
 * `truecourse guard setup` — the terminal surface.
 *
 * The engine and the adapter are covered elsewhere; what this file pins down is the
 * command's own contract: the one-line cost confirm and its `-y`, the non-TTY
 * refusal that never clobbers a hand-edited seed, and the closing report that names
 * every artifact it wrote (a compose file or a seed script appearing unexplained in
 * `git status` is the failure mode this block exists for).
 *
 * The prompts are scripted through the CLI's own `@clack/prompts` copy — pnpm keeps
 * it under `tools/cli/node_modules`, so the bare specifier does not resolve here and
 * an unmocked prompt would block on stdin.
 */

import { describe, it, expect, afterEach, afterAll, beforeAll, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { recipePath } from '@truecourse/guard-runner';
import { setDefaultTransport } from '@truecourse/shared/llm';
import type { SeedProposal } from '@truecourse/guard-generator';
import { writeGlobalConfig } from '../../packages/core/src/config/global-config';

const { out, confirms } = vi.hoisted(() => ({ out: [] as string[], confirms: [] as boolean[] }));

vi.mock('../../tools/cli/node_modules/@clack/prompts', () => {
  const say = (msg?: unknown) => {
    out.push(String(msg ?? ''));
  };
  return {
    intro: say,
    outro: say,
    cancel: say,
    note: (body: string, title: string) => out.push(`${title}\n${body}`),
    log: { info: say, step: say, message: say, warn: say, error: say, success: say },
    spinner: () => ({ start: say, stop: say }),
    confirm: async (o: { message: string }) => {
      out.push(`confirm: ${o.message}`);
      if (confirms.length === 0) throw new Error(`no scripted answer for: ${o.message}`);
      return confirms.shift();
    },
    select: async () => {
      throw new Error('guard setup must not select');
    },
    text: async () => {
      throw new Error('guard setup must not prompt for text');
    },
    password: async () => {
      throw new Error('guard setup must not prompt for a password');
    },
    isCancel: (v: unknown) => typeof v === 'symbol',
  };
});

const { runGuardSetup } = await import('../../tools/cli/src/commands/guard-setup');

const FIXTURE = fileURLToPath(new URL('../fixtures/seed-draft', import.meta.url));

// `guard setup` registers the repo in the USER-level registry, the same as analyze
// and spec do. Every repo here is a throwaway temp dir, so without relocating
// TRUECOURSE_HOME each run would append a dead `/var/folders/…` project to the
// developer's real `~/.truecourse/registry.json` — and the dashboard renders that
// registry as its project list.
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-cli-setup-home-'));
// Setup's step 0 refuses to run without a usable LLM provider, and with no
// provider configured in this HOME that means a `<binary> --version` probe.
// Every case here injects BOTH stage runners, so no model is ever called — the
// gate just needs a binary that answers, and node is the one binary a test can
// count on. (The suite-wide tripwire points CLAUDE_CODE_BINARY at a nonexistent
// path so an UNstubbed runner can never spawn the real `claude`; this replaces
// it for the probe and restores it after, as that tripwire prescribes.)
const tripwireBinary = process.env.CLAUDE_CODE_BINARY;
beforeAll(() => {
  process.env.TRUECOURSE_HOME = HOME;
  process.env.CLAUDE_CODE_BINARY = process.execPath;
});
afterAll(() => {
  delete process.env.TRUECOURSE_HOME;
  if (tripwireBinary === undefined) delete process.env.CLAUDE_CODE_BINARY;
  else process.env.CLAUDE_CODE_BINARY = tripwireBinary;
  fs.rmSync(HOME, { recursive: true, force: true });
});

const repos: string[] = [];
afterEach(() => {
  while (repos.length) fs.rmSync(repos.pop()!, { recursive: true, force: true });
  out.length = 0;
  confirms.length = 0;
  vi.restoreAllMocks();
});

const DOC = 'docs/orgs.md';

/** A git repo (the command requires one) carrying the fixture app and a corpus. */
function fixtureRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-cli-setup-'));
  repos.push(dir);
  fs.cpSync(FIXTURE, dir, { recursive: true });
  execSync('git init -q -b main', { cwd: dir });
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

function writeRecipe(r: string, over: Record<string, unknown> = {}): void {
  const recipe = {
    build: 'true',
    api: {
      serve: ['node', path.join(r, 'server.mjs')],
      healthPath: '/health',
      env: { SEED_STORE: path.join(r, 'store.json') },
      ...over,
    },
  };
  const target = recipePath(r);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(recipe, null, 2) + '\n');
}

const PROPOSAL: SeedProposal = {
  scriptPath: 'scripts/guard-seed.mjs',
  scriptContent: [
    "import fs from 'node:fs'",
    'const org = { id: 42, slug: "acme" }',
    'fs.writeFileSync(process.env.SEED_STORE, JSON.stringify({ orgs: [org] }))',
    'fs.writeFileSync(process.env.GUARD_SEED_OUT, JSON.stringify({',
    '  fixtures: { org },',
    '  credentials: { owner: { value: "Bearer owner-token" } },',
    '}))',
    '',
  ].join('\n'),
  seed: {
    command: 'node scripts/guard-seed.mjs',
    provides: {
      fixtures: { org: ['id', 'slug'] },
      credentials: { owner: { header: 'Authorization', description: 'org owner' } },
    },
  },
};

const neverCalled = async (): Promise<never> => {
  throw new Error('no model in tests');
};

const text = (): string => out.join('\n');

/** Run the command, swallowing the mocked process.exit so the assertion runs. */
async function run(opts: Parameters<typeof runGuardSetup>[0]): Promise<number | undefined> {
  let exited: number | undefined;
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exited = code;
    throw new Error(`process.exit(${code})`);
  }) as never);
  try {
    await runGuardSetup(opts);
  } catch (e) {
    if (!(e instanceof Error) || !e.message.startsWith('process.exit(')) throw e;
  }
  return exited;
}

describe('runGuardSetup', () => {
  it('names every artifact it wrote — nothing appears in `git status` unexplained', async () => {
    const r = fixtureRepo();
    writeRecipe(r);

    await run({
      cwd: r,
      yes: true,
      interactive: false,
      recipeRunner: neverCalled,
      seedRunner: async () => PROPOSAL,
    });

    expect(text()).toMatch(/recipe\s+already present/);
    expect(text()).toMatch(/reached\s+default: GET \/health → 200/);
    expect(text()).toMatch(/seed\s+wrote scripts\/guard-seed\.mjs/);
    expect(text()).toMatch(/principals\s+owner/);
    expect(text()).toMatch(/Review and commit/);
    expect(fs.existsSync(path.join(r, 'scripts/guard-seed.mjs'))).toBe(true);
  }, 120_000);

  // The estimate is ONE LINE, deliberately: setup is bounded at two calls, so the
  // staged modal the big pipelines render would be more ceremony than the spend.
  it('confirms the cost in one line, and `-y` skips the prompt', async () => {
    const r = fixtureRepo();
    writeRecipe(r);

    await run({
      cwd: r,
      yes: true,
      interactive: false,
      recipeRunner: neverCalled,
      seedRunner: async () => PROPOSAL,
    });

    expect(text()).toMatch(/Setup makes up to \d+ LLM calls/);
    expect(text()).not.toMatch(/confirm: Proceed with setup\?/);
  }, 120_000);

  it('asks before spending in a terminal, and a decline writes nothing', async () => {
    const r = fixtureRepo();
    writeRecipe(r);
    const before = fs.readFileSync(recipePath(r), 'utf-8');
    confirms.push(false);

    const exited = await run({
      cwd: r,
      interactive: true,
      recipeRunner: neverCalled,
      seedRunner: neverCalled,
    });

    expect(text()).toMatch(/confirm: Proceed with setup\?/);
    expect(text()).toMatch(/Setup cancelled/);
    expect(exited).toBe(0);
    expect(fs.readFileSync(recipePath(r), 'utf-8')).toBe(before);
  });

  // The one rule a flag must never be able to break: a hand-edited seed script is a
  // committed, human-reviewed file, so a non-TTY `--refresh` with no `-y` refuses.
  it('--refresh in a non-TTY without -y refuses to replace the seed', async () => {
    const r = fixtureRepo();
    fs.mkdirSync(path.join(r, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(r, 'scripts/guard-seed.mjs'), '// mine\n');
    writeRecipe(r, {
      seed: {
        command: 'node scripts/guard-seed.mjs',
        script: 'scripts/guard-seed.mjs',
        provides: { fixtures: { org: ['id'] } },
      },
    });

    // No `-y`: the estimate gate itself refuses non-interactively, which is the
    // outermost guard. Assert the script survived either way.
    await run({
      cwd: r,
      refresh: true,
      interactive: false,
      recipeRunner: neverCalled,
      seedRunner: neverCalled,
    });

    expect(fs.readFileSync(path.join(r, 'scripts/guard-seed.mjs'), 'utf-8')).toBe('// mine\n');
  }, 120_000);

  // Step 3's interactive half — the externals provisioning that used to live in
  // `guard externals`: a terminal run offers to provision what it just declared.
  // A decline leaves the declaration in place — which is the point: the declaration
  // is the fingerprint-relevant half, and the value can be supplied later for free.
  it('offers to provision the externals it declared, and a decline writes only the declaration', async () => {
    const r = fixtureRepo();
    writeRecipe(r);
    // estimate confirm → the provisioning offer.
    confirms.push(true, false);

    await run({
      cwd: r,
      interactive: true,
      recipeRunner: neverCalled,
      seedRunner: async () => PROPOSAL,
      interfaces: async () => ({
        interfaces: [],
        externalServices: [
          { service: 'stripe', category: 'payment' as const, evidence: [], baseUrlEnv: 'STRIPE_BASE_URL' },
        ],
        database: null,
        datastoreUrls: [],
      }),
    });

    expect(text()).toMatch(/1 external API has no account yet\. Provide one now\?/);
    const recipe = JSON.parse(fs.readFileSync(recipePath(r), 'utf-8'));
    expect(recipe.api.externals.stripe.baseUrlEnv).toBe('STRIPE_BASE_URL');
    expect(recipe.api.externals.stripe.baseUrl).toBeUndefined();
  }, 120_000);

  it('reports the hard-gate failure and exits non-zero', async () => {
    const r = fixtureRepo();
    writeRecipe(r, { serve: ['node', path.join(r, 'missing.mjs')], readyTimeoutMs: 4000 });

    const exited = await run({
      cwd: r,
      yes: true,
      interactive: false,
      recipeRunner: neverCalled,
      seedRunner: neverCalled,
    });

    expect(exited).toBe(1);
    expect(text()).toMatch(/not reachable/);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// API mode — the transport the user configured, not the one setup assumed.
// ---------------------------------------------------------------------------

describe('runGuardSetup — API mode', () => {
  // The suite-wide tripwire is back for these cases: an API run reaches a provider
  // over HTTP, so it must go through on a machine with no `claude` binary at all.
  beforeEach(() => {
    process.env.CLAUDE_CODE_BINARY = '/nonexistent/claude-test-tripwire';
  });
  afterEach(() => {
    process.env.CLAUDE_CODE_BINARY = process.execPath;
    fs.rmSync(path.join(HOME, 'config.json'), { force: true });
    setDefaultTransport(undefined);
  });

  function useApiMode(transport: 'api' | 'claude-code' = 'api'): void {
    writeGlobalConfig({
      llm: { transport, api: { provider: 'openai', model: 'gpt-5.5', apiKey: 'sk-test' } },
    });
  }

  it('runs with no `claude` binary on the machine', async () => {
    const r = fixtureRepo();
    writeRecipe(r);
    useApiMode();

    await run({
      cwd: r,
      yes: true,
      interactive: false,
      recipeRunner: neverCalled,
      seedRunner: async () => PROPOSAL,
    });

    expect(text()).not.toMatch(/`claude` CLI/);
    expect(text()).toMatch(/seed\s+wrote scripts\/guard-seed\.mjs/);
  }, 120_000);

  // The pre-flight is the transport's, not Claude Code's: an unusable provider
  // configuration aborts up front — before the build, the boot and the analysis pass
  // — and never asks whether a binary nothing will spawn is logged in.
  it('gates on the provider configuration, never the `claude` login', async () => {
    const r = fixtureRepo();
    writeRecipe(r);
    writeGlobalConfig({
      llm: {
        transport: 'api',
        api: { provider: 'openai', model: 'gpt-5.5', apiKeyEnv: 'TC_TEST_MISSING_KEY' },
      },
    });

    const exited = await run({ cwd: r, yes: true, interactive: false });

    expect(exited).toBe(1);
    expect(text()).toMatch(/No API key for provider `openai`/);
    expect(text()).toMatch(/Aborted — fix the API configuration/);
    expect(text()).not.toMatch(/`claude` CLI/);
  });

  // `--llm-transport api` overrides the saved selection, exactly as it does on
  // `spec scan` and `guard generate`: Claude Code is selected, no binary exists, and
  // the run still goes through on the configured provider.
  it('honors --llm-transport api over the saved Claude Code selection', async () => {
    const r = fixtureRepo();
    writeRecipe(r);
    useApiMode('claude-code');

    await run({
      cwd: r,
      yes: true,
      interactive: false,
      llmTransport: 'api',
      recipeRunner: neverCalled,
      seedRunner: async () => PROPOSAL,
    });

    expect(text()).not.toMatch(/`claude` CLI/);
    expect(text()).toMatch(/seed\s+wrote scripts\/guard-seed\.mjs/);
  }, 120_000);
});
