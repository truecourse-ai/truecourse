/**
 * How the pre-flight cost estimate presents in the terminal for `spec scan` and
 * `guard generate`.
 *
 * The estimate runs BEFORE the pipeline's first step, so it needs a live surface
 * of its own — but not a checklist step: the step renderer redraws the checklist
 * in place, so a leading `Estimating cost` step made the whole list paint once
 * while estimating (every real step pending) and again after the confirm. It now
 * resolves its own spinner line above the estimate panel, and the checklist
 * starts with the run itself.
 *
 * The engines are mocked (they have their own suites) — the subject here is
 * strictly what the two surfaces print and in what order.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import type { EstimatePhase, StepTracker } from '@truecourse/core/progress';

vi.mock('../../tools/cli/src/lib/claude-preflight.js', () => ({
  preflightClaudeOrExit: async () => {},
  preflightLlmOrExit: async () => {},
}));

vi.mock('@truecourse/core/commands/spec-in-process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@truecourse/core/commands/spec-in-process')>();
  return { ...actual, curateInProcess: vi.fn() };
});

vi.mock('@truecourse/core/commands/guard-in-process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@truecourse/core/commands/guard-in-process')>();
  return { ...actual, guardGenerateInProcess: vi.fn() };
});

import { runSpecScan } from '../../tools/cli/src/commands/spec.js';
import { runGuardGenerate } from '../../tools/cli/src/commands/guard.js';
import { curateInProcess, EstimateDeclined } from '@truecourse/core/commands/spec-in-process';
import { guardGenerateInProcess } from '@truecourse/core/commands/guard-in-process';
import type { LlmEstimate } from '@truecourse/core/commands/analyze-in-process';

/** A staged estimate shaped like the real scan/guard ones (subject + one stage). */
function estimate(subject: string): LlmEstimate {
  return {
    totalEstimatedTokens: 1_200_000,
    tiers: [],
    subjectLabel: subject,
    estimatedCostUsd: 3.1,
    costSource: 'bundled',
    stages: [
      {
        // The scan's stages are SESSION KINDS now (plan 02 step 7), all on one model.
        stage: 'spec-scan.curate-doc',
        label: 'Curating docs',
        model: 'opus',
        calls: 80,
        estimatedTokens: 1_200_000,
        estimatedCostUsd: 3.1,
      },
    ],
  } as LlmEstimate;
}

interface Driven {
  onEstimatePhase?: EstimatePhase;
  onLlmEstimate?: (e: LlmEstimate) => Promise<boolean>;
  tracker?: StepTracker;
}

/**
 * Everything the command wrote, in ONE ordered log: clack prints to stdout, the
 * checklist renderer to stderr, and the defect is about their interleaving.
 */
interface Captured {
  merged: string;
  stdout: string;
  stderr: string;
  /** Index into `merged` of the first checklist (stderr) byte, or -1. */
  firstChecklistAt: number;
  exit?: number;
}

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');

async function capture(fn: () => Promise<void>): Promise<Captured> {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  let merged = '';
  let firstChecklistAt = -1;
  const write = (chunks: string[], isStderr: boolean) =>
    ((c: string | Uint8Array) => {
      const text = stripAnsi(typeof c === 'string' ? c : Buffer.from(c).toString());
      if (isStderr && firstChecklistAt < 0 && text.trim()) firstChecklistAt = merged.length;
      chunks.push(text);
      merged += text;
      return true;
    }) as never;
  const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(write(stdoutChunks, false));
  const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(write(stderrChunks, true));
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`exit:${code ?? 0}`);
  }) as never);
  let exit: number | undefined;
  try {
    await fn();
  } catch (err) {
    const match = /^exit:(\d+)$/.exec((err as Error).message);
    if (!match) throw err;
    exit = Number(match[1]);
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
    exitSpy.mockRestore();
  }
  return {
    merged,
    stdout: stdoutChunks.join(''),
    stderr: stderrChunks.join(''),
    firstChecklistAt,
    exit,
  };
}

let repo: string;
let home: string;
let stdinIsTTY: boolean | undefined;
let stderrIsTTY: boolean | undefined;

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-cli-estimate-'));
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-cli-estimate-home-'));
  process.env.TRUECOURSE_HOME = home;
  execSync('git init -q', { cwd: repo });
  // Non-interactive: the confirm gate declines instead of blocking on stdin, and
  // the renderer leaves its lines unclamped so the captured text is whole.
  stdinIsTTY = process.stdin.isTTY;
  stderrIsTTY = process.stderr.isTTY;
  (process.stdin as { isTTY?: boolean }).isTTY = false;
  (process.stderr as { isTTY?: boolean }).isTTY = false;
  vi.mocked(curateInProcess).mockReset();
  vi.mocked(guardGenerateInProcess).mockReset();
});

afterEach(() => {
  (process.stdin as { isTTY?: boolean }).isTTY = stdinIsTTY;
  (process.stderr as { isTTY?: boolean }).isTTY = stderrIsTTY;
  delete process.env.TRUECOURSE_HOME;
  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});

