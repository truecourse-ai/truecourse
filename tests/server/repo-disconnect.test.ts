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
    createSocketSpecTracker: () => new NoopTracker(),
    createSocketLlmEstimateHandler: () => () => Promise.resolve(true),
    createSocketStashConfirmHandler: () => () => Promise.resolve('stash'),
    emitSpecProgress: vi.fn(),
    emitSpecComplete: vi.fn(),
  };
});

// The onboarding scan's entry point, stubbed so a test can hold a scan open and
// watch the disconnect refuse under it.
const scan = vi.hoisted(() => ({
  impl: (async () => ({})) as (repoRoot: string) => Promise<unknown>,
}));

vi.mock('@truecourse/core/commands/spec-in-process', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@truecourse/core/commands/spec-in-process')>();
  return {
    ...actual,
    curateInProcess: (repoRoot: string) => scan.impl(repoRoot),
  };
});

import { createApp } from '../../apps/dashboard/server/src/app';
import { readRegistry, unregisterProject } from '../../packages/core/src/config/registry';
import { getClonesDir } from '../../apps/dashboard/server/src/services/repo-clone.service';
import {
  isSpecScanRunning,
  startOnboardingScan,
} from '../../apps/dashboard/server/src/services/onboarding-scan.service';

/**
 * Registering a repository by local path, and disconnecting it again.
 *
 * Connect-by-URL is gone — repositories arrive through the GitHub App now (see
 * tests/dashboard-server/github-mount.test.ts, which owns the managed-clone
 * half of disconnect). What is left here is the local-path half: the source
 * tree survives, only `.truecourse/` goes, and a running spec scan blocks the
 * disconnect entirely.
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

/** A git repo — what the spec scan insists on before it does anything. */
function makeGitRepo(prefix: string): string {
  const repo = makeTmpDir(prefix);
  git(repo, 'init', '--initial-branch=main');
  // The suite hides the developer's global git config, so identity is per-repo.
  git(repo, 'config', 'user.name', 'Test');
  git(repo, 'config', 'user.email', 'test@example.com');
  fs.writeFileSync(path.join(repo, 'README.md'), '# one\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'one');
  return repo;
}

const settle = (ms = 50): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function until(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) await settle(10);
}

let app: Express;

beforeAll(() => {
  // The registry hangs off TRUECOURSE_HOME; point it at a throwaway dir.
  process.env.TRUECOURSE_HOME = makeTmpDir('tc-disconnect-home-');
  app = createApp({ serveStatic: false, authVerifier: null, github: null });
});

afterEach(async () => {
  for (const entry of await readRegistry()) await unregisterProject(entry.slug);
  fs.rmSync(getClonesDir(), { recursive: true, force: true });
  scan.impl = async () => ({});
});

afterAll(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe('POST /api/repos/connect', () => {
  it('is gone — a repository arrives through the GitHub App, not a pasted URL', async () => {
    await request(app)
      .post('/api/repos/connect')
      .send({ url: 'https://github.com/acme/widgets' })
      .expect(404);

    expect(await readRegistry()).toHaveLength(0);
  });
});

describe('DELETE /api/repos/:id', () => {
  it('leaves a path-registered repo on disk, removing only .truecourse', async () => {
    const local = makeTmpDir('tc-disconnect-local-');
    fs.writeFileSync(path.join(local, 'source.ts'), 'export const x = 1\n');

    const res = await request(app).post('/api/repos').send({ path: local }).expect(201);
    expect(res.body.remoteUrl).toBeUndefined();
    expect(fs.existsSync(path.join(local, '.truecourse'))).toBe(true);

    await request(app).delete(`/api/repos/${res.body.id}`).expect(204);

    expect(fs.existsSync(local)).toBe(true);
    expect(fs.existsSync(path.join(local, 'source.ts'))).toBe(true);
    expect(fs.existsSync(path.join(local, '.truecourse'))).toBe(false);
  });

  it('refuses to disconnect while the spec scan is still running', async () => {
    const local = makeGitRepo('tc-disconnect-scanning-');
    const res = await request(app).post('/api/repos').send({ path: local }).expect(201);

    let release: (() => void) | undefined;
    scan.impl = () => new Promise((r) => (release = () => r({})));
    try {
      // Deleting the tree under the scan would orphan its later writes and
      // leave the path's in-flight guard blocking a reconnect.
      expect(startOnboardingScan(res.body.id, local)).toBe(true);
      const refused = await request(app).delete(`/api/repos/${res.body.id}`).expect(409);
      expect(refused.body.error).toMatch(/scan is running/i);
      expect(fs.existsSync(path.join(local, '.truecourse'))).toBe(true);

      // The scan holds the slot from the moment it starts; the stub itself is
      // only reached after the service's own git preamble.
      await until(() => release !== undefined);
      release!();
      await until(() => !isSpecScanRunning(local));
      await request(app).delete(`/api/repos/${res.body.id}`).expect(204);
      expect(fs.existsSync(path.join(local, '.truecourse'))).toBe(false);
    } finally {
      release?.();
    }
  });
});
