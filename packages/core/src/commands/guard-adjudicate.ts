/**
 * `guard adjudicate` — the post-run adjudication of a guard board's failures
 * (plan 05, steps 21–24): the read view (which failures exist, which carry a
 * verdict, whether the corpus has converged), and the run that classifies the
 * unadjudicated ones — a deterministic pre-pass first (zero sessions for the
 * common case), then one `guard-adjudicate.failure` agent session per
 * surprise, each with a possible `guard-adjudicate.control` child.
 *
 * The engine halves live in `services/guard-adjudicate/`; THIS module is the
 * adapter both UIs call — it joins the stores into per-failure work items,
 * resolves the run's driver and transcripts (`sessions/guard-adjudicate/
 * <runId>/`), runs the pool, and folds every verdict through the one serial
 * write path (`persistAdjudication`). Tools never write; the fold does.
 */

import yaml from 'js-yaml';
import { WRAP_UP_TURNS, type SessionEvent } from '@truecourse/agent-loop';
import { getCacheEntry, setCacheEntry } from '@truecourse/llm';
import {
  evidenceRelPath,
  guardAdjudicateFindingsPath,
  readGuardFlowsCorpus,
  sourceGuardRunInputs,
  type Recipe,
} from '@truecourse/guard-runner';
import {
  GuardAdjudicationSchema,
  GuardScenarioSchema,
  guardResultRunId,
  type GuardAdjudication,
  type GuardAdjudicationClass,
  type GuardFlow,
  type GuardLatest,
  type GuardScenario,
  type GuardScenarioAdjudication,
  type GuardScenarioDiagnosis,
} from '@truecourse/shared';
import path from 'node:path';
import { createSessionRun, type SessionRunStartedInfo } from '../lib/sessions-store.js';
import { resolveCommitSha } from '../lib/repo-ref.js';
import { getGuardExecutor } from '../lib/guard-executor.js';
import {
  listScenarioFiles,
  readGuardHistory,
  readGuardLatest,
  readGuardRun,
  readManifest,
  readScenarioFile,
} from '../lib/guard-store.js';
import { createConfiguredSessionDriver } from '../services/llm/session-driver.js';
import type { LlmTransportFlag } from '../config/global-config.js';
import { defaultPoolConcurrency, runSessionPool } from '../services/agent/session-pool.js';
import { appendFindingsLedger } from '../services/agent/findings-ledger.js';
import { describeSessionFailure } from '../services/guard-setup/session-context.js';
import {
  ADJUDICATE_BUDGET,
  ADJUDICATE_CACHE_NAME,
  adjudicationBriefing,
  adjudicationCacheKey,
  adjudicationSessionDef,
  adjudicationWorkItem,
  sectionTextsForItem,
} from '../services/guard-adjudicate/session.js';
import { buildEvidenceDigest } from '../services/guard-adjudicate/evidence.js';
import {
  adjudicationRefusalReason,
  persistAdjudication,
  type AdjudicationRouting,
} from '../services/guard-adjudicate/fold.js';
import {
  deterministicVerdict,
  itemSurface,
  type AdjudicationItem,
} from '../services/guard-adjudicate/pre-pass.js';
import { newSessionState, type AdjudicationSessionState } from '../services/guard-adjudicate/tools.js';
import type { AdjudicationExecution } from '../services/guard-adjudicate/execute.js';
import { writeGuardFindingsReport } from '../services/guard-adjudicate/findings-report.js';

// ---------------------------------------------------------------------------
// The read view
// ---------------------------------------------------------------------------

export interface GuardAdjudicationFailureView {
  scenarioId: string;
  title: string;
  outcome: 'fail' | 'error';
  step?: number;
  expected?: string;
  actual?: string;
  adjudication?: GuardScenarioAdjudication;
}

