import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { analyzeInProcess } from '../../packages/core/src/commands/analyze-in-process.js';
import { clearLatestCache, listAnalyses } from '../../packages/core/src/lib/analysis-store.js';
import { registerProject, unregisterProject, type RegistryEntry } from '../../packages/core/src/config/registry.js';
import { buildAnalysisSteps, StepTracker, type AnalysisProgressPayload } from '../../packages/core/src/progress.js';
import { createLLMProvider } from '../../packages/core/src/services/llm/provider.js';
import { LlmSessionLimitError, type LlmTransport } from '../../packages/shared/src/llm/transport.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.resolve(__dirname, '../fixtures/sample-js-project-negative');
const originalTruecourseHome = process.env.TRUECOURSE_HOME;

function copyDir(source: string, destination: string): void {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === '.truecourse' || entry.name === 'node_modules') continue;
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

describe('analyze session-limit integrity', () => {
  let workDir: string;
  let truecourseHome: string;
  let project: RegistryEntry;

  beforeAll(async () => {
    truecourseHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-session-limit-home-'));
    process.env.TRUECOURSE_HOME = truecourseHome;
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-session-limit-analysis-'));
    copyDir(fixture, workDir);
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
    project = await registerProject(workDir);
    clearLatestCache();
  });

  afterAll(async () => {
    if (project) await unregisterProject(project.slug);
    if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
    if (truecourseHome) fs.rmSync(truecourseHome, { recursive: true, force: true });
    if (originalTruecourseHome === undefined) delete process.env.TRUECOURSE_HOME;
    else process.env.TRUECOURSE_HOME = originalTruecourseHome;
    clearLatestCache();
  });

  it.each([
    'analyze.service',
    'analyze.code',
    'analyze.database',
  ])('keeps the previous completed analysis unchanged when %s reaches the session limit', async (targetStage) => {
    await analyzeInProcess(project, {
      enableLlmRulesOverride: false,
      skipStash: true,
    });

    const latestPath = path.join(workDir, '.truecourse', 'LATEST.json');
    const historyPath = path.join(workDir, '.truecourse', 'history.json');
    const digest = (file: string): string =>
      createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    const latestBefore = digest(latestPath);
    const historyBefore = digest(historyPath);
    const analysesBefore = await listAnalyses(workDir);

    const transport: LlmTransport = async (request) => {
      if (request.stage === targetStage) {
        throw new LlmSessionLimitError('7pm (Africa/Cairo)');
      }
      if (request.stage === 'analyze.service') {
        return JSON.stringify({ violations: [], serviceDescriptions: [] });
      }
      return JSON.stringify({ violations: [] });
    };
    const progress: AnalysisProgressPayload[] = [];
    const tracker = new StepTracker(
      (payload) => progress.push(payload),
      buildAnalysisSteps(undefined, true),
    );
    const outcome = await analyzeInProcess(project, {
      enableLlmRulesOverride: true,
      skipStash: true,
      provider: createLLMProvider(transport),
      tracker,
      onLlmEstimate: async () => true,
    }).then(
      () => ({ ok: true as const, error: null }),
      (error: unknown) => ({ ok: false as const, error }),
    );

    expect.soft(outcome).toMatchObject({
      ok: false,
      error: {
        code: 'LLM_SESSION_LIMIT',
        resetHint: '7pm (Africa/Cairo)',
      },
    });
    const message = outcome.error instanceof Error ? outcome.error.message : '';
    expect.soft(message).toMatch(/LATEST\.json was not updated/i);
    expect.soft(message).toMatch(/previous completed analysis remains unchanged/i);
    expect.soft(message).toMatch(/successful LLM calls.*may be repeated/i);
    expect.soft(progress.some((payload) => payload.steps?.some((step) =>
      step.key === 'llm-session-limit' &&
      step.status === 'error' &&
      /resets 7pm.*queued LLM calls stopped.*active calls/i.test(step.detail ?? ''),
    ))).toBe(true);
    expect.soft(digest(latestPath)).toBe(latestBefore);
    expect.soft(digest(historyPath)).toBe(historyBefore);
    expect.soft(await listAnalyses(workDir)).toEqual(analysesBefore);
  }, 120_000);
});
