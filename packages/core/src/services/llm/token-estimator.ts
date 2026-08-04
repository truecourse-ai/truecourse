/**
 * Shared pre-flight TOKEN estimator for the staged LLM pipelines (spec scan,
 * contracts generate) — the single place their estimate math lives, mirroring
 * how `analyze` estimates tokens for code rules. Pure + deterministic: callers
 * describe each stage's expected calls + per-call token sizes, and this rolls
 * them into the `LlmEstimate` shape the CLI prompt and dashboard modal already
 * render.
 *
 * Token-only by design (no dollar pricing): it reuses analyze's `CHARS_PER_TOKEN`
 * / `PROMPT_OVERHEAD_TOKENS` heuristics so all surfaces count tokens the same way.
 */

import type { LlmEstimate } from '../../commands/analyze-core.js';
import { CHARS_PER_TOKEN, PROMPT_OVERHEAD_TOKENS } from './context-router.js';
import { priceForModel, type PriceTable } from './model-prices.js';

export { CHARS_PER_TOKEN, PROMPT_OVERHEAD_TOKENS };

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
    tiers: [],
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
