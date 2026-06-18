import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import request from 'supertest';
import { type Express } from 'express';
import { resetSpecStore } from '@truecourse/core/lib/spec-store';
import { resetContractStore } from '@truecourse/core/lib/contract-store';
import { createApp } from '../../apps/dashboard/server/src/app';
import { setupTestFixture, teardownTestFixture, type TestFixture } from '../helpers/test-db';

/**
 * OSS Git-Diff: the BL-Drift tabs diff the working tree against the committed
 * baseline (no per-commit store). Contracts = git status of `.tc`; Spec = current
 * `claims.json` vs `git show HEAD:claims.json`. (EE uses the per-commit `?ref` GET.)
 */

function git(dir: string, cmd: string) {
  execSync(`git ${cmd}`, { cwd: dir, stdio: 'pipe' });
}
function gitInitCommit(dir: string) {
  git(dir, 'init -q');
  git(dir, 'config user.email t@t.co');
  git(dir, 'config user.name test');
  git(dir, 'add -A');
  git(dir, 'commit -q -m baseline');
}
function write(root: string, rel: string, content: string) {
  const f = path.join(root, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content);
}

describe('OSS Git-Diff routes', () => {
  let app: Express;
  let fixture: TestFixture;

  beforeEach(async () => {
    resetSpecStore();
    resetContractStore();
    fixture = await setupTestFixture();
    app = createApp({ serveStatic: false });
  });
  afterEach(async () => {
    await teardownTestFixture(fixture.project.slug);
  });

  it('contracts/diff: working-tree add / modify / remove of `.tc` vs HEAD', async () => {
    const root = fixture.repoPath;
    write(root, '.truecourse/contracts/orders/keep.tc', 'entity Keep {}');
    write(root, '.truecourse/contracts/orders/edit.tc', 'entity Edit { a }');
    write(root, '.truecourse/contracts/orders/drop.tc', 'entity Drop {}');
    gitInitCommit(root);

    // Working-tree changes (uncommitted).
    write(root, '.truecourse/contracts/orders/edit.tc', 'entity Edit { a b }'); // modified
    fs.rmSync(path.join(root, '.truecourse/contracts/orders/drop.tc')); // removed
    write(root, '.truecourse/contracts/orders/add.tc', 'entity Add {}'); // added (untracked)

    const res = await request(app)
      .post(`/api/repos/${fixture.project.slug}/contracts/diff`)
      .expect(200);
    expect(res.body.added).toEqual(['orders/add.tc']);
    expect(res.body.removed).toEqual(['orders/drop.tc']);
    expect(res.body.modified).toEqual(['orders/edit.tc']);
  });

  it('spec/diff: working-tree claims added / removed vs the committed claims.json', async () => {
    const root = fixture.repoPath;
    const claim = (module: string, topic: string, subject: string) => ({ module, topic, subject });
    const claimsFile = (claims: ReturnType<typeof claim>[]) =>
      JSON.stringify({ generatedAt: '2026-01-01T00:00:00.000Z', modules: [], claims });

    write(root, '.truecourse/specs/claims.json', claimsFile([claim('auth', 'login', 'kept'), claim('auth', 'login', 'gone')]));
    gitInitCommit(root);

    // Working tree: drop `gone`, add `new`.
    write(root, '.truecourse/specs/claims.json', claimsFile([claim('auth', 'login', 'kept'), claim('billing', 'tax', 'new')]));

    const res = await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/diff`)
      .expect(200);
    expect(res.body.added.map((c: { subject: string }) => c.subject)).toEqual(['new']);
    expect(res.body.removed.map((c: { subject: string }) => c.subject)).toEqual(['gone']);
  });
});
