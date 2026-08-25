import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Socket emits call getIO() which throws without an active socket server.
// Stub only the emit helpers + trackers; pass every other export (domain
// constants, StepTracker, etc.) through so violation-pipeline etc. keep
// working.
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
import {
  readLatest,
  readHistory,
  listAnalyses,
  clearLatestCache,
} from '../../packages/core/src/lib/analysis-store';
import {
  registerProject,
  unregisterProject,
  getProjectBySlug,
  type RegistryEntry,
} from '../../packages/core/src/config/registry';
import { updateProjectConfig } from '../../packages/core/src/config/project-config';
import { resolveRoslynHostBinary } from '../../packages/analyzer/src/roslyn-host-client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const hostBuilt = resolveRoslynHostBinary() !== null;

// One end-to-end pass per supported language: full analyze pipeline → store.
// C# is host-required (the pipeline fail-hards without the Roslyn host), so it
// runs only when the host is built. markerKey is a stable `// VIOLATION:` key
// from each fixture — if the catalog renames it, update marker + assertion.
const E2E_CASES: Array<{ lang: string; fixture: string; markerKey: string; skip: boolean }> = [
  { lang: 'JS/TS', fixture: 'sample-js-project-negative', markerKey: 'code-quality/deterministic/missing-return-type', skip: false },
  { lang: 'Python', fixture: 'sample-python-project-negative', markerKey: 'code-quality/deterministic/missing-type-hints', skip: false },
  { lang: 'C#', fixture: 'sample-csharp-project-negative', markerKey: 'architecture/deterministic/duplicate-import', skip: !hostBuilt },
];

/**
 * Copy a directory recursively, skipping generated state so fixture pollution
 * from a prior run can't leak into a fresh test invocation.
 */
function copyDir(src: string, dest: string, skipDotnetBuildArtifacts = false): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === '.truecourse' || entry.name === 'node_modules' || entry.name === '.git') continue;
    if (skipDotnetBuildArtifacts && (entry.name === 'bin' || entry.name === 'obj')) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d, skipDotnetBuildArtifacts);
    else fs.copyFileSync(s, d);
  }
}

for (const c of E2E_CASES) {
  describe.skipIf(c.skip)(`CLI analyze pipeline (e2e) — ${c.lang}`, () => {
    let workDir: string;
    let project: RegistryEntry;

    beforeAll(async () => {
      // Copy fixture into a throwaway tmpdir. We avoid analyzing the fixture
      // in-place so the shared fixture directory stays pristine across runs
      // and parallel test invocations don't step on each other.
      workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'truecourse-e2e-analyze-'));
      copyDir(path.resolve(__dirname, '../fixtures', c.fixture), workDir, c.lang === 'C#');

      // Initialize a real (empty) git repo so analyzeInProcess can collect
      // branch/commit metadata — that's what the CLI sees in production.
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
      if (c.lang === 'C#') {
        execFileSync('dotnet', ['restore', 'SampleCsharpProject.sln'], {
          cwd: workDir,
          env,
          encoding: 'utf8',
        });
      }

      project = await registerProject(workDir);

      // Disable LLM rules so the pipeline is deterministic and network-free.
      await updateProjectConfig(workDir, { enableLlmRules: false });

      clearLatestCache();
    }, c.lang === 'C#' ? 300_000 : 60_000);

    afterAll(async () => {
      if (project) await unregisterProject(project.slug);
      if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
      clearLatestCache();
    });

    it('writes a complete store and populates the registry', async () => {
      const result = await analyzeInProcess(project, { enableLlmRulesOverride: false });
      expect(result.analysisId).toBeTruthy();
      expect(result.serviceCount).toBeGreaterThan(0);

      const latest = await readLatest(workDir);
      expect(latest).not.toBeNull();
      expect(latest!.head).toBe(result.filename);
      expect(latest!.analysis.id).toBe(result.analysisId);
      expect(latest!.analysis.status).toBe('completed');
      expect(latest!.graph.services.length).toBeGreaterThan(0);
      expect(latest!.graph.modules.length).toBeGreaterThan(0);
      expect(latest!.graph.methods.length).toBeGreaterThan(0);
      expect(latest!.violations.length).toBeGreaterThan(0);

      // Sanity: a stable rule key from a `// VIOLATION:` marker in the fixture
      // should appear in the materialized violation set. If the rule catalog
      // renames this key, update the marker + assertion together.
      const ruleKeys = new Set(latest!.violations.map((v) => v.ruleKey));
      expect(ruleKeys.has(c.markerKey)).toBe(true);

      // Per-analysis snapshot file exists and its filename matches LATEST.head.
      const analysisFiles = await listAnalyses(workDir);
      expect(analysisFiles).toHaveLength(1);
      expect(analysisFiles[0]).toBe(latest!.head);

      // History has exactly one entry for the run.
      const history = await readHistory(workDir);
      expect(history.analyses).toHaveLength(1);
      expect(history.analyses[0].id).toBe(result.analysisId);
      expect(history.analyses[0].counts.services).toBe(latest!.graph.services.length);

      // Registry `lastAnalyzed` got bumped.
      const fresh = await getProjectBySlug(project.slug);
      expect(fresh?.lastAnalyzed).toBeTruthy();
    }, 180_000);
  });
}

