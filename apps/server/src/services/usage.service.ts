import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db } from '../config/database.js';
import { analysisUsage } from '../db/schema.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UsageData {
  analysisId: string;
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

export interface UsageRow {
  id: string;
  analysisId: string;
  provider: string;
  callType: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costUsd: string | null;
  durationMs: number;
  createdAt: Date;
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

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

export async function recordUsageBatch(records: UsageData[]): Promise<void> {
  if (records.length === 0) return;
  await db.insert(analysisUsage).values(
    records.map((r) => ({
      id: randomUUID(),
      analysisId: r.analysisId,
      provider: r.provider,
      callType: r.callType,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      cacheReadTokens: r.cacheReadTokens ?? 0,
      cacheWriteTokens: r.cacheWriteTokens ?? 0,
      totalTokens: r.totalTokens,
      costUsd: r.costUsd ?? null,
      durationMs: r.durationMs,
    })),
  );
}

export async function getUsageByAnalysis(analysisId: string): Promise<UsageRow[]> {
  return db
    .select()
    .from(analysisUsage)
    .where(eq(analysisUsage.analysisId, analysisId));
}

export async function getUsageSummaryByAnalysis(analysisId: string): Promise<UsageSummary> {
  const [row] = await db
    .select({
      totalInputTokens: sql<number>`coalesce(sum(${analysisUsage.inputTokens}), 0)::int`,
      totalOutputTokens: sql<number>`coalesce(sum(${analysisUsage.outputTokens}), 0)::int`,
      totalCacheReadTokens: sql<number>`coalesce(sum(${analysisUsage.cacheReadTokens}), 0)::int`,
      totalCacheWriteTokens: sql<number>`coalesce(sum(${analysisUsage.cacheWriteTokens}), 0)::int`,
      totalTokens: sql<number>`coalesce(sum(${analysisUsage.totalTokens}), 0)::int`,
      totalCostUsd: sql<string | null>`case when sum(case when ${analysisUsage.costUsd} is not null then 1 else 0 end) > 0 then sum(${analysisUsage.costUsd}::numeric)::text else null end`,
      totalDurationMs: sql<number>`coalesce(sum(${analysisUsage.durationMs}), 0)::int`,
      callCount: sql<number>`count(*)::int`,
      provider: sql<string | null>`max(${analysisUsage.provider})`,
    })
    .from(analysisUsage)
    .where(eq(analysisUsage.analysisId, analysisId));

  return row;
}
