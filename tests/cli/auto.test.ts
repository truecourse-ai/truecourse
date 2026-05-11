import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

import {
  runAutoEnable,
  runAutoDisable,
  runAutoStatus,
} from '../../tools/cli/src/commands/auto';

const HOOK_NAMES = ['post-merge', 'post-rewrite'] as const;
const IDENTIFIER = '# TrueCourse auto-mode hook';
const BRANCH_MARKER = '# truecourse-branch:';
const COMMIT_MARKER = '# truecourse-commit:';

function initRepo(dir: string): void {
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email test@example.com', { cwd: dir });
  execSync('git config user.name test', { cwd: dir });
}

/**
 * Create main with one commit so detectMainBranch() can find it. Without
 * a commit, `git show-ref refs/heads/main` returns nothing.
 */
function seedMain(dir: string): void {
  fs.writeFileSync(path.join(dir, 'README'), 'hello');
  execSync('git add README && git commit -q -m init', { cwd: dir });
  execSync('git branch -M main', { cwd: dir });
}

describe('truecourse auto', () => {
  let repoDir: string;
  let originalCwd: string;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-auto-'));
    originalCwd = process.cwd();
    process.chdir(repoDir);

    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(repoDir, { recursive: true, force: true });
    exitSpy.mockRestore();
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  function hookPath(name: string): string {
    return path.join(repoDir, '.git', 'hooks', name);
  }

  it('exits with an error when not in a git repository', async () => {
    await expect(runAutoEnable({ branch: 'main' })).rejects.toThrow('process.exit(1)');
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('Not a git repository'),
    );
  });

  it('enable bakes the explicit --branch into both hooks and marks them executable', async () => {
    initRepo(repoDir);
    await runAutoEnable({ branch: 'develop' });

    for (const name of HOOK_NAMES) {
      const p = hookPath(name);
      expect(fs.existsSync(p), `${name} should exist`).toBe(true);
      const content = fs.readFileSync(p, 'utf-8');
      expect(content).toContain(IDENTIFIER);
      expect(content).toContain(`${BRANCH_MARKER} develop`);
      expect(content).toContain('"$current_branch" = "develop"');
      expect(content).toMatch(/--no-llm/);
      expect(content).toMatch(/--no-stash/);
      const mode = fs.statSync(p).mode & 0o777;
      expect(mode & 0o100).toBe(0o100);
    }
  });

  it('enable rejects branch names with invalid characters', async () => {
    initRepo(repoDir);
    await expect(runAutoEnable({ branch: 'evil; rm -rf /' })).rejects.toThrow(
      'process.exit(1)',
    );
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('invalid branch name'));
    expect(fs.existsSync(hookPath('post-merge'))).toBe(false);
  });

  it('enable auto-detects from a local main branch in non-interactive mode', async () => {
    initRepo(repoDir);
    seedMain(repoDir);

    const wasTty = process.stdout.isTTY;
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    try {
      await runAutoEnable({});
    } finally {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: wasTty,
        configurable: true,
      });
    }

    const content = fs.readFileSync(hookPath('post-merge'), 'utf-8');
    expect(content).toContain(`${BRANCH_MARKER} main`);
    expect(content).toContain('"$current_branch" = "main"');
  });

  it('enable errors in non-interactive mode when no branch can be detected', async () => {
    initRepo(repoDir); // no commit, no branch yet

    const wasTty = process.stdout.isTTY;
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    try {
      await expect(runAutoEnable({})).rejects.toThrow('process.exit(1)');
    } finally {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: wasTty,
        configurable: true,
      });
    }
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('could not detect a main branch'),
    );
  });

  it('enable is idempotent: re-running with same branch overwrites our hooks identically', async () => {
    initRepo(repoDir);
    await runAutoEnable({ branch: 'main' });
    const before = fs.readFileSync(hookPath('post-merge'), 'utf-8');
    await runAutoEnable({ branch: 'main' });
    const after = fs.readFileSync(hookPath('post-merge'), 'utf-8');
    expect(after).toBe(before);
  });

  it('enable can change the trigger branch on rerun', async () => {
    initRepo(repoDir);
    await runAutoEnable({ branch: 'main' });
    await runAutoEnable({ branch: 'trunk' });
    const content = fs.readFileSync(hookPath('post-merge'), 'utf-8');
    expect(content).toContain(`${BRANCH_MARKER} trunk`);
    expect(content).toContain('"$current_branch" = "trunk"');
    expect(content).not.toContain(`${BRANCH_MARKER} main`);
  });

  it('enable refuses to clobber a foreign hook and exits 1', async () => {
    initRepo(repoDir);
    const foreignBody = '#!/bin/sh\necho "my custom hook"\n';
    fs.mkdirSync(path.join(repoDir, '.git', 'hooks'), { recursive: true });
    fs.writeFileSync(hookPath('post-merge'), foreignBody, { mode: 0o755 });

    await expect(runAutoEnable({ branch: 'main' })).rejects.toThrow('process.exit(1)');
    expect(fs.readFileSync(hookPath('post-merge'), 'utf-8')).toBe(foreignBody);
    expect(fs.existsSync(hookPath('post-rewrite'))).toBe(false);
  });

  it('disable removes only our hooks, leaves foreign ones', async () => {
    initRepo(repoDir);
    await runAutoEnable({ branch: 'main' });

    const foreign = '#!/bin/sh\necho hi\n';
    fs.writeFileSync(hookPath('post-rewrite'), foreign, { mode: 0o755 });

    runAutoDisable();

    expect(fs.existsSync(hookPath('post-merge'))).toBe(false);
    expect(fs.readFileSync(hookPath('post-rewrite'), 'utf-8')).toBe(foreign);
  });

  it('disable is a no-op (no error) when nothing is installed', () => {
    initRepo(repoDir);
    expect(() => runAutoDisable()).not.toThrow();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('not enabled'));
  });

  it('status surfaces the configured branch and commit mode when enabled', async () => {
    initRepo(repoDir);
    await runAutoEnable({ branch: 'develop' });
    logSpy.mockClear();
    runAutoStatus();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('branch: develop, commit: no'),
    );
  });

  it('status detects an inconsistent half-installed state', async () => {
    initRepo(repoDir);
    await runAutoEnable({ branch: 'main' });
    // Replace just one hook with a different-branch script to simulate a
    // partial reinstall (e.g. user interrupted mid-rerun).
    const wonky = fs
      .readFileSync(hookPath('post-merge'), 'utf-8')
      .replace(`${BRANCH_MARKER} main`, `${BRANCH_MARKER} trunk`)
      .replace('"$current_branch" = "main"', '"$current_branch" = "trunk"');
    fs.writeFileSync(hookPath('post-rewrite'), wonky);

    logSpy.mockClear();
    runAutoStatus();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('inconsistent'),
    );
  });

  it('hook script gates on the configured branch (feature branch skips, main fires)', async () => {
    initRepo(repoDir);
    seedMain(repoDir);
    await runAutoEnable({ branch: 'main' });

    // Stub `truecourse` and `npx` in PATH so the hook's analyze call just
    // touches a marker file — we don't want a real analyze in tests.
    const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-auto-stub-'));
    const marker = path.join(repoDir, 'analyze-was-called');
    const stub = `#!/bin/sh\ntouch "${marker}"\nexit 0\n`;
    fs.writeFileSync(path.join(stubDir, 'truecourse'), stub, { mode: 0o755 });
    fs.writeFileSync(path.join(stubDir, 'npx'), stub, { mode: 0o755 });
    const env = { ...process.env, PATH: `${stubDir}:${process.env.PATH}` };

    // Feature branch → gate skips, marker stays absent.
    execSync('git checkout -q -b feature', { cwd: repoDir });
    execSync(`sh ${hookPath('post-merge')}`, { cwd: repoDir, env });
    expect(fs.existsSync(marker)).toBe(false);

    // Main → gate fires, background analyze stub touches the marker.
    execSync('git checkout -q main', { cwd: repoDir });
    execSync(`sh ${hookPath('post-merge')}`, { cwd: repoDir, env });
    const deadline = Date.now() + 2000;
    while (!fs.existsSync(marker) && Date.now() < deadline) {
      // bounded poll
    }
    expect(fs.existsSync(marker)).toBe(true);

    fs.rmSync(stubDir, { recursive: true, force: true });
  });

  it('hook script honours a non-default trigger branch (develop)', async () => {
    initRepo(repoDir);
    seedMain(repoDir);
    execSync('git checkout -q -b develop', { cwd: repoDir });
    await runAutoEnable({ branch: 'develop' });

    const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-auto-stub-'));
    const marker = path.join(repoDir, 'analyze-was-called');
    const stub = `#!/bin/sh\ntouch "${marker}"\nexit 0\n`;
    fs.writeFileSync(path.join(stubDir, 'truecourse'), stub, { mode: 0o755 });
    fs.writeFileSync(path.join(stubDir, 'npx'), stub, { mode: 0o755 });
    const env = { ...process.env, PATH: `${stubDir}:${process.env.PATH}` };

    // On main: gate skips (we configured 'develop' as the trigger).
    execSync('git checkout -q main', { cwd: repoDir });
    execSync(`sh ${hookPath('post-merge')}`, { cwd: repoDir, env });
    expect(fs.existsSync(marker)).toBe(false);

    // On develop: gate fires.
    execSync('git checkout -q develop', { cwd: repoDir });
    execSync(`sh ${hookPath('post-merge')}`, { cwd: repoDir, env });
    const deadline = Date.now() + 2000;
    while (!fs.existsSync(marker) && Date.now() < deadline) {
      // bounded poll
    }
    expect(fs.existsSync(marker)).toBe(true);

    fs.rmSync(stubDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // --commit mode
  // -------------------------------------------------------------------------

  /**
   * Set up a repo with a fake `origin` remote pointing at itself, both main
   * branches at the same SHA, and an initial committed `LATEST.json`. That
   * gives the hook's commit gate (`HEAD == origin/main`) a defined baseline
   * we can advance or diverge in each test.
   */
  function seedRepoWithOrigin(dir: string): void {
    initRepo(dir);
    fs.mkdirSync(path.join(dir, '.truecourse'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.truecourse', 'LATEST.json'), '{"v": 1}');
    fs.writeFileSync(path.join(dir, 'README'), 'hello');
    execSync('git add README .truecourse/LATEST.json', { cwd: dir });
    execSync('git commit -q -m initial', { cwd: dir });
    execSync('git branch -M main', { cwd: dir });
    // Fake an origin/main ref pointing at HEAD by writing the packed ref
    // directly. This lets `git rev-parse origin/main` resolve without an
    // actual remote round-trip.
    const sha = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf-8' }).trim();
    const remotesDir = path.join(dir, '.git', 'refs', 'remotes', 'origin');
    fs.mkdirSync(remotesDir, { recursive: true });
    fs.writeFileSync(path.join(remotesDir, 'main'), sha + '\n');
  }

  /**
   * Build a stub `truecourse` that mutates LATEST.json (so a commit becomes
   * possible) and a stub `npx` that just exits. We shadow both via PATH so
   * the hook never reaches a real CLI.
   */
  function makeStubs(repoDir: string, mutateLatest: boolean): {
    stubDir: string;
    env: NodeJS.ProcessEnv;
  } {
    const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-auto-stub-'));
    const truecourseStub = mutateLatest
      ? `#!/bin/sh\nmkdir -p "${repoDir}/.truecourse"\necho "{\\"v\\": 2}" > "${repoDir}/.truecourse/LATEST.json"\nexit 0\n`
      : `#!/bin/sh\nexit 0\n`;
    fs.writeFileSync(path.join(stubDir, 'truecourse'), truecourseStub, { mode: 0o755 });
    fs.writeFileSync(path.join(stubDir, 'npx'), `#!/bin/sh\nexit 0\n`, { mode: 0o755 });
    const env = { ...process.env, PATH: `${stubDir}:${process.env.PATH}` };
    return { stubDir, env };
  }

  /** Wait until the hook's background subshell finishes (analyze + commit). */
  function awaitBackgroundDone(repoDir: string, deadlineMs = 3000): void {
    const deadline = Date.now() + deadlineMs;
    // The background subshell appends to auto.log; once HEAD advances or the
    // log mentions completion we're done. Simpler: just poll for HEAD to
    // change, with a short ceiling so we don't hang on a no-op test.
    const startHead = execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf-8' }).trim();
    while (Date.now() < deadline) {
      const cur = execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf-8' }).trim();
      if (cur !== startHead) return;
    }
  }

  it('enable --commit bakes the commit marker into the hook', async () => {
    initRepo(repoDir);
    await runAutoEnable({ branch: 'main', commit: true });
    const content = fs.readFileSync(hookPath('post-merge'), 'utf-8');
    expect(content).toContain(`${COMMIT_MARKER} yes`);
    expect(content).toContain('git commit -q -m "chore: refresh LATEST.json [truecourse auto]"');
  });

  it('enable without --commit bakes commit:no and omits the commit block', async () => {
    initRepo(repoDir);
    await runAutoEnable({ branch: 'main' });
    const content = fs.readFileSync(hookPath('post-merge'), 'utf-8');
    expect(content).toContain(`${COMMIT_MARKER} no`);
    expect(content).not.toContain('git commit');
  });

  it('status reports the commit mode', async () => {
    initRepo(repoDir);
    await runAutoEnable({ branch: 'main', commit: true });
    logSpy.mockClear();
    runAutoStatus();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('commit: yes'),
    );
  });

  it('hook commits LATEST.json when HEAD == origin/main and the file changed', async () => {
    seedRepoWithOrigin(repoDir);
    await runAutoEnable({ branch: 'main', commit: true });

    const startHead = execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf-8' }).trim();
    const { stubDir, env } = makeStubs(repoDir, /* mutateLatest */ true);

    execSync(`sh ${hookPath('post-merge')}`, { cwd: repoDir, env });
    awaitBackgroundDone(repoDir);

    const endHead = execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf-8' }).trim();
    expect(endHead).not.toBe(startHead);
    const lastMsg = execSync('git log -1 --pretty=%s', { cwd: repoDir, encoding: 'utf-8' }).trim();
    expect(lastMsg).toContain('refresh LATEST.json');

    fs.rmSync(stubDir, { recursive: true, force: true });
  });

  it('hook skips commit when HEAD has diverged from origin/main', async () => {
    seedRepoWithOrigin(repoDir);
    await runAutoEnable({ branch: 'main', commit: true });

    // Add a local commit so HEAD advances past origin/main — the gate must skip.
    fs.writeFileSync(path.join(repoDir, 'extra.txt'), 'local');
    execSync('git add extra.txt && git commit -q -m local', { cwd: repoDir });
    const headBefore = execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf-8' }).trim();

    const { stubDir, env } = makeStubs(repoDir, /* mutateLatest */ true);
    execSync(`sh ${hookPath('post-merge')}`, { cwd: repoDir, env });
    // Give the background process time to either commit (bug) or skip (correct).
    const deadline = Date.now() + 1500;
    while (Date.now() < deadline) { /* settle */ }

    const headAfter = execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf-8' }).trim();
    expect(headAfter).toBe(headBefore);

    fs.rmSync(stubDir, { recursive: true, force: true });
  });

  it('hook skips commit when LATEST.json did not change', async () => {
    seedRepoWithOrigin(repoDir);
    await runAutoEnable({ branch: 'main', commit: true });

    const headBefore = execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf-8' }).trim();
    const { stubDir, env } = makeStubs(repoDir, /* mutateLatest */ false);

    execSync(`sh ${hookPath('post-merge')}`, { cwd: repoDir, env });
    const deadline = Date.now() + 1500;
    while (Date.now() < deadline) { /* settle */ }

    const headAfter = execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf-8' }).trim();
    expect(headAfter).toBe(headBefore);

    fs.rmSync(stubDir, { recursive: true, force: true });
  });

  it('hook skips commit when origin/<branch> ref is missing', async () => {
    initRepo(repoDir);
    seedMain(repoDir); // no origin remote at all
    await runAutoEnable({ branch: 'main', commit: true });

    fs.mkdirSync(path.join(repoDir, '.truecourse'), { recursive: true });
    fs.writeFileSync(path.join(repoDir, '.truecourse', 'LATEST.json'), '{"v": 1}');
    execSync('git add .truecourse/LATEST.json && git commit -q -m baseline', { cwd: repoDir });
    const headBefore = execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf-8' }).trim();

    const { stubDir, env } = makeStubs(repoDir, /* mutateLatest */ true);
    execSync(`sh ${hookPath('post-merge')}`, { cwd: repoDir, env });
    const deadline = Date.now() + 1500;
    while (Date.now() < deadline) { /* settle */ }

    const headAfter = execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf-8' }).trim();
    expect(headAfter).toBe(headBefore);

    fs.rmSync(stubDir, { recursive: true, force: true });
  });

  it('hook script skips when an analyze lock exists', async () => {
    initRepo(repoDir);
    seedMain(repoDir);
    await runAutoEnable({ branch: 'main' });

    fs.mkdirSync(path.join(repoDir, '.truecourse'), { recursive: true });
    fs.writeFileSync(path.join(repoDir, '.truecourse', '.analyze.lock'), '');

    const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-auto-stub-'));
    const marker = path.join(repoDir, 'analyze-was-called');
    const stub = `#!/bin/sh\ntouch "${marker}"\nexit 0\n`;
    fs.writeFileSync(path.join(stubDir, 'truecourse'), stub, { mode: 0o755 });
    fs.writeFileSync(path.join(stubDir, 'npx'), stub, { mode: 0o755 });
    const env = { ...process.env, PATH: `${stubDir}:${process.env.PATH}` };

    execSync(`sh ${hookPath('post-merge')}`, { cwd: repoDir, env });
    const deadline = Date.now() + 500;
    while (Date.now() < deadline) {
      // brief settle for any background process
    }
    expect(fs.existsSync(marker)).toBe(false);

    fs.rmSync(stubDir, { recursive: true, force: true });
  });
});