// ---------------------------------------------------------------------------
// Stash decision (issue #64) — the CLI must never silently stash a dirty
// working tree. Flags pre-approve; absent flag + dirty + non-interactive must
// exit with a clear message; absent flag + clean does nothing.
// ---------------------------------------------------------------------------

import { resolveStashDecision } from '../../tools/cli/src/commands/analyze';

describe('resolveStashDecision', () => {
  let workDir: string;
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'test',
    GIT_AUTHOR_EMAIL: 't@t',
    GIT_COMMITTER_NAME: 'test',
    GIT_COMMITTER_EMAIL: 't@t',
  };

  beforeAll(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'truecourse-stash-decision-'));
    execSync('git init -q -b main', { cwd: workDir, env });
    fs.writeFileSync(path.join(workDir, 'a.txt'), 'committed\n');
    execSync('git add -A', { cwd: workDir, env });
    execSync('git -c commit.gpgsign=false commit -q -m init', { cwd: workDir, env });
  });

  afterAll(() => {
    if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
  });

  function makeDirty(): void {
    fs.writeFileSync(path.join(workDir, 'a.txt'), 'dirty\n');
    fs.writeFileSync(path.join(workDir, 'untracked.txt'), 'new\n');
  }
  function cleanTree(): void {
    execSync('git checkout -- a.txt', { cwd: workDir, env });
    fs.rmSync(path.join(workDir, 'untracked.txt'), { force: true });
  }

  it('--no-stash: returns skipStash=true without prompting (dirty tree)', async () => {
    makeDirty();
    try {
      const result = await resolveStashDecision({ stash: false }, workDir);
      expect(result).toEqual({ skipStash: true });
    } finally {
      cleanTree();
    }
  });

  it('--stash: returns skipStash=false without prompting (dirty tree)', async () => {
    makeDirty();
    try {
      const result = await resolveStashDecision({ stash: true }, workDir);
      expect(result).toEqual({ skipStash: false });
    } finally {
      cleanTree();
    }
  });

  it('no flag + clean tree: returns skipStash=false without prompting', async () => {
    const result = await resolveStashDecision({}, workDir);
    expect(result).toEqual({ skipStash: false });
  });

  it('no flag + non-interactive + dirty tree: exits with helpful message', async () => {
    makeDirty();
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);
    try {
      await expect(resolveStashDecision({}, workDir)).rejects.toThrow('process.exit called');
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      exitSpy.mockRestore();
      Object.defineProperty(process.stdin, 'isTTY', {
        value: originalIsTTY,
        configurable: true,
      });
      cleanTree();
    }
  });

  it('non-git directory: returns skipStash=false (nothing to stash)', async () => {
    const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'truecourse-stash-nongit-'));
    try {
      const result = await resolveStashDecision({}, nonGitDir);
      expect(result).toEqual({ skipStash: false });
    } finally {
      fs.rmSync(nonGitDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// The store dir is not user dirt: `.truecourse/` is TrueCourse's own output
// (mostly gitignored by its own template, but the dir + the committable files
// show up as untracked until someone commits them). It must never be what
// makes analyze demand a stash decision — otherwise a clean repo can't be
// analyzed non-interactively at all, since `resolveOrInitProject` creates the
// dir moments before the check runs.
// ---------------------------------------------------------------------------

import { ensureRepoTruecourseDir } from '../../packages/core/src/config/paths';
import { getGit, summarizeUserWorkingTree } from '../../packages/core/src/lib/git';

describe('resolveStashDecision — the TrueCourse store is not user dirt', () => {
  let workDir: string;
  let originalIsTTY: boolean | undefined;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'test',
    GIT_AUTHOR_EMAIL: 't@t',
    GIT_COMMITTER_NAME: 'test',
    GIT_COMMITTER_EMAIL: 't@t',
  };

  beforeAll(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'truecourse-stash-store-'));
    execSync('git init -q -b main', { cwd: workDir, env });
    execSync('git config user.name test', { cwd: workDir, env });
    execSync('git config user.email t@t', { cwd: workDir, env });
    fs.writeFileSync(path.join(workDir, 'a.js'), 'export function a() { return 1; }\n');
    execSync('git add -A', { cwd: workDir, env });
    execSync('git -c commit.gpgsign=false commit -q -m init', { cwd: workDir, env });

    // Non-interactive: the exact condition under which the decision must not
    // be demanded. `process.exit` throws so a demand fails the test loudly.
    originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);
  });

  afterAll(() => {
    exitSpy.mockRestore();
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
    if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
  });

  it('clean repo + the store dir analyze just created: no stash decision demanded', async () => {
    // Exactly what `resolveOrInitProject` does before `resolveStashDecision`.
    ensureRepoTruecourseDir(workDir);
    expect(execSync('git status --porcelain', { cwd: workDir, env }).toString()).toContain(
      '.truecourse/',
    );

    const result = await resolveStashDecision({}, workDir);
    expect(result).toEqual({ skipStash: false });
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('pre-existing untracked store (a previous run left it behind): still no demand', async () => {
    const tcDir = ensureRepoTruecourseDir(workDir);
    fs.writeFileSync(path.join(tcDir, 'config.json'), '{}\n');
    fs.writeFileSync(path.join(tcDir, 'LATEST.json'), '{}\n');
    fs.mkdirSync(path.join(tcDir, 'logs'), { recursive: true });
    fs.writeFileSync(path.join(tcDir, 'logs', 'analyze.log'), 'log\n');
    fs.mkdirSync(path.join(tcDir, 'contracts'), { recursive: true });
    fs.writeFileSync(path.join(tcDir, 'contracts', 'manifest.json'), '{}\n');

    const result = await resolveStashDecision({}, workDir);
    expect(result).toEqual({ skipStash: false });
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('real user dirt alongside the store: still exits demanding the decision', async () => {
    ensureRepoTruecourseDir(workDir);
    fs.writeFileSync(path.join(workDir, 'a.js'), 'export function a() { return 2; }\n');
    try {
      await expect(resolveStashDecision({}, workDir)).rejects.toThrow('process.exit called');
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      exitSpy.mockClear();
      execSync('git checkout -- a.js', { cwd: workDir, env });
    }
  });

  it('untracked user file alongside the store: still exits demanding the decision', async () => {
    ensureRepoTruecourseDir(workDir);
    fs.writeFileSync(path.join(workDir, 'untracked.js'), 'export const b = 1;\n');
    try {
      await expect(resolveStashDecision({}, workDir)).rejects.toThrow('process.exit called');
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      exitSpy.mockClear();
      fs.rmSync(path.join(workDir, 'untracked.js'), { force: true });
    }
  });

  it('summarizeUserWorkingTree: excludes store paths (incl. nested), keeps user counts', async () => {
    const tcDir = ensureRepoTruecourseDir(workDir);
    // A store in a subdirectory (monorepo package analyzed on its own) is
    // still TrueCourse output, wherever git reports it from.
    const nested = path.join(workDir, 'packages', 'api');
    fs.mkdirSync(nested, { recursive: true });
    ensureRepoTruecourseDir(nested);
    fs.writeFileSync(path.join(tcDir, 'LATEST.json'), '{"x":1}\n');
    fs.writeFileSync(path.join(workDir, 'a.js'), 'export function a() { return 3; }\n');
    fs.writeFileSync(path.join(workDir, 'untracked.js'), 'export const b = 1;\n');

    try {
      const status = await (await getGit(workDir)).status();
      const summary = summarizeUserWorkingTree(status);
      expect(summary.isClean).toBe(false);
      expect(summary.modifiedCount).toBe(1);
      expect(summary.untrackedCount).toBe(1);
    } finally {
      fs.rmSync(path.join(workDir, 'untracked.js'), { force: true });
      fs.rmSync(path.join(workDir, 'packages'), { recursive: true, force: true });
      execSync('git checkout -- a.js', { cwd: workDir, env });
    }
  });
});
