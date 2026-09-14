/**
 * Shared pre-flight TOKEN estimator for the staged LLM pipelines (the spec scan,
 * guard setup and guard generate) — the single place their estimate math lives.
 * Pure + deterministic: callers describe each stage's expected calls + per-call
 * token sizes, and this rolls them into the `LlmEstimate` shape the dashboard
 * modal renders.
 */

import { priceForModel, type PriceTable } from './model-prices.js';

/** Characters per token — the rough conversion every surface counts with. */
export const CHARS_PER_TOKEN = 4;
/** Prompt template + instructions charged on top of every call's body. */
export const PROMPT_OVERHEAD_TOKENS = 500;

/**
 * A run's pre-flight estimate: what each stage will spend, and the ceiling for
 * the whole run. The dashboard's modal renders this one shape.
 */
export interface LlmEstimate {
  totalEstimatedTokens: number;
  /** Per-stage breakdown — staged LLM calls, in run order. */
  stages?: {
    /** Internal stage id (e.g. `gapJudge`). */
    stage: string;
    /** Human-readable label for display (e.g. "Reviewing gaps"). */
    label?: string;
    model: string;
    calls: number;
    estimatedTokens: number;
    /** Set when call count is a range (e.g. scan's overlap pairs). */
    callsRange?: { low: number; high: number };
    /**
     * Realistic (point) call count when the ceiling overstates the likely spend.
     * Set only for stages that carry it.
     */
    expectedCalls?: number;
    /**
     * One line stating the honest BOUND behind a stage whose work count is an
     * output of an earlier stage (guard flow synthesis: the flow count isn't
     * knowable before the call, so the estimate quotes "flows ≤ runnable claims").
     */
    bound?: string;
    /** Ceiling USD cost for this stage (set only when a price table was supplied). */
    estimatedCostUsd?: number;
    /** Expected USD cost for this stage (set only when {@link expectedCalls} is). */
    expectedCostUsd?: number;
  }[];
  /** Short subject for the confirm copy, e.g. "12 docs" / "9 areas". */
  subjectLabel?: string;
  /**
   * Ceiling USD cost for the whole run. Prices the high end of every stage's
   * call range and ignores prompt-caching discounts, so the real bill lands at
   * or below it. Absent when no price table was available.
   */
  estimatedCostUsd?: number;
  /**
   * Expected (likely) USD cost for the whole run — priced at each stage's realistic
   * count instead of its ceiling. Set only when some stage carries `expectedCalls`;
   * the ceiling {@link estimatedCostUsd} still bounds the spend.
   */
  expectedCostUsd?: number;
  /** Provenance of the prices behind {@link estimatedCostUsd}. */
  costSource?: 'live' | 'cache' | 'bundled';
  /** True when some stage's model couldn't be priced (cost is a partial total). */
  costPartial?: boolean;
}

