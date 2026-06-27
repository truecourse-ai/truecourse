/**
 * Local LLM call logger — the OSS, on-disk analog of the EE trace store
 * (`LlmTraceRecorder` → Postgres/blob). Opt-in via env, it captures every
 * `claude -p` invocation the cli transport makes and writes:
 *
 *   - `.truecourse/logs/llm-<label>-<runId>.jsonl`     one metrics line per call
 *   - `.truecourse/logs/llm-<label>-<runId>.summary.json`  the rolled-up summary
 *   - `.truecourse/logs/llm-<label>-<runId>.io/<n>.json`   full system/user/output
 *                                                          (only with LLM_DUMP)
 *
 * Unlike the EE recorder, this is cli-native: cache tokens, $ cost, num_turns and
 * the spawn-overhead timing breakdown are first-class, because the `claude -p`
 * envelope exposes them and they're the signals a perf investigation needs.
 *
 * Enable with `TRUECOURSE_LLM_LOG=1` (metrics + summary) or
 * `TRUECOURSE_LLM_DUMP=1` (the above + full prompt/response dump). Unset → null,
 * zero overhead, behavior byte-for-byte unchanged.
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { LlmCallRecord } from '@truecourse/shared/llm';

/**
 * The per-call metrics, sans the raw prompt/response payloads. This is what the
 * summary needs and all that's retained in memory — the heavy strings go
 * straight to the io dump (when enabled) and are never held for the run.
 */
export type LlmCallMetrics = Omit<LlmCallRecord, 'system' | 'user' | 'responseText'>;

export interface LlmCallLogger {
  /** Pass to `setLlmCallSink`. */
  sink: (rec: LlmCallRecord) => void;
  /** Flush, write the summary, print it to stderr. `elapsedMs` = run wall time. */
  finish: (elapsedMs: number) => void;
  /** Absolute path to the per-call JSONL (for messaging). */
  callsPath: string;
}

function truthyEnv(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.toLowerCase();
  return s !== '0' && s !== 'false' && s !== 'no' && s !== '';
}

/** Filesystem-safe id for the io dump filenames. */
function sanitize(id: string): string {
  return id.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
}

/**
 * Create a logger when `TRUECOURSE_LLM_LOG` or `TRUECOURSE_LLM_DUMP` is set;
 * otherwise null so the caller installs no sink and pays nothing.
 */