export interface GuardAdjudicationView {
  /** The board envelope's run, or null when no board exists. */
  runId: string | null;
  /** Every `fail` / `error` row of the current board. */
  failures: GuardAdjudicationFailureView[];
  /** Failures without a verdict for their current identity. */
  unadjudicated: number;
  /**
   * True when the last two runs in `guard/history.json` produced identical
   * per-scenario outcome sets (checked against their run snapshots) AND every
   * current failure carries an adjudication — the "documenso ran 9 times"
   * signal, computed instead of counted by hand.
   */
  converged: boolean;
}

/**
 * The free, LLM-less read view — also the work list the run takes, so the bill
 * is visible before it is paid. Async (deviation from the plan's sync
 * signature): every read goes through the pluggable guard store seam, which
 * is async by contract.
 */
export async function readGuardAdjudicationView(repoRoot: string): Promise<GuardAdjudicationView> {
  const latest = await readGuardLatest(repoRoot);
  const failures = failingRows(latest).map((row) => ({
    scenarioId: row.id,
    title: row.title,
    outcome: row.outcome as 'fail' | 'error',
    ...(row.failure ? { step: row.failure.step, expected: row.failure.expected, actual: row.failure.actual } : {}),
    ...(row.adjudication ? { adjudication: row.adjudication } : {}),
  }));
  return {
    runId: latest?.run.runId ?? null,
    failures,
    unadjudicated: failures.filter((f) => f.adjudication === undefined).length,
    converged: await computeConverged(repoRoot, latest),
  };
}

function failingRows(latest: GuardLatest | null) {
  return (latest?.scenarios ?? []).filter((row) => row.outcome === 'fail' || row.outcome === 'error');
}

/** The convergence rule — see {@link GuardAdjudicationView.converged}. */
async function computeConverged(repoRoot: string, latest: GuardLatest | null): Promise<boolean> {
  if (!latest) return false;
  if (failingRows(latest).some((row) => row.adjudication === undefined)) return false;
  const history = await readGuardHistory(repoRoot);
  if (history.runs.length < 2) return false;
  const [prev, last] = history.runs.slice(-2);
  // Cheap gate first: differing tallies can never be identical outcome sets.
  if (JSON.stringify(prev.summary) !== JSON.stringify(last.summary)) return false;
  // The honest check needs both snapshots; a missing one (gitignored, another
  // machine's run) cannot PROVE identity, so it reads as not converged.
  const [snapPrev, snapLast] = await Promise.all([
    readGuardRun(repoRoot, prev.runId),
    readGuardRun(repoRoot, last.runId),
  ]);
  if (!snapPrev || !snapLast) return false;
  const outcomes = (snap: GuardLatest): string =>
    JSON.stringify(
      [...snap.scenarios].sort((a, b) => a.id.localeCompare(b.id)).map((s) => [s.id, s.outcome]),
    );
  return outcomes(snapPrev) === outcomes(snapLast);
}

// ---------------------------------------------------------------------------
// Work-item assembly (shared by the run and the estimate)
// ---------------------------------------------------------------------------

interface PreparedAdjudication {
  latest: GuardLatest;
  /** Scoped items, in board order. */
  items: AdjudicationItem[];
  /** Rows the default scope skipped because they already carry a verdict. */
  alreadyAdjudicated: number;
  /** Deterministic pre-pass verdicts, by scenario id. */
  deterministic: Map<string, GuardAdjudication>;
  /** Cached verdicts, by scenario id. */
  cached: Map<string, GuardAdjudication>;
  /** What remains for sessions, in board order. */
  sessionItems: AdjudicationItem[];
}

/** Parse a committed scenario file's yaml, or null (a malformed file is the
 *  loader's error feed's business, not adjudication's). */
