import { describe, expect, it } from 'vitest';
import { RecipeSchema, bindPreparationPostgres, preparationCatalog, validateScenarioPreparation } from '@truecourse/guard-runner';
import { scenario } from './helpers.js';

const profile = {
  baseline: 'seeded' as const, scope: 'instance' as const, env: {},
  postgres: { isolation: 'database' as const, urlEnvs: ['DATABASE_URL', 'DIRECT_URL'] },
  baselineChecks: [{ path: '/rpc/count', query: { input: '{}' }, counts: { count: 2 } }],
  seed: { script: 'seed.mjs', provides: {} }, verify: { script: 'verify.mjs' }, cleanup: { script: 'cleanup.mjs' },
};
const namespace = `guard_${'a'.repeat(32)}`;

describe('Postgres preparation bindings', () => {
  it('preserves distinct endpoints and options while binding both connections to the owned database', () => {
    const base = {
      DATABASE_URL: 'postgresql://fixture:p%40ss@pool.local:6543/shared?schema=public&pgbouncer=true',
      DIRECT_URL: 'postgres://fixture:p%40ss@direct.local:5432/shared?sslmode=require',
    };
    const bound = bindPreparationPostgres(profile, base, namespace);
    for (const name of profile.postgres.urlEnvs) {
      const before = new URL(base[name as keyof typeof base]);
      const after = new URL(bound.env[name]);
      expect(after.pathname).toBe(`/${namespace}`);
      expect(after.host).toBe(before.host);
      expect(after.password).toBe(before.password);
      expect(after.search).toBe(before.search);
    }
    expect(JSON.parse(bound.provisioningEnv.GUARD_PREPARATION_POSTGRES_BASE_URLS)).toEqual(base);
    expect(bound.env).not.toHaveProperty('GUARD_PREPARATION_POSTGRES_BASE_URLS');
    expect([...bound.secrets.values()]).toContain('p@ss');
    expect(bindPreparationPostgres(profile, base, `guard_${'b'.repeat(32)}`).env).not.toEqual(bound.env);
    expect(base.DATABASE_URL).toContain('/shared?');
  });

  it('rejects missing, ambiguous or invalid URLs without echoing their contents', () => {
    for (const value of ['', 'contains-private-password', 'https://private-password@example.test/db',
      'postgres://private-password@localhost/', 'postgres://u:private-password@localhost/db#fragment',
      'postgres://u:private-password@localhost/db?dbname=shared']) {
      let message = '';
      try { bindPreparationPostgres(profile, { DATABASE_URL: value }, namespace); }
      catch (error) { message = (error as Error).message; }
      expect(message).toContain('DATABASE_URL');
      expect(message).not.toContain('private-password');
    }
    expect(() => bindPreparationPostgres(profile, {}, 'public')).toThrow('runner-owned');
  });

  it('requires explicit supported isolation, unique URL ownership and cleanup', () => {
    const parse = (p: unknown) => RecipeSchema.safeParse({ build: 'true', entry: ['node', 'app.js'], preparations: { private: p } });
    expect(parse(profile).success).toBe(true);
    for (const patch of [
      { postgres: undefined }, { cleanup: undefined },
      { postgres: { isolation: 'prisma-schema', urlEnvs: ['DATABASE_URL'] } },
      { postgres: { isolation: 'database', urlEnvs: [] } },
      { postgres: { isolation: 'database', urlEnvs: ['DATABASE_URL', 'DATABASE_URL'] } },
      { postgres: { isolation: 'database', urlEnvs: ['GUARD_REPO_ROOT'] } },
      { env: { DATABASE_URL: 'postgres://local/${namespace}' } },
    ]) expect(parse({ ...profile, ...patch }).success).toBe(false);
  });

  it('protects derived bindings across setup, commands, boots and teardown', () => {
    const recipe = RecipeSchema.parse({ build: 'true', entry: ['node', 'app.js'], preparations: { private: profile } });
    for (const key of profile.postgres.urlEnvs) {
      const env = { [key]: 'postgres://local/shared' };
      for (const spec of [
        { setup: { preparation: 'private', env }, steps: [] },
        { setup: { preparation: 'private' }, steps: [{ run: ['test'], env }] },
        { setup: { preparation: 'private' }, steps: [{ boot: { env } }] },
        { setup: { preparation: 'private' }, steps: [], teardown: [{ boot: { env } }] },
      ]) expect(validateScenarioPreparation(recipe, scenario({ id: 'private', ...spec }))).toContain(`owns ${key}`);
    }
    expect(preparationCatalog(recipe)[0]).toMatchObject({ name: 'private', baselineChecks: profile.baselineChecks });
    expect(preparationCatalog(recipe)[0]).not.toHaveProperty('env');
    expect(preparationCatalog(recipe)[0]).not.toHaveProperty('postgres');
  });
});
