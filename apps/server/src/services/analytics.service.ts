import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import { db } from '../config/database.js';
import {
  violations,
  analyses,
  services,
  modules,
} from '../db/schema.js';
import type {
  TrendDataPoint,
  TrendResponse,
  BreakdownResponse,
  TopOffender,
  TopOffendersResponse,
  ResolutionResponse,
} from '@truecourse/shared';

/** SQL filter to exclude diff analyses */
const notDiffAnalysis = sql`(${analyses.metadata}->>'isDiffAnalysis')::boolean IS NOT TRUE`;

// ---------------------------------------------------------------------------
// Helper: find latest non-diff analysis for a repo
// ---------------------------------------------------------------------------

async function findLatestAnalysisId(branch?: string): Promise<string | null> {
  const conditions = [notDiffAnalysis];
  if (branch) conditions.push(eq(analyses.branch, branch));

  const [row] = await db
    .select({ id: analyses.id })
    .from(analyses)
    .where(and(...conditions))
    .orderBy(desc(analyses.createdAt))
    .limit(1);

  return row?.id ?? null;
}

// ---------------------------------------------------------------------------
// Trend: violation counts per full analysis over time
// ---------------------------------------------------------------------------

export async function getTrend(
  branch?: string,
  limit = 20,
): Promise<TrendResponse> {
  const conditions = [notDiffAnalysis];
  if (branch) conditions.push(eq(analyses.branch, branch));

  // Get recent full analyses (newest first, then reverse for chronological)
  const recentAnalyses = await db
    .select({ id: analyses.id, createdAt: analyses.createdAt, branch: analyses.branch })
    .from(analyses)
    .where(and(...conditions))
    .orderBy(desc(analyses.createdAt))
    .limit(limit);

  if (recentAnalyses.length === 0) return { points: [] };

  const analysisIds = recentAnalyses.map((a) => a.id);

  // Count all violations per analysis, grouped by status and severity
  const allRows = await db
    .select({
      analysisId: violations.analysisId,
      status: violations.status,
      severity: violations.severity,
      count: sql<number>`count(*)::int`,
    })
    .from(violations)
    .where(inArray(violations.analysisId, analysisIds))
    .groupBy(violations.analysisId, violations.status, violations.severity);

  // Build counts map
  const countMap = new Map<string, Map<string, number>>();
  for (const row of allRows) {
    const key = row.analysisId;
    if (!countMap.has(key)) countMap.set(key, new Map());
    const m = countMap.get(key)!;
    // Accumulate by status
    m.set(`status:${row.status}`, (m.get(`status:${row.status}`) ?? 0) + row.count);
    // Accumulate by severity
    m.set(`severity:${row.severity}`, (m.get(`severity:${row.severity}`) ?? 0) + row.count);
    // Total
    m.set('total', (m.get('total') ?? 0) + row.count);
  }

  // Build points in chronological order (oldest first)
  const points: TrendDataPoint[] = recentAnalyses
    .reverse()
    .map((a) => {
      const m = countMap.get(a.id) ?? new Map<string, number>();
      return {
        analysisId: a.id,
        date: a.createdAt.toISOString(),
        branch: a.branch,
        total: m.get('total') ?? 0,
        new: m.get('status:new') ?? 0,
        unchanged: m.get('status:unchanged') ?? 0,
        resolved: m.get('status:resolved') ?? 0,
        critical: m.get('severity:critical') ?? 0,
        high: m.get('severity:high') ?? 0,
        medium: m.get('severity:medium') ?? 0,
        low: m.get('severity:low') ?? 0,
        info: m.get('severity:info') ?? 0,
      };
    });

  return { points };
}

// ---------------------------------------------------------------------------
// Breakdown: type & severity distribution for latest analysis
// ---------------------------------------------------------------------------

export async function getBreakdown(
  branch?: string,
  specificAnalysisId?: string,
): Promise<BreakdownResponse> {
  const analysisId = specificAnalysisId ?? await findLatestAnalysisId(branch);
  if (!analysisId) return { byCategory: {}, bySeverity: {}, total: 0 };

  // Category is the first segment of ruleKey (e.g. 'security/deterministic/foo' → 'security').
  // Done in SQL via split_part so we can GROUP BY directly.
  const allByCategory = await db
    .select({
      category: sql<string>`split_part(${violations.ruleKey}, '/', 1)`,
      count: sql<number>`count(*)::int`,
    })
    .from(violations)
    .where(
      and(
        eq(violations.analysisId, analysisId),
        inArray(violations.status, ['new', 'unchanged']),
      ),
    )
    .groupBy(sql`split_part(${violations.ruleKey}, '/', 1)`);

  const allBySeverity = await db
    .select({
      severity: violations.severity,
      count: sql<number>`count(*)::int`,
    })
    .from(violations)
    .where(
      and(
        eq(violations.analysisId, analysisId),
        inArray(violations.status, ['new', 'unchanged']),
      ),
    )
    .groupBy(violations.severity);

  const byCategory: Record<string, number> = {};
  for (const row of allByCategory) {
    if (!row.category) continue;
    byCategory[row.category] = (byCategory[row.category] ?? 0) + row.count;
  }

  const bySeverity: Record<string, number> = {};
  for (const row of allBySeverity) {
    bySeverity[row.severity] = (bySeverity[row.severity] ?? 0) + row.count;
  }

  const total = Object.values(byCategory).reduce((a, b) => a + b, 0);

  return { byCategory, bySeverity, total };
}

