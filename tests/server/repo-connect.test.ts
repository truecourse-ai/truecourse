import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import type { Express } from 'express';

// app.ts pulls the analyses router, which imports the socket-handlers module;
// stub it so nothing tries to open a real socket (same shape as the other
// route suites).
vi.mock('../../apps/dashboard/server/src/socket/handlers', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../apps/dashboard/server/src/socket/handlers')>();
  class NoopTracker {
    start() {}
    done() {}
    error() {}
    detail() {}
  }
  return {
    ...actual,
    emitAnalysisProgress: vi.fn(),
    emitAnalysisComplete: vi.fn(),
    emitViolationsReady: vi.fn(),
    emitFilesChanged: vi.fn(),
    emitAnalysisCanceled: vi.fn(),
    createSocketTracker: () => new NoopTracker(),
    createSocketLlmEstimateHandler: () => () => Promise.resolve(true),
    createSocketStashConfirmHandler: () => () => Promise.resolve('stash'),
  };
});

import { createApp } from '../../apps/dashboard/server/src/app';
import { readRegistry, unregisterProject } from '../../packages/core/src/config/registry';
import {
  getClonesDir,
  normalizeRemoteUrl,
  parseRemoteUrl,
} from '../../apps/dashboard/server/src/services/repo-clone.service';

/**
 * Connect-by-URL (POST /api/repos/connect). The end-to-end cases clone a real
 * local git repository over a `file://` URL, so the suite never touches the
 * network while still exercising the actual `git clone` path.
 */

const tmpDirs: string[] = [];

function makeTmpDir(prefix: string): string {
  // realpath: macOS /tmp is a symlink, and the registry stores resolved paths.
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tmpDirs.push(dir);
  return dir;
}

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();

