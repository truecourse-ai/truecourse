/**
 * THE AUTH VERIFICATION SESSION — `guard-setup.auth-proof` (plan 03 step 14):
 * the last setup step takes the catalog's SUPPLIED entries and proves each
 * REGISTERED one actually authenticates, by running the program under test in a
 * fresh sandbox that already carries the materialized state.
 *
 * The program is `relkit` — the fixture CLI the guard-runner engine tests drive
 * — plus one tiny probe script that prints what reached the child, so both
 * materialization shapes (`env` export, `path` copy-in) are observable. The
 * model is scripted; the sandbox, the copy-in and the redaction are real.
 *
 * Two rules this step exists to hold, pinned here:
 *  - an UNREGISTERED entry is `blocked` WITHOUT spending a session (there is
 *    nothing to materialize, and the actionable answer is the registration);
 *  - the step is PROOF-CLASS, so there is NO cache: a second identical run
 *    spends a second session, because a cached proof is a claim about a key
 *    that may since have been rotated.
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  GuardSetupReportSchema,
  GuardSetupTaxonomyStepSchema,
} from '../../packages/shared/src/guard/setup';
import {
  readGuardSetup,
  recipePath,
  resolveDependencies,
  writeGuardSetup,
} from '@truecourse/guard-runner';
import { runGuardSetup, type GuardSetupOptions } from '@truecourse/guard-generator';
import type { SessionRunInput } from '../../packages/agent-loop/src/index';
import {
  authProofBriefing,
  authProofSessionDef,
  buildAuthProof,
  AUTH_PROOF_BUDGET,
} from '../../packages/core/src/services/guard-setup/auth-proof';
import type { GuardSetupSessionContext } from '../../packages/core/src/services/guard-setup/session-context';
import { memoryPersistence, stubDriver, outcome } from './spec-scan-session-stub';

const repos: string[] = [];
afterEach(() => {
  while (repos.length) fs.rmSync(repos.pop()!, { recursive: true, force: true });
});

const DOC = 'docs/cli.md';
const TOKEN = 'tok-123-secret';

/**
 * A repo whose recipe entry is a probe script: it prints the registered token
 * and the contents of the sandbox cwd, which is exactly what a proof reads.
 */
function fixtureRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-auth-proof-'));
  repos.push(dir);
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'relkit', version: '1.0.0', private: true, type: 'module' }, null, 2),
  );
  fs.writeFileSync(
    path.join(dir, 'probe.mjs'),
    [
      "import fs from 'node:fs'",
      "if (process.argv[2] === 'whoami') {",
      '  process.stdout.write(`authed as ${process.env.FOO_TOKEN ?? "(nobody)"}\\n`)',
      "  process.stdout.write(`cwd entries: ${fs.readdirSync(process.cwd()).join(',')}\\n`)",
      '  process.exit(0)',
      '}',
      "process.stderr.write('unknown command\\n')",
      'process.exit(2)',
      '',
    ].join('\n'),
  );
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(dir, DOC), '## relkit\n`relkit whoami` prints the account.\n');
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
  const recipe = { build: 'true', entry: ['node', 'probe.mjs'] };
  fs.mkdirSync(path.dirname(recipePath(dir)), { recursive: true });
  fs.writeFileSync(recipePath(dir), JSON.stringify(recipe, null, 2) + '\n');
  return dir;
}

const RECIPE = { build: 'true', entry: ['node', 'probe.mjs'] } as const;

/** The committed catalog: one supplied entry registered as an env variable. */
function writeCatalog(r: string, registration: unknown = {
    kind: 'env',
    vars: [{ name: 'FOO_TOKEN', description: 'the account token relkit authenticates with', secret: true }],
  }): void {
  const file = path.join(r, '.truecourse', 'scenarios', 'dependencies.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        dependencies: [
          {
            name: 'foo-service',
            class: 'supplied',
            summary: 'an authenticated foo account',
            registration,
            needs: [{ flowId: 'core/login', need: 'an account that can list its own releases' }],
          },
        ],
      },
      null,
      2,
    ),
  );
}

