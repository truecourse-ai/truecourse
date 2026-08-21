/**
 * THE DEPENDENCY CATALOG SESSION — `guard-setup.dependency-catalog`
 * (plan 03 step 10): the condition grammar, the validation `check_catalog` runs
 * verbatim, the ADD-ONLY fold into the committed catalog + the gitignored
 * overlay, and the seam the engine's catalog step calls.
 *
 * Plus `externalServiceStates` — the read surface §7.6 moves to the catalog:
 * a supplied catalog entry that names a service answers for it, and the recipe
 * declaration keeps answering for the services only IT declares.
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { SessionDriver } from '@truecourse/agent-loop';
import type { GuardSetupCatalogSessionInput } from '@truecourse/guard-generator';
import {
  dependenciesPath,
  dependenciesLocalPath,
  externalServiceStates,
  guardSetupFindingsPath,
  loadDependencyCatalog,
} from '@truecourse/guard-runner';
import { setCacheEntry } from '@truecourse/llm';
import { GITIGNORE_CONTENTS } from '../../packages/core/src/config/paths.js';
import { readGuardExternalsView } from '../../packages/core/src/commands/guard-externals.js';
import {
  buildCatalogSession,
  dependencyCatalogBriefing,
  dependencyCatalogSessionDef,
  DEPENDENCY_CATALOG_BUDGET,
  DEPENDENCY_CATALOG_CACHE_NAME,
  DEPENDENCY_CATALOG_SESSION_KIND,
  foldCatalogDraft,
  parseCatalogCondition,
  validateCatalogDraft,
  type CatalogDraft,
  type GuardSetupSessionContext,
} from '../../packages/core/src/services/guard-setup/index.js';
import { promptFingerprint } from '../../packages/core/src/services/agent/session-cache.js';
import { memoryPersistence, outcome, stubDriver, toolResult } from './spec-scan-session-stub.js';

const cleanup: (() => void)[] = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

function repo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-catalog-'));
  cleanup.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const STRIPE = {
  service: 'stripe',
  category: 'payment' as const,
  evidence: [],
  baseUrlEnv: 'STRIPE_BASE_URL',
};

function input(r: string, over: Partial<GuardSetupCatalogSessionInput> = {}): GuardSetupCatalogSessionInput {
  return {
    repoRoot: r,
    recipe: { build: 'true', api: { serve: ['node', 'server.mjs'] } },
    detected: [],
    database: null,
    datastoreUrls: [],
    skeleton: { declared: [], alreadyDeclared: [], undeclarable: [] },
    fingerprint: 'fp-1',
    ...over,
  } as GuardSetupCatalogSessionInput;
}

const draft = (entries: CatalogDraft['entries'], findings: string[] = []): CatalogDraft => ({
  entries,
  findings,
});

// ---------------------------------------------------------------------------
// The condition grammar
// ---------------------------------------------------------------------------

describe('parseCatalogCondition', () => {
  it('parses a predicate expression into machine-evaluable predicates', () => {
    const parsed = parseCatalogCondition('config-value:llm.transport=api :: only in api mode');

    expect(parsed).toEqual({
      ok: true,
      condition: {
        predicates: [{ kind: 'config-value', key: 'llm.transport', value: 'api' }],
        sentence: 'only in api mode',
      },
    });
  });

  it('parses a conjunction of predicates', () => {
    const parsed = parseCatalogCondition(
      'language-present:python && command-path:cli/analyze :: only when analyzing python',
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.condition.predicates).toEqual([
      { kind: 'language-present', language: 'python' },
      { kind: 'command-path', interfaceId: 'cli/analyze' },
    ]);
  });

  // A condition nobody can evaluate is worse than none: refused, with the grammar
  // in the message so the next turn can fix it.
  it('refuses a condition with no `::` and states the grammar', () => {
    const parsed = parseCatalogCondition('when api');

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain('<predicate>[ && <predicate>] :: <sentence>');
  });

  it('refuses an unknown predicate kind, naming the closed set', () => {
    const parsed = parseCatalogCondition('phase-of-moon:full :: only in a full moon');

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toMatch(/config-value, language-present, command-path/);
  });

  it('refuses an empty sentence and a malformed config-value', () => {
    expect(parseCatalogCondition('config-value:a=b :: ').ok).toBe(false);
    expect(parseCatalogCondition('config-value:nope :: because').ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The validation `check_catalog` runs verbatim
// ---------------------------------------------------------------------------

describe('validateCatalogDraft', () => {
  const empty = { dependencies: [] };

  it('refuses a draft that leaves a DETECTED service invisible', () => {
    const complaints = validateCatalogDraft(
      draft([{ name: 'app-database', class: 'seedable', evidence: 'schema.prisma' }]),
      input('/tmp/x', { detected: [STRIPE] }),
      empty,
    );

    expect(complaints).toHaveLength(1);
    expect(complaints[0]).toContain('"stripe"');
    expect(complaints[0]).toMatch(/flow gating/);
  });

  it('accepts it once the service is accounted for — by the draft, the skeleton, or the catalog', () => {
    const byDraft = validateCatalogDraft(
      draft([{ name: 'stripe', class: 'supplied', evidence: 'src/pay.ts imports stripe' }]),
      input('/tmp/x', { detected: [STRIPE] }),
      empty,
    );
    expect(byDraft).toEqual([]);

    const bySkeleton = validateCatalogDraft(
      draft([{ name: 'app-database', class: 'seedable', evidence: 'schema.prisma' }]),
      input('/tmp/x', {
        detected: [STRIPE],
        skeleton: { declared: ['stripe'], alreadyDeclared: [], undeclarable: [] },
      }),
      empty,
    );
    expect(bySkeleton).toEqual([]);

    const byCatalog = validateCatalogDraft(
      draft([{ name: 'app-database', class: 'seedable', evidence: 'schema.prisma' }]),
      input('/tmp/x', { detected: [STRIPE] }),
      {
        dependencies: [
          { name: 'payments', class: 'supplied', summary: 'the payment account', services: ['stripe'] },
        ],
      },
    );
    expect(byCatalog).toEqual([]);
  });

  // The 2026-08-20 cal.diy failure: 81 url-mined hostnames (www, gstatic,
  // npmjs…) each forced an entry, drowning the domain catalog in 65 junk rows.
  // Only SUBSTANTIATED services (SDK match or base-URL var) force accounting.
  it('never forces an entry for a url-mined service with no SDK match and no base-URL var', () => {
    const junk = { service: 'gstatic', evidence: [], source: 'http' as const };
    const complaints = validateCatalogDraft(
      draft([{ name: 'app-database', class: 'seedable', evidence: 'schema.prisma' }]),
      input('/tmp/x', { detected: [junk, STRIPE] }),
      empty,
    );

    // stripe (substantiated) still complains; gstatic never does.
    expect(complaints).toHaveLength(1);
    expect(complaints[0]).toContain('"stripe"');
  });

  it('refuses a non-kebab name, a duplicate, and an unparseable condition', () => {
    const complaints = validateCatalogDraft(
      draft([
        { name: 'App Database', class: 'seedable', evidence: 'x' },
        { name: 'dup', class: 'seedable', evidence: 'x' },
        { name: 'dup', class: 'seedable', evidence: 'x', condition: 'when api' },
      ]),
      input('/tmp/x'),
      empty,
    );

    expect(complaints[0]).toMatch(/lower-kebab-case/);
    expect(complaints.some((c) => c.includes('appears twice'))).toBe(true);
    expect(complaints.some((c) => c.includes('<predicate>'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The fold — the only writes of this step's session half
// ---------------------------------------------------------------------------

describe('dependencyCatalogBriefing', () => {
  it('splits detection into MUST-account vs information-only, and grounds on the corpus areas', () => {
    const r = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-catalog-brief-'));
    try {
      fs.mkdirSync(path.join(r, '.truecourse', 'specs'), { recursive: true });
      fs.writeFileSync(
        path.join(r, '.truecourse', 'specs', 'corpus.json'),
        JSON.stringify({
          docs: [
            { ref: 'docs/booking.md', areaTags: ['core/bookings'] },
            { ref: 'docs/slots.md', areaTags: ['core/bookings'] },
            { ref: 'docs/auth.md', areaTags: ['core/authentication'] },
          ],
        }),
      );
      const junk = { service: 'gstatic', evidence: [], source: 'http' as const };
      const briefing = dependencyCatalogBriefing(
        input(r, { detected: [STRIPE, junk] }),
        { dependencies: [] },
      );

      expect(briefing).toContain('core/bookings (2 docs)');
      expect(briefing).toMatch(/MUST be accounted for[\s\S]*stripe/);
      expect(briefing).toMatch(/INFORMATION ONLY[\s\S]*gstatic/);
      // The junk hostname never appears in the must-account section.
      const mustSection = briefing.split('INFORMATION ONLY')[0];
      expect(mustSection).not.toContain('gstatic');
    } finally {
      fs.rmSync(r, { recursive: true, force: true });
    }
  });
});

describe('foldCatalogDraft', () => {
  it('writes a new entry, and the machine-side registration of a supplied service', () => {
    const r = repo();

    const folded = foldCatalogDraft(
      input(r, { detected: [STRIPE] }),
      draft([{ name: 'stripe', class: 'supplied', evidence: 'src/pay.ts imports stripe' }]),
    );

    expect(folded).toEqual({ added: ['stripe'], alreadyDeclared: [] });
    const catalog = JSON.parse(fs.readFileSync(dependenciesPath(r), 'utf-8'));
    expect(catalog.dependencies).toEqual([
      {
        name: 'stripe',
        class: 'supplied',
        summary: 'src/pay.ts imports stripe',
        needs: [],
        services: ['stripe'],
        registration: {
          kind: 'env',
          vars: [
            {
              name: 'STRIPE_BASE_URL',
              description: 'the base URL the program reads stripe from',
              secret: false,
            },
          ],
        },
      },
    ]);
    // The INSTANCE skeleton lands in the gitignored overlay — the user's file.
    expect(JSON.parse(fs.readFileSync(dependenciesLocalPath(r), 'utf-8'))).toEqual({
      stripe: { env: { STRIPE_BASE_URL: '' } },
    });
  });

  // The committed/gitignored split is materialized by the store's ignore template:
  // the catalog and the findings ledger travel through git; the instances never do.
  it('keeps the values out of git and the declaration in it', () => {
    const lines = GITIGNORE_CONTENTS.split('\n').map((l) => l.trim());

    expect(lines).toContain('scenarios/dependencies.local.json');
    expect(lines).not.toContain('scenarios/dependencies.json');
    expect(lines.some((l) => l.includes('setup.findings.md'))).toBe(false);
  });

  it('is ADD-ONLY — an entry the catalog already declares is left byte-identical', () => {
    const r = repo();
    const existing = {
      dependencies: [
        {
          name: 'stripe',
          class: 'supplied',
          summary: 'a curated summary a human wrote',
          needs: [{ flowId: 'pay', need: 'a test-mode key' }],
          registration: {
            kind: 'env',
            vars: [{ name: 'STRIPE_API_KEY', description: 'a test-mode key', secret: true }],
          },
        },
      ],
    };
    fs.mkdirSync(path.dirname(dependenciesPath(r)), { recursive: true });
    fs.writeFileSync(dependenciesPath(r), JSON.stringify(existing, null, 2) + '\n');
    const before = fs.readFileSync(dependenciesPath(r), 'utf-8');

    const folded = foldCatalogDraft(
      input(r, { detected: [STRIPE] }),
      draft([{ name: 'stripe', class: 'seedable', evidence: 'a re-classification nobody asked for' }]),
    );

    expect(folded).toEqual({ added: [], alreadyDeclared: ['stripe'] });
    expect(fs.readFileSync(dependenciesPath(r), 'utf-8')).toBe(before);
  });

  it('never overwrites an instance row the user already registered', () => {
    const r = repo();
    fs.mkdirSync(path.dirname(dependenciesLocalPath(r)), { recursive: true });
    fs.writeFileSync(
      dependenciesLocalPath(r),
      JSON.stringify({ stripe: { env: { STRIPE_BASE_URL: 'https://mine.example' } } }),
    );

    foldCatalogDraft(
      input(r, { detected: [STRIPE] }),
      draft([{ name: 'stripe', class: 'supplied', evidence: 'x' }]),
    );

    expect(JSON.parse(fs.readFileSync(dependenciesLocalPath(r), 'utf-8'))).toEqual({
      stripe: { env: { STRIPE_BASE_URL: 'https://mine.example' } },
    });
  });

  // A supplied entry with no detected variables is a real-world input on disk —
  // the honest default, never a fabricated env var.
  it('registers an undetected supplied entry as a path, and writes no overlay row', () => {
    const r = repo();

    foldCatalogDraft(
      input(r),
      draft([{ name: 'supplied-project', class: 'supplied', evidence: 'the analyzer needs a real checkout' }]),
    );

    expect(loadDependencyCatalog(r).dependencies[0].registration).toEqual({
      kind: 'path',
      description: 'the analyzer needs a real checkout',
    });
    expect(fs.existsSync(dependenciesLocalPath(r))).toBe(false);
  });

  // §7.6's read-surface move: after the fold, the External APIs surface lists the
  // service through its CATALOG row — no `api` block required.
  it('makes the folded entry visible to the externals view', () => {
    const r = repo();

    foldCatalogDraft(
      input(r, { detected: [STRIPE] }),
      draft([{ name: 'stripe', class: 'supplied', evidence: 'src/pay.ts imports stripe' }]),
    );

    const row = readGuardExternalsView(r).services.find((s) => s.service === 'stripe');
    expect(row?.catalog?.dependency).toBe('stripe');
  });

  it('stores a condition as parsed predicates, not as the raw string', () => {
    const r = repo();

    foldCatalogDraft(
      input(r),
      draft([
        {
          name: 'anthropic',
          class: 'supplied',
          evidence: 'the llm rules call it',
          condition: 'config-value:llm.transport=api :: only in api mode',
        },
      ]),
    );

    expect(loadDependencyCatalog(r).dependencies[0].condition).toEqual({
      predicates: [{ kind: 'config-value', key: 'llm.transport', value: 'api' }],
      sentence: 'only in api mode',
    });
  });
});

// ---------------------------------------------------------------------------
// The read surface §7.6 moves onto the catalog
// ---------------------------------------------------------------------------

describe('externalServiceStates', () => {
  function writeCatalog(r: string, dependencies: unknown[]): void {
    fs.mkdirSync(path.dirname(dependenciesPath(r)), { recursive: true });
    fs.writeFileSync(dependenciesPath(r), JSON.stringify({ dependencies }, null, 2));
  }

  it('lets the catalog answer for a service the recipe calls unprovided', () => {
    const r = repo();
    writeCatalog(r, [
      {
        name: 'stripe',
        class: 'supplied',
        summary: 'the payment account',
        services: ['stripe'],
        registration: {
          kind: 'env',
          vars: [{ name: 'STRIPE_BASE_URL', description: 'base url', secret: false }],
        },
      },
    ]);
    fs.writeFileSync(
      dependenciesLocalPath(r),
      JSON.stringify({ stripe: { env: { STRIPE_BASE_URL: 'https://stripe.test' } } }),
    );

    const states = externalServiceStates(r, { stripe: { baseUrlEnv: 'STRIPE_BASE_URL' } }, {
      recipeStates: new Map([['stripe', 'unprovided']]),
    });

    expect(states.get('stripe')).toBe('provided');
  });

  it('falls back to the recipe for a service only the recipe declares', () => {
    const r = repo();

    const states = externalServiceStates(r, { twilio: { baseUrlEnv: 'TWILIO_BASE_URL' } }, {
      recipeStates: new Map([['twilio', 'unprovided']]),
    });

    expect(states.get('twilio')).toBe('unprovided');
  });

  // A broken catalog blanks the CATALOG half only — the recipe half is still true.
  it('returns the recipe map when the catalog file cannot be read', () => {
    const r = repo();
    fs.mkdirSync(path.dirname(dependenciesPath(r)), { recursive: true });
    fs.writeFileSync(dependenciesPath(r), '{ not json');

    const states = externalServiceStates(r, { twilio: { baseUrlEnv: 'TWILIO_BASE_URL' } }, {
      recipeStates: new Map([['twilio', 'incomplete']]),
    });

    expect([...states]).toEqual([['twilio', 'incomplete']]);
  });
});

// ---------------------------------------------------------------------------
// The seam the engine's catalog step calls
// ---------------------------------------------------------------------------

describe('buildCatalogSession', () => {
  function stubContext(driver: SessionDriver | (() => never)): {
    context: GuardSetupSessionContext;
    acquires: number;
  } {
    const state = { acquires: 0 };
    const { persistence } = memoryPersistence();
    const context: GuardSetupSessionContext = {
      async acquire() {
        state.acquires++;
        if (typeof driver === 'function') driver();
        return { runId: 'run-catalog', driver: driver as SessionDriver, persistence };
      },
      runId: () => (state.acquires > 0 ? 'run-catalog' : undefined),
      note: () => {},
      addSpend: () => {},
      usageTotals: () => null,
      finish: () => {},
    };
    return {
      context,
      get acquires() {
        return state.acquires;
      },
    };
  }

  const scripted = (value: CatalogDraft): SessionDriver =>
    stubDriver(async (call) => {
      await call.emit(toolResult('check_catalog', 'The draft is valid.'));
      return outcome(value);
    }).driver;

  it('folds the session draft and reports what it added', async () => {
    const r = repo();
    const session = buildCatalogSession(
      stubContext(scripted(draft([{ name: 'app-database', class: 'seedable', evidence: 'schema.prisma' }])))
        .context,
    );

    const result = await session(input(r));

    expect(result).toEqual({
      status: 'ok',
      added: ['app-database'],
      findings: [],
      sessionRunId: 'run-catalog',
    });
    expect(loadDependencyCatalog(r).dependencies.map((d) => d.name)).toEqual(['app-database']);
  });

  it('refuses a draft the fold would not accept, and writes nothing', async () => {
    const r = repo();
    const session = buildCatalogSession(
      stubContext(scripted(draft([{ name: 'app-database', class: 'seedable', evidence: 'x' }]))).context,
    );

    const result = await session(input(r, { detected: [STRIPE] }));

    expect(result.status).toBe('failed');
    if (result.status !== 'failed') return;
    expect(result.reason).toContain('"stripe"');
    expect(fs.existsSync(dependenciesPath(r))).toBe(false);
  });

  // The cache hit still FOLDS — add-only against a catalog that already holds the
  // entries adds nothing, which is what makes the write idempotent.
  it('answers a warm cache without a session, and the second write is byte-identical', async () => {
    const r = repo();
    const value = draft([{ name: 'app-database', class: 'seedable', evidence: 'schema.prisma' }]);
    const first = buildCatalogSession(stubContext(scripted(value)).context);
    await first(input(r));
    const after = fs.readFileSync(dependenciesPath(r), 'utf-8');

    const stub = stubContext(() => {
      throw new Error('a cache hit must not acquire a driver');
    });
    const result = await buildCatalogSession(stub.context)(input(r));

    expect(result).toMatchObject({ status: 'ok', fromCache: true, added: [] });
    expect(stub.acquires).toBe(0);
    expect(fs.readFileSync(dependenciesPath(r), 'utf-8')).toBe(after);
  });

  it('keys the cache on the step fingerprint, so a moved catalog re-runs', async () => {
    const r = repo();
    const value = draft([{ name: 'app-database', class: 'seedable', evidence: 'schema.prisma' }]);
    await buildCatalogSession(stubContext(scripted(value)).context)(input(r, { fingerprint: 'fp-1' }));

    const stub = stubContext(scripted(value));
    const result = await buildCatalogSession(stub.context)(input(r, { fingerprint: 'fp-2' }));

    expect(result).toMatchObject({ status: 'ok' });
    expect(stub.acquires).toBe(1);
  });

  // The findings ledger is the doc-bug feed: one section per RUN, and a cache hit
  // re-appending them every time would drown it.
  it('appends findings once, and never on a cache hit', async () => {
    const r = repo();
    const value = draft(
      [{ name: 'app-database', class: 'seedable', evidence: 'schema.prisma' }],
      ['README says sqlite; schema.prisma declares postgres'],
    );

    await buildCatalogSession(stubContext(scripted(value)).context)(input(r));
    const ledger = fs.readFileSync(guardSetupFindingsPath(r), 'utf-8');
    expect(ledger).toContain('README says sqlite; schema.prisma declares postgres');
    expect(ledger).toMatch(/## run-catalog/);

    await buildCatalogSession(
      stubContext(() => {
        throw new Error('cache hit');
      }).context,
    )(input(r));

    expect(fs.readFileSync(guardSetupFindingsPath(r), 'utf-8')).toBe(ledger);
  });

  // A pre-seeded entry under the session's own key is a hit — the key folds the
  // prompt fingerprint, so editing the prompt invalidates exactly this kind.
  it('reads a pre-seeded cache entry under `guard/dependency-catalog`', async () => {
    const r = repo();
    const def = dependencyCatalogSessionDef(input(r), { dependencies: [] });
    const key = keyFor(def.systemPrompt, 'fp-1');
    await setCacheEntry(r, DEPENDENCY_CATALOG_CACHE_NAME, key, {
      entries: [{ name: 'seeded', class: 'seedable', evidence: 'pre-seeded' }],
      findings: [],
    });
    const stub = stubContext(() => {
      throw new Error('a pre-seeded entry must not acquire a driver');
    });

    const result = await buildCatalogSession(stub.context)(input(r));

    expect(result).toMatchObject({ status: 'ok', fromCache: true, added: ['seeded'] });
    expect(stub.acquires).toBe(0);
  });

  it('carries the budget and the check_catalog precondition', () => {
    const def = dependencyCatalogSessionDef(input('/tmp/x'), { dependencies: [] });

    expect(def.kind).toBe(DEPENDENCY_CATALOG_SESSION_KIND);
    expect(def.budget).toEqual(DEPENDENCY_CATALOG_BUDGET);
    expect(def.outcomePrecondition?.tool).toBe('check_catalog');
    expect(def.tools.map((t) => t.name)).toEqual([
      'read_file',
      'search_repo',
      'run_program',
      'check_catalog',
    ]);
  });
});

/** The seam's own key: sha256(promptFingerprint :: step fingerprint). */
function keyFor(systemPrompt: string, stepFingerprint: string): string {
  return createHash('sha256')
    .update(`${promptFingerprint(systemPrompt)}::${stepFingerprint}`)
    .digest('hex');
}
