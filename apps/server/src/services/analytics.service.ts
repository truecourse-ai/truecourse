import type {
  BreakdownResponse,
  ResolutionResponse,
  TopOffender,
  TopOffendersResponse,
  TrendDataPoint,
  TrendResponse,
} from '@truecourse/shared';
import {
  listAnalyses,
  readAnalysis,
  readHistory,
  readLatest,
} from '../lib/analysis-store.js';
import type { HistoryEntry, ViolationWithNames } from '../types/snapshot.js';

const STALE_DAYS = 7;

// ---------------------------------------------------------------------------
// Trend
// ---------------------------------------------------------------------------

export function getTrend(repoPath: string, branch?: string, limit = 20): TrendResponse {
  const history = readHistory(repoPath);
  const entries = history.analyses
    .filter((e) => (!branch || e.branch === branch) && !isDiff(e))
    .slice(-limit);

  const points: TrendDataPoint[] = entries.map((e) => {
    const sev = e.counts.violations.bySeverity;
    const total = e.counts.violations.new + e.counts.violations.unchanged;
    return {
      analysisId: e.id,
      date: e.createdAt,
      branch: e.branch,
      total,
      new: e.counts.violations.new,
      unchanged: e.counts.violations.unchanged,
      resolved: e.counts.violations.resolved,
      critical: sev.critical ?? 0,
      high: sev.high ?? 0,
      medium: sev.medium ?? 0,
      low: sev.low ?? 0,
      info: sev.info ?? 0,
    };
  });

  return { points };
}

// ---------------------------------------------------------------------------
// Breakdown — category × severity
// ---------------------------------------------------------------------------

export function getBreakdown(
  repoPath: string,
  branch?: string,
  specificAnalysisId?: string,
): BreakdownResponse {
  const violations = loadActiveViolations(repoPath, branch, specificAnalysisId);
  const byCategory: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  let total = 0;

  for (const v of violations) {
    const category = v.ruleKey.split('/')[0] || 'unknown';
    byCategory[category] = (byCategory[category] ?? 0) + 1;
    bySeverity[v.severity] = (bySeverity[v.severity] ?? 0) + 1;
    total++;
  }

  return { byCategory, bySeverity, total };
}

// ---------------------------------------------------------------------------
// Top offenders
// ---------------------------------------------------------------------------

