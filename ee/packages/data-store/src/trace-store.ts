/**
 * Postgres implementation of the LLM trace store (enterprise observability).
 * Metadata rows go to `llm_traces`; the heavy prompt/output/reasoning payloads
 * are content-addressed in `content` (scope = `trace:<org>`), referenced by sha
 * (an identical prompt across calls — the duplicate-variant case — is stored
 * once, and the rows share its `prompt_sha`/`prompt_hash`, which is exactly what
 * the same-prompt→divergent-output view groups on).
 *
 * `record` implements `LlmTraceRecorder` (the sink the EE transport writes to).
 * It is honest — it throws on a real failure — because the transport wraps it in
 * a never-throw guard, so a trace-write error never breaks the LLM call while
 * still surfacing in tests.
 */

import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, inArray, lt, sql, type SQL } from 'drizzle-orm';
import { llmTraces, type EeDb } from '@truecourse/ee-db';
import type {
  LlmTraceInput,
  LlmTraceRecorder,
  TraceDetail,
  TraceListFilters,
  TraceStats,
  TraceSummary,
} from '@truecourse/shared';
import { log } from '@truecourse/core/lib/logger';
import { sha256 } from './pack.js';
import { ContentStore, contentScope } from './content-store.js';

type TraceRow = typeof llmTraces.$inferSelect;

/** Org bucket for content scope — a null-org (context-less) call lands under `_`. */
function orgBucket(org: string | null): string {
  return org ?? '_';
}

function toSummary(r: TraceRow): TraceSummary {
  return {
    id: r.id,
    workspaceOrgId: r.workspaceOrgId,
    traceId: r.traceId,
    stage: r.stage,
    callId: r.callId,
    sliceId: r.sliceId,
    module: r.module,
    topic: r.topic,
    model: r.model,
    status: r.status as TraceSummary['status'],
    finishReason: r.finishReason,
    usedFallback: r.usedFallback,
    promptHash: r.promptHash,
    promptTokens: r.promptTokens,
    completionTokens: r.completionTokens,
    totalTokens: r.totalTokens,
    reasoningTokens: r.reasoningTokens,
    latencyMs: r.latencyMs,
    createdAt: r.createdAt,
  };
}

export class PgTraceStore implements LlmTraceRecorder {
  private readonly content: ContentStore;

  constructor(private readonly db: EeDb) {
    this.content = new ContentStore(db);
  }

  async record(input: LlmTraceInput): Promise<void> {
    const scope = contentScope.trace(orgBucket(input.workspaceOrgId));

    // Prompt → one content-addressed JSON body; its sha doubles as the prompt hash.
    const promptBody = JSON.stringify({ system: input.system, user: input.user });
    const promptHash = sha256(Buffer.from(promptBody, 'utf-8'));
    await this.content.put(scope, promptHash, promptBody);

    const outputSha = input.output == null ? null : await this.content.putText(scope, input.output);
    const reasoningSha =
      input.reasoning == null ? null : await this.content.putText(scope, input.reasoning);

    await this.db.insert(llmTraces).values({
      id: randomUUID(),
      workspaceOrgId: input.workspaceOrgId,
      traceId: input.traceId,
      parentId: input.parentId,
      stage: input.stage,
      callId: input.callId,
      sliceId: input.sliceId,
      module: input.module,
      topic: input.topic,
      model: input.model,
      status: input.status,
      errorMessage: input.errorMessage,
      finishReason: input.finishReason,
      usedFallback: input.usedFallback,
      promptHash,
      promptTokens: input.promptTokens,
      completionTokens: input.completionTokens,
      totalTokens: input.totalTokens,
      reasoningTokens: input.reasoningTokens,
      latencyMs: input.latencyMs,
      promptSha: promptHash,
      outputSha,
      reasoningSha,
      metadata: input.metadata,
      createdAt: new Date().toISOString(),
    });
  }

