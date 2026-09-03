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

/**
 * The spec scan runs AGENT SESSIONS now (plan 02), and `runSpecScan` has no
 * driver seam of its own — so the session driver the run resolves is mocked at
 * the module the built core imports it from, and each case scripts it. Anything
 * that reaches it without a script fails loudly rather than calling a provider.
 */
let sessionScript: StubScript = () => {
  throw new Error('no session script installed for this case');
};
vi.mock('../../packages/core/dist/services/llm/session-driver.js', () => ({
  SESSION_MODEL_CLAUDE_CODE: 'opus',
  assertSessionBackendReady: async () => {},
  createConfiguredSessionDriver: () => {
    const { driver } = stubDriver((call) => sessionScript(call));
    return { driver, mode: 'claude-code', attribution: driver.attribution };
  },
}));

import { setDefaultTransport, type LlmTransport } from '@truecourse/shared/llm';
import { readGuardResult, manifestPath, writeGuardResult } from '@truecourse/guard-runner';
import { GuardGenerateReportSchema, type GuardGenerateReport } from '@truecourse/shared';
import { corpusFilePath } from '../../packages/spec-consolidator/src/index.js';
import { runSpecScan } from '../../tools/cli/src/commands/spec.js';
import { runGuardGenerate, runGuardStatus, printGuardGenerateSummary } from '../../tools/cli/src/commands/guard.js';
import { makeTempRepo, rmrf, writeDoc, writeRecipe, writeCorpus } from '../guard-generator/helpers.js';
import {
  docPathOf,
  outcome,
  stubDriver,
  toolResult,
  type StubCall,
  type StubScript,
} from '../core/spec-scan-session-stub';

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

/**
 * The scan's non-curation sessions, answered so a case can script only the part
 * it is about: the scope orchestrator covers the universe, the settlement is
 * empty, and no overlap is flagged.
 */
async function answerSupportingSession(call: StubCall): Promise<ReturnType<typeof outcome> | null> {
  if (call.kind === 'spec-scan.orchestrate') {
    return outcome({
      scopeVerdicts: [
        { path: '.', verdict: 'keep', reason: 'root docs' },
        { path: 'docs', verdict: 'keep', reason: 'the spec tree' },
      ],
      instructions: [],
    });
  }
  if (call.kind === 'spec-scan.settle-areas') {
    await call.emit(toolResult('check_settlement', 'valid'));
    return outcome({ concernMerges: {}, productMerges: {}, productVerdicts: [], subdivisions: [] });
  }
  if (call.kind === 'spec-scan.overlap') {
    await call.emit(toolResult('check_findings', 'valid'));
    return outcome({ overlaps: [], notReached: [] });
  }
  return null;
}

/** A kept doc verdict, one concern per doc so no two docs share an area. */
const keptVerdict = (docPath: string): unknown => ({
  keep: true,
  reason: 'spec',
  subject: 'this-product',
  areas: [{ product: 'core', concern: docPath.split('/').pop()!.replace('.md', '') }],
  status: null,
});

describe('spec scan — every curation session failed', () => {
  it('aborts with a non-zero exit and leaves the previous corpus.json untouched', async () => {
    const r = seedSpecRepo();
    const file = corpusFilePath(r);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const prior = JSON.stringify({ version: 3, generatedAt: '2026-01-01T00:00:00Z', docs: [], areas: [], skippedDocs: [] });
    fs.writeFileSync(file, prior);

    sessionScript = async (call) =>
      (await answerSupportingSession(call)) ?? {
        kind: 'failure',
        failure: {
          kind: 'transport',
          detail: "Invalid schema for response_format 'response': Missing 'reason'.",
          class: 'provider',
          retryability: 'none',
        },
      };
    const { out, exitCode } = await capture(() => runSpecScan({ cwd: r, yes: true }));

    expect(exitCode).toBe(1);
    expect(out).toContain('Scan aborted');
    // The failed kind is named raw: the CLI's stage-label map predates session kinds.
    expect(out).toContain('spec-scan.curate-doc');
    expect(out).toContain("Missing 'reason'");
    expect(out).toContain('unchanged');
    expect(out).not.toContain('Done.');
    expect(fs.readFileSync(file, 'utf-8')).toBe(prior);
  });
});