export function getTopOffenders(
  repoPath: string,
  branch?: string,
  specificAnalysisId?: string,
): TopOffendersResponse {
  const latest = readLatest(repoPath);
  const analysisId = specificAnalysisId
    ? specificAnalysisId
    : latest?.analysis.id ?? '';
  const violations = loadActiveViolations(repoPath, branch, specificAnalysisId);

  const byService = new Map<string, { name: string; total: number; critical: number; high: number }>();
  const byModule = new Map<string, { name: string; total: number; critical: number; high: number }>();

  for (const v of violations) {
    if (v.targetServiceId && v.targetServiceName) {
      const key = v.targetServiceId;
      const entry = byService.get(key) ?? { name: v.targetServiceName, total: 0, critical: 0, high: 0 };
      entry.total++;
      if (v.severity === 'critical') entry.critical++;
      if (v.severity === 'high') entry.high++;
      byService.set(key, entry);
    }
    if (v.targetModuleId && v.targetModuleName) {
      const key = v.targetModuleId;
      const entry = byModule.get(key) ?? { name: v.targetModuleName, total: 0, critical: 0, high: 0 };
      entry.total++;
      if (v.severity === 'critical') entry.critical++;
      if (v.severity === 'high') entry.high++;
      byModule.set(key, entry);
    }
  }

  const toOffender = (kind: 'service' | 'module') =>
    ([id, v]: [string, { name: string; total: number; critical: number; high: number }]): TopOffender => ({
      kind,
      id,
      name: v.name,
      violationCount: v.total,
      criticalCount: v.critical,
      highCount: v.high,
    });

  const services = [...byService.entries()]
    .map(toOffender('service'))
    .sort((a, b) => b.violationCount - a.violationCount)
    .slice(0, 10);
  const modules = [...byModule.entries()]
    .map(toOffender('module'))
    .sort((a, b) => b.violationCount - a.violationCount)
    .slice(0, 10);

  const offenders = [...services, ...modules]
    .sort((a, b) => b.violationCount - a.violationCount)
    .slice(0, 10);

  return { offenders, analysisId };
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export function getResolution(repoPath: string, branch?: string): ResolutionResponse {
  const files = listAnalyses(repoPath);
  const staleThresholdMs = Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000;

  let totalResolved = 0;
  let totalActive = 0;
  let staleCount = 0;
  let timeSum = 0;
  let timeCount = 0;

  // Walk snapshot files once to count resolved + compute avg time-to-resolve
  // from (resolvedAt - firstSeenAt) on each resolved row.
  const firstSeenByViolationId = new Map<string, string>();
  for (const name of files) {
    const snap = readAnalysis(repoPath, name);
    if (!snap) continue;
    if (branch && snap.branch !== branch) continue;
    if (isDiff({ metadata: snap.metadata })) continue;

    for (const v of snap.violations.added) {
      if (v.firstSeenAt) firstSeenByViolationId.set(v.id, v.firstSeenAt);
    }
    for (const r of snap.violations.resolved) {
      totalResolved++;
      const firstSeen = firstSeenByViolationId.get(r.id);
      if (firstSeen) {
        const delta = Date.parse(r.resolvedAt) - Date.parse(firstSeen);
        if (delta > 0) {
          timeSum += delta;
          timeCount++;
        }
      }
    }
  }

  const latest = readLatest(repoPath);
  if (latest) {
    for (const v of latest.violations) {
      if (v.status === 'new' || v.status === 'unchanged') {
        totalActive++;
        if (v.firstSeenAt && Date.parse(v.firstSeenAt) < staleThresholdMs) staleCount++;
      }
    }
  }

  const resolutionRate =
    totalResolved + totalActive > 0 ? totalResolved / (totalResolved + totalActive) : 0;

  return {
    avgTimeToResolveMs: timeCount > 0 ? Math.round(timeSum / timeCount) : null,
    totalResolved,
    totalActive,
    resolutionRate,
    staleCount,
    staleDays: STALE_DAYS,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isDiff(entry: { metadata: Record<string, unknown> | null }): boolean {
  return entry.metadata?.isDiffAnalysis === true;
}

function loadActiveViolations(
  repoPath: string,
  branch?: string,
  specificAnalysisId?: string,
): ViolationWithNames[] {
  const latest = readLatest(repoPath);
  if (!latest) return [];

  if (specificAnalysisId && latest.analysis.id !== specificAnalysisId) {
    for (const name of listAnalyses(repoPath).reverse()) {
      const snap = readAnalysis(repoPath, name);
      if (snap?.id === specificAnalysisId) {
        const serviceById = new Map(snap.graph.services.map((s) => [s.id, s.name]));
        const moduleById = new Map(snap.graph.modules.map((m) => [m.id, m.name]));
        const methodById = new Map(snap.graph.methods.map((m) => [m.id, m.name]));
        const databaseById = new Map(snap.graph.databases.map((d) => [d.id, d.name]));
        return snap.violations.added.map((v) => ({
          ...v,
          targetServiceName: v.targetServiceId ? serviceById.get(v.targetServiceId) ?? null : null,
          targetModuleName: v.targetModuleId ? moduleById.get(v.targetModuleId) ?? null : null,
          targetMethodName: v.targetMethodId ? methodById.get(v.targetMethodId) ?? null : null,
          targetDatabaseName: v.targetDatabaseId ? databaseById.get(v.targetDatabaseId) ?? null : null,
        }));
      }
    }
    return [];
  }

  if (branch && latest.analysis.branch !== branch) return [];

  return latest.violations.filter((v) => v.status === 'new' || v.status === 'unchanged');
}

export function listHistoryEntries(repoPath: string): HistoryEntry[] {
  const h = readHistory(repoPath);
  return [...h.analyses].reverse();
}
