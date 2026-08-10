/**
 * The externals read/write surface the UIs drive.
 *
 * The VIEW is a three-way join — detection (`guard/result.json`), declaration
 * (`recipe.json`), resolution (the overlay + the host env) — plus the per-service
 * blocked-flow count parsed back out of the last generate's gaps.
 *
 * The WRITE is the secrecy split: declarations to the committed recipe, values to
 * the gitignored overlay, both byte-stable and both no-ops when nothing changed.
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  guardNeedsSetupServices,
  readGuardExternalSetupIndex,
  readGuardExternalsView,
  writeGuardExternals,
  GuardExternalsWriteError,
} from '../../packages/core/src/commands/guard-externals';
import { GITIGNORE_CONTENTS } from '../../packages/core/src/config/paths';
import { computeRecipeFingerprint } from '../../packages/guard-runner/src/index';
import { deriveNeedsSetup } from '../../packages/shared/src/index';
import type { GuardGenerateReport } from '../../packages/shared/src/index';

const repos: string[] = [];
afterEach(() => {
  while (repos.length) fs.rmSync(repos.pop()!, { recursive: true, force: true });
});

function repo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-externals-'));
  repos.push(dir);
  return dir;
}

const recipeFile = (r: string): string => path.join(r, '.truecourse', 'scenarios', 'recipe.json');
const localFile = (r: string): string => path.join(r, '.truecourse', 'scenarios', 'externals.local.json');
const catalogFile = (r: string): string => path.join(r, '.truecourse', 'scenarios', 'dependencies.json');
const catalogLocalFile = (r: string): string =>
  path.join(r, '.truecourse', 'scenarios', 'dependencies.local.json');

function writeJson(file: string, data: unknown, trailingNewline = true): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + (trailingNewline ? '\n' : ''));
}

function baseRecipe(externals?: Record<string, unknown>): Record<string, unknown> {
  return {
    build: 'true',
    entry: ['node', 'bin.mjs'],
    api: { serve: ['node', 'server.mjs'], healthPath: '/health', ...(externals ? { externals } : {}) },
  };
}

/**
 * The COMMITTED manifest, one flow per blocked-on gap — where the blocked-flow
 * counts are read from. `guard/result.json` is gitignored, so a clone only ever
 * inherits this file.
 */
function writeBlockedManifest(r: string, gaps: { flowId: string; reason: string; surface?: string }[]): void {
  const byFlow = new Map<string, { flowId: string; reason: string; surface?: string }[]>();
  for (const g of gaps) byFlow.set(g.flowId, [...(byFlow.get(g.flowId) ?? []), g]);
  writeJson(path.join(r, '.truecourse', 'scenarios', 'manifest.json'), {
    version: 3,
    flows: [...byFlow].map(([flowId, rows]) => ({
      flowId,
      flowFingerprint: `sha256:${flowId}`,
      bindings: [{ doc: 'docs/a.md', anchor: flowId, fingerprint: `sha256:${flowId}-section` }],
      scenarios: [],
      journeys: [],
      generationInputsHash: `sha256:${flowId}-inputs`,
      gaps: rows.map((g) => ({ surface: g.surface ?? 'api', kind: 'blocked-on', reason: g.reason })),
    })),
  });
}

/** A generate report carrying detection + two blocked-on gaps naming open-meteo. */
function writeReport(r: string, report: Partial<GuardGenerateReport> = {}): void {
  const file = path.join(r, '.truecourse', 'guard', 'result.json');
  writeJson(file, {
    generatedAt: '2026-07-28T00:00:00Z',
    status: 'ok',
    noChanges: false,
    sectionsTotal: 1,
    sectionsChanged: 1,
    skippedUnchanged: 0,
    written: [],
    coverageGaps: [],
    birthFindings: [],
    errors: [],
    extractionFailures: [],
    orphaned: [],
    ...report,
  });
}

