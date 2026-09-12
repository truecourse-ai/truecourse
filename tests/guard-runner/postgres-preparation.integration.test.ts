import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { prepareScenario, RecipeSchema, runGuard, type PreparedScenarioWorld } from '@truecourse/guard-runner';
import { startApiServer } from '../../packages/guard-runner/src/api/server.js';
import { GuardScenarioSchema } from '@truecourse/shared';
import { specBinds, writeScenario, writeSpecDoc } from './helpers.js';

const enabled = process.env.TRUECOURSE_TEST_POSTGRES === '1';
const fixtureRoot = path.resolve('tests/fixtures/guard-preparation-postgres');
const roots: string[] = [];
const container = `tc-preparation-${randomUUID()}`;
let containerCreated = false;
let connection: any;
let baseUrl: string;
const docker = (...args: string[]) => execFileSync('docker', args, { encoding: 'utf8', timeout: 120_000 }).trim();

describe.skipIf(!enabled)('real Postgres private preparations', () => {
  beforeAll(async () => {
    const require = createRequire(path.join(fixtureRoot, 'package.json'));
    let pg: any;
    try { pg = require('pg'); require.resolve('.prisma/client/default'); }
    catch { throw new Error('Install the Postgres fixture with npm ci and npm run generate in tests/fixtures/guard-preparation-postgres'); }
    docker('info', '--format', '{{.ServerVersion}}');
    const password = randomUUID();
    docker('run', '--detach', '--rm', '--name', container, '-e', `POSTGRES_PASSWORD=${password}`, '-p', '127.0.0.1::5432', 'postgres:16-alpine');
    containerCreated = true;
    const port = docker('port', container, '5432/tcp').split(':').at(-1);
    baseUrl = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
    const deadline = Date.now() + 30_000;
    while (true) {
      const attempt = new pg.Client({ connectionString: baseUrl });
      try { await attempt.connect(); connection = attempt; break; }
      catch {
        await attempt.end();
        if (Date.now() >= deadline) throw new Error('Disposable Postgres did not become ready');
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
    await connection.query('CREATE TABLE sentinel (value text); INSERT INTO sentinel VALUES (\'shared state\')');
  }, 150_000);

  afterEach(async () => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
    if (!connection) return;
    expect((await connection.query("SELECT datname FROM pg_database WHERE datname LIKE 'guard_%'")).rows).toEqual([]);
    expect((await connection.query('SELECT value FROM sentinel')).rows).toEqual([{ value: 'shared state' }]);
  });
  afterAll(async () => {
    await connection?.end();
    if (containerCreated) docker('rm', '--force', container);
  });

  function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-postgres-fixture-')); roots.push(root);
    fs.cpSync(fixtureRoot, root, { recursive: true, filter: source => path.basename(source) !== 'node_modules' });
    fs.symlinkSync(path.join(fixtureRoot, 'node_modules'), path.join(root, 'node_modules'), 'dir');
    const recipe = RecipeSchema.parse({
      build: 'true', api: { serve: ['node', 'server.mjs'], healthPath: '/health', env: { DATABASE_URL: baseUrl, DIRECT_URL: baseUrl, APP_ORIGIN: 'http://127.0.0.1:${PORT}' } },
      preparations: { documents: {
        baseline: 'seeded', scope: 'instance', env: {},
        postgres: { isolation: 'database', urlEnvs: ['DATABASE_URL', 'DIRECT_URL'] },
        baselineChecks: [{ path: '/rpc/documents', query: { input: '{}' }, credential: 'owner', counts: { 'result.data.json.count': 2 } }],
        seed: { script: 'seed.mjs', provides: { credentials: { owner: { header: 'x-world-token' } }, fixtures: { documents: ['count'] } } },
        verify: { script: 'verify.mjs' }, cleanup: { script: 'cleanup.mjs' },
      } },
    });
    return { root, recipe, prepare: () => prepareScenario({ repoRoot: root, recipe, profile: 'documents', timeoutMs: 60_000 }) };
  }

  async function serve(root: string, world: PreparedScenarioWorld) {
    const started = await startApiServer({ resolvedServe: [process.execPath, path.join(root, 'server.mjs')], cwd: root, env: world.env, healthPath: '/health', readyTimeoutMs: 15_000 });
    if (!started.ok) throw new Error('Fixture server did not start');
    return {
      request: (method = 'GET', route = '/rpc/documents?input=%7B%7D') => fetch(started.server.baseUrl + route, { method, headers: { 'x-world-token': world.credentials.get('owner')!.value } }),
      close: () => started.server.stop(),
    };
  }

  it('migrates qualified public SQL, isolates documents/sessions, and resets only on a new execution', async () => {
    const { root, prepare } = fixture();
    const a = await prepare();
    let b: PreparedScenarioWorld | undefined;
    let serverA: Awaited<ReturnType<typeof serve>> | undefined;
    let serverB: Awaited<ReturnType<typeof serve>> | undefined;
    let retry: PreparedScenarioWorld | undefined;
    try {
      b = await prepare();
      expect(a.env.DATABASE_URL).not.toBe(b.env.DATABASE_URL);
      expect(a.env.DATABASE_URL).toBe(a.env.DIRECT_URL);
      expect(a.env).not.toHaveProperty('GUARD_PREPARATION_POSTGRES_BASE_URLS');
      serverA = await serve(root, a); serverB = await serve(root, b);
      expect((await (await serverA.request('POST')).json()).result.data.json.count).toBe(3);
      await serverA.close(); serverA = await serve(root, a);
      expect((await (await serverA.request()).json()).result.data.json.count).toBe(3);
      await serverA.request('DELETE');
      expect((await serverA.request()).status).toBe(401);
      expect((await (await serverB.request()).json()).result.data.json.count).toBe(2);
      await serverA.close(); serverA = undefined; await a.close();
      retry = await prepare();
      expect(retry.env.DATABASE_URL).not.toBe(a.env.DATABASE_URL);
      expect(retry.credentials.get('owner')!.value).not.toBe(a.credentials.get('owner')!.value);
      expect(retry.fixtures.get('documents')!.count).toBe(2);
    } finally {
      await serverA?.close(); await serverB?.close();
      await a.close(); await b?.close(); await retry?.close();
    }
  }, 90_000);

  it('fails real baseline filtering, false isolation and invalid credentials before scenario actions', async () => {
    const { recipe, prepare } = fixture();
    const check = recipe.preparations!.documents.baselineChecks![0];
    check.query = { input: '{"tenant":"alpha"}' };
    await expect(prepare()).rejects.toThrow('expected 2, observed 1');
    check.query = { input: '{}' };
    recipe.api!.env!.TEST_FALSE_ISOLATION = 'yes';
    await expect(prepare()).rejects.toThrow();
    delete recipe.api!.env!.TEST_FALSE_ISOLATION;
    delete check.credential;
    await expect(prepare()).rejects.toThrow('returned 401');
  }, 90_000);

  it('cleans a failed partial seed and redacts its private database URL', async () => {
    const { recipe, prepare } = fixture();
    recipe.api!.env!.TEST_SEED_FAILURE = 'yes';
    let message = '';
    try { await prepare(); } catch (error) { message = (error as Error).message; }
    expect(message).toContain('failed before migration');
    expect(message).not.toContain(new URL(baseUrl).password);
    expect(message).not.toContain('postgresql://');
    delete recipe.api!.env!.TEST_SEED_FAILURE;
    recipe.api!.env!.TEST_SERVER_FAILURE = 'yes';
    try { await prepare(); } catch (error) { message = (error as Error).message; }
    expect(message).toContain('baseline server failed');
    expect(message).toContain('boot failed:');
    expect(message).not.toContain(new URL(baseUrl).password);
    expect(message).not.toContain('postgresql://');
  }, 60_000);

  it('cleans after cancellation during seed and reports cleanup failure', async () => {
    const { root, recipe } = fixture();
    fs.appendFileSync(path.join(root, 'seed.mjs'), "\nfs.writeFileSync(path.join(root, 'seed-ready'), 'ready'); await new Promise(r => setTimeout(r, 60000));");
    const controller = new AbortController();
    const pending = prepareScenario({ repoRoot: root, recipe, profile: 'documents', signal: controller.signal, timeoutMs: 60_000 });
    const rejected = expect(pending).rejects.toThrow();
    const deadline = Date.now() + 30_000;
    while (!fs.existsSync(path.join(root, 'seed-ready')) && Date.now() < deadline) await new Promise(r => setTimeout(r, 100));
    controller.abort(); await rejected;
    expect(fs.existsSync(path.join(root, 'seed-ready'))).toBe(true);
    fs.copyFileSync(path.join(fixtureRoot, 'seed.mjs'), path.join(root, 'seed.mjs'));
    recipe.api!.env!.TEST_CLEANUP_FAILURE = 'yes';
    await expect(prepareScenario({ repoRoot: root, recipe, profile: 'documents' })).rejects.toThrow('cleanup');
  }, 90_000);

  it('uses private credentials/env in the runner and redacts database responses', async () => {
    const { root, recipe } = fixture(); writeSpecDoc(root);
    recipe.web = { serve: ['node', 'server.mjs'], healthPath: '/health',
      env: { DATABASE_URL: 'postgres://wrong/shared', DIRECT_URL: 'postgres://wrong/shared' } };
    writeScenario(root, 'private.yaml', GuardScenarioSchema.parse({
      id: 'private-postgres', title: 'Private documents', binds: specBinds('spec/section'), setup: { preparation: 'documents' },
      steps: [
        { request: { method: 'GET', path: '/private-env', headers: { 'x-world-token': '{{cred:owner}}' } }, expect: { status: 200, json: { provisioning: { equals: false } } } },
        { request: { method: 'GET', path: '/rpc/documents?input=%7B%7D', headers: { 'x-world-token': '{{cred:owner}}' } }, expect: { status: 200, json: { 'result.data.json.count': { equals: 2 } } } },
        { request: { method: 'GET', path: '/echo-secret', headers: { 'x-world-token': '{{cred:owner}}' } }, expect: { status: 200 } },
      ],
    }));
    writeScenario(root, 'private-web.yaml', GuardScenarioSchema.parse({
      id: 'private-postgres-web', title: 'Private browser and API state', binds: specBinds('spec/section'), setup: { preparation: 'documents' },
      steps: [
        { driver: 'web', credential: 'owner' },
        { driver: 'web', navigate: '/private-env', expect: { text: { contains: '/guard_' } } },
        { request: { method: 'GET', path: '/rpc/documents?input=%7B%7D', headers: { 'x-world-token': '{{cred:owner}}' } }, expect: { status: 200, json: { 'result.data.json.count': { equals: 2 } } } },
      ],
    }));
    const result = await runGuard({ repoRoot: root, recipe, skipBuild: true, capturePassEvidence: true, concurrency: 1 });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.latest.summary).toMatchObject({ pass: 2, error: 0 });
    expect(JSON.stringify(result)).not.toContain(new URL(baseUrl).password);
  }, 90_000);
});
