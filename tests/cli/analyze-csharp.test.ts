import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Same socket stub as analyze.test.ts — emits require a live socket server.
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
import {
  registerProject,
  unregisterProject,
  type RegistryEntry,
} from '../../packages/core/src/config/registry';
import { updateProjectConfig } from '../../packages/core/src/config/project-config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_SRC = path.resolve(__dirname, '../fixtures/sample-csharp-project-negative');

function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === '.truecourse' || entry.name === 'bin' || entry.name === 'obj' || entry.name === '.git') continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

describe('CLI analyze pipeline (e2e, C#)', () => {
  let workDir: string;
  let project: RegistryEntry;

  beforeAll(async () => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'truecourse-e2e-analyze-cs-'));
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

    project = registerProject(workDir);
    updateProjectConfig(workDir, { enableLlmRules: false });
    clearLatestCache();
  }, 30_000);

  afterAll(() => {
    if (project) unregisterProject(project.slug);
    if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
    clearLatestCache();
  });

  it('analyzes a C# repo end to end: graph, flows, databases, violations, store', async () => {
    const result = await analyzeInProcess(project, { enableLlmRulesOverride: false });
    expect(result.analysisId).toBeTruthy();

    const latest = readLatest(workDir);
    expect(latest).not.toBeNull();
    expect(latest!.analysis.status).toBe('completed');

    const graph = latest!.graph;

    // Services typed from csproj SDKs, not directory heuristics
    const services = new Map(graph.services.map((s) => [s.name, s.type]));
    expect(services.get('ApiGateway')).toBe('api-server');
    expect(services.get('UserService')).toBe('api-server');
    expect(services.get('Utils')).toBe('library');

    expect(graph.modules.length).toBeGreaterThan(50);
    expect(graph.methods.length).toBeGreaterThan(100);

    // Flow tracing works through minimal-API registration and DI'd services,
    // crossing into the shared library
    expect(graph.flows.length).toBeGreaterThan(0);
    const getAll = graph.flows.find((f) => f.name === 'UserController.GetAll');
    expect(getAll).toBeDefined();
    const stepTargets = getAll!.steps.map((s) => `${s.targetModule}.${s.targetMethod}`);
    expect(stepTargets).toContain('UserService.FindAll');
    expect(stepTargets).toContain('Formatters.FormatUser');

    // Manifest-declared EF provider detected with parsed entity tables
    const postgres = graph.databases.find((db) => db.type === 'postgres');
    expect(postgres).toBeDefined();
    expect(postgres!.tables.length).toBeGreaterThan(0);

    // Violations from the marker corpus made it through the full pipeline
    expect(latest!.violations.length).toBeGreaterThan(300);
    const ruleKeys = new Set(latest!.violations.map((v) => v.ruleKey));
    expect(ruleKeys.has('security/deterministic/sql-injection')).toBe(true);
    expect(ruleKeys.has('bugs/deterministic/empty-catch')).toBe(true);
    expect(ruleKeys.has('code-quality/deterministic/cognitive-complexity')).toBe(true);
  }, 180_000);
});