describe('readGuardExternalsView', () => {
  it('is an honest empty view on a repo with no recipe and no report', () => {
    const r = repo();
    const view = readGuardExternalsView(r);
    expect(view.services).toEqual([]);
    expect(view.recipeValid).toBe(false);
    expect(view.detectionAvailable).toBe(false);
    expect(view.invalidReason).toBeNull();
    expect(view.recipePath).toBe(recipeFile(r));
    expect(view.localPath).toBe(localFile(r));
  });

  it('joins detected + declared + resolved + blocked-flow counts', () => {
    const r = repo();
    writeJson(
      recipeFile(r),
      baseRecipe({
        'open-meteo': {
          baseUrlEnv: 'GEOCODING_BASE_URL',
          baseUrl: 'https://sandbox.test',
          mode: 'sandbox',
          env: { GEO_KEY: {} },
        },
      }),
    );
    writeJson(localFile(r), { 'open-meteo': { env: { GEO_KEY: 'sk-local' } } });
    writeReport(r, {
      externalServices: [
        {
          service: 'open-meteo',
          category: 'ai',
          evidence: [{ filePath: 'src/geo.ts', importSource: 'open-meteo' }],
          baseUrlEnv: 'OM_BASE',
        },
        { service: 'stripe', category: 'payment', evidence: [{ filePath: 'src/pay.ts', importSource: 'stripe' }] },
      ],
    });
    writeBlockedManifest(r, [
      { flowId: 'f1', reason: 'blocked on open-meteo: forecast' },
      { flowId: 'f2', reason: 'blocked on open-meteo, stripe: pay' },
      // The same flow blocked on the same service twice counts once.
      { flowId: 'f1', reason: 'blocked on open-meteo: again', surface: 'cli' },
    ]);

    const view = readGuardExternalsView(r);
    expect(view.detectionAvailable).toBe(true);
    expect(view.services.map((s) => s.service)).toEqual(['open-meteo', 'stripe']);

    const [om, stripe] = view.services;
    expect(om).toMatchObject({
      declared: true,
      detected: true,
      state: 'provided',
      category: 'ai',
      // The declaration wins over the detector's suggestion.
      baseUrlEnv: 'GEOCODING_BASE_URL',
      baseUrlEnvSource: 'recipe',
      baseUrl: 'https://sandbox.test',
      mode: 'sandbox',
      blockedFlows: 2,
    });
    expect(om.requirements.find((q) => q.envVar === 'GEO_KEY')).toMatchObject({
      resolved: true,
      source: 'local',
      secret: true,
    });
    expect(om.evidence).toEqual([{ filePath: 'src/geo.ts', importSource: 'open-meteo' }]);

    expect(stripe).toMatchObject({
      declared: false,
      detected: true,
      state: 'unprovided',
      baseUrlEnv: null,
      baseUrlEnvSource: null,
      blockedFlows: 1,
    });
    expect(stripe.requirements).toEqual([]);
  });

  // A service detected from a bare HTTP call has no category and several
  // override variables. All of it must survive the join, or the form can only offer
  // the one variable and the card claims a kind it never learned.
  it('carries an HTTP-detected service whole: no category, every base-URL env, URL evidence', () => {
    const r = repo();
    writeJson(recipeFile(r), baseRecipe({}));
    writeReport(r, {
      externalServices: [
        {
          service: 'open-meteo',
          source: 'http',
          evidence: [{ filePath: 'src/config.ts', url: 'https://api.open-meteo.com' }],
          baseUrlEnv: 'GEOCODING_BASE_URL',
          baseUrlEnvs: [
            {
              envVar: 'GEOCODING_BASE_URL',
              defaultUrl: 'https://geocoding-api.open-meteo.com',
              confidence: 'literal-fallback',
            },
            {
              envVar: 'FORECAST_BASE_URL',
              defaultUrl: 'https://api.open-meteo.com',
              confidence: 'literal-fallback',
            },
          ],
        },
      ],
    });

    const [om] = readGuardExternalsView(r).services;
    expect(om).toMatchObject({
      service: 'open-meteo',
      declared: false,
      detected: true,
      detectedVia: 'http',
      baseUrlEnv: 'GEOCODING_BASE_URL',
      baseUrlEnvSource: 'detected',
    });
    expect(om.category).toBeUndefined();
    expect(om.baseUrlEnvs.map((e) => e.envVar)).toEqual(['GEOCODING_BASE_URL', 'FORECAST_BASE_URL']);
    expect(om.baseUrlEnvs[1].defaultUrl).toBe('https://api.open-meteo.com');
    expect(om.evidence).toEqual([{ filePath: 'src/config.ts', url: 'https://api.open-meteo.com' }]);
  });

  it('names the unresolved requirement of an incomplete account, and surfaces stray overlay keys', () => {
    const r = repo();
    writeJson(
      recipeFile(r),
      baseRecipe({
        'open-meteo': { baseUrlEnv: 'GEO_BASE', env: { GEO_KEY: { valueFromEnv: 'TC_UNSET_KEY_62' } } },
      }),
    );
    writeJson(localFile(r), {
      'open-meteo': { baseUrl: 'https://sandbox.test', env: { STRAY: 'x' } },
      ghost: { baseUrl: 'https://ghost.test' },
    });
    const view = readGuardExternalsView(r);
    expect(view.services[0].state).toBe('incomplete');
    expect(view.services[0].requirements.find((q) => !q.resolved)?.reason).toContain('TC_UNSET_KEY_62');
    expect(view.services[0].undeclaredLocalEnv).toEqual(['STRAY']);
    expect(view.unknownLocalServices).toEqual(['ghost']);
  });

  it('reports an unparseable recipe as invalid without losing the detected list', () => {
    const r = repo();
    fs.mkdirSync(path.dirname(recipeFile(r)), { recursive: true });
    fs.writeFileSync(recipeFile(r), '{ broken');
    writeReport(r, {
      externalServices: [{ service: 'stripe', category: 'payment', evidence: [] }],
    });
    const view = readGuardExternalsView(r);
    expect(view.recipeValid).toBe(false);
    expect(view.invalidReason).toContain('recipe.json');
    expect(view.services.map((s) => s.service)).toEqual(['stripe']);
  });
});

