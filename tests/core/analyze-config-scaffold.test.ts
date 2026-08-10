import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Same socket stub as the analyze e2e test — getIO() throws with no server.
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
  };
});

import { analyzeInProcess } from '../../packages/core/src/commands/analyze-in-process';
import { clearLatestCache } from '../../packages/core/src/lib/analysis-store';
import { readProjectConfig } from '../../packages/core/src/config/project-config';
import type { RegistryEntry } from '../../packages/core/src/config/registry';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_SRC = path.resolve(__dirname, '../fixtures/sample-js-project-negative');

function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === '.truecourse' || entry.name === 'node_modules' || entry.name === '.git') continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

/**
 * A completed analyze must leave `<repo>/.truecourse/config.json` on disk.
 * The documented baseline flow is `truecourse analyze` then
 * `git add .truecourse/LATEST.json .truecourse/config.json` — without the file
 * that `git add` dies with `did not match any files` on a fresh repo.
 */
describe('analyze scaffolds .truecourse/config.json', () => {
  let workDir: string;
  let homeDir: string;
  let prevHome: string | undefined;
  let project: RegistryEntry;

  beforeAll(() => {
    prevHome = process.env.TRUECOURSE_HOME;
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-cfg-scaffold-home-'));
    process.env.TRUECOURSE_HOME = homeDir;

    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-cfg-scaffold-repo-'));
    copyDir(FIXTURE_SRC, workDir);
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 't@t',
    };
    execSync('git init -q -b main', { cwd: workDir, env });
    execSync('git add -A', { cwd: workDir, env });
    execSync('git -c commit.gpgsign=false commit -q -m init', { cwd: workDir, env });

    project = { slug: 'cfg-scaffold-test', name: 'cfg-scaffold', path: workDir };
    clearLatestCache();
  });

  afterAll(() => {
    clearLatestCache();
    if (prevHome === undefined) delete process.env.TRUECOURSE_HOME;
    else process.env.TRUECOURSE_HOME = prevHome;
    for (const d of [workDir, homeDir]) {
      if (d) fs.rmSync(d, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    // Each case starts from a repo with no store at all.
    fs.rmSync(path.join(workDir, '.truecourse'), { recursive: true, force: true });
    clearLatestCache();
  });

  const analyze = () =>
    analyzeInProcess(project, {
      enableLlmRulesOverride: false,
      skipStash: true,
      branch: 'main',
      commitHash: 'deadbeef',
    });

  it('writes the empty per-repo config when none exists', async () => {
    const configPath = path.join(workDir, '.truecourse', 'config.json');
    expect(fs.existsSync(configPath)).toBe(false);

    await analyze();

    expect(fs.existsSync(configPath)).toBe(true);
    expect(JSON.parse(fs.readFileSync(configPath, 'utf-8'))).toEqual({});
    expect(await readProjectConfig(workDir)).toEqual({});
  }, 60_000);

  it('never overwrites an existing config.json', async () => {
    const configPath = path.join(workDir, '.truecourse', 'config.json');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    const existing = JSON.stringify(
      { enableLlmRules: false, disabledRules: ['a/b'], spec: { include: ['docs/**'] } },
      null,
      2,
    );
    fs.writeFileSync(configPath, existing, 'utf-8');

    await analyze();

    expect(fs.readFileSync(configPath, 'utf-8')).toBe(existing);
  }, 60_000);
});