describe('spec scan — one curation session failed', () => {
  it('writes the corpus, reports the stage counts + the kept-by-default effect, and qualifies the close', async () => {
    const r = seedSpecRepo();
    sessionScript = async (call) => {
      const supporting = await answerSupportingSession(call);
      if (supporting) return supporting;
      const docPath = docPathOf(call.briefing);
      if (docPath.includes('auth.md')) {
        return {
          kind: 'failure',
          failure: {
            kind: 'transport',
            detail: 'claude API error (api 429): usage limit reached',
            class: 'provider',
            retryability: 'none',
          },
        };
      }
      return outcome(keptVerdict(docPath));
    };

    const { out, exitCode } = await capture(() => runSpecScan({ cwd: r, yes: true }));

    expect(exitCode).toBeNull();
    expect(out).toContain('LLM calls failed');
    expect(out).toContain('spec-scan.curate-doc: 1 of 3 calls failed — affected items skipped');
    expect(out).toContain('first failure: the provider failed (provider): claude API error (api 429): usage limit reached');
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

/**
 * GUARD GENERATE runs its content stages as agent SESSIONS too (plan 04), so
 * these cases script the session driver the same way the scan cases above do.
 * Only `guard.match` is still a one-shot CALL, and it keeps its transport stub.
 */

/** Call one of a session's tools the way a driver does. */
async function callTool(call: StubCall, name: string, args: unknown): Promise<{ content: string; isError?: boolean }> {
  const tool = call.def.tools.find((t) => t.name === name)!;
  const result = await tool.execute(args, {
    workItem: call.input.workItem,
    signal: call.input.signal,
    dispatchChild: call.input.dispatchChild,
  });
  await call.emit({ type: 'tool-result', toolName: name, content: result.content, isError: result.isError });
  return result;
}

const TRANSPORT_FAILURE = (detail: string): { kind: 'failure'; failure: { kind: 'transport'; detail: string; class: 'provider'; retryability: 'none' } } => ({
  kind: 'failure',
  failure: { kind: 'transport', detail, class: 'provider', retryability: 'none' },
});

const CLAIM = 'version works';

/** The extract + flows sessions, answered so a case can script only the stage
 *  it is about. Both run their checker tool first, as the shell requires. */
async function answerSpecSideSession(call: StubCall): Promise<ReturnType<typeof outcome> | null> {
  if (call.kind === 'guard-generate.extract') {
    const draft = {
      claims: [{ claim: CLAIM, driver: 'cli', sectionAnchor: 'version', reason: 'the exit code is observable', needs: [] }],
      untestable: [],
    };
    await callTool(call, 'check_claims', draft);
    return outcome(draft);
  }
  if (call.kind === 'guard-generate.flows') {
    // The epic session shares the kind; its checker takes an epic set.
    if (call.def.tools.some((t) => t.name === 'read_section')) {
      const draft = {
        flows: [
          {
            title: 'version',
            goal: 'verify the version claim',
            milestones: [{ order: 1, doc: DOC, anchor: 'version', claimTitle: CLAIM }],
          },
        ],
        noFlowClaims: [],
      };
      await callTool(call, 'check_flows', draft);
      return outcome(draft);
    }
    await callTool(call, 'check_flows', { epics: [] });
    return outcome({ epics: [] });
  }
  return null;
}

/** The matcher is the one remaining one-shot: answer it off the prompt. */
function matchOnlyTransport(): LlmTransport {
  return async (req) => {
    if (req.stage === 'guard.match') {
      const interfaceId = /^--- id: (.+)$/m.exec(req.user)?.[1] ?? '';
      return JSON.stringify({ plan: [{ interfaceId, milestone: 1 }] });
    }
    return '{}';
  };
}

describe('guard generate — every extraction session failed', () => {
  it('exits non-zero, records status llm-failed in result.json, and writes no manifest', async () => {
    const r = seedGuardRepo();

    sessionScript = () => TRANSPORT_FAILURE("Invalid schema for response_format 'response': Missing 'extension'.");
    setDefaultTransport(matchOnlyTransport());
    const { out, exitCode } = await capture(() => runGuardGenerate({ cwd: r, yes: true }));

    expect(exitCode).toBe(1);
    expect(out).toContain('Generate aborted');
    expect(out).toContain('guard-generate.extract');
    expect(out).toContain(DOC);

    const report = readGuardResult(r);
    expect(report).not.toBeNull();
    expect(() => GuardGenerateReportSchema.parse(report)).not.toThrow();
    expect(report!.status).toBe('llm-failed');
    expect(report!.written).toEqual([]);
    expect(report!.llmFailures).toEqual([
      {
        stage: 'guard-generate.extract',
        attempts: 1,
        failures: 1,
        firstError:
          "the provider failed (provider): Invalid schema for response_format 'response': Missing 'extension'.",
      },
    ]);
    // Never a healthy-looking empty manifest.
    expect(fs.existsSync(manifestPath(r))).toBe(false);
  });
});

describe('guard generate — every flow-worker session failed', () => {
  it('exits non-zero, records status llm-failed in result.json, and writes no manifest', async () => {
    const r = seedGuardRepo();

    sessionScript = async (call) =>
      (await answerSpecSideSession(call)) ?? TRANSPORT_FAILURE('claude exited 1: expired login');
    setDefaultTransport(matchOnlyTransport());
    const { out, exitCode } = await capture(() => runGuardGenerate({ cwd: r, yes: true }));

    expect(exitCode).toBe(1);
    expect(out).toContain('Generate aborted');
    expect(out).toContain('guard-generate.flow-worker');

    const report = readGuardResult(r);
    expect(report!.status).toBe('llm-failed');
    expect(report!.written).toEqual([]);
    expect(report!.llmFailures?.find((f) => f.stage === 'guard-generate.flow-worker')?.failures).toBe(1);
    expect(fs.existsSync(manifestPath(r))).toBe(false);
  });
});

describe('guard generate — every fidelity child was lost', () => {
  // The end-to-end round trip of the adjudication carve-out (plan item 88): the
  // command SUCCEEDS, the corpus lands, and the stored report — the file `guard
  // status` and the dashboard read back — says the tests carry no review. Before
  // the carve-out this run aborted at the very last stage and threw away every
  // scenario the (already paid for) authoring and birth stages produced.
  it('exits clean, writes the manifest, and records the stage unadjudicated in result.json', async () => {
    const r = seedGuardRepo();

    sessionScript = async (call) => {
      const specSide = await answerSpecSideSession(call);
      if (specSide) return specSide;
      // The fidelity CHILD is dispatched from inside `submit_scenario`; losing
      // it must not lose the green the confirmation run already executed.
      if (call.kind === 'guard-generate.fidelity') {
        return TRANSPORT_FAILURE('claude API error (api 429): usage limit reached');
      }
      const submitted = await callTool(call, 'submit_scenario', {
        yaml: ['title: prints the version', 'steps:', '  - run: ["--version"]', '    expect: { exit: 0 }', '    milestone: 1'].join('\n'),
        expectedReds: [],
      });
      const sha = /under sha ([0-9a-f]{64})/.exec(submitted.content)?.[1];
      if (!sha) return TRANSPORT_FAILURE(`the submission was refused: ${submitted.content}`);
      return outcome({ kind: 'settled', scenarioYamlSha: sha, expectedReds: [] });
    };
    setDefaultTransport(matchOnlyTransport());
    const { out, exitCode } = await capture(() => runGuardGenerate({ cwd: r, yes: true }));

    expect(exitCode).toBeNull();
    expect(out).not.toContain('Generate aborted');
    expect(out).toContain('unadjudicated');

    const report = readGuardResult(r);
    expect(() => GuardGenerateReportSchema.parse(report)).not.toThrow();
    expect(report!.status).toBe('ok');
    expect(report!.written).toHaveLength(1);
    expect(report!.unadjudicated).toEqual([{ stage: 'guard.fidelity', affected: 1 }]);
    // The corpus really landed — the whole point of not aborting.
    expect(fs.existsSync(manifestPath(r))).toBe(true);
  }, 60_000);
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

/**
 * The unadjudicated surfaces. A generate whose fidelity or triage stage lost every
 * call no longer aborts — it ships the corpus (plan item 88). The terminal is what
 * keeps that honest: both the closing summary and `guard status` must say the
 * tests carry no verdict, or an unreviewed corpus reads as a reviewed one.
 */
describe('the unadjudicated stage on the CLI surfaces', () => {
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

  it('the generate summary names the stage, what shipped without it, and the retry', () => {
    printGuardGenerateSummary(
      guardReport({
        unadjudicated: [
          { stage: 'guard.fidelity', affected: 41 },
          { stage: 'guard.triage', affected: 7 },
        ],
        llmFailures: [{ stage: 'guard.fidelity', attempts: 41, failures: 41, firstError: 'claude API error (429)' }],
      }),
      '.truecourse/guard/result.json',
    );
    const text = stripAnsi(out);
    expect(text).toContain('unadjudicated');
    expect(text).toContain('fidelity review');
    expect(text).toContain('41');
    expect(text).toContain('failure triage');
    expect(text).toContain('7');
    // ONE story per stage: the per-call effect sentence ("their flows unsettled")
    // describes a PARTIAL loss, so a stage already reported unadjudicated never
    // prints it — it points at the block that states the total loss in full.
    expect(text).not.toContain('affected tests were left unreviewed');
    expect(text).toContain('claude API error (429)');
  });

  it('still prints the per-call effect for a stage that lost only SOME calls', () => {
    printGuardGenerateSummary(
      guardReport({
        llmFailures: [{ stage: 'guard.fidelity', attempts: 41, failures: 1, firstError: 'claude API error (429)' }],
      }),
      '.truecourse/guard/result.json',
    );
    const text = stripAnsi(out);
    expect(text).toContain('affected tests were left unreviewed');
    expect(text).not.toContain('unadjudicated');
  });

  it('says nothing when every verdict landed', () => {
    printGuardGenerateSummary(guardReport(), '.truecourse/guard/result.json');
    expect(stripAnsi(out)).not.toContain('unadjudicated');
  });

  it('`guard status` reports the unadjudicated stage off the stored report', async () => {
    const r = repo();
    writeGuardResult(r, guardReport({ unadjudicated: [{ stage: 'guard.fidelity', affected: 41 }] }));
    await runGuardStatus({ cwd: r });
    const text = stripAnsi(out);
    expect(text).toContain('unadjudicated');
    expect(text).toContain('fidelity review 41');
  });
});