describe('the needs-setup derivation off the view', () => {
  /** A repo where open-meteo is detected + declared but unconfigured, stripe is
   *  detected only, and both have flows blocked on them. */
  function needsSetupRepo(): string {
    const r = repo();
    writeJson(recipeFile(r), baseRecipe({ 'open-meteo': { baseUrlEnv: 'FORECAST_BASE_URL' } }));
    writeReport(r, {
      externalServices: [
        { service: 'open-meteo', evidence: [{ filePath: 'src/config.ts', url: 'https://api.open-meteo.com' }], source: 'http' },
        { service: 'stripe', category: 'payment', evidence: [{ filePath: 'src/pay.ts', importSource: 'stripe' }] },
      ],
    });
    writeBlockedManifest(r, [
      { flowId: 'f1', reason: 'blocked on open-meteo: forecast' },
      { flowId: 'f2', reason: 'blocked on open-meteo: history' },
      { flowId: 'f3', reason: 'blocked on stripe: pay' },
      // A generic noun is nobody's service — it must not invent a row.
      { flowId: 'f4', reason: 'blocked on external-service: something' },
    ]);
    return r;
  }

  it('indexes every KNOWN service — declared-but-unconfigured and detected-only alike', () => {
    expect(readGuardExternalSetupIndex(needsSetupRepo())).toEqual({
      'open-meteo': 'unprovided',
      stripe: 'unprovided',
    });
    // A repo that knows nothing indexes nothing, so every gap stays plain blocked.
    expect(readGuardExternalSetupIndex(repo())).toEqual({});
  });

  it('ranks the services with waiting flows, most-blocked first', () => {
    expect(guardNeedsSetupServices(readGuardExternalsView(needsSetupRepo()))).toEqual([
      { service: 'open-meteo', state: 'unprovided', blockedFlows: 2 },
      { service: 'stripe', state: 'unprovided', blockedFlows: 1 },
    ]);
  });

  it('sinks a PROVIDED service below the outstanding ones — its flows just need a re-generate', () => {
    const r = repo();
    writeJson(
      recipeFile(r),
      baseRecipe({
        'open-meteo': { baseUrlEnv: 'FORECAST_BASE_URL' },
        stripe: { baseUrlEnv: 'STRIPE_BASE_URL', baseUrl: 'https://sandbox.stripe.test' },
      }),
    );
    writeReport(r);
    writeBlockedManifest(r, [
      { flowId: 'f1', reason: 'blocked on open-meteo: forecast' },
      { flowId: 'f2', reason: 'blocked on stripe: pay' },
      { flowId: 'f3', reason: 'blocked on stripe: refund' },
    ]);
    const view = readGuardExternalsView(r);
    expect(readGuardExternalSetupIndex(r).stripe).toBe('provided');
    // stripe has MORE blocked flows and still sorts last: it needs no setup.
    expect(guardNeedsSetupServices(view).map((s) => s.service)).toEqual(['open-meteo', 'stripe']);
  });

  it('a service no flow is blocked on is not a needs-setup row at all', () => {
    const r = repo();
    writeJson(recipeFile(r), baseRecipe({ 'open-meteo': { baseUrlEnv: 'FORECAST_BASE_URL' } }));
    writeReport(r);
    expect(guardNeedsSetupServices(readGuardExternalsView(r))).toEqual([]);
  });

  // A teammate's clone (and every supplied sandbox instance, which copies the repo)
  // has the committed manifest and NO gitignored run-result. The blocked counts must
  // survive that, or the page tells them nothing is waiting on stripe.
  it('counts blocked flows from the committed manifest alone — no guard/result.json', () => {
    const r = repo();
    writeJson(recipeFile(r), baseRecipe({ stripe: { baseUrlEnv: 'STRIPE_BASE_URL' } }));
    writeBlockedManifest(r, [
      { flowId: 'f1', reason: 'blocked on stripe: pay' },
      { flowId: 'f2', reason: 'blocked on stripe: refund' },
    ]);

    expect(fs.existsSync(path.join(r, '.truecourse', 'guard', 'result.json'))).toBe(false);
    expect(readGuardExternalsView(r).services).toMatchObject([{ service: 'stripe', blockedFlows: 2 }]);
    expect(guardNeedsSetupServices(readGuardExternalsView(r))).toEqual([
      { service: 'stripe', state: 'unprovided', blockedFlows: 2 },
    ]);
  });
});

