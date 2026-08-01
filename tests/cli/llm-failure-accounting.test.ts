/**
 * The CLI surface of LLM-failure accounting: a stage that lost EVERY call aborts
 * the command loudly with a non-zero exit (a CI gate can never read it as a clean
 * no-op), and a run that lost SOME calls completes but never prints an unqualified
 * success line. The command runs for real against an injected transport — only the
 * `claude`/API preflight is stubbed (it would otherwise exit first).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

vi.mock('../../tools/cli/src/lib/claude-preflight.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../tools/cli/src/lib/claude-preflight.js')>();
  return { ...actual, preflightLlmOrExit: vi.fn(async () => {}) };
});

import { setDefaultTransport, type LlmTransport } from '@truecourse/shared/llm';
import { readGuardResult, manifestPath, writeGuardResult } from '@truecourse/guard-runner';
import { GuardGenerateReportSchema, type GuardGenerateReport } from '@truecourse/shared';
import { corpusFilePath } from '../../packages/spec-consolidator/src/index.js';
import { runSpecScan } from '../../tools/cli/src/commands/spec.js';
import { runGuardGenerate, runGuardStatus, printGuardGenerateSummary } from '../../tools/cli/src/commands/guard.js';
import { makeTempRepo, rmrf, writeDoc, writeRecipe, writeCorpus } from '../guard-generator/helpers.js';

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');

/** Run a command, capturing stdout + stderr and the exit code it asked for. */
async function capture(fn: () => Promise<void>): Promise<{ out: string; exitCode: number | null }> {
  let exitCode: number | null = null;
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exitCode = code ?? 0;
    throw new Error(`process.exit(${code})`);
  }) as never);
  const chunks: string[] = [];
  const sink = ((chunk: unknown, ...rest: unknown[]) => {
    chunks.push(typeof chunk === 'string' ? chunk : String(chunk));
    const cb = rest.find((a) => typeof a === 'function') as (() => void) | undefined;
    cb?.();
    return true;
  }) as never;
  const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(sink);
  const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(sink);
  try {
    await fn();
  } catch (e) {
    if (!(e instanceof Error) || !e.message.startsWith('process.exit(')) throw e;
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
    exitSpy.mockRestore();
  }
  return { out: stripAnsi(chunks.join('')), exitCode };
}

const repos: string[] = [];
let home: string;
let priorHome: string | undefined;

beforeEach(() => {
  // Keep the user-level registry/config writes (registerProject, the remembered
  // generate mode) inside the test.
  priorHome = process.env.TRUECOURSE_HOME;
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-home-'));
  process.env.TRUECOURSE_HOME = home;
});
afterEach(() => {
  setDefaultTransport(undefined);
  if (priorHome === undefined) delete process.env.TRUECOURSE_HOME;
  else process.env.TRUECOURSE_HOME = priorHome;
  fs.rmSync(home, { recursive: true, force: true });
  while (repos.length) rmrf(repos.pop()!);
});

function repo(): string {
  const r = makeTempRepo();
  repos.push(r);
  execSync('git init -q -b main', { cwd: r });
  return r;
}

// ---------------------------------------------------------------------------
// spec scan
// ---------------------------------------------------------------------------

const SPEC_DOCS: Array<[string, string]> = [
  ['docs/orders.md', '# Orders\nAn order is created with a POST to /orders and returns 201.'],
  ['docs/auth.md', '# Auth\nEvery request carries a Bearer JWT; an expired token gets a 401.'],
  ['docs/billing.md', '# Billing\nAn invoice is issued monthly and dunning retries three times.'],
];

function seedSpecRepo(): string {
  const r = repo();
  for (const [rel, content] of SPEC_DOCS) writeDoc(r, rel, content);
  return r;
}

/** The area-tag answer for a doc — a distinct concern per doc, so no doc PAIR shares
 *  an area and the overlap stage makes no calls. */
function areaAnswerFor(id: string | undefined): string {
  const concern = (id ?? '').split('/').pop()?.replace('.md', '') ?? 'core';
  return JSON.stringify({ areas: [{ product: 'core', concern }], status: null });
}

