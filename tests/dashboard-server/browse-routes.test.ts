import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import type { Express } from 'express';

// app.ts pulls the analyses router which imports the socket-handlers module;
// mirror dashboard-routes.test.ts's stub so nothing tries to open a real socket.
vi.mock('../../apps/dashboard/server/src/socket/handlers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../apps/dashboard/server/src/socket/handlers')>();
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

// Switchable capability set — reset to OSS default before each case; only the
// last case flips it off to prove the gate.
let mockCaps: string[] = ['local-filesystem'];
vi.mock('../../apps/dashboard/server/src/ee-loader', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../apps/dashboard/server/src/ee-loader')>();
  return { ...actual, getCapabilities: () => mockCaps };
});

import { createApp } from '../../apps/dashboard/server/src/app';

let app: Express;
let tmpRoots: string[] = [];

function makeTmpRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-browse-'));
  tmpRoots.push(root);
  // realpath because macOS /tmp is a symlink to /private/tmp — the handler
  // returns realpath-resolved paths, so tests must compare against realpath too.
  return fs.realpathSync(root);
}

beforeEach(() => {
  mockCaps = ['local-filesystem'];
  app = createApp({ serveStatic: false });
});

afterEach(() => {
  for (const root of tmpRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  tmpRoots = [];
});

describe('GET /api/repos/browse', () => {
  it('lists non-hidden subdirectories sorted alphabetically, excluding files and dotfiles', async () => {
    const root = makeTmpRoot();
    fs.mkdirSync(path.join(root, 'beta'));
    fs.mkdirSync(path.join(root, 'alpha'));
    fs.mkdirSync(path.join(root, '.hidden'));
    fs.writeFileSync(path.join(root, 'readme.txt'), 'hi');

    const res = await request(app).get('/api/repos/browse').query({ path: root });

    expect(res.status).toBe(200);
    expect(res.body.entries.map((e: { name: string }) => e.name)).toEqual(['alpha', 'beta']);
    for (const entry of res.body.entries) {
      expect(entry.path).toBe(path.join(root, entry.name));
      expect(entry.isRepo).toBe(false);
    }
  });

  it('marks a subdirectory containing a .git dir as isRepo:true', async () => {
    const root = makeTmpRoot();
    fs.mkdirSync(path.join(root, 'proj', '.git'), { recursive: true });
    fs.mkdirSync(path.join(root, 'plain'));

    const res = await request(app).get('/api/repos/browse').query({ path: root });

    expect(res.status).toBe(200);
    const byName = Object.fromEntries(
      res.body.entries.map((e: { name: string; isRepo: boolean }) => [e.name, e.isRepo]),
    );
    expect(byName.proj).toBe(true);
    expect(byName.plain).toBe(false);
  });

  it('defaults to the home directory when path is omitted', async () => {
    const res = await request(app).get('/api/repos/browse');

    expect(res.status).toBe(200);
    expect(res.body.path).toBe(fs.realpathSync(os.homedir()));
    expect(Array.isArray(res.body.entries)).toBe(true);
  });

  it('returns the parent for a nested dir, and null at the filesystem root', async () => {
    const root = makeTmpRoot();
    const nested = path.join(root, 'a', 'b');
    fs.mkdirSync(nested, { recursive: true });

    const nestedRes = await request(app).get('/api/repos/browse').query({ path: nested });
    expect(nestedRes.status).toBe(200);
    expect(nestedRes.body.parent).toBe(fs.realpathSync(path.join(root, 'a')));

    const rootRes = await request(app).get('/api/repos/browse').query({ path: '/' });
    expect(rootRes.status).toBe(200);
    expect(rootRes.body.parent).toBeNull();
  });

  it('404 {error} for a non-existent path', async () => {
    const res = await request(app)
      .get('/api/repos/browse')
      .query({ path: '/definitely/not/here/xyz' });

    expect(res.status).toBe(404);
    expect(typeof res.body.error).toBe('string');
  });

  it('400 {error} when path points to a file', async () => {
    const root = makeTmpRoot();
    const file = path.join(root, 'a-file.txt');
    fs.writeFileSync(file, 'contents');

    const res = await request(app).get('/api/repos/browse').query({ path: file });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('400 {error} for a relative path', async () => {
    const res = await request(app).get('/api/repos/browse').query({ path: 'relative/dir' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('404 when the local-filesystem capability is absent', async () => {
    mockCaps = [];
    const root = makeTmpRoot();

    const res = await request(app).get('/api/repos/browse').query({ path: root });

    expect(res.status).toBe(404);
  });
});
