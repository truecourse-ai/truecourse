/**
 * The externals read/write surface the UIs drive (item 62).
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
  readGuardExternalsView,
  writeGuardExternals,
  GuardExternalsWriteError,
} from '../../packages/core/src/commands/guard-externals';
import { GITIGNORE_CONTENTS } from '../../packages/core/src/config/paths';
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
    expect(view.hasApiBlock).toBe(false);
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
      coverageGaps: [
        { doc: 'docs/a.md', anchor: 'x', kind: 'blocked-on', reason: 'blocked on open-meteo: forecast', flowId: 'f1' },
        { doc: 'docs/a.md', anchor: 'y', kind: 'blocked-on', reason: 'blocked on open-meteo, stripe: pay', flowId: 'f2' },
        // The same flow blocked on the same service twice counts once.
        { doc: 'docs/a.md', anchor: 'z', kind: 'blocked-on', reason: 'blocked on open-meteo: again', flowId: 'f1' },
      ],
    });

    const view = readGuardExternalsView(r);
    expect(view.detectionAvailable).toBe(true);
    expect(view.hasApiBlock).toBe(true);
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

  it('refuses a write with no recipe, no api block, or a declaration that would not load', () => {
    const bare = repo();
    expect(() => writeGuardExternals(bare, { externals: {} })).toThrow(GuardExternalsWriteError);

    const cliOnly = repo();
    writeJson(recipeFile(cliOnly), { build: 'true', entry: ['node', 'bin.mjs'] });
    expect(() => writeGuardExternals(cliOnly, { externals: { svc: { baseUrlEnv: 'B' } } })).toThrow(
      /no `api` block/,
    );

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

describe('the .truecourse/.gitignore template', () => {
  it('ignores the externals overlay — the secrets must never be committable', () => {
    expect(GITIGNORE_CONTENTS.split('\n')).toContain('scenarios/externals.local.json');
    // The declaration itself stays committable.
    expect(GITIGNORE_CONTENTS).not.toContain('scenarios/recipe.json');
  });
});
