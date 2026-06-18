import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
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
import { readLatest, clearLatestCache } from '../../packages/core/src/lib/analysis-store';
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

describe('analyzeInProcess with codeDir — code ≠ storage key (the EE flow)', () => {
  let codeDir: string; // the "clone" — where the code is
  let keyDir: string; // the storage key — an opaque repo identity, here a path
  let project: RegistryEntry;

  beforeAll(() => {
    codeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-codedir-code-'));
    copyDir(FIXTURE_SRC, codeDir);
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 't@t',
    };
    execSync('git init -q -b main', { cwd: codeDir, env });
    execSync('git add -A', { cwd: codeDir, env });
    execSync('git -c commit.gpgsign=false commit -q -m init', { cwd: codeDir, env });

    keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-codedir-key-'));
    // Storage identity ≠ code. Manual entry (no registry side effects needed).
    project = { slug: 'codedir-test', name: 'codedir', path: keyDir };
    clearLatestCache();
  });

  afterAll(() => {
    clearLatestCache();
    for (const d of [codeDir, keyDir]) fs.rmSync(d, { recursive: true, force: true });
  });

  it('reads code from codeDir but stores the analysis under project.path', async () => {
    const result = await analyzeInProcess(project, {
      codeDir,
      enableLlmRulesOverride: false,
      skipStash: true,
      branch: 'main',
      commitHash: 'deadbeef',
    });
    expect(result.serviceCount).toBeGreaterThan(0); // the fixture code WAS analyzed

    // Stored under the key (keyDir), NOT under the code dir.
    const underKey = await readLatest(keyDir);
    expect(underKey).not.toBeNull();
    expect(underKey!.analysis.id).toBe(result.analysisId);
    expect(underKey!.graph.services.length).toBeGreaterThan(0);
    expect(underKey!.violations.length).toBeGreaterThan(0);

    // The code dir got no store written to it.
    expect(await readLatest(codeDir)).toBeNull();
    expect(fs.existsSync(path.join(codeDir, '.truecourse', 'LATEST.json'))).toBe(false);
  }, 30_000);
});