export function createLlmCallLogger(repoRoot: string, label = 'scan'): LlmCallLogger | null {
  const dump = truthyEnv(process.env.TRUECOURSE_LLM_DUMP);
  if (!truthyEnv(process.env.TRUECOURSE_LLM_LOG) && !dump) return null;

  const logDir = path.join(repoRoot, '.truecourse', 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}_${randomUUID().slice(0, 8)}`;
  const callsPath = path.join(logDir, `llm-${label}-${runId}.jsonl`);
  const summaryPath = path.join(logDir, `llm-${label}-${runId}.summary.json`);
  const ioDir = dump ? path.join(logDir, `llm-${label}-${runId}.io`) : null;
  if (ioDir) fs.mkdirSync(ioDir, { recursive: true });

  const createdAt = Date.now();
  const records: LlmCallMetrics[] = [];
  let seq = 0;
  let finished = false;
  let fd: number | null = null;
  try {
    fd = fs.openSync(callsPath, 'a');
  } catch {
    fd = null; // best-effort: still keep records in memory for the summary
  }

  const sink = (rec: LlmCallRecord): void => {
    seq += 1;
    // Retain metrics only — the raw prompt/response are huge and go to the io
    // dump (when enabled), not into memory or the per-call metrics stream.
    const { system: _s, user: _u, responseText: _r, ...metrics } = rec;
    records.push(metrics);
    if (fd !== null) {
      try {
        fs.writeSync(fd, JSON.stringify(metrics) + '\n');
      } catch {
        /* best-effort */
      }
    }
    if (ioDir) {
      const fname = `${String(seq).padStart(5, '0')}-${sanitize(rec.id) || rec.stage}.json`;
      try {
        fs.writeFileSync(
          path.join(ioDir, fname),
          JSON.stringify(
            {
              stage: rec.stage,
              model: rec.model,
              ok: rec.ok,
              error: rec.error,
              itemCount: rec.itemCount,
              wallMs: rec.wallMs,
              numTurns: rec.numTurns,
              inputTokens: rec.inputTokens,
              outputTokens: rec.outputTokens,
              cacheReadTokens: rec.cacheReadTokens,
              cacheCreateTokens: rec.cacheCreateTokens,
              costUsd: rec.costUsd,
              system: rec.system,
              user: rec.user,
              response: rec.responseText,
            },
            null,
            2,
          ),
        );
      } catch {
        /* best-effort */
      }
    }
  };

  const signalHandlers: Array<[NodeJS.Signals, () => void]> = [];

  // Idempotent finalize: close the file, write + print the summary. Safe to call
  // from both the normal `finally` and a signal handler — runs exactly once.
  const finishOnce = (elapsedMs: number): void => {
    if (finished) return;
    finished = true;
    for (const [sig, h] of signalHandlers) process.removeListener(sig, h);
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
    const summary = summarizeLlmCalls(records, elapsedMs);
    try {
      fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
    } catch {
      /* best-effort */
    }
    printSummary(summary, callsPath, ioDir);
  };

  // Ctrl-C / kill mid-run should still flush the summary of whatever completed
  // — this logger only exists when the operator opted in (env-gated), so adding
  // a signal handler here never affects normal runs. Default SIGINT behavior is
  // to exit; once we attach a listener we must re-exit ourselves.
  for (const sig of ['SIGINT', 'SIGTERM'] as NodeJS.Signals[]) {
    const h = (): void => {
      finishOnce(Date.now() - createdAt);
      process.exit(sig === 'SIGINT' ? 130 : 143);
    };
    signalHandlers.push([sig, h]);
    process.on(sig, h);
  }

  return { sink, finish: finishOnce, callsPath };
}

// ---------------------------------------------------------------------------
// summary
// ---------------------------------------------------------------------------

export interface StageCallSummary {
  stage: string;
  models: string[];
  calls: number;
  failures: number;
  /** Sum of itemCount — logical work items (blocks) processed via the LLM. */
  items: number;
  /** Calls the model looped on (num_turns > 1) — extra, avoidable cost. */
  multiTurnCalls: number;
  wallMsSum: number;
  wallMsP50: number;
  wallMsP95: number;
  wallMsMax: number;
  /** Sum of claude's own `duration_ms`. */
  claudeMsSum: number;
  /** Sum of (our wall − claude duration) — process spawn/teardown overhead. */
  spawnOverheadMsSum: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  costUsd: number;
  /** Derived per-item economics. */
  costPerItem: number;
  tokensPerItem: number;
  outputTokensPerItem: number;
}

export interface LlmCallSummary {
  totalCalls: number;
  totalFailures: number;
  totalItems: number;
  totalCostUsd: number;
  totalTokens: number;
  /** Run wall time the caller measured (the whole consolidate phase). */
  elapsedMs: number;
  /** Sum of all per-call wall times. */
  wallMsSum: number;
  /** wallMsSum / elapsedMs — effective parallelism achieved. */
  effectiveParallelism: number;
  /** cacheRead + cacheCreate tokens — the reused per-call agent overhead. */
  overheadTokens: number;
  /** input + output tokens — the actual spec content + extraction. */
  freshTokens: number;
  /** overheadTokens / (overheadTokens + freshTokens). */
  overheadFraction: number;
  stages: StageCallSummary[];
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil((p / 100) * sortedAsc.length) - 1));
  return sortedAsc[idx];
}

/** Roll up a list of call records into per-stage + overall metrics. Pure. */
export function summarizeLlmCalls(records: LlmCallMetrics[], elapsedMs: number): LlmCallSummary {
  const byStage = new Map<string, LlmCallMetrics[]>();
  for (const r of records) {
    const list = byStage.get(r.stage) ?? [];
    list.push(r);
    byStage.set(r.stage, list);
  }

  const stages: StageCallSummary[] = [];
  for (const [stage, recs] of byStage) {
    const walls = recs.map((r) => r.wallMs).sort((a, b) => a - b);
    const items = recs.reduce((n, r) => n + (r.itemCount || 0), 0);
    const inputTokens = recs.reduce((n, r) => n + r.inputTokens, 0);
    const outputTokens = recs.reduce((n, r) => n + r.outputTokens, 0);
    const cacheReadTokens = recs.reduce((n, r) => n + r.cacheReadTokens, 0);
    const cacheCreateTokens = recs.reduce((n, r) => n + r.cacheCreateTokens, 0);
    const costUsd = recs.reduce((n, r) => n + r.costUsd, 0);
    const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheCreateTokens;
    const claudeMsSum = recs.reduce((n, r) => n + (r.claudeDurationMs ?? 0), 0);
    // Overhead = wall minus claude's own duration, only when claude reported it.
    const spawnOverheadMsSum = recs.reduce(
      (n, r) => n + (r.claudeDurationMs != null ? Math.max(0, r.wallMs - r.claudeDurationMs) : 0),
      0,
    );
    const denom = items || 1;
    stages.push({
      stage,
      models: [...new Set(recs.map((r) => r.model).filter(Boolean))],
      calls: recs.length,
      failures: recs.filter((r) => !r.ok).length,
      items,
      multiTurnCalls: recs.filter((r) => (r.numTurns ?? 1) > 1).length,
      wallMsSum: walls.reduce((n, w) => n + w, 0),
      wallMsP50: percentile(walls, 50),
      wallMsP95: percentile(walls, 95),
      wallMsMax: walls.length ? walls[walls.length - 1] : 0,
      claudeMsSum,
      spawnOverheadMsSum,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreateTokens,
      costUsd,
      costPerItem: costUsd / denom,
      tokensPerItem: totalTokens / denom,
      outputTokensPerItem: outputTokens / denom,
    });
  }
  // Busiest stage (by cost) first — that's where optimization pays off.
  stages.sort((a, b) => b.costUsd - a.costUsd);

  const totalCostUsd = stages.reduce((n, s) => n + s.costUsd, 0);
  const overheadTokens = stages.reduce((n, s) => n + s.cacheReadTokens + s.cacheCreateTokens, 0);
  const freshTokens = stages.reduce((n, s) => n + s.inputTokens + s.outputTokens, 0);
  const wallMsSum = stages.reduce((n, s) => n + s.wallMsSum, 0);
  return {
    totalCalls: records.length,
    totalFailures: records.filter((r) => !r.ok).length,
    totalItems: stages.reduce((n, s) => n + s.items, 0),
    totalCostUsd,
    totalTokens: overheadTokens + freshTokens,
    elapsedMs,
    wallMsSum,
    effectiveParallelism: elapsedMs > 0 ? wallMsSum / elapsedMs : 0,
    overheadTokens,
    freshTokens,
    overheadFraction: overheadTokens + freshTokens > 0 ? overheadTokens / (overheadTokens + freshTokens) : 0,
    stages,
  };
}

// ---------------------------------------------------------------------------
// stderr printout
// ---------------------------------------------------------------------------

function humanTokens(n: number): string {
  if (n >= 999_500) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

function pad(s: string, w: number): string {
  return s.length >= w ? s : s + ' '.repeat(w - s.length);
}
function padL(s: string, w: number): string {
  return s.length >= w ? s : ' '.repeat(w - s.length) + s;
}

/** Compact per-stage table on stderr (won't corrupt --json stdout). */
function printSummary(s: LlmCallSummary, callsPath: string, ioDir: string | null): void {
  const w = (line: string): void => {
    process.stderr.write(`[llm-log] ${line}\n`);
  };
  const secs = (s.elapsedMs / 1000).toFixed(1);
  w(
    `${s.totalCalls} calls · ${s.totalItems} items · ${secs}s wall · ` +
      `~${s.effectiveParallelism.toFixed(1)}x parallel · $${s.totalCostUsd.toFixed(2)}` +
      (s.totalFailures ? ` · ${s.totalFailures} failed` : ''),
  );
  w(
    `overhead: ${humanTokens(s.overheadTokens)} cache vs ${humanTokens(s.freshTokens)} fresh ` +
      `(${(s.overheadFraction * 100).toFixed(0)}% of tokens are per-call overhead)`,
  );
  // Header
  w(
    pad('stage', 22) +
      padL('calls', 6) +
      padL('items', 7) +
      padL('$cost', 9) +
      padL('$/item', 9) +
      padL('tok/it', 8) +
      padL('out/it', 8) +
      padL('p50ms', 8) +
      padL('p95ms', 8) +
      padL('spawn%', 8) +
      padL('turns>1', 9),
  );
  for (const st of s.stages) {
    const spawnPct = st.wallMsSum > 0 ? (st.spawnOverheadMsSum / st.wallMsSum) * 100 : 0;
    w(
      pad(st.stage, 22) +
        padL(String(st.calls), 6) +
        padL(String(st.items), 7) +
        padL(`$${st.costUsd.toFixed(2)}`, 9) +
        padL(`$${st.costPerItem.toFixed(4)}`, 9) +
        padL(humanTokens(st.tokensPerItem), 8) +
        padL(humanTokens(st.outputTokensPerItem), 8) +
        padL(String(Math.round(st.wallMsP50)), 8) +
        padL(String(Math.round(st.wallMsP95)), 8) +
        padL(`${spawnPct.toFixed(0)}%`, 8) +
        padL(String(st.multiTurnCalls), 9),
    );
  }
  w(`written: ${callsPath}`);
  if (ioDir) w(`full I/O: ${ioDir}`);
}