// ---------------------------------------------------------------------------
// Top Offenders: services/modules ranked by violation count
// ---------------------------------------------------------------------------

export async function getTopOffenders(
  branch?: string,
  specificAnalysisId?: string,
): Promise<TopOffendersResponse> {
  const analysisId = specificAnalysisId ?? await findLatestAnalysisId(branch);
  if (!analysisId) return { offenders: [], analysisId: '' };

  // Services with most violations
  const serviceRows = await db
    .select({
      id: services.id,
      name: services.name,
      violationCount: sql<number>`count(${violations.id})::int`,
      criticalCount: sql<number>`count(*) filter (where ${violations.severity} = 'critical')::int`,
      highCount: sql<number>`count(*) filter (where ${violations.severity} = 'high')::int`,
    })
    .from(services)
    .innerJoin(violations, eq(violations.targetServiceId, services.id))
    .where(
      and(
        eq(services.analysisId, analysisId),
        eq(violations.analysisId, analysisId),
        inArray(violations.status, ['new', 'unchanged']),
      ),
    )
    .groupBy(services.id, services.name)
    .orderBy(sql`count(${violations.id}) desc`)
    .limit(10);

  // Modules with most violations
  const moduleRows = await db
    .select({
      id: modules.id,
      name: modules.name,
      violationCount: sql<number>`count(${violations.id})::int`,
      criticalCount: sql<number>`count(*) filter (where ${violations.severity} = 'critical')::int`,
      highCount: sql<number>`count(*) filter (where ${violations.severity} = 'high')::int`,
    })
    .from(modules)
    .innerJoin(violations, eq(violations.targetModuleId, modules.id))
    .where(
      and(
        eq(modules.analysisId, analysisId),
        eq(violations.analysisId, analysisId),
        inArray(violations.status, ['new', 'unchanged']),
      ),
    )
    .groupBy(modules.id, modules.name)
    .orderBy(sql`count(${violations.id}) desc`)
    .limit(10);

  // Combine, sort by violation count, take top 10
  const offenders: TopOffender[] = [
    ...serviceRows.map((r) => ({
      id: r.id,
      name: r.name,
      kind: 'service' as const,
      violationCount: r.violationCount,
      criticalCount: r.criticalCount,
      highCount: r.highCount,
    })),
    ...moduleRows.map((r) => ({
      id: r.id,
      name: r.name,
      kind: 'module' as const,
      violationCount: r.violationCount,
      criticalCount: r.criticalCount,
      highCount: r.highCount,
    })),
  ]
    .sort((a, b) => b.violationCount - a.violationCount)
    .slice(0, 10);

  return { offenders, analysisId };
}

// ---------------------------------------------------------------------------
// Resolution: velocity metrics across all analyses
// ---------------------------------------------------------------------------

export async function getResolution(branch?: string): Promise<ResolutionResponse> {
  const conditions = [notDiffAnalysis];
  if (branch) conditions.push(eq(analyses.branch, branch));

  // Get all analysis IDs (non-diff)
  const repoAnalyses = await db
    .select({ id: analyses.id })
    .from(analyses)
    .where(and(...conditions));

  if (repoAnalyses.length === 0) {
    return {
      avgTimeToResolveMs: null,
      totalResolved: 0,
      totalActive: 0,
      resolutionRate: 0,
      staleCount: 0,
      staleDays: 7,
    };
  }

  // Find the latest analysis to count active violations
  const latestAnalysisId = await findLatestAnalysisId(branch);
  if (!latestAnalysisId) {
    return {
      avgTimeToResolveMs: null,
      totalResolved: 0,
      totalActive: 0,
      resolutionRate: 0,
      staleCount: 0,
      staleDays: 7,
    };
  }

  const analysisIds = repoAnalyses.map((a) => a.id);

  // Average resolution time for all resolved violations
  const [resolution] = await db
    .select({
      avgMs: sql<number>`avg(extract(epoch from (${violations.resolvedAt} - ${violations.firstSeenAt})) * 1000)::float`,
      totalResolved: sql<number>`count(*) filter (where ${violations.status} = 'resolved')::int`,
    })
    .from(violations)
    .where(
      and(
        inArray(violations.analysisId, analysisIds),
        eq(violations.status, 'resolved'),
        sql`${violations.firstSeenAt} is not null`,
        sql`${violations.resolvedAt} is not null`,
      ),
    );

  // Active violations in latest analysis
  const [activeResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(violations)
    .where(
      and(
        eq(violations.analysisId, latestAnalysisId),
        inArray(violations.status, ['new', 'unchanged']),
      ),
    );

  // Stale violations: active in latest analysis with firstSeenAt > 7 days ago
  const staleDays = 7;
  const staleThreshold = sql`now() - interval '${sql.raw(String(staleDays))} days'`;

  const [staleResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(violations)
    .where(
      and(
        eq(violations.analysisId, latestAnalysisId),
        inArray(violations.status, ['new', 'unchanged']),
        sql`${violations.firstSeenAt} < ${staleThreshold}`,
      ),
    );

  const totalResolved = resolution?.totalResolved ?? 0;
  const totalActive = activeResult?.count ?? 0;
  const staleCount = staleResult?.count ?? 0;
  const avgTimeToResolveMs = totalResolved > 0 ? (resolution?.avgMs ?? null) : null;

  const totalEver = totalResolved + totalActive;
  const resolutionRate = totalEver > 0 ? totalResolved / totalEver : 0;

  return {
    avgTimeToResolveMs,
    totalResolved,
    totalActive,
    resolutionRate,
    staleCount,
    staleDays,
  };
}
