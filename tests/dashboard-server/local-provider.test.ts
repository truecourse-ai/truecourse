/**
 * The Local folder provider: a directory on this machine, connected the way a
 * hosted repository is, and read the way one is — by copying.
 *
 * The two things that matter here are the row and the copy. Connecting writes
 * the same `repositories` row every provider writes, so everything downstream
 * reads a folder without knowing it is one; and a run gets a COPY under the
 * run-clones dir, so the tree it writes into is never the developer's.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express, { type Express, type Request } from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AuthUser } from '@truecourse/shared';
import { createLocalConnection, type LocalMount } from '../../apps/dashboard/server/src/local/index';
import {
  acquireWorkTree,
  setRepoProviderLookup,
  setWorkTreeProvider,
} from '../../apps/dashboard/server/src/services/work-tree.service';
import { removeRepoRunState } from '../../apps/dashboard/server/src/services/repo-removal.service';
import { MemoryGateStore } from '../github-app/memory-store';

// A folder has no webhook, so the provider watches it. Chokidar's own event
// timing is not what these cases are about — that a folder is watched while it
// is connected and not after is.
const watching = vi.hoisted(() => ({ started: [] as string[], stopped: [] as string[] }));
vi.mock('../../apps/dashboard/server/src/services/watcher.service', () => ({
  watchRepo: (dir: string) => watching.started.push(dir),
  stopWatching: (dir: string) => watching.stopped.push(dir),
  stopAllWatchers: () => {},
}));

const ORG = 'org_local';

let store: MemoryGateStore;
let mount: LocalMount;
let app: Express;
let setups: string[];
let roots: string[];

/** A folder as a developer's checkout: files, and the version control marker. */
function folder(name: string, files: Record<string, string> = { 'README.md': '# hi\n' }): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-local-'));
  const dir = path.join(root, name);
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  for (const [file, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), body);
  }
  roots.push(root);
  return dir;
}

beforeEach(() => {
  store = new MemoryGateStore();
  setups = [];
  roots = [];
  watching.started = [];
  watching.stopped = [];
  mount = createLocalConnection({
    repos: store,
    startSetup: async (link) => {
      setups.push(link.repoFullName);
      return 'queued';
    },
    contextSync: async () => 'queued',
  });
  setRepoProviderLookup(async (key) => (await store.getRepo(key))?.provider ?? null);
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as Request & { user?: AuthUser }).user = {
      id: 'user_local',
      email: '',
      organizationId: ORG,
    };
    next();
  });
  app.use('/api/local', mount.router);
});

afterEach(() => {
  mount.stop();
  setRepoProviderLookup(null);
  setWorkTreeProvider('local', null);
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

describe('connecting a folder', () => {
  it('writes the repository row, names it after the folder, and starts its setup', async () => {
    const dir = folder('orders-api');

    const res = await request(app).post('/api/local/repos').send({ path: dir }).expect(201);
    expect(res.body.repoFullName).toBe('local/orders-api');

    expect(await store.getRepo('local/orders-api')).toMatchObject({
      provider: 'local',
      accountId: null,
      defaultBranch: null,
      location: dir,
      workspaceOrgId: ORG,
      enabled: true,
    });
    expect(setups).toEqual(['local/orders-api']);

    const listed = await request(app).get('/api/local/repos').expect(200);
    expect(listed.body.repos).toEqual([
      expect.objectContaining({ repoFullName: 'local/orders-api', path: dir }),
    ]);
  });

  it('gives two folders of one name two repositories', async () => {
    const first = await request(app).post('/api/local/repos').send({ path: folder('orders') });
    const second = await request(app).post('/api/local/repos').send({ path: folder('orders') });
    expect(first.body.repoFullName).toBe('local/orders');
    expect(second.body.repoFullName).toBe('local/orders-2');
  });

  it('refuses the same folder twice', async () => {
    const dir = folder('orders');
    await request(app).post('/api/local/repos').send({ path: dir }).expect(201);
    const again = await request(app).post('/api/local/repos').send({ path: dir }).expect(409);
    expect(again.body.error).toMatch(/already connected/);
  });

  it('refuses what is not a folder it can run on, saying which', async () => {
    await request(app).post('/api/local/repos').send({}).expect(400);

    const relative = await request(app).post('/api/local/repos').send({ path: 'code/orders' });
    expect(relative.status).toBe(400);

    const missing = await request(app)
      .post('/api/local/repos')
      .send({ path: path.join(os.tmpdir(), 'tc-nothing-here') })
      .expect(400);
    expect(missing.body.error).toMatch(/no folder/i);

    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-bare-'));
    roots.push(bare);
    const noHistory = await request(app).post('/api/local/repos').send({ path: bare }).expect(400);
    expect(noHistory.body.error).toMatch(/commit/);
  });
});

describe('the watcher, which is what a folder has instead of a webhook', () => {
  it('watches a connected folder, and stops when it is disconnected', async () => {
    const dir = folder('orders-api');
    await request(app).post('/api/local/repos').send({ path: dir }).expect(201);
    expect(watching.started).toEqual([dir]);

    await removeRepoRunState('local/orders-api', ORG);
    expect(watching.stopped).toEqual([dir]);
  });

  it('watches again what this machine already connected, on the next boot', async () => {
    const dir = folder('orders-api');
    await request(app).post('/api/local/repos').send({ path: dir }).expect(201);
    watching.started = [];

    await mount.watchConnected(ORG);
    expect(watching.started).toEqual([]);

    // A fresh process has watched nothing yet.
    const next = createLocalConnection({ repos: store, contextSync: async () => 'queued' });
    await next.watchConnected(ORG);
    expect(watching.started).toEqual([dir]);
    next.stop();
  });
});

describe('a run over a connected folder', () => {
  it('works on a copy and leaves the folder untouched', async () => {
    const dir = folder('orders-api', { 'README.md': '# orders\n', 'docs/api.md': '# api\n' });
    await request(app).post('/api/local/repos').send({ path: dir }).expect(201);

    const tree = await acquireWorkTree('local/orders-api');
    expect(tree.dir).not.toBe(dir);
    expect(fs.readFileSync(path.join(tree.dir, 'docs/api.md'), 'utf8')).toBe('# api\n');

    // The engine writes inside the tree it is given; the original must not move.
    fs.mkdirSync(path.join(tree.dir, '.truecourse'), { recursive: true });
    fs.writeFileSync(path.join(tree.dir, '.truecourse', 'run.json'), '{}');
    fs.writeFileSync(path.join(tree.dir, 'README.md'), '# changed\n');
    expect(fs.existsSync(path.join(dir, '.truecourse'))).toBe(false);
    expect(fs.readFileSync(path.join(dir, 'README.md'), 'utf8')).toBe('# orders\n');

    tree.dispose();
    expect(fs.existsSync(tree.dir)).toBe(false);
    expect(fs.existsSync(dir)).toBe(true);
  });

  it('refuses a folder that is gone rather than running on nothing', async () => {
    const dir = folder('orders-api');
    await request(app).post('/api/local/repos').send({ path: dir }).expect(201);
    fs.rmSync(dir, { recursive: true, force: true });

    await expect(acquireWorkTree('local/orders-api')).rejects.toThrow(/not a folder/);
  });
});