describe('the missing-data key in the setup index', () => {
  const seedBlock = {
    command: 'node scripts/guard-seed.mjs',
    script: 'scripts/guard-seed.mjs',
    provides: { fixtures: { org: ['id'] } },
  };

  it('adds `missing-data → provided` once the recipe declares an api.seed', () => {
    const r = repo();
    const withSeed = baseRecipe();
    (withSeed.api as Record<string, unknown>).seed = seedBlock;
    writeJson(recipeFile(r), withSeed);

    // The gap can now render in the "setup done — re-run guard generate" sub-state.
    expect(readGuardExternalSetupIndex(r)['missing-data']).toBe('provided');
    expect(deriveNeedsSetup('blocked on missing-data, an org: list orgs', readGuardExternalSetupIndex(r))).toEqual({
      services: [],
      provided: ['missing-data'],
    });
  });

  it('reads `incomplete` when the CURRENT seed already fed the last generate — "re-run" would loop', () => {
    const r = repo();
    const withSeed = baseRecipe();
    (withSeed.api as Record<string, unknown>).seed = seedBlock;
    writeJson(recipeFile(r), withSeed);
    // The last generate recorded the fingerprint of exactly this recipe + seed, so
    // a surviving missing-data gap is its verdict ON this seed — the gap must
    // render as a to-do ("extend the seed"), never as "already set up".
    writeReport(r, { recipeFingerprint: computeRecipeFingerprint(r) });

    expect(readGuardExternalSetupIndex(r)['missing-data']).toBe('incomplete');
    expect(deriveNeedsSetup('blocked on missing-data, an org: list orgs', readGuardExternalSetupIndex(r))).toEqual({
      services: ['missing-data'],
      provided: [],
    });
  });

  it('reads `provided` again the moment the seed is EDITED after that generate', () => {
    const r = repo();
    const withSeed = baseRecipe();
    (withSeed.api as Record<string, unknown>).seed = seedBlock;
    writeJson(recipeFile(r), withSeed);
    writeReport(r, { recipeFingerprint: 'sha256:a-fingerprint-the-working-tree-no-longer-matches' });

    // The fingerprint moved, so the next generate re-authors — "re-run" is honest.
    expect(readGuardExternalSetupIndex(r)['missing-data']).toBe('provided');
  });

  it('reads `provided` for a report that predates the fingerprint field — never a fabricated verdict', () => {
    const r = repo();
    const withSeed = baseRecipe();
    (withSeed.api as Record<string, unknown>).seed = seedBlock;
    writeJson(recipeFile(r), withSeed);
    writeReport(r);

    expect(readGuardExternalSetupIndex(r)['missing-data']).toBe('provided');
  });

  it('is ABSENT without a seed — the gap stays plain blocked-on, never a form to nowhere', () => {
    const r = repo();
    writeJson(recipeFile(r), baseRecipe());
    expect(readGuardExternalSetupIndex(r)['missing-data']).toBeUndefined();
    expect(deriveNeedsSetup('blocked on missing-data, an org: list orgs', readGuardExternalSetupIndex(r))).toBeNull();
    // …and so is a repo with no recipe at all.
    expect(readGuardExternalSetupIndex(repo())['missing-data']).toBeUndefined();
  });
});

