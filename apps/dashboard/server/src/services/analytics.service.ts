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
} from '@truecourse/core/lib/analysis-store';
import { readActiveViolationsForAnalysisId } from '@truecourse/core/services/violation-query';
import type { HistoryEntry, ViolationWithNames } from '@truecourse/core/types/snapshot';

const STALE_DAYS = 7;

// ---------------------------------------------------------------------------
// Trend
// ---------------------------------------------------------------------------

export function getTrend(
  repoPath: string,
  branch?: string,
  limit = 20,
  upToAnalysisId?: string,
): TrendResponse {
  const history = readHistory(repoPath);
  const eligible = history.analyses.filter((e) => (!branch || e.branch === branch) && !isDiff(e));

  // When scoped to a past analysis, truncate at that entry (inclusive). Keeps
  // the timeline honest — no future points after the one the user is viewing.
  let windowed = eligible;
  if (upToAnalysisId) {
    const idx = eligible.findIndex((e) => e.id === upToAnalysisId);
    if (idx >= 0) windowed = eligible.slice(0, idx + 1);
  }

  const entries = windowed.slice(-limit);

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

export function getResolution(
  repoPath: string,
  branch?: string,
  upToAnalysisId?: string,
): ResolutionResponse {
  const files = listAnalyses(repoPath);
  const staleThresholdMs = Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000;

  let totalResolved = 0;
  let totalActive = 0;
  let staleCount = 0;
  let timeSum = 0;
  let timeCount = 0;

  // When scoped to a past analysis, stop the chronological walk once we've
  // processed that analysis's file. Future resolutions aren't part of that
  // point-in-time's metrics.
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

    if (upToAnalysisId && snap.id === upToAnalysisId) break;
  }

  // Active-at-this-moment: LATEST when no selection; otherwise the
  // reconstructed active set as of the selected analysis.
  const activeSet = upToAnalysisId
    ? readActiveViolationsForAnalysisId(repoPath, upToAnalysisId)
    : readLatest(repoPath)?.violations.filter((v) => v.status === 'new' || v.status === 'unchanged') ?? null;
  if (activeSet) {
    for (const v of activeSet) {
      totalActive++;
      if (v.firstSeenAt && Date.parse(v.firstSeenAt) < staleThresholdMs) staleCount++;
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
  // LATEST-mode: respect the branch filter on LATEST's branch. For historical
  // and diff ids the branch filter is implicit in the analysis itself, so
  // skip it there.
  if (!specificAnalysisId) {
    const latest = readLatest(repoPath);
    if (!latest) return [];
    if (branch && latest.analysis.branch !== branch) return [];
  }
  return readActiveViolationsForAnalysisId(repoPath, specificAnalysisId) ?? [];
}

export function listHistoryEntries(repoPath: string): HistoryEntry[] {
  const h = readHistory(repoPath);
  return [...h.analyses].reverse();
}
