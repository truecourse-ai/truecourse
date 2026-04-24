import type { UsageRecord } from '../types/snapshot.js';

/**
 * LLM usage records for a single analyze run.
 *
 * Before the file-store refactor this module wrote usage rows into the DB;
 * now usage lives inside the per-analysis snapshot. `flushUsage` on the
 * provider returns the accumulated records and the orchestrator puts them
 * on the snapshot.
 */

/** Input the provider emits at the end of an analyze run. */
export interface UsageData {
  provider: string;
  callType: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens: number;
  costUsd?: string;
  durationMs: number;
}

/**
 * Aggregate a batch of `UsageData` into fully-formed `UsageRecord[]`
 * (fills `createdAt` + defaults the optional cache token fields to 0).
 * Pure — the caller assigns the result to `snapshot.usage`.
 */
export function toUsageRecords(records: UsageData[]): UsageRecord[] {
  const now = new Date().toISOString();
  return records.map((r) => ({
    provider: r.provider,
    callType: r.callType,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    cacheReadTokens: r.cacheReadTokens ?? 0,
    cacheWriteTokens: r.cacheWriteTokens ?? 0,
    totalTokens: r.totalTokens,
    costUsd: r.costUsd ?? null,
    durationMs: r.durationMs,
    createdAt: now,
  }));
}

export interface UsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  totalTokens: number;
  totalCostUsd: string | null;
  totalDurationMs: number;
  callCount: number;
  provider: string | null;
}

/** Compute the summary the UI displays from an analysis's usage records. */
export function summarizeUsage(records: UsageRecord[]): UsageSummary {
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalCacheWriteTokens = 0;
  let totalTokens = 0;
  let totalDurationMs = 0;
  let costSum = 0;
  let anyCost = false;
  let provider: string | null = null;

  for (const r of records) {
    totalInputTokens += r.inputTokens;
    totalOutputTokens += r.outputTokens;
    totalCacheReadTokens += r.cacheReadTokens;
    totalCacheWriteTokens += r.cacheWriteTokens;
    totalTokens += r.totalTokens;
    totalDurationMs += r.durationMs;
    if (r.costUsd != null) {
      const n = Number(r.costUsd);
      if (!Number.isNaN(n)) {
        costSum += n;
        anyCost = true;
      }
    }
    if (r.provider) provider = r.provider;   // last wins; records share one provider per run
  }

  return {
    totalInputTokens,
    totalOutputTokens,
    totalCacheReadTokens,
    totalCacheWriteTokens,
    totalTokens,
    totalCostUsd: anyCost ? costSum.toFixed(6) : null,
    totalDurationMs,
    callCount: records.length,
    provider,
  };
}