/** The gitignored instance overlay — what the user registered on this machine. */
function writeLocal(r: string, instance: unknown): void {
  const file = path.join(r, '.truecourse', 'scenarios', 'dependencies.local.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ 'foo-service': instance }, null, 2));
}

/** Call a session tool the way a driver does. */
async function callTool(input: SessionRunInput, name: string, args: unknown): Promise<string> {
  const tool = input.def.tools.find((t) => t.name === name)!;
  const result = await tool.execute(args, {
    workItem: 'auth:foo-service',
    signal: input.signal,
    dispatchChild: () => {
      throw new Error('not used');
    },
  });
  input.onEvent({ type: 'tool-result', toolName: name, content: result.content, isError: result.isError });
  return result.content;
}

function harness(driver: ReturnType<typeof stubDriver>['driver'] | null): {
  context: GuardSetupSessionContext;
  acquires: () => number;
} {
  const persistence = memoryPersistence();
  let acquires = 0;
  return {
    acquires: () => acquires,
    context: {
      async acquire() {
        acquires++;
        if (!driver) throw new Error('no session should have been started');
        return { runId: 'setup-run-1', driver, persistence: persistence.persistence };
      },
      runId: () => (acquires > 0 ? 'setup-run-1' : undefined),
      note: () => {},
      addSpend: () => {},
      usageTotals: () => null,
      finish: () => {},
    },
  };
}

const authInput = (r: string) => ({ repoRoot: r, recipe: RECIPE as never, fingerprint: 'auth-fp-1' });

// ---------------------------------------------------------------------------
// Nothing to prove
// ---------------------------------------------------------------------------

describe('buildAuthProof — the honest skips', () => {
  it('skips when the catalog declares no supplied entry', async () => {
    const r = fixtureRepo();
    const h = harness(null);

    const result = await buildAuthProof(h.context)(authInput(r));

    expect(result).toEqual({
      status: 'skipped',
      reason: 'the catalog declares no supplied dependencies to verify',
    });
    expect(h.acquires()).toBe(0);
  });

  it('skips an api-only repo — supplied auth is proven by running the program', async () => {
    const r = fixtureRepo();
    writeCatalog(r);
    const h = harness(null);

    const result = await buildAuthProof(h.context)({ ...authInput(r), recipe: { build: 'true' } as never });

    expect(result.status).toBe('skipped');
    expect(result.reason).toMatch(/no cli `entry`/);
    expect(h.acquires()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Blocked without a session
// ---------------------------------------------------------------------------

describe('buildAuthProof — an unregistered entry blocks LOUDLY and spends nothing', () => {
  it('names the entry, its requirement, and the overlay to register it in', async () => {
    const r = fixtureRepo();
    writeCatalog(r);
    const h = harness(null);

    const result = await buildAuthProof(h.context)(authInput(r));

    const resolved = resolveDependencies(r);
    expect(result.status).toBe('blocked');
    expect(result.reason).toContain('foo-service');
    expect(result.reason).toContain(resolved.dependencies[0].requirement);
    expect(result.reason).toContain(resolved.localPath);
    // Nothing to materialize ⇒ nothing to run ⇒ no run record, no driver.
    expect(h.acquires()).toBe(0);
    expect(result.sessionRunId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The proof itself
// ---------------------------------------------------------------------------

describe('buildAuthProof — the materialized state reaches the child', () => {
  it('exports a registered env value into the sandbox and redacts it out of the transcript', async () => {
    const r = fixtureRepo();
    writeCatalog(r);
    writeLocal(r, { env: { FOO_TOKEN: TOKEN } });
    let observed = '';
    const stub = stubDriver(async (call) => {
      observed = await callTool(call.input, 'run_entry', { argv: ['whoami'] });
      return outcome({ verdict: 'proved', proof: { argv: ['whoami'], excerpt: 'authed as «external:foo-service.FOO_TOKEN»' } });
    });
    const h = harness(stub.driver);

    const result = await buildAuthProof(h.context)(authInput(r));

    // The env really reached the child — and the value never reached the model.
    expect(observed).toContain('authed as «external:foo-service.FOO_TOKEN»');
    expect(observed).not.toContain(TOKEN);
    expect(result).toMatchObject({ status: 'ok', sessionRunId: 'setup-run-1' });
    expect(result.reason).toMatch(/1 supplied dependency proved/);
  }, 30_000);

  it('copies a registered path into the sandbox at `.tc-supplied/<name>`', async () => {
    const r = fixtureRepo();
    const registered = path.join(r, 'registered-account');
    fs.mkdirSync(registered, { recursive: true });
    fs.writeFileSync(path.join(registered, 'credentials.json'), '{"account":"acme"}');
    writeCatalog(r, { kind: 'path', description: 'the authenticated account directory' });
    writeLocal(r, { path: registered });
    let observed = '';
    const stub = stubDriver(async (call) => {
      observed = await callTool(call.input, 'run_entry', { argv: ['whoami'] });
      return outcome({ verdict: 'proved', proof: { argv: ['whoami'], excerpt: observed.slice(0, 200) } });
    });

    const result = await buildAuthProof(harness(stub.driver).context)(authInput(r));

    expect(observed).toContain('.tc-supplied');
    expect(result.status).toBe('ok');
  }, 30_000);

  it('maps a session `blocked` outcome onto the step, keeping its actionable words', async () => {
    const r = fixtureRepo();
    writeCatalog(r);
    writeLocal(r, { env: { FOO_TOKEN: TOKEN } });
    const stub = stubDriver(async (call) => {
      await callTool(call.input, 'run_entry', { argv: ['whoami'] });
      return outcome({ verdict: 'blocked', blocked: { registration: 'run `relkit login` and register the printed token' } });
    });

    const result = await buildAuthProof(harness(stub.driver).context)(authInput(r));

    expect(result.status).toBe('blocked');
    expect(result.reason).toContain('run `relkit login`');
  }, 30_000);

  it('fails the step — softly — when the session itself dies', async () => {
    const r = fixtureRepo();
    writeCatalog(r);
    writeLocal(r, { env: { FOO_TOKEN: TOKEN } });
    const stub = stubDriver(() => ({
      kind: 'failure' as const,
      failure: { kind: 'transport' as const, detail: 'the provider is gone', class: 'provider', retryability: 'none' as const },
    }));

    const result = await buildAuthProof(harness(stub.driver).context)(authInput(r));

    expect(result.status).toBe('failed');
    expect(result.reason).toContain('foo-service');
  }, 30_000);
});

// ---------------------------------------------------------------------------
// The outcome carries exactly the half its verdict names
// ---------------------------------------------------------------------------

/**
 * The outcome is ONE object (`{verdict, proof?, blocked?}`) rather than a union,
 * because both drivers hand the rendered JSON schema to a provider surface that
 * requires an object root. The pairing a union encoded structurally is a
 * `superRefine` now — so it has to be the SHELL that refuses a mismatch, and
 * these two cases are what says so.
 */
describe('buildAuthProof — a verdict without its half never completes', () => {
  const cases: Array<[string, unknown]> = [
    ['a verdict with the wrong half', { verdict: 'proved', blocked: { registration: 'register a token' } }],
    ['a verdict with no half at all', { verdict: 'blocked' }],
  ];

  for (const [name, payload] of cases) {
    it(`refuses ${name} as malformed`, async () => {
      const r = fixtureRepo();
      writeCatalog(r);
      writeLocal(r, { env: { FOO_TOKEN: TOKEN } });
      const stub = stubDriver(async (call) => {
        await callTool(call.input, 'run_entry', { argv: ['whoami'] });
        return outcome(payload);
      });

      const result = await buildAuthProof(harness(stub.driver).context)(authInput(r));

      // The shell parses every outcome against the schema before completing, so
      // an unpaired verdict is a session failure — never a step that reports a
      // proof nobody produced.
      expect(result.status).toBe('failed');
      expect(result.reason).toMatch(/malformed/);
      expect(result.reason).toContain('foo-service');
    }, 30_000);
  }
});

// ---------------------------------------------------------------------------
// Proof-class: no cache, ever
// ---------------------------------------------------------------------------

describe('buildAuthProof — proof-class means no cache', () => {
  it('writes no cache entry and spends a session again on an identical re-run', async () => {
    const r = fixtureRepo();
    writeCatalog(r);
    writeLocal(r, { env: { FOO_TOKEN: TOKEN } });
    const stub = stubDriver(async (call) => {
      await callTool(call.input, 'run_entry', { argv: ['whoami'] });
      return outcome({ verdict: 'proved', proof: { argv: ['whoami'], excerpt: 'authed as someone' } });
    });
    const h = harness(stub.driver);

    expect((await buildAuthProof(h.context)(authInput(r))).status).toBe('ok');
    expect((await buildAuthProof(h.context)(authInput(r))).status).toBe('ok');

    expect(stub.calls).toHaveLength(2);
    const cacheDir = path.join(r, '.truecourse', '.cache');
    const cached = fs.existsSync(cacheDir) ? fs.readdirSync(path.join(cacheDir, 'guard'), { recursive: true }) : [];
    expect(cached.filter((e) => String(e).includes('auth'))).toEqual([]);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// The session definition
// ---------------------------------------------------------------------------

describe('the auth-proof session definition', () => {
  const item = {
    dependency: {
      name: 'foo-service',
      entry: { name: 'foo-service', class: 'supplied' as const, summary: 'an authenticated foo account', needs: [] },
      state: 'provided' as const,
      requirements: [],
      requirement: 'an account that can list its own releases',
      needs: [],
      env: { FOO_TOKEN: TOKEN },
    },
    instance: { name: 'foo-service', kind: 'env' as const, env: { FOO_TOKEN: TOKEN } },
  };

  it('is one tool, one observation minimum, and a tiny budget', () => {
    const def = authProofSessionDef({ repoRoot: '/repo', recipe: RECIPE as never, item: item as never });

    expect(def.kind).toBe('guard-setup.auth-proof');
    expect(def.tools.map((t) => t.name)).toEqual(['run_entry']);
    expect(def.outcomePrecondition?.tool).toBe('run_entry');
    expect(AUTH_PROOF_BUDGET).toEqual({ turns: 5, maxResumes: 0, tokenCeiling: 50_000 });
  });

  it('briefs the registered variables by NAME and never by value', () => {
    const briefing = authProofBriefing(item as never, ['node', '/repo/probe.mjs']);

    expect(briefing).toContain('FOO_TOKEN');
    expect(briefing).not.toContain(TOKEN);
    expect(briefing).toContain('node /repo/probe.mjs');
  });
});

// ---------------------------------------------------------------------------
// `blocked` is the auth step's alone, and it does not demote the run
// ---------------------------------------------------------------------------

describe('the blocked verdict in the report', () => {
  it('is refused on every other step key and round-trips on auth', () => {
    const row = { status: 'blocked' as const, inputFingerprint: 'x' };
    expect(GuardSetupTaxonomyStepSchema.safeParse({ key: 'auth', ...row }).success).toBe(true);
    expect(GuardSetupTaxonomyStepSchema.safeParse({ key: 'seed', ...row }).success).toBe(false);

    const r = fixtureRepo();
    const report = GuardSetupReportSchema.parse({
      ranAt: '2026-01-01T00:00:00.000Z',
      status: 'ok',
      steps: [{ key: 'auth', status: 'blocked', inputFingerprint: 'x', reason: 'foo-service: not registered' }],
      recipe: { status: 'ok', outcome: 'exists' },
    });
    writeGuardSetup(r, report);

    expect(readGuardSetup(r)?.steps).toEqual(report.steps);
  });

  it('leaves the whole run `ok` when the last step blocks', async () => {
    const r = fixtureRepo();
    writeCatalog(r);
    const h = harness(null);
    const opts: GuardSetupOptions = {
      repoRoot: r,
      interfaces: async () => ({ interfaces: [], externalServices: [], database: null, datastoreUrls: [] }),
      recipeRunner: async () => {
        throw new Error('the recipe runner must not be called');
      },
      probe: async () => [],
      verifyAuth: buildAuthProof(h.context),
    };

    const { report } = await runGuardSetup(opts);

    expect(report.status).toBe('ok');
    const auth = report.steps.find((s) => s.key === 'auth')!;
    expect(auth.status).toBe('blocked');
    expect(auth.reason).toContain('foo-service');
    // Zero sessions: no run record was ever opened.
    expect(h.acquires()).toBe(0);
    expect(fs.existsSync(path.join(r, '.truecourse', 'sessions'))).toBe(false);
  }, 60_000);
});