describe('writeGuardExternals', () => {
  it('declares in the recipe and lands the secret in the gitignored overlay', () => {
    const r = repo();
    writeJson(recipeFile(r), baseRecipe());
    const view = writeGuardExternals(r, {
      externals: {
        'open-meteo': {
          baseUrlEnv: 'GEOCODING_BASE_URL',
          baseUrl: 'https://sandbox.test',
          mode: 'sandbox',
          description: 'team sandbox',
          env: { GEO_KEY: { value: 'sk-secret' }, GEO_ACCOUNT: { valueFromEnv: 'HOST_GEO_ACCOUNT' } },
        },
      },
    });

    const recipe = JSON.parse(fs.readFileSync(recipeFile(r), 'utf-8'));
    expect(recipe.api.externals['open-meteo']).toEqual({
      baseUrlEnv: 'GEOCODING_BASE_URL',
      baseUrl: 'https://sandbox.test',
      mode: 'sandbox',
      // The secret's variable is DECLARED, its value is not committed.
      env: { GEO_ACCOUNT: { valueFromEnv: 'HOST_GEO_ACCOUNT' }, GEO_KEY: {} },
      description: 'team sandbox',
    });
    expect(fs.readFileSync(recipeFile(r), 'utf-8')).not.toContain('sk-secret');
    expect(JSON.parse(fs.readFileSync(localFile(r), 'utf-8'))).toEqual({
      'open-meteo': { env: { GEO_KEY: 'sk-secret' } },
    });
    // The write answers with the fresh view (no follow-up GET needed).
    expect(view.services[0].state).toBe('incomplete'); // HOST_GEO_ACCOUNT is unset
    expect(view.services[0].baseUrl).toBe('https://sandbox.test');
  });

  it('commits an explicitly inline value, and stores a base URL locally on request', () => {
    const r = repo();
    writeJson(recipeFile(r), baseRecipe());
    writeGuardExternals(r, {
      externals: {
        svc: {
          baseUrlEnv: 'SVC_BASE',
          baseUrl: 'https://local-only.test',
          baseUrlTarget: 'local',
          env: { SVC_REGION: { value: 'eu-west-1', inline: true } },
        },
      },
    });
    const recipe = JSON.parse(fs.readFileSync(recipeFile(r), 'utf-8'));
    expect(recipe.api.externals.svc).toEqual({
      baseUrlEnv: 'SVC_BASE',
      env: { SVC_REGION: { value: 'eu-west-1' } },
    });
    expect(JSON.parse(fs.readFileSync(localFile(r), 'utf-8'))).toEqual({
      svc: { baseUrl: 'https://local-only.test' },
    });
    expect(readGuardExternalsView(r).services[0].state).toBe('provided');
  });

  it('preserves unrelated recipe content byte-for-byte, and a no-op write touches nothing', () => {
    const r = repo();
    const original = {
      build: 'pnpm build',
      install: 'pnpm i',
      entry: ['node', 'bin.mjs'],
      env: { NODE_ENV: 'test' },
      api: {
        serve: ['node', 'server.mjs'],
        healthPath: '/health',
        credentials: { 'api-key': { header: 'Authorization', value: 'Bearer x' } },
      },
    };
    writeJson(recipeFile(r), original);
    const before = fs.readFileSync(recipeFile(r), 'utf-8');

    writeGuardExternals(r, { externals: { svc: { baseUrlEnv: 'SVC_BASE', baseUrl: 'https://s.test' } } });
    const after = JSON.parse(fs.readFileSync(recipeFile(r), 'utf-8'));
    expect(after.install).toBe('pnpm i');
    expect(after.env).toEqual({ NODE_ENV: 'test' });
    expect(after.api.credentials).toEqual(original.api.credentials);
    // The 2-space format and the trailing newline survive.
    const patched = fs.readFileSync(recipeFile(r), 'utf-8');
    expect(patched.endsWith('\n')).toBe(true);
    expect(patched).toContain('\n  "build": "pnpm build",');
    expect(patched).not.toBe(before);

    // Re-applying the identical patch changes no bytes and no mtime.
    const mtime = fs.statSync(recipeFile(r)).mtimeMs;
    writeGuardExternals(r, { externals: { svc: { baseUrlEnv: 'SVC_BASE', baseUrl: 'https://s.test' } } });
    expect(fs.readFileSync(recipeFile(r), 'utf-8')).toBe(patched);
    expect(fs.statSync(recipeFile(r)).mtimeMs).toBe(mtime);
  });

  it('a recipe written without a trailing newline stays that way', () => {
    const r = repo();
    writeJson(recipeFile(r), baseRecipe(), false);
    writeGuardExternals(r, { externals: { svc: { baseUrlEnv: 'SVC_BASE' } } });
    expect(fs.readFileSync(recipeFile(r), 'utf-8').endsWith('\n')).toBe(false);
  });

  it('keeps env vars a patch does not mention, and drops the ones it nulls', () => {
    const r = repo();
    writeJson(recipeFile(r), baseRecipe());
    writeGuardExternals(r, {
      externals: {
        svc: { baseUrlEnv: 'B', env: { KEEP: { value: 'k' }, DROP: { value: 'd' } } },
      },
    });
    writeGuardExternals(r, { externals: { svc: { baseUrlEnv: 'B', env: { DROP: null } } } });
    const recipe = JSON.parse(fs.readFileSync(recipeFile(r), 'utf-8'));
    expect(Object.keys(recipe.api.externals.svc.env)).toEqual(['KEEP']);
    expect(JSON.parse(fs.readFileSync(localFile(r), 'utf-8')).svc.env).toEqual({ KEEP: 'k' });
  });

  // Extra base URLs are committed declarations, and the view reports them.
  it('writes extra base URLs to the recipe as `endpoints`, and keeps overlay overrides', () => {
    const r = repo();
    writeJson(recipeFile(r), baseRecipe());
    const view = writeGuardExternals(r, {
      externals: {
        'open-meteo': {
          baseUrlEnv: 'FORECAST_BASE_URL',
          baseUrl: 'https://api.open-meteo.test',
          endpoints: { GEOCODING_BASE_URL: 'https://geo.open-meteo.test' },
          env: { GEO_KEY: { value: 'sk-secret' } },
        },
      },
    });

    const recipe = JSON.parse(fs.readFileSync(recipeFile(r), 'utf-8'));
    expect(recipe.api.externals['open-meteo'].endpoints).toEqual({
      GEOCODING_BASE_URL: 'https://geo.open-meteo.test',
    });
    // An origin is not a secret: it is committed, never written to the overlay.
    const overlay = JSON.parse(fs.readFileSync(localFile(r), 'utf-8'));
    expect(overlay['open-meteo'].endpoints).toBeUndefined();
    const service = view.services.find((s) => s.service === 'open-meteo')!;
    expect(service.endpoints).toEqual({ GEOCODING_BASE_URL: 'https://geo.open-meteo.test' });
    expect(service.state).toBe('provided');

    // A later patch that says nothing about endpoints keeps them.
    const again = writeGuardExternals(r, {
      externals: { 'open-meteo': { baseUrlEnv: 'FORECAST_BASE_URL', baseUrl: 'https://api.open-meteo.test' } },
    });
    expect(again.services[0].endpoints).toEqual({ GEOCODING_BASE_URL: 'https://geo.open-meteo.test' });

    // …and a null drops it, with its per-developer override.
    const dropped = writeGuardExternals(r, {
      externals: {
        'open-meteo': {
          baseUrlEnv: 'FORECAST_BASE_URL',
          baseUrl: 'https://api.open-meteo.test',
          endpoints: { GEOCODING_BASE_URL: null },
        },
      },
    });
    expect(dropped.services[0].endpoints).toEqual({});
  });

  it('removes a service from both files, deleting the overlay when it empties', () => {
    const r = repo();
    writeJson(recipeFile(r), baseRecipe());
    writeGuardExternals(r, {
      externals: { svc: { baseUrlEnv: 'B', baseUrl: 'https://b.test', env: { K: { value: 'k' } } } },
    });
    expect(fs.existsSync(localFile(r))).toBe(true);
    writeGuardExternals(r, { externals: { svc: null } });
    const recipe = JSON.parse(fs.readFileSync(recipeFile(r), 'utf-8'));
    expect(recipe.api.externals).toBeUndefined();
    expect(fs.existsSync(localFile(r))).toBe(false);
  });

  it('refuses a write with no recipe, or a declaration that would not load', () => {
    const bare = repo();
    expect(() => writeGuardExternals(bare, { externals: {} })).toThrow(GuardExternalsWriteError);

    const clash = repo();
    writeJson(recipeFile(clash), baseRecipe({ a: { baseUrlEnv: 'SHARED' } }));
    expect(() => writeGuardExternals(clash, { externals: { b: { baseUrlEnv: 'SHARED' } } })).toThrow(
      /exactly one owner/,
    );
    // The refused write left the file untouched.
    expect(JSON.parse(fs.readFileSync(recipeFile(clash), 'utf-8')).api.externals.b).toBeUndefined();
  });

  it('refuses to write over a broken overlay rather than clobbering it', () => {
    const r = repo();
    writeJson(recipeFile(r), baseRecipe());
    fs.writeFileSync(localFile(r), '{ broken');
    expect(() => writeGuardExternals(r, { externals: { svc: { baseUrlEnv: 'B' } } })).toThrow(
      /externals\.local\.json/,
    );
    expect(fs.readFileSync(localFile(r), 'utf-8')).toBe('{ broken');
  });
});