describe('spec scan — every relevance call failed', () => {
  it('aborts with a non-zero exit and leaves the previous corpus.json untouched', async () => {
    const r = seedSpecRepo();
    const file = corpusFilePath(r);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const prior = JSON.stringify({ version: 3, generatedAt: '2026-01-01T00:00:00Z', docs: [], areas: [], skippedDocs: [] });
    fs.writeFileSync(file, prior);

    setDefaultTransport(async () => {
      throw new Error("Invalid schema for response_format 'response': Missing 'reason'.");
    });
    const { out, exitCode } = await capture(() => runSpecScan({ cwd: r, yes: true }));

    expect(exitCode).toBe(1);
    expect(out).toContain('Scan aborted');
    expect(out).toContain('spec.relevance');
    expect(out).toContain("Missing 'reason'");
    expect(out).toContain('unchanged');
    expect(out).not.toContain('Done.');
    expect(fs.readFileSync(file, 'utf-8')).toBe(prior);
  });
});

describe('spec scan — one relevance call failed', () => {
  it('writes the corpus, reports the stage counts + the kept-by-default effect, and qualifies the close', async () => {
    const r = seedSpecRepo();
    const failing: LlmTransport = async (req) => {
      if (req.stage === 'spec.relevance') {
        if (req.id?.includes('auth.md')) throw new Error('claude API error (api 429): usage limit reached');
        return '{"include":true,"reason":"spec"}';
      }
      if (req.stage === 'spec.areaTag') return areaAnswerFor(req.id);
      return '{}';
    };
    setDefaultTransport(failing);

    const { out, exitCode } = await capture(() => runSpecScan({ cwd: r, yes: true }));

    expect(exitCode).toBeNull();
    expect(out).toContain('LLM calls failed');
    expect(out).toContain('relevance: 1 of 3 calls failed — affected docs kept by default');
    expect(out).toContain('first failure: claude API error (api 429): usage limit reached');
    // The close never reads as an unqualified success.
    expect(out).toContain('INCOMPLETE');
    expect(fs.existsSync(corpusFilePath(r))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// guard generate
// ---------------------------------------------------------------------------

const DOC = 'docs/cli.md';
const DOC_CONTENT = ['## version', '`relkit --version` prints the version and exits 0.'].join('\n');

function seedGuardRepo(): string {
  const r = repo();
  writeRecipe(r);
  writeCorpus(r, [{ ref: DOC }]);
  writeDoc(r, DOC, DOC_CONTENT);
  return r;
}

describe('guard generate — every extraction call failed', () => {
  it('exits non-zero, records status llm-failed in result.json, and writes no manifest', async () => {
    const r = seedGuardRepo();

    setDefaultTransport(async () => {
      throw new Error("Invalid schema for response_format 'response': Missing 'extension'.");
    });
    const { out, exitCode } = await capture(() => runGuardGenerate({ cwd: r, yes: true }));

    expect(exitCode).toBe(1);
    expect(out).toContain('Generate aborted');
    expect(out).toContain('guard.extract');
    expect(out).toContain(DOC);

    const report = readGuardResult(r);
    expect(report).not.toBeNull();
    expect(() => GuardGenerateReportSchema.parse(report)).not.toThrow();
    expect(report!.status).toBe('llm-failed');
    expect(report!.written).toEqual([]);
    expect(report!.llmFailures).toEqual([
      {
        stage: 'guard.extract',
        attempts: 1,
        failures: 1,
        firstError: "Invalid schema for response_format 'response': Missing 'extension'.",
      },
    ]);
    // Never a healthy-looking empty manifest.
    expect(fs.existsSync(manifestPath(r))).toBe(false);
  });
});

describe('guard generate — every authoring reply was unusable', () => {
  it('exits non-zero, records status llm-failed in result.json, and writes no manifest', async () => {
    const r = seedGuardRepo();

    // Extraction, synthesis and matching answer; authoring answers with a JSON
    // object that is not the reply contract — every call LANDS, so nothing is a
    // transport failure and only the engine's own counters catch the loss.
    setDefaultTransport(async (req) => {
      if (req.stage === 'guard.extract') {
        return JSON.stringify({
          claims: [{ claim: 'version works', driver: 'cli', sectionAnchor: 'version', reason: 'exit code is observable' }],
          untestable: [],
        });
      }
      if (req.stage === 'guard.flows') {
        return JSON.stringify({
          flows: [
            {
              title: 'version',
              goal: 'verify the version claim',
              milestones: [{ order: 1, doc: DOC, anchor: 'version', claimTitle: 'version works' }],
            },
          ],
          noFlowClaims: [],
        });
      }
      if (req.stage === 'guard.match') {
        // The catalog is the real mapped one, so the plan copies its first id back
        // out of the prompt rather than inventing one.
        const journeyId = /^--- id: (.+)$/m.exec(req.user)?.[1] ?? '';
        return JSON.stringify({ plan: [{ journeyId, milestone: 1 }] });
      }
      if (req.stage === 'guard.generate') return '{"scenarios":[]}';
      return '{}';
    });
    const { out, exitCode } = await capture(() => runGuardGenerate({ cwd: r, yes: true }));

    expect(exitCode).toBe(1);
    expect(out).toContain('Generate aborted');
    expect(out).toContain('guard.generate');

    const report = readGuardResult(r);
    expect(report!.status).toBe('llm-failed');
    expect(report!.written).toEqual([]);
    expect(report!.reason).toContain('unusable');
    // The lost calls answered, so the transport tally stays empty.
    expect(report!.llmFailures ?? []).toEqual([]);
    expect(fs.existsSync(manifestPath(r))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Read surfaces: the generate summary + `guard status` over the same report.
// ---------------------------------------------------------------------------

function guardReport(over: Partial<GuardGenerateReport> = {}): GuardGenerateReport {
  return {
    generatedAt: '2026-01-02T03:04:05.000Z',
    status: 'ok',
    sectionsTotal: 4,
    sectionsChanged: 2,
    skippedUnchanged: 2,
    noChanges: false,
    written: [],
    coverageGaps: [],
    birthFindings: [],
    errors: [],
    extractionFailures: [],
    orphaned: [],
    ...over,
  };
}

describe('printGuardGenerateSummary — partial LLM failure', () => {
  let out: string;
  let spy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    out = '';
    spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      out += String(chunk);
      return true;
    });
  });
  afterEach(() => spy.mockRestore());

  it('names the stage, the counts, the affected documents, and the underlying error', () => {
    printGuardGenerateSummary(
      guardReport({
        extractionFailures: [{ doc: 'docs/other.md', reason: 'extraction call failed: claude API error (api 500)' }],
        llmFailures: [
          { stage: 'guard.extract', attempts: 4, failures: 1, firstError: 'claude API error (api 500)' },
          { stage: 'guard.flows', attempts: 2, failures: 1, firstError: 'claude exited 1' },
        ],
      }),
      '.truecourse/guard/result.json',
    );
    const text = stripAnsi(out);
    expect(text).toContain('LLM calls failed');
    expect(text).toContain('claim extraction: 1 of 4 calls failed');
    expect(text).toContain('docs/other.md');
    expect(text).toContain('first failure: claude API error (api 500)');
    expect(text).toContain('flow synthesis: 1 of 2 calls failed');
  });

  it('says nothing when every call landed', () => {
    printGuardGenerateSummary(guardReport(), '.truecourse/guard/result.json');
    expect(stripAnsi(out)).not.toContain('LLM calls failed');
  });
});

describe('guard status — an llm-failed report', () => {
  let out: string;
  let spy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    out = '';
    spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      out += String(chunk);
      return true;
    });
  });
  afterEach(() => spy.mockRestore());

  it('renders the status and the per-stage failed-call counts', async () => {
    const r = repo();
    writeGuardResult(
      r,
      guardReport({
        status: 'llm-failed',
        reason: 'every LLM call in the `guard.extract` stage failed (3 of 3)',
        llmFailures: [{ stage: 'guard.extract', attempts: 3, failures: 3, firstError: 'claude exited 1' }],
      }),
    );
    await runGuardStatus({ cwd: r });
    const text = stripAnsi(out);
    expect(text).toContain('llm-failed');
    expect(text).toContain('llm calls failed: claim extraction 3/3');
  });
});
