/**
 * The hosted half of core's `UsageStore`: what a workspace's runs spent, over
 * the `llm_usage` table.
 *
 * The write is ONE upsert onto the (job, subject) row: this flush's tokens,
 * calls and cost are ADDED to what is there, the interval is widened to cover
 * both, the model becomes the newest one seen, and a run id only ever arrives
 * (`coalesce`), never leaves. That is what makes a live run's row grow and a run
 * that died keep what it had spent.
 *
 * Every read is scoped to one workspace and one half-open period
 * (`from` inclusive, `to` exclusive) and anchored on `started_at`, so a row
 * belongs to the bucket its first call fell in. `cost_usd` is a numeric, which
 * the driver hands back as a STRING; it becomes a number here, at the boundary,
 * and nowhere else.
 *
 * The runs list joins the `jobs` row for its outcome: a run's spend is this
 * table's, how the job ended is the queue's, and the two are one row on the page.
 */

import { randomUUID } from 'node:crypto';
import { and, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { jobs, llmUsage, type Db } from '@truecourse/db';
import type { JobStatus } from '@truecourse/shared';
import type {
  UsageDelta,
  UsageFacetCell,
  UsageQuery,
  UsageRunRecord,
  UsageSeriesRecord,
  UsageStore,
  UsageTotalsRecord,
} from '@truecourse/core/lib/usage-store';
import { iso } from './iso.js';

/** A driver's rendering of a number: numeric and bigint arrive as strings. */
function num(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** The rows of one workspace, one period, and whichever filters were asked for. */
function scope(query: UsageQuery) {
  const clauses = [
    eq(llmUsage.workspaceOrgId, query.workspaceOrgId),
    gte(llmUsage.startedAt, query.from),
    lt(llmUsage.startedAt, query.to),
  ];
  if (query.repoFullName !== undefined) clauses.push(eq(llmUsage.repoFullName, query.repoFullName));
  if (query.jobType !== undefined) clauses.push(eq(llmUsage.jobType, query.jobType));
  return and(...clauses)!;
}

/** The four token columns added up, as one SQL expression. */
const TOKENS = sql`(${llmUsage.inputTokens} + ${llmUsage.outputTokens} + ${llmUsage.cacheReadTokens} + ${llmUsage.cacheCreateTokens})`;

export class PgUsageStore implements UsageStore {
  constructor(private readonly db: Db) {}

  async record(delta: UsageDelta): Promise<void> {
    await this.db
      .insert(llmUsage)
      .values({
        id: randomUUID(),
        workspaceOrgId: delta.workspaceOrgId,
        repoFullName: delta.repoFullName,
        jobType: delta.jobType,
        jobId: delta.jobId,
        runId: delta.runId,
        subjectKind: delta.subjectKind,
        subject: delta.subject,
        provider: delta.provider,
        model: delta.model,
        inputTokens: delta.inputTokens,
        outputTokens: delta.outputTokens,
        cacheReadTokens: delta.cacheReadTokens,
        cacheCreateTokens: delta.cacheCreateTokens,
        calls: delta.calls,
        costUsd: delta.costUsd.toFixed(8),
        startedAt: delta.startedAt,
        finishedAt: delta.finishedAt,
      })
      .onConflictDoUpdate({
        target: [llmUsage.jobId, llmUsage.subjectKind, llmUsage.subject],
        set: {
          inputTokens: sql`${llmUsage.inputTokens} + excluded.input_tokens`,
          outputTokens: sql`${llmUsage.outputTokens} + excluded.output_tokens`,
          cacheReadTokens: sql`${llmUsage.cacheReadTokens} + excluded.cache_read_tokens`,
          cacheCreateTokens: sql`${llmUsage.cacheCreateTokens} + excluded.cache_create_tokens`,
          calls: sql`${llmUsage.calls} + excluded.calls`,
          costUsd: sql`${llmUsage.costUsd} + excluded.cost_usd`,
          model: sql`excluded.model`,
          runId: sql`coalesce(excluded.run_id, ${llmUsage.runId})`,
          startedAt: sql`least(${llmUsage.startedAt}, excluded.started_at)`,
          finishedAt: sql`greatest(${llmUsage.finishedAt}, excluded.finished_at)`,
        },
      });
  }

  async attachRun(jobId: string, runId: string): Promise<void> {
    await this.db
      .update(llmUsage)
      .set({ runId })
      .where(and(eq(llmUsage.jobId, jobId), isNull(llmUsage.runId)));
  }

  async totals(query: UsageQuery): Promise<UsageTotalsRecord> {
    const [row] = await this.db
      .select({
        costUsd: sql<string>`coalesce(sum(${llmUsage.costUsd}), 0)`,
        inputTokens: sql<string>`coalesce(sum(${llmUsage.inputTokens}), 0)`,
        outputTokens: sql<string>`coalesce(sum(${llmUsage.outputTokens}), 0)`,
        cacheReadTokens: sql<string>`coalesce(sum(${llmUsage.cacheReadTokens}), 0)`,
        cacheCreateTokens: sql<string>`coalesce(sum(${llmUsage.cacheCreateTokens}), 0)`,
        calls: sql<string>`coalesce(sum(${llmUsage.calls}), 0)`,
        runs: sql<string>`count(distinct ${llmUsage.jobId})`,
      })
      .from(llmUsage)
      .where(scope(query));
    return {
      costUsd: num(row?.costUsd),
      inputTokens: num(row?.inputTokens),
      outputTokens: num(row?.outputTokens),
      cacheReadTokens: num(row?.cacheReadTokens),
      cacheCreateTokens: num(row?.cacheCreateTokens),
      calls: num(row?.calls),
      runs: num(row?.runs),
    };
  }

  async series(query: UsageQuery, bucket: 'day' | 'week'): Promise<UsageSeriesRecord[]> {
    // The bucket's first day in UTC, as the date the page draws. `week` truncates
    // to the Monday, which is Postgres's own week.
    const at = sql<string>`to_char(date_trunc(${bucket}, ${llmUsage.startedAt} at time zone 'UTC'), 'YYYY-MM-DD')`;
    const rows = await this.db
      .select({
        at,
        jobType: llmUsage.jobType,
        costUsd: sql<string>`coalesce(sum(${llmUsage.costUsd}), 0)`,
        tokens: sql<string>`coalesce(sum(${TOKENS}), 0)`,
      })
      .from(llmUsage)
      .where(scope(query))
      // By ordinal: the bucket expression is spelled once, in the select list.
      .groupBy(sql`1`, llmUsage.jobType)
      .orderBy(sql`1`);
    return rows.map((row) => ({
      at: text(row.at),
      jobType: row.jobType,
      costUsd: num(row.costUsd),
      tokens: num(row.tokens),
    }));
  }

  async runs(query: UsageQuery, limit: number): Promise<UsageRunRecord[]> {
    const finished = sql<string>`max(${llmUsage.finishedAt})`;
    const rows = await this.db
      .select({
        jobId: llmUsage.jobId,
        // Every row of a job carries the same run id, or none yet: the non-null
        // one is the answer whichever row it was written on.
        runId: sql<string | null>`max(${llmUsage.runId})`,
        jobType: sql<string>`min(${llmUsage.jobType})`,
        repoFullName: sql<string | null>`min(${llmUsage.repoFullName})`,
        costUsd: sql<string>`coalesce(sum(${llmUsage.costUsd}), 0)`,
        tokens: sql<string>`coalesce(sum(${TOKENS}), 0)`,
        calls: sql<string>`coalesce(sum(${llmUsage.calls}), 0)`,
        startedAt: sql<string>`min(${llmUsage.startedAt})`,
        finishedAt: finished,
        outcome: jobs.status,
      })
      .from(llmUsage)
      .leftJoin(jobs, eq(jobs.id, llmUsage.jobId))
      // `jobs.status` is one value per job id, so grouping by it splits nothing.
      .where(scope(query))
      .groupBy(llmUsage.jobId, jobs.status)
      .orderBy(sql`max(${llmUsage.finishedAt}) desc`)
      .limit(limit);
    const models = await this.modelsOf(rows.map((row) => row.jobId));
    return rows.map((row) => ({
      jobId: row.jobId,
      runId: row.runId ?? null,
      jobType: text(row.jobType),
      repoFullName: row.repoFullName ?? null,
      costUsd: num(row.costUsd),
      tokens: num(row.tokens),
      calls: num(row.calls),
      model: models.get(row.jobId) ?? '',
      startedAt: iso(text(row.startedAt)),
      finishedAt: iso(text(row.finishedAt)),
      outcome: (row.outcome as JobStatus | null) ?? null,
    }));
  }

  /** The model that did most of each job's work, by tokens; ties go to the name. */
  private async modelsOf(jobIds: readonly string[]): Promise<Map<string, string>> {
    if (jobIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        jobId: llmUsage.jobId,
        model: llmUsage.model,
        tokens: sql<string>`coalesce(sum(${TOKENS}), 0)`,
      })
      .from(llmUsage)
      .where(inArray(llmUsage.jobId, [...jobIds]))
      .groupBy(llmUsage.jobId, llmUsage.model);
    const best = new Map<string, { model: string; tokens: number }>();
    for (const row of rows) {
      const tokens = num(row.tokens);
      const held = best.get(row.jobId);
      if (!held || tokens > held.tokens || (tokens === held.tokens && row.model < held.model)) {
        best.set(row.jobId, { model: row.model, tokens });
      }
    }
    return new Map([...best].map(([jobId, held]) => [jobId, held.model]));
  }

  async facets(query: UsageQuery): Promise<UsageFacetCell[]> {
    // Neither filter applies: the menu answers what picking a value WOULD keep,
    // which it cannot do from rows a filter already removed.
    const rows = await this.db
      .select({
        repoFullName: llmUsage.repoFullName,
        jobType: llmUsage.jobType,
        runs: sql<string>`count(distinct ${llmUsage.jobId})`,
      })
      .from(llmUsage)
      .where(
        scope({ workspaceOrgId: query.workspaceOrgId, from: query.from, to: query.to }),
      )
      .groupBy(llmUsage.repoFullName, llmUsage.jobType);
    return rows.map((row) => ({
      repoFullName: row.repoFullName ?? null,
      jobType: row.jobType,
      runs: num(row.runs),
    }));
  }

  async since(workspaceOrgId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ at: sql<string | null>`min(${llmUsage.startedAt})` })
      .from(llmUsage)
      .where(eq(llmUsage.workspaceOrgId, workspaceOrgId));
    return row?.at ? iso(row.at) : null;
  }
}