describe('external services without an api block (the dependency catalog)', () => {
  it('lists a catalog-declared service with its contributed requirement, on a cli-only repo', () => {
    const r = repo();
    writeJson(recipeFile(r), { build: 'true', entry: ['node', 'bin.mjs'] });
    writeJson(catalogFile(r), {
      dependencies: [
        {
          name: 'open-meteo',
          class: 'supplied',
          service: 'open-meteo',
          summary: 'the geocoding account the CLI calls',
          registration: {
            kind: 'env',
            vars: [{ name: 'GEO_KEY', description: 'the api key', secret: true }],
          },
          needs: [{ flowId: 'f1', need: 'a key with quota for one lookup' }],
        },
      ],
    });

    const unprovided = readGuardExternalsView(r);
    expect(unprovided.services.map((s) => s.service)).toEqual(['open-meteo']);
    expect(unprovided.services[0]).toMatchObject({
      declared: true,
      state: 'unprovided',
      catalog: {
        dependency: 'open-meteo',
        requirement: 'a key with quota for one lookup',
        needs: [{ flowId: 'f1', need: 'a key with quota for one lookup' }],
      },
    });

    writeJson(catalogLocalFile(r), { 'open-meteo': { env: { GEO_KEY: 'sk-local' } } });
    expect(readGuardExternalsView(r).services[0].state).toBe('provided');
  });

  it('saves an account on a repo with no api block, splitting declaration from secret', () => {
    const r = repo();
    writeJson(recipeFile(r), { build: 'true', entry: ['node', 'bin.mjs'] });

    const view = writeGuardExternals(r, {
      externals: { stripe: { baseUrlEnv: 'STRIPE_BASE', baseUrl: 'https://sandbox.test', env: { STRIPE_KEY: { value: 'sk-secret' } } } },
    });
    expect(view.services.map((s) => s.service)).toEqual(['stripe']);
    expect(view.services[0].state).toBe('provided');

    // The recipe is untouched — an external is a dependency, not an api-driver field.
    expect(JSON.parse(fs.readFileSync(recipeFile(r), 'utf-8')).api).toBeUndefined();
    const catalog = JSON.parse(fs.readFileSync(catalogFile(r), 'utf-8'));
    expect(catalog.dependencies[0]).toMatchObject({ name: 'stripe', class: 'supplied', services: ['stripe'] });
    // The committed half declares NAMES only; the values live in the gitignored overlay.
    expect(fs.readFileSync(catalogFile(r), 'utf-8')).not.toContain('sk-secret');
    expect(JSON.parse(fs.readFileSync(catalogLocalFile(r), 'utf-8'))).toEqual({
      stripe: { env: { STRIPE_BASE: 'https://sandbox.test', STRIPE_KEY: 'sk-secret' } },
    });

    // Removing it takes both halves away.
    const after = writeGuardExternals(r, { externals: { stripe: null } });
    expect(after.services).toEqual([]);
    expect(fs.existsSync(catalogFile(r))).toBe(false);
    expect(fs.existsSync(catalogLocalFile(r))).toBe(false);
  });

  /**
   * An entry standing for SEVERAL services is one class of starting state, not one
   * account: rewriting it as a single external would rename it and throw away the
   * registration the other three are provided through. It is refused, and the file
   * is left exactly as it was.
   */
  it('refuses to rewrite an umbrella entry as one service’s external', () => {
    const r = repo();
    writeJson(recipeFile(r), { build: 'true', entry: ['node', 'bin.mjs'] });
    writeJson(catalogFile(r), {
      dependencies: [
        {
          name: 'llm-api-credentials',
          class: 'supplied',
          services: ['anthropic', 'openai'],
          summary: 'a provider API account the CLI can reach the model through',
          registration: {
            kind: 'env',
            vars: [{ name: 'api-key', description: 'a key for that provider', secret: true }],
          },
          needs: [],
        },
      ],
    });
    const before = fs.readFileSync(catalogFile(r), 'utf-8');

    expect(() =>
      writeGuardExternals(r, { externals: { openai: { baseUrlEnv: 'OPENAI_BASE' } } }),
    ).toThrow(/llm-api-credentials/);
    expect(() => writeGuardExternals(r, { externals: { openai: null } })).toThrow(
      GuardExternalsWriteError,
    );
    expect(fs.readFileSync(catalogFile(r), 'utf-8')).toBe(before);
  });
});

describe('the .truecourse/.gitignore template', () => {
  it('ignores the externals overlay — the secrets must never be committable', () => {
    expect(GITIGNORE_CONTENTS.split('\n')).toContain('scenarios/externals.local.json');
    // Same split for the dependency catalog: the INSTANCES are per-machine secrets.
    expect(GITIGNORE_CONTENTS.split('\n')).toContain('scenarios/dependencies.local.json');
    // The declarations themselves stay committable.
    expect(GITIGNORE_CONTENTS).not.toContain('scenarios/recipe.json');
    expect(GITIGNORE_CONTENTS.split('\n')).not.toContain('scenarios/dependencies.json');
  });
});