/** A local repo with two commits, so `--depth 1` is observably shallow. */
function makeOriginRepo(name: string): string {
  const parent = makeTmpDir('tc-connect-origin-');
  const repo = path.join(parent, name);
  fs.mkdirSync(repo);
  git(repo, 'init', '--initial-branch=main');
  // The suite hides the developer's global git config, so identity is per-repo.
  git(repo, 'config', 'user.name', 'Test');
  git(repo, 'config', 'user.email', 'test@example.com');
  fs.writeFileSync(path.join(repo, 'README.md'), '# one\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'one');
  fs.writeFileSync(path.join(repo, 'README.md'), '# two\n');
  git(repo, 'commit', '-am', 'two');
  return repo;
}

let app: Express;

beforeAll(() => {
  // The registry and the managed clones root both hang off TRUECOURSE_HOME;
  // point them at a throwaway dir. Both are read lazily, per call.
  process.env.TRUECOURSE_HOME = makeTmpDir('tc-connect-home-');
  app = createApp({ serveStatic: false });
});

afterEach(async () => {
  for (const entry of await readRegistry()) await unregisterProject(entry.slug);
  fs.rmSync(getClonesDir(), { recursive: true, force: true });
});

afterAll(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// URL parsing / normalization
// ---------------------------------------------------------------------------

describe('parseRemoteUrl', () => {
  it('extracts owner/repo from an https URL and derives the clone directory', () => {
    const remote = parseRemoteUrl('https://github.com/acme/widgets');
    expect(remote).toMatchObject({
      owner: 'acme',
      repo: 'widgets',
      displayName: 'acme/widgets',
      dirName: 'acme__widgets',
    });
  });

  it('strips a trailing .git and a trailing slash', () => {
    expect(parseRemoteUrl('https://github.com/acme/widgets.git').repo).toBe('widgets');
    expect(parseRemoteUrl('https://github.com/acme/widgets/').repo).toBe('widgets');
  });

  it('takes the last two segments of a nested path (GitLab subgroups)', () => {
    const remote = parseRemoteUrl('https://gitlab.com/acme/team/widgets.git');
    expect(remote.owner).toBe('team');
    expect(remote.repo).toBe('widgets');
  });

  it('sanitizes path segments into a flat directory name', () => {
    expect(parseRemoteUrl('https://example.com/a b/c d').dirName).toBe('a-b__c-d');
  });

  it.each([
    ['ssh://git@github.com/acme/widgets.git'],
    ['git@github.com:acme/widgets.git'],
    ['git://github.com/acme/widgets.git'],
    ['http://github.com/acme/widgets'],
    ['/Users/me/projects/widgets'],
    ['not a url'],
    [''],
  ])('rejects %s', (bad) => {
    expect(() => parseRemoteUrl(bad)).toThrowError();
    try {
      parseRemoteUrl(bad);
    } catch (err) {
      expect((err as { statusCode?: number }).statusCode).toBe(400);
    }
  });

  it('rejects a URL carrying credentials', () => {
    expect(() => parseRemoteUrl('https://user:token@github.com/acme/widgets')).toThrowError(
      /credentials/i,
    );
  });

  it('accepts file:// URLs (local repos, and what the tests clone)', () => {
    expect(parseRemoteUrl('file:///tmp/some/widgets').repo).toBe('widgets');
  });
});

describe('normalizeRemoteUrl', () => {
  it('collapses host case, a trailing slash and a .git suffix to one identity', () => {
    const canonical = normalizeRemoteUrl('https://github.com/acme/widgets');
    expect(normalizeRemoteUrl('https://GitHub.com/acme/widgets.git')).toBe(canonical);
    expect(normalizeRemoteUrl('https://github.com/acme/widgets/')).toBe(canonical);
    expect(normalizeRemoteUrl('  https://github.com/acme/widgets.git  ')).toBe(canonical);
  });

  it('keeps the path case-sensitive — different repos stay different', () => {
    expect(normalizeRemoteUrl('https://github.com/acme/Widgets')).not.toBe(
      normalizeRemoteUrl('https://github.com/acme/widgets'),
    );
  });
});

// ---------------------------------------------------------------------------
// POST /api/repos/connect
// ---------------------------------------------------------------------------

describe('POST /api/repos/connect', () => {
  it('shallow-clones the remote into the managed clones dir and registers it', async () => {
    const origin = makeOriginRepo('widgets');
    const url = `file://${origin}`;

    const res = await request(app).post('/api/repos/connect').send({ url }).expect(201);

    expect(res.body.remoteUrl).toBe(url);
    expect(res.body.name).toBe(`${path.basename(path.dirname(origin))}/widgets`);
    expect(res.body.path.startsWith(getClonesDir() + path.sep)).toBe(true);
    expect(res.body.lastAnalyzed).toBeNull();

    const clone = res.body.path as string;
    expect(fs.readFileSync(path.join(clone, 'README.md'), 'utf-8')).toBe('# two\n');
    expect(git(clone, 'rev-parse', '--is-shallow-repository')).toBe('true');
    expect(git(clone, 'rev-list', '--count', 'HEAD')).toBe('1');

    // Registered like any other project, with the remote recorded.
    const registry = await readRegistry();
    expect(registry).toHaveLength(1);
    expect(registry[0]).toMatchObject({ slug: res.body.id, path: clone, remoteUrl: url });
  });

  it('lists the connected repo with its remoteUrl', async () => {
    const origin = makeOriginRepo('widgets');
    const url = `file://${origin}`;
    await request(app).post('/api/repos/connect').send({ url }).expect(201);

    const list = await request(app).get('/api/repos').expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].remoteUrl).toBe(url);

    const detail = await request(app).get(`/api/repos/${list.body[0].id}`).expect(200);
    expect(detail.body.remoteUrl).toBe(url);
  });

  it('refuses a second connect of the same remote and points at the existing repo', async () => {
    const origin = makeOriginRepo('widgets');
    const first = await request(app)
      .post('/api/repos/connect')
      .send({ url: `file://${origin}` })
      .expect(201);

    // Same repo, written differently — normalization must still match.
    const dup = await request(app)
      .post('/api/repos/connect')
      .send({ url: `file://${origin}/` })
      .expect(409);

    expect(dup.body.repoId).toBe(first.body.id);
    expect(await readRegistry()).toHaveLength(1);
  });

  it('rejects a non-https URL without cloning anything', async () => {
    const res = await request(app)
      .post('/api/repos/connect')
      .send({ url: 'ssh://git@github.com/acme/widgets.git' })
      .expect(400);

    expect(res.body.error).toMatch(/https/i);
    expect(fs.existsSync(getClonesDir())).toBe(false);
  });

  it("surfaces git's own message when the remote cannot be cloned", async () => {
    const missing = path.join(makeTmpDir('tc-connect-missing-'), 'nope');
    const res = await request(app)
      .post('/api/repos/connect')
      .send({ url: `file://${missing}` })
      .expect(400);

    expect(res.body.error).toMatch(/Could not clone/);
    // The failed attempt leaves nothing behind — no temp dir, no half-clone.
    expect(fs.readdirSync(getClonesDir())).toEqual([]);
    expect(await readRegistry()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/repos/:id
// ---------------------------------------------------------------------------

describe('DELETE /api/repos/:id', () => {
  it('deletes the whole clone when the repo was connected by URL', async () => {
    const origin = makeOriginRepo('widgets');
    const res = await request(app)
      .post('/api/repos/connect')
      .send({ url: `file://${origin}` })
      .expect(201);
    const clone = res.body.path as string;
    expect(fs.existsSync(clone)).toBe(true);

    await request(app).delete(`/api/repos/${res.body.id}`).expect(204);

    expect(fs.existsSync(clone)).toBe(false);
    expect(await readRegistry()).toHaveLength(0);
    // The repo it was cloned from is untouched.
    expect(fs.existsSync(path.join(origin, 'README.md'))).toBe(true);
  });

  it('leaves a path-registered repo on disk, removing only .truecourse', async () => {
    const local = makeTmpDir('tc-connect-local-');
    fs.writeFileSync(path.join(local, 'source.ts'), 'export const x = 1\n');

    const res = await request(app).post('/api/repos').send({ path: local }).expect(201);
    expect(res.body.remoteUrl).toBeUndefined();
    expect(fs.existsSync(path.join(local, '.truecourse'))).toBe(true);

    await request(app).delete(`/api/repos/${res.body.id}`).expect(204);

    expect(fs.existsSync(local)).toBe(true);
    expect(fs.existsSync(path.join(local, 'source.ts'))).toBe(true);
    expect(fs.existsSync(path.join(local, '.truecourse'))).toBe(false);
  });
});
