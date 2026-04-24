import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_SRC = path.resolve(__dirname, '../fixtures/sample-js-project-negative');

/**
 * Copy a directory recursively, skipping `.truecourse/` so fixture pollution
 * from a prior run can't leak into a fresh test invocation.
 */
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

describe('CLI analyze pipeline (e2e)', () => {
  let workDir: string;
  let project: RegistryEntry;

  beforeAll(async () => {
    // Copy fixture into a throwaway tmpdir. We avoid analyzing the fixture
    // in-place so the shared fixture directory stays pristine across runs
    // and parallel test invocations don't step on each other.
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'truecourse-e2e-analyze-'));
    copyDir(FIXTURE_SRC, workDir);

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

    project = registerProject(workDir);

    // Disable LLM rules so the pipeline is deterministic and network-free.
    // Config takes precedence over the override inside analyze-core, so we
    // set it here to be explicit about what's exercised.
    updateProjectConfig(workDir, { enableLlmRules: false });

    clearLatestCache();
  }, 30_000);

  afterAll(() => {
    if (project) unregisterProject(project.slug);
    if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
    clearLatestCache();
  });

  it('writes a complete store and populates the registry', async () => {
    const result = await analyzeInProcess(project, { enableLlmRulesOverride: false });
    expect(result.analysisId).toBeTruthy();
    expect(result.serviceCount).toBeGreaterThan(0);

    const latest = readLatest(workDir);
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
    expect(ruleKeys.has('code-quality/deterministic/missing-return-type')).toBe(true);

    // Per-analysis snapshot file exists and its filename matches LATEST.head.
    const analysisFiles = listAnalyses(workDir);
    expect(analysisFiles).toHaveLength(1);
    expect(analysisFiles[0]).toBe(latest!.head);

    // History has exactly one entry for the run.
    const history = readHistory(workDir);
    expect(history.analyses).toHaveLength(1);
    expect(history.analyses[0].id).toBe(result.analysisId);
    expect(history.analyses[0].counts.services).toBe(latest!.graph.services.length);

    // Registry `lastAnalyzed` got bumped.
    const fresh = getProjectBySlug(project.slug);
    expect(fresh?.lastAnalyzed).toBeTruthy();
  }, 120_000);
});