  /**
   * Newest-first metadata page (no payloads — those stay in `content`). `org` is
   * an OPTIONAL filter: omit it (operator only) for a cross-org read; set it to
   * scope to one tenant.
   */
  async list(filters: TraceListFilters = {}): Promise<TraceSummary[]> {
    const conds: SQL[] = [];
    if (filters.org) conds.push(eq(llmTraces.workspaceOrgId, filters.org));
    if (filters.stage) conds.push(eq(llmTraces.stage, filters.stage));
    if (filters.status) conds.push(eq(llmTraces.status, filters.status));
    if (filters.promptHash) conds.push(eq(llmTraces.promptHash, filters.promptHash));
    if (filters.traceId) conds.push(eq(llmTraces.traceId, filters.traceId));
    if (filters.before) conds.push(lt(llmTraces.createdAt, filters.before));
    const rows = await this.db
      .select()
      .from(llmTraces)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(llmTraces.createdAt))
      .limit(filters.limit ?? 100);
    return rows.map(toSummary);
  }

  /** All calls that saw the identical prompt — the divergence view. */
  async listByPromptHash(
    promptHash: string,
    opts: { org?: string; limit?: number } = {},
  ): Promise<TraceSummary[]> {
    return this.list({ promptHash, org: opts.org, limit: opts.limit ?? 100 });
  }

  /** Distinct tenant ids that have traces — populates the Admin org filter. */
  async listOrgs(): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ org: llmTraces.workspaceOrgId })
      .from(llmTraces);
    return rows
      .map((r) => r.org)
      .filter((o): o is string => o !== null)
      .sort();
  }

  /** One trace with its payloads hydrated from `content`. `org`, if set, scopes it. */
  async get(id: string, org?: string): Promise<TraceDetail | null> {
    const conds = [eq(llmTraces.id, id)];
    if (org) conds.push(eq(llmTraces.workspaceOrgId, org));
    const [row] = await this.db.select().from(llmTraces).where(and(...conds)).limit(1);
    if (!row) return null;

    const scope = contentScope.trace(orgBucket(row.workspaceOrgId));
    let system: string | null = null;
    let user: string | null = null;
    const promptBody = await this.content.get(scope, row.promptSha);
    if (promptBody) {
      try {
        const p = JSON.parse(promptBody) as { system?: string; user?: string };
        system = p.system ?? null;
        user = p.user ?? null;
      } catch {
        // A non-JSON prompt body (shouldn't happen) — leave the fields null.
      }
    }
    const output = row.outputSha ? await this.content.get(scope, row.outputSha) : null;
    const reasoning = row.reasoningSha ? await this.content.get(scope, row.reasoningSha) : null;

    return {
      ...toSummary(row),
      parentId: row.parentId,
      errorMessage: row.errorMessage,
      metadata: row.metadata ?? null,
      system,
      user,
      output,
      reasoning,
    };
  }

  /** Per-stage aggregates (calls/errors/tokens/latency). `org`, if set, scopes it. */
  async stats(opts: { org?: string; since?: string } = {}): Promise<TraceStats> {
    const conds: SQL[] = [];
    if (opts.org) conds.push(eq(llmTraces.workspaceOrgId, opts.org));
    if (opts.since) conds.push(gte(llmTraces.createdAt, opts.since));
    const rows = await this.db
      .select({
        stage: llmTraces.stage,
        calls: sql<number>`count(*)::int`,
        errors: sql<number>`sum(case when ${llmTraces.status} = 'error' then 1 else 0 end)::int`,
        totalTokens: sql<number>`coalesce(sum(${llmTraces.totalTokens}), 0)::int`,
        avgLatencyMs: sql<number>`coalesce(round(avg(${llmTraces.latencyMs})), 0)::int`,
      })
      .from(llmTraces)
      .where(conds.length ? and(...conds) : undefined)
      .groupBy(llmTraces.stage);
    const stages = rows.map((r) => ({
      stage: r.stage,
      calls: r.calls,
      errors: r.errors,
      totalTokens: r.totalTokens,
      avgLatencyMs: r.avgLatencyMs,
    }));
    return {
      stages,
      totalCalls: stages.reduce((n, s) => n + s.calls, 0),
      totalErrors: stages.reduce((n, s) => n + s.errors, 0),
    };
  }

  /**
   * Retention: delete rows older than `olderThanDays` and/or beyond `maxRows`
   * (keeping the newest), then mark-sweep now-orphaned content objects for the org.
   */
  async gc(input: { org: string; olderThanDays?: number; maxRows?: number }): Promise<{
    deletedRows: number;
    deletedObjects: number;
  }> {
    const { org } = input;
    let deletedRows = 0;

    if (input.olderThanDays != null) {
      const cutoff = new Date(Date.now() - input.olderThanDays * 86_400_000).toISOString();
      const del = await this.db
        .delete(llmTraces)
        .where(and(eq(llmTraces.workspaceOrgId, org), lt(llmTraces.createdAt, cutoff)))
        .returning({ id: llmTraces.id });
      deletedRows += del.length;
    }

    if (input.maxRows != null) {
      const keep = await this.db
        .select({ id: llmTraces.id })
        .from(llmTraces)
        .where(eq(llmTraces.workspaceOrgId, org))
        .orderBy(desc(llmTraces.createdAt))
        .limit(input.maxRows);
      const keepIds = new Set(keep.map((r) => r.id));
      const all = await this.db
        .select({ id: llmTraces.id })
        .from(llmTraces)
        .where(eq(llmTraces.workspaceOrgId, org));
      const toDelete = all.map((r) => r.id).filter((id) => !keepIds.has(id));
      if (toDelete.length > 0) {
        await this.db.delete(llmTraces).where(inArray(llmTraces.id, toDelete));
        deletedRows += toDelete.length;
      }
    }

    // mark: every content sha any surviving row still points at.
    const live = new Set<string>();
    const rows = await this.db
      .select({
        p: llmTraces.promptSha,
        o: llmTraces.outputSha,
        r: llmTraces.reasoningSha,
      })
      .from(llmTraces)
      .where(eq(llmTraces.workspaceOrgId, org));
    for (const row of rows) {
      for (const s of [row.p, row.o, row.r]) if (s) live.add(s);
    }

    // sweep: delete org content objects no surviving row references.
    const deletedObjects = await this.content.gc(contentScope.trace(orgBucket(org)), live);

    if (deletedRows > 0 || deletedObjects > 0) {
      log.info(`[ee-data-store] trace gc (org ${org}): ${deletedRows} rows, ${deletedObjects} objects`);
    }
    return { deletedRows, deletedObjects };
  }
}
