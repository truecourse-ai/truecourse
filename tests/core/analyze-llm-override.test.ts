import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Same socket stub as the other analyze tests — getIO() throws with no server.
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

import {
  analyzeCore,
  resolveEnableLlmRules,
} from '../../packages/core/src/commands/analyze-core';
import { clearLatestCache } from '../../packages/core/src/lib/analysis-store';
import { updateProjectConfig } from '../../packages/core/src/config/project-config';
import type { RegistryEntry } from '../../packages/core/src/config/registry';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_SRC = path.resolve(__dirname, '../fixtures/sample-js-project-negative');

/**
 * `--llm` / `--no-llm` are documented as per-run: "`--no-llm` skips them for
 * that run" (reference/spec-docs/analyze/rules.mdx). That only holds if the
 * flag OUTRANKS the value `truecourse rules llm --enable/--disable` persisted
 * into the repo's `config.json` — a saved setting that beat the flag would make
 * the flag a no-op on exactly the repos that bothered to configure it.
 */
describe('resolveEnableLlmRules — per-run override beats the saved repo setting', () => {
  it('honors --no-llm even when the repo has LLM rules enabled', () => {
    expect(resolveEnableLlmRules(false, true)).toBe(false);
  });

  it('honors --llm even when the repo has LLM rules disabled', () => {
    expect(resolveEnableLlmRules(true, false)).toBe(true);
  });

  it('falls back to the saved repo setting when no flag was passed', () => {
    expect(resolveEnableLlmRules(undefined, true)).toBe(true);
    expect(resolveEnableLlmRules(undefined, false)).toBe(false);
  });

  it('defaults to on when neither a flag nor a repo setting exists', () => {
    expect(resolveEnableLlmRules(undefined, undefined)).toBe(true);
    // `rules llm --reset` writes an explicit null — the "no opinion" value.
    expect(resolveEnableLlmRules(undefined, null)).toBe(true);
  });
});

/**
 * The precedence has to survive the trip into the violation pipeline, not just
 * hold in isolation: the CLI already resolves flag+config into one boolean and
 * renders its checklist from it, so if the core re-derives a different value
 * the run silently disagrees with what the terminal just said it would do.
 *
 * `onLlmEstimate` is the observable: the pipeline only builds and offers an
 * estimate when at least one LLM rule survived the `enableLlmRules` filter.
 * Answering `false` means no model is ever called, so both directions are
 * network-free.
 */
describe('analyzeCore — the effective LLM decision reaches the pipeline', () => {
  let workDir: string;
  let project: RegistryEntry;

  beforeAll(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-llm-override-'));
    for (const entry of walk(FIXTURE_SRC)) {
      const dest = path.join(workDir, path.relative(FIXTURE_SRC, entry));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(entry, dest);
    }
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

    project = { slug: 'llm-override-test', name: 'llm-override', path: workDir };
    clearLatestCache();
  });

  afterAll(() => {
    clearLatestCache();
    if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    clearLatestCache();
  });

  it('runs no LLM rules under --no-llm even though the repo enabled them', async () => {
    await updateProjectConfig(workDir, { enableLlmRules: true });
    const onLlmEstimate = vi.fn(async () => false);

    const core = await analyzeCore(project, {
      mode: 'full',
      skipStash: true,
      skipGit: true,
      enableLlmRulesOverride: false,
      onLlmEstimate,
    });

    expect(core.analysisId).toBeTruthy();
    expect(onLlmEstimate).not.toHaveBeenCalled();
  }, 120_000);

  it('runs LLM rules under --llm even though the repo disabled them', async () => {
    await updateProjectConfig(workDir, { enableLlmRules: false });
    const onLlmEstimate = vi.fn(async () => false); // decline — no model is called

    await analyzeCore(project, {
      mode: 'full',
      skipStash: true,
      skipGit: true,
      enableLlmRulesOverride: true,
      onLlmEstimate,
    });

    expect(onLlmEstimate).toHaveBeenCalledTimes(1);
  }, 120_000);
});

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.truecourse' || entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}