/** Drive the estimate phase + gate the way the real curate does, then the run. */
function curateDriver(approved: boolean, extra: { pendingQuestions?: unknown[] } = {}) {
  return (async (_root: string, opts: Driven) => {
    opts.onEstimatePhase?.start();
    opts.onEstimatePhase?.done('80 docs');
    if (!(await opts.onLlmEstimate!(estimate('80 docs')))) throw new EstimateDeclined('scan');
    expect(approved).toBe(true);
    opts.tracker?.start('discover');
    opts.tracker?.done('discover', '80/80 docs');
    opts.tracker?.start('tag');
    opts.tracker?.done('tag', '80/80 docs');
    return {
      noChanges: false,
      // §3.7: every scan result carries these; the CLI summary must surface them.
      pendingQuestions: extra.pendingQuestions ?? [],
      scanFindings: [],
      curate: {
        corpus: { areas: [] },
        decisions: {},
        stats: {
          scopeGlobs: [],
          docsScanned: 80,
          docsKept: 74,
          skippedDocs: [],
          thirdPartyDropped: 0,
          thirdPartyRestored: 0,
          classifyFailed: 0,
          areaCount: 9,
          overlapFlags: 0,
          outOfScopeManualIncludes: [],
          llmFailures: [],
        },
      },
    };
  }) as never;
}

describe('spec scan — estimate presentation', () => {
  it('resolves the estimate line before the panel, then paints the checklist once', async () => {
    vi.mocked(curateInProcess).mockImplementation(curateDriver(true));

    const { merged, stdout, stderr, firstChecklistAt, exit } = await capture(() =>
      runSpecScan({ cwd: repo, yes: true }),
    );

    expect(exit).toBeUndefined();
    // A standalone resolved line carrying the estimate's subject — the `claude`
    // preflight's shape — and it lands BEFORE the panel it introduces.
    expect(stdout).toContain('Cost estimated — 80 docs');
    expect(merged.indexOf('Cost estimated — 80 docs')).toBeLessThan(
      merged.indexOf('Scan will make ~80 LLM calls over 80 docs'),
    );
    // The checklist is the run's own steps only, and nothing of it was drawn
    // before the confirm resolved.
    expect(stderr).not.toContain('Estimating');
    expect(stderr).toContain('Discovering docs');
    expect(firstChecklistAt).toBeGreaterThan(merged.indexOf('Scan will make ~80 LLM calls'));
  });

  it('declining prints the estimate line + panel and never paints a checklist', async () => {
    vi.mocked(curateInProcess).mockImplementation(curateDriver(false));

    const { stdout, stderr, exit } = await capture(() => runSpecScan({ cwd: repo }));

    expect(exit).toBe(0);
    expect(stdout).toContain('Cost estimated — 80 docs');
    expect(stdout).toContain('Scan will make ~80 LLM calls over 80 docs');
    expect(stdout).toContain('Scan cancelled.');
    expect(stderr).toBe('');
  });

  // The scope orchestrator is interactive but a CLI run never blocks on it, so an
  // unanswered question must be LOUD in the summary or it silently becomes a
  // default (plan 02 step 6 / §3.7).
  it('surfaces an unanswered scope question in the summary', async () => {
    vi.mocked(curateInProcess).mockImplementation(
      curateDriver(true, {
        pendingQuestions: [
          {
            id: 'q1',
            header: 'Scan scope',
            question: 'Is `docs/` product documentation or the company handbook?',
            options: [],
            multiSelect: false,
          },
        ],
      }),
    );

    const { stdout, exit } = await capture(() => runSpecScan({ cwd: repo, yes: true }));

    expect(exit).toBeUndefined();
    expect(stdout).toContain('1 scan question went unanswered');
    expect(stdout).toContain('Scan scope: Is `docs/` product documentation');
  });
});

describe('guard generate — estimate presentation', () => {
  it('resolves the estimate line before the panel, then paints the checklist once', async () => {
    vi.mocked(guardGenerateInProcess).mockImplementation((async (_root: string, opts: Driven) => {
      opts.onEstimatePhase?.start();
      opts.onEstimatePhase?.done('3 of 14 sections changed');
      if (!(await opts.onLlmEstimate!(estimate('3 of 14 sections changed')))) {
        throw new EstimateDeclined('guard');
      }
      opts.tracker?.start('index');
      opts.tracker?.done('index', '14 sections');
      return { guard: { status: 'ok', noChanges: true, written: [], birthFindings: [], errors: [], llmFailures: [], extractionFailures: [] } };
    }) as never);

    const { merged, stdout, stderr, firstChecklistAt, exit } = await capture(() =>
      runGuardGenerate({ cwd: repo, yes: true }),
    );

    expect(exit).toBeUndefined();
    expect(stdout).toContain('Cost estimated — 3 of 14 sections changed');
    expect(merged.indexOf('Cost estimated — 3 of 14 sections changed')).toBeLessThan(
      merged.indexOf('Generate will make ~80 LLM calls'),
    );
    expect(stderr).not.toContain('Estimating');
    expect(stderr).toContain('Indexing sections');
    expect(firstChecklistAt).toBeGreaterThan(merged.indexOf('Generate will make ~80 LLM calls'));
  });

  it('declining prints the estimate line + panel and never paints a checklist', async () => {
    vi.mocked(guardGenerateInProcess).mockImplementation((async (_root: string, opts: Driven) => {
      opts.onEstimatePhase?.start();
      opts.onEstimatePhase?.done('3 of 14 sections changed');
      await opts.onLlmEstimate!(estimate('3 of 14 sections changed'));
      throw new EstimateDeclined('guard');
    }) as never);

    const { stdout, stderr, exit } = await capture(() => runGuardGenerate({ cwd: repo }));

    expect(exit).toBe(0);
    expect(stdout).toContain('Cost estimated — 3 of 14 sections changed');
    expect(stdout).toContain('Generate cancelled.');
    expect(stderr).toBe('');
  });
});