function parseScenario(raw: string): GuardScenario | null {
  try {
    const parsed = GuardScenarioSchema.safeParse(yaml.load(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function prepareAdjudication(
  repoRoot: string,
  opts: { runId?: string; scenarios?: readonly string[] },
): Promise<PreparedAdjudication> {
  const latest = await readGuardLatest(repoRoot);
  if (!latest) {
    throw new Error('No guard board (`guard/LATEST.json`) — run `truecourse guard run` first.');
  }
  let rows = failingRows(latest);
  if (opts.runId) {
    rows = rows.filter((row) => guardResultRunId(row, latest.run) === opts.runId);
  }
  const scoped = opts.scenarios && opts.scenarios.length > 0 ? new Set(opts.scenarios) : undefined;
  if (scoped) {
    const known = new Set(rows.map((r) => r.id));
    const unknown = [...scoped].filter((id) => !known.has(id));
    if (unknown.length > 0) {
      throw new Error(
        `No failing scenario named: ${unknown.join(', ')}. Adjudication works the board's fail/error rows.`,
      );
    }
  }
  // Default scope: every failure NOT yet adjudicated for its current identity
  // (the board merge drops a verdict when the row re-runs, so presence means
  // the verdict is about THIS actual). An explicitly named row re-adjudicates,
  // its prior verdict briefed.
  const alreadyAdjudicated = scoped ? 0 : rows.filter((r) => r.adjudication !== undefined).length;
  rows = rows.filter((row) => (scoped ? scoped.has(row.id) : row.adjudication === undefined));

  // The joins, each read once: the manifest (diagnosis + expectedRed), the
  // flow corpus, and the committed scenario files (raw yaml + parsed).
  const manifest = await readManifest(repoRoot);
  const diagnosisById = new Map<string, GuardScenarioDiagnosis>();
  const flowIdByScenario = new Map<string, string>();
  for (const flow of manifest?.flows ?? []) {
    for (const s of flow.scenarios) {
      flowIdByScenario.set(s.id, flow.flowId);
      if (s.diagnosis) diagnosisById.set(s.id, s.diagnosis);
    }
  }
  const flowById = new Map<string, GuardFlow>(
    (readGuardFlowsCorpus(repoRoot)?.flows ?? []).map((f) => [f.id, f]),
  );
  const scenarioById = new Map<string, { file: string; raw: string; scenario: GuardScenario }>();
  const wanted = new Set(rows.map((r) => r.id));
  for (const file of await listScenarioFiles(repoRoot)) {
    if (wanted.size === 0) break;
    const raw = await readScenarioFile(repoRoot, file);
    if (raw === null) continue;
    const scenario = parseScenario(raw);
    if (!scenario || !wanted.has(scenario.id)) continue;
    scenarioById.set(scenario.id, { file, raw, scenario });
    wanted.delete(scenario.id);
  }

  const items: AdjudicationItem[] = rows.map((row) => {
    const runId = guardResultRunId(row, latest.run);
    const found = scenarioById.get(row.id);
    const diagnosis = diagnosisById.get(row.id);
    const flowId = row.flowId ?? found?.scenario.flow?.id ?? flowIdByScenario.get(row.id);
    return {
      scenarioId: row.id,
      title: row.title,
      outcome: row.outcome as 'fail' | 'error',
      runId,
      row,
      step: row.failure?.step ?? 1,
      expected: row.failure?.expected ?? '',
      actual: row.failure?.actual ?? '',
      surface: itemSurface(found?.scenario),
      ...(flowId ? { flowId } : {}),
      evidenceDir: row.evidencePath ?? evidenceRelPath(runId, row.id),
      ...(found
        ? { scenario: found.scenario, scenarioFile: found.file, scenarioYaml: found.raw }
        : {}),
      ...(flowId && flowById.has(flowId) ? { flow: flowById.get(flowId)! } : {}),
      ...(diagnosis ? { diagnosis } : {}),
      ...(diagnosis?.expectedRed ? { expectedRed: diagnosis.expectedRed } : {}),
      ...(scoped && row.adjudication ? { prior: row.adjudication } : {}),
    };
  });

  // The deterministic pre-pass, then the cache probe — only surprises reach
  // sessions. A cached value that fails the schema OR the fold's structural
  // invariants is a MISS, never a poison. The pre-pass runs for EVERY item,
  // explicitly scoped ones included: it re-derives the verdict fresh off the
  // committed corpus and the board row (never off a remembered answer), so a
  // re-adjudication settles the same way for free. The CACHE, by contrast, is
  // exactly the memory an explicit `--scenario` asks to look past — the row's
  // identity has not moved (that is what makes re-adjudication meaningful), so
  // the probe would always hit and the promised re-run would never happen.
  // Scoped items therefore skip the probe and go straight to a session, prior
  // verdict briefed; the fold overwrites the stale cache entry when the fresh
  // verdict lands.
  const deterministic = new Map<string, GuardAdjudication>();
  const cached = new Map<string, GuardAdjudication>();
  const sessionItems: AdjudicationItem[] = [];
  for (const item of items) {
    const auto = deterministicVerdict(item);
    if (auto) {
      deterministic.set(item.scenarioId, auto);
      continue;
    }
    if (!scoped) {
      const entry = await getCacheEntry(repoRoot, ADJUDICATE_CACHE_NAME, adjudicationCacheKey(item)).catch(
        () => null,
      );
      if (entry !== null) {
        const parsed = GuardAdjudicationSchema.safeParse(entry);
        if (parsed.success && adjudicationRefusalReason(parsed.data) === null) {
          cached.set(item.scenarioId, parsed.data);
          continue;
        }
      }
    }
    sessionItems.push(item);
  }
  return { latest, items, alreadyAdjudicated, deterministic, cached, sessionItems };
}

// ---------------------------------------------------------------------------
// The pre-flight estimate (plan: items = un-pre-passed, cache-missing failures)
// ---------------------------------------------------------------------------

/** Expected turns one adjudication session spends — PROVISIONAL until real
 *  transcripts ground it (the step-7 convention: a constant per session kind). */
export const ADJUDICATE_EXPECTED_TURNS = 6;

export interface GuardAdjudicationPlan {
  /** Failures in scope. */
  failures: number;
  /** Rows the default scope skipped (already adjudicated). */
  alreadyAdjudicated: number;
  /** Settled deterministically — zero sessions. */
  prePassed: number;
  /** Settled from the verdict cache — zero sessions. */
  cached: number;
  /** Sessions the run would start. */
  sessions: number;
  /** Expected turns per session (provisional constant). */
  expectedTurns: number;
  /** The hard per-session ceiling (`turns × (maxResumes + 1)` + the shell's wrap-up window). */
  maxTurnsPerSession: number;
}

/**
 * The session estimate, cache-aware through the run's OWN pre-pass and key
 * builder — the confirm prompt and the run can never disagree about which
 * failures pay for a session. Deterministic and offline (no LLM call).
 */
export async function planGuardAdjudication(
  repoRoot: string,
  opts: { runId?: string; scenarios?: readonly string[] } = {},
): Promise<GuardAdjudicationPlan> {
  const prepared = await prepareAdjudication(repoRoot, opts);
  return {
    failures: prepared.items.length,
    alreadyAdjudicated: prepared.alreadyAdjudicated,
    prePassed: prepared.deterministic.size,
    cached: prepared.cached.size,
    sessions: prepared.sessionItems.length,
    expectedTurns: ADJUDICATE_EXPECTED_TURNS,
    maxTurnsPerSession: ADJUDICATE_BUDGET.turns * (ADJUDICATE_BUDGET.maxResumes + 1) + WRAP_UP_TURNS,
  };
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export type AdjudicationProgress =
  | { kind: 'settled'; scenarioId: string; source: 'pre-pass' | 'cache'; verdictClass: GuardAdjudicationClass }
  | { kind: 'session-start'; scenarioId: string; index: number; total: number }
  | { kind: 'session-done'; scenarioId: string; index: number; total: number };

export interface RunGuardAdjudicationOptions {
  repoRoot: string;
  /** Restrict to failures whose recorded actual came from this run; default:
   *  the board as it stands (every current fail/error row). */
  runId?: string;
  /** Adjudicate exactly these scenario ids (re-adjudicates an already-verdicted
   *  row, its prior verdict briefed); default: every failure not yet
   *  adjudicated for its current identity. */
  scenarios?: readonly string[];
  /** Ceiling on concurrent sessions (the governor may run fewer). */
  concurrency?: number;
  /** Per-run transport flag; the saved selection answers otherwise. */
  transport?: LlmTransportFlag;
  /** Render `guard/findings.md` from the board's bug/drift verdicts after the run. */
  report?: boolean;
  signal?: AbortSignal;
  onProgress?: (event: AdjudicationProgress) => void;
  onSessionEvent?: (scenarioId: string, event: SessionEvent) => void;
  /** What the run is doing before/around the sessions — the phase line. */
  onStatus?: (message: string) => void;
  /** The sessions-store run record just came into being (only when there are
   *  session items) — the CLI prints the "watch live" deep link from it. */
  onRunStarted?: (info: SessionRunStartedInfo) => void;
}

export interface GuardAdjudicationVerdictRow {
  scenarioId: string;
  /** How the verdict was reached: the deterministic pre-pass, the verdict
   *  cache, or a session. A `failed` row has a source and no verdict. */
  source: 'pre-pass' | 'cache' | 'session';
  verdict?: GuardScenarioAdjudication;
  /** Why no verdict landed (session failure, or a fold refusal). */
  failed?: string;
  /** What the fold routed (taint / escalation / auto-dismissal). */
  routing?: AdjudicationRouting;
}

export interface GuardAdjudicationRun {
  /** The board run envelope the adjudication worked against. */
  boardRunId: string;
  scenarios: GuardAdjudicationVerdictRow[];
  /** Rows the default scope skipped because they already carry a verdict. */
  alreadyAdjudicated: number;
  /** The sessions-store run, when any session actually ran. */
  sessionRunId?: string;
  runDir?: string;
  /** Which backend the sessions ran on — absent on a zero-session run. */
  transport?: { mode: string; provider: string; model: string; fallbackModel?: string };
  /** Session spend (the 03 `usage.sessions` precedent). Zero on a zero-session run. */
  usage: { sessions: { count: number; turns: number; tokens: number; costUsd: number } };
  /** The append to `guard/adjudicate.findings.md`, when a session found anything. */
  findingsLedger?: { path: string; appended: number };
  /** The findings report, when `report` was asked for and there was one to write. */
  report?: { path: string; findings: number };
  /** The convergence verdict AFTER this run's folds. */
  converged: boolean;
}

export async function runGuardAdjudication(
  opts: RunGuardAdjudicationOptions,
): Promise<GuardAdjudicationRun> {
  const { repoRoot } = opts;
  const now = (): string => new Date().toISOString();
  opts.onStatus?.('reading the board and the stores');
  const prepared = await prepareAdjudication(repoRoot, {
    ...(opts.runId ? { runId: opts.runId } : {}),
    ...(opts.scenarios ? { scenarios: opts.scenarios } : {}),
  });

  const rowsById = new Map<string, GuardAdjudicationVerdictRow>();
  const settle = async (
    item: AdjudicationItem,
    output: GuardAdjudication,
    source: 'pre-pass' | 'cache',
  ): Promise<void> => {
    const verdict: GuardScenarioAdjudication = { ...output, adjudicatedAt: now() };
    const { routing } = await persistAdjudication({ repoRoot, item, verdict, now });
    rowsById.set(item.scenarioId, { scenarioId: item.scenarioId, source, verdict, routing });
    opts.onProgress?.({ kind: 'settled', scenarioId: item.scenarioId, source, verdictClass: output.class });
  };
  for (const item of prepared.items) {
    const auto = prepared.deterministic.get(item.scenarioId);
    if (auto) await settle(item, auto, 'pre-pass');
    else {
      const hit = prepared.cached.get(item.scenarioId);
      if (hit) await settle(item, hit, 'cache');
    }
  }

  const usage = { sessions: { count: 0, turns: 0, tokens: 0, costUsd: 0 } };
  let sessionRunId: string | undefined;
  let runDir: string | undefined;
  let transport: GuardAdjudicationRun['transport'];
  const findings: { workItem: string; lines: readonly string[] }[] = [];
  let ledger: { path: string; appended: number } | undefined;

  if (prepared.sessionItems.length > 0 && !opts.signal?.aborted) {
    const gitRef = await resolveCommitSha(repoRoot);
    const run = createSessionRun(repoRoot, { command: 'guard-adjudicate', gitRef });
    sessionRunId = run.runId;
    runDir = run.dir;
    opts.onRunStarted?.({ command: 'guard-adjudicate', runId: run.runId, dir: run.dir });
    const { driver, mode, attribution } = createConfiguredSessionDriver({
      ...(opts.transport ? { transport: opts.transport } : {}),
      cwd: repoRoot,
      providerStateDir: path.join(run.dir, 'provider'),
    });
    transport = {
      mode,
      provider: attribution.provider,
      model: attribution.model,
      ...(attribution.fallbackModel ? { fallbackModel: attribution.fallbackModel } : {}),
    };
    run.setLlm(transport);

    // The execution seam the rerun/control tools share: the on-disk recipe
    // when it loads (the tools degrade to an honest error when it does not),
    // one memoized build across every execution of this command run.
    const sourced = sourceGuardRunInputs(repoRoot);
    const recipe: Recipe | null = 'early' in sourced ? null : sourced.loaded.recipe;
    const exec: AdjudicationExecution = {
      executor: getGuardExecutor(),
      recipe,
      repoRoot,
      branch: null,
      commit: gitRef,
      built: false,
      ...(opts.signal ? { signal: opts.signal } : {}),
    };

    // Briefings BEFORE the pool (the pool's `briefing` callback is sync, and
    // the digest reads evidence files): sequential, cheap disk reads.
    opts.onStatus?.(`briefing ${prepared.sessionItems.length} session(s) from the evidence`);
    const briefings = new Map<string, string>();
    for (const item of prepared.sessionItems) {
      const digest = await buildEvidenceDigest(repoRoot, item.evidenceDir, item.step);
      briefings.set(
        item.scenarioId,
        adjudicationBriefing({
          item,
          evidenceDigest: digest.digest,
          sectionTexts: sectionTextsForItem(repoRoot, item),
        }),
      );
    }
    const states = new Map<string, AdjudicationSessionState>();

    let failedSessions = 0;
    try {
      await runSessionPool<AdjudicationItem, GuardAdjudication>({
        items: prepared.sessionItems,
        workItem: adjudicationWorkItem,
        session: (item) => {
          const state = newSessionState();
          states.set(item.scenarioId, state);
          return adjudicationSessionDef({ repoRoot, item, exec, state });
        },
        briefing: (item) => [briefings.get(item.scenarioId)!],
        driver,
        persistence: run.persistence,
        concurrency: Math.max(1, opts.concurrency ?? defaultPoolConcurrency()),
        ...(opts.signal ? { signal: opts.signal } : {}),
        ...(opts.onSessionEvent ? { onSessionEvent: opts.onSessionEvent } : {}),
        onProgress: (e) => {
          if (e.kind === 'item-start') {
            opts.onProgress?.({ kind: 'session-start', scenarioId: e.workItem, index: e.index, total: e.total });
          } else if (e.kind === 'item-done') {
            opts.onProgress?.({ kind: 'session-done', scenarioId: e.workItem, index: e.index, total: e.total });
          }
        },
        fold: async (item, outcome, sessionId) => {
          usage.sessions.count++;
          usage.sessions.turns += outcome.spent.turns;
          usage.sessions.tokens += outcome.spent.tokens;
          usage.sessions.costUsd += outcome.spent.costUsd;
          if (outcome.status !== 'completed') {
            failedSessions++;
            rowsById.set(item.scenarioId, {
              scenarioId: item.scenarioId,
              source: 'session',
              failed: describeSessionFailure(outcome.failure),
            });
            return;
          }
          // The fold's refusal: a completed verdict that breaks the structural
          // invariants (or restates a control the engine never ran) lands as a
          // failed item — never persisted, never cached, one re-run away.
          const reason = adjudicationRefusalReason(outcome.output, states.get(item.scenarioId));
          if (reason !== null) {
            failedSessions++;
            rowsById.set(item.scenarioId, {
              scenarioId: item.scenarioId,
              source: 'session',
              failed: `verdict refused: ${reason}`,
            });
            return;
          }
          const verdict: GuardScenarioAdjudication = { ...outcome.output, adjudicatedAt: now(), sessionId };
          const { routing } = await persistAdjudication({ repoRoot, item, verdict, now });
          rowsById.set(item.scenarioId, { scenarioId: item.scenarioId, source: 'session', verdict, routing });
          if (outcome.output.findings.length > 0) {
            findings.push({ workItem: item.scenarioId, lines: outcome.output.findings });
          }
          // Only an ACCEPTED verdict enters the cache (the raw output — the
          // timestamp/session envelope is a fact about this run, not the inputs).
          await setCacheEntry(
            repoRoot,
            ADJUDICATE_CACHE_NAME,
            adjudicationCacheKey(item),
            outcome.output,
          ).catch(() => undefined);
        },
      });
      // The doc-bug feed, appended before anything else can fail — findings are
      // about the repository, not about the run.
      ledger = appendFindingsLedger({
        repoRoot,
        ledgerPath: guardAdjudicateFindingsPath(repoRoot),
        runId: run.runId,
        findings,
        preamble:
          '# Adjudication findings\n\n' +
          'Code-vs-docs discrepancies the `guard adjudicate` sessions read while classifying failures — ' +
          'appended per run, never rewritten. Repetition across runs means nobody has fixed it yet.\n\n',
      });
      run.finish(
        opts.signal?.aborted
          ? 'interrupted'
          : failedSessions > 0 && failedSessions === prepared.sessionItems.length
            ? 'failed'
            : 'completed',
      );
    } catch (error) {
      run.finish('failed');
      throw error;
    }
  }

  // Report + convergence, both over the board AS THE FOLDS LEFT IT.
  const latestAfter = await readGuardLatest(repoRoot);
  let report: { path: string; findings: number } | undefined;
  if (opts.report) {
    opts.onStatus?.('rendering guard/findings.md');
    report = writeGuardFindingsReport(repoRoot, latestAfter) ?? undefined;
  }

  return {
    boardRunId: prepared.latest.run.runId,
    scenarios: prepared.items.map(
      (item) =>
        rowsById.get(item.scenarioId) ?? {
          scenarioId: item.scenarioId,
          source: 'session' as const,
          failed: 'the session never ran (aborted before start)',
        },
    ),
    alreadyAdjudicated: prepared.alreadyAdjudicated,
    ...(sessionRunId ? { sessionRunId } : {}),
    ...(runDir ? { runDir } : {}),
    ...(transport ? { transport } : {}),
    usage,
    ...(ledger ? { findingsLedger: ledger } : {}),
    ...(report ? { report } : {}),
    converged: await computeConverged(repoRoot, latestAfter),
  };
}

/**
 * Render `guard/findings.md` from the current board WITHOUT adjudicating
 * anything — `truecourse guard adjudicate --report` with nothing left to
 * classify, and the dashboard's regenerate action.
 */
export async function writeGuardAdjudicationReport(
  repoRoot: string,
): Promise<{ path: string; findings: number } | null> {
  return writeGuardFindingsReport(repoRoot, await readGuardLatest(repoRoot));
}

// Re-exported so the CLI states the ceiling it confirms against without a
// second import path into the service internals.
export { ADJUDICATE_BUDGET } from '../services/guard-adjudicate/session.js';