/** Render a USD amount for the estimate UIs: `<$0.01`, `$0.42`, `$3.10`. */
export function formatCostUsd(usd: number): string {
  if (usd > 0 && usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

/** One pipeline stage's expected LLM work, before token roll-up. */
export interface StageCallEstimate {
  /** Internal stage id, e.g. `relevance`, `extract`, `gapJudge`. */
  stage: string;
  /** Human-readable label for display (e.g. "Generating contracts"). */
  label?: string;
  /** Resolved model (alias `haiku`/`sonnet`/`opus` or full id). */
  model: string;
  /** Expected number of LLM calls (the point estimate). */
  calls: number;
  /** Average INPUT tokens per call (system prompt + body), excluding overhead. */
  avgInputTokens: number;
  /** Average OUTPUT tokens per call. */
  avgOutputTokens: number;
  /** When the call count is uncertain (e.g. overlap pairs), the low/high bounds. */
  minCalls?: number;
  maxCalls?: number;
  /**
   * Realistic (point) call count when the ceiling `maxCalls` overstates the likely
   * spend — e.g. verify runs on only the flagged fraction of the overlap pairs.
   * Drives the "expected" cost shown alongside the ceiling. Omit when `calls` is
   * already the realistic count (the stage renders unchanged).
   */
  expectedCalls?: number;
  /** Honest bound line for a stage whose work count is an earlier stage's OUTPUT. */
  bound?: string;
}

/** Estimate input tokens from raw character counts (system prompt + body). */
export function tokensFromChars(...charCounts: number[]): number {
  const chars = charCounts.reduce((n, c) => n + Math.max(0, c), 0);
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

function perCallTokens(s: StageCallEstimate): number {
  return s.avgInputTokens + PROMPT_OVERHEAD_TOKENS + s.avgOutputTokens;
}

/**
 * Roll a list of stage estimates into an `LlmEstimate`. The point-estimate
 * `calls` drives `totalEstimatedTokens`; any stage carrying `minCalls`/`maxCalls`
 * also widens the total's implied range via `callsRange`.
 *
 * When a `prices` table is supplied, each stage also gets a ceiling
 * `estimatedCostUsd` and the total a ceiling `estimatedCostUsd`. Cost is a
 * CEILING: it prices the HIGH end of each stage's call range (`maxCalls ?? calls`)
 * and ignores prompt-caching discounts — so the real bill lands at or below it.
 *
 * A stage that carries `expectedCalls` (a realistic point count below its ceiling)
 * also gets an `expectedCostUsd`, and the total gains an `expectedCostUsd` — the
 * likely spend, priced at each stage's realistic count (`expectedCalls ?? calls`).
 * The ceiling is unchanged; expected is additional information shown beside it.
 */
export function estimateStageTokens(
  stages: StageCallEstimate[],
  subjectLabel?: string,
  prices?: PriceTable,
): LlmEstimate {
  let totalCost = 0;
  let totalExpectedCost = 0;
  let anyPriced = false;
  let anyUnpriced = false;
  let anyExpected = false;

  const breakdown = stages
    .filter((s) => s.calls > 0 || (s.maxCalls ?? 0) > 0)
    .map((s) => {
      const tpc = perCallTokens(s);
      const entry: NonNullable<LlmEstimate['stages']>[number] = {
        stage: s.stage,
        label: s.label,
        model: s.model,
        calls: s.calls,
        estimatedTokens: s.calls * tpc,
      };
      if (s.minCalls !== undefined || s.maxCalls !== undefined) {
        entry.callsRange = { low: s.minCalls ?? s.calls, high: s.maxCalls ?? s.calls };
      }
      if (s.expectedCalls !== undefined) {
        entry.expectedCalls = s.expectedCalls;
        anyExpected = true;
      }
      if (s.bound) entry.bound = s.bound;
      if (prices) {
        const price = priceForModel(s.model, prices);
        if (price) {
          const perCallInput = (s.avgInputTokens + PROMPT_OVERHEAD_TOKENS) * price.input;
          const perCallOutput = s.avgOutputTokens * price.output;
          const priceCalls = (n: number) => n * perCallInput + n * perCallOutput;
          const ceilingCalls = s.maxCalls ?? s.calls;
          entry.estimatedCostUsd = priceCalls(ceilingCalls);
          totalCost += entry.estimatedCostUsd;
          const expectedCost = priceCalls(s.expectedCalls ?? s.calls);
          totalExpectedCost += expectedCost;
          if (s.expectedCalls !== undefined) entry.expectedCostUsd = expectedCost;
          anyPriced = true;
        } else {
          anyUnpriced = true;
        }
      }
      return entry;
    });

  const totalEstimatedTokens = breakdown.reduce((n, s) => n + s.estimatedTokens, 0);

  const result: LlmEstimate = {
    totalEstimatedTokens,
    stages: breakdown,
    subjectLabel,
  };
  if (prices && anyPriced) {
    result.estimatedCostUsd = totalCost;
    result.costSource = prices.source;
    result.costPartial = anyUnpriced;
    if (anyExpected) result.expectedCostUsd = totalExpectedCost;
  }
  return result;
}
