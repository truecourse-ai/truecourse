/**
 * Query helpers over the stored violation set.
 *
 * Used by:
 *   - `GET /api/repos/:id/violations`  (dashboard HTTP route)
 *   - `truecourse list` / `list --diff` (CLI)
 *
 * Filter, sort, and paginate live here so both callers stay consistent.
 * Reads from `LATEST.json` / `diff.json` via analysis-store.
 */

import type {
  AnalysisSnapshot,
  DiffSnapshot,
  Graph,
  ViolationRecord,
  ViolationStatus,
  ViolationWithNames,
} from '../types/snapshot.js';
import {
  findAnalysisFilename,
  listAnalyses,
  readAnalysis,
  readDiff,
  readLatest,
} from '../lib/analysis-store.js';

export const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

export interface ListViolationsOptions {
  /** Scope to a specific analysis id; if it doesn't match LATEST, returns empty. */
  analysisId?: string;
  /** `active` (default) = new + unchanged. `resolved` = only resolved. `all` = no status filter. */
  status?: 'active' | 'resolved' | 'all';
  /** File path filter (absolute or repo-relative). Scoped to `type === 'code'`. */
  filePath?: string;
  /** 0 = no pagination, just full list. */
  limit?: number;
  offset?: number;
}

export interface ListViolationsResult {
  violations: ViolationWithNames[];
  /** Size of the filtered set before pagination. */
  total: number;
}

/**
 * Filter + sort + paginate the active violation set for either LATEST or a
 * specific historical analysis.
 *
 * LATEST path reads the materialized set directly (fast). Historical path
 * reconstructs the active set as of `analysisId` by walking the delta chain
 * in `analyses/*.json` from oldest to target (O(n analyses up to target),
 * each file sub-ms on typical projects).
 */
export function listViolations(
  repoPath: string,
  options: ListViolationsOptions = {},
): ListViolationsResult {
  const latest = readLatest(repoPath);
  if (!latest) return { violations: [], total: 0 };

  let violations: ViolationWithNames[];
  if (!options.analysisId || latest.analysis.id === options.analysisId) {
    violations = latest.violations;
  } else {
    const historical = readActiveViolationsAt(repoPath, options.analysisId);
    if (!historical) return { violations: [], total: 0 };
    violations = historical;
  }

  const statusMode = options.status ?? 'active';
  let filtered: ViolationWithNames[];
  if (statusMode === 'resolved') {
    filtered = violations.filter((v) => v.status === 'resolved');
  } else if (statusMode === 'all') {
    filtered = violations;
  } else {
    const active: ViolationStatus[] = ['new', 'unchanged'];
    filtered = violations.filter((v) => active.includes(v.status));
  }

  if (options.filePath) {
    const absPath = options.filePath.startsWith('/')
      ? options.filePath
      : `${repoPath}/${options.filePath}`;
    filtered = filtered.filter(
      (v) => v.type === 'code' && (v.filePath === absPath || v.filePath === options.filePath),
    );
  }

  filtered.sort((a, b) => {
    const sa = SEVERITY_ORDER[a.severity] ?? 5;
    const sb = SEVERITY_ORDER[b.severity] ?? 5;
    if (sa !== sb) return sa - sb;
    return b.createdAt.localeCompare(a.createdAt);
  });

  const total = filtered.length;
  const limit = options.limit ?? 0;
  const offset = options.offset ?? 0;
  const paged = limit > 0 ? filtered.slice(offset, offset + limit) : filtered;

  return { violations: paged, total };
}

/**
 * Reconstruct the active violation set as of `analysisId` by replaying the
 * delta chain (added / resolved refs) from the oldest analysis up to and
 * including the target. Target's own graph is used to denormalize target
 * names. Returns null if the analysisId isn't found.
 */
export function readActiveViolationsAt(
  repoPath: string,
  analysisId: string,
): ViolationWithNames[] | null {
  const targetFile = findAnalysisFilename(repoPath, analysisId);
  if (!targetFile) return null;
  const targetSnap = readAnalysis(repoPath, targetFile);
  if (!targetSnap) return null;

  const files = listAnalyses(repoPath);
  const targetIdx = files.indexOf(targetFile);
  if (targetIdx === -1) return null;

  // Walk oldest → target, apply added + resolved refs.
  const active = new Map<string, ViolationRecord>();
  for (let i = 0; i <= targetIdx; i++) {
    const snap = readAnalysis(repoPath, files[i]);
    if (!snap) continue;
    for (const r of snap.violations.resolved) active.delete(r.id);
    for (const a of snap.violations.added) active.set(a.id, a);
  }

  return [...active.values()].map(denormalizeAgainst(targetSnap.graph));
}

function denormalizeAgainst(graph: Graph): (v: ViolationRecord) => ViolationWithNames {
  const serviceById = new Map(graph.services.map((s) => [s.id, s.name]));
  const moduleById = new Map(graph.modules.map((m) => [m.id, m.name]));
  const methodById = new Map(graph.methods.map((m) => [m.id, m.name]));
  const databaseById = new Map(graph.databases.map((d) => [d.id, d.name]));
  return (v) => ({
    ...v,
    targetServiceName: v.targetServiceId ? serviceById.get(v.targetServiceId) ?? null : null,
    targetModuleName: v.targetModuleId ? moduleById.get(v.targetModuleId) ?? null : null,
    targetMethodName: v.targetMethodId ? methodById.get(v.targetMethodId) ?? null : null,
    targetDatabaseName: v.targetDatabaseId ? databaseById.get(v.targetDatabaseId) ?? null : null,
  });
}

// ---------------------------------------------------------------------------
// Graph resolver — used by /flows and /databases (and graph, analytics) to
// honor `?analysisId=` consistently. Returns LATEST / diff / historical graph
// in one call instead of every route re-implementing the three-way lookup.
// ---------------------------------------------------------------------------

export type GraphSource = 'latest' | 'diff' | 'historical';

export interface ResolvedGraph {
  graph: Graph;
  source: GraphSource;
  /** Analysis id the graph belongs to (LATEST id, diff id, or historical id). */
  analysisId: string;
}

export function resolveGraphForAnalysisId(
  repoPath: string,
  analysisId?: string,
): ResolvedGraph | null {
  const latest = readLatest(repoPath);

  // No param, or explicitly pointing at LATEST → serve LATEST.
  if (!analysisId || (latest && latest.analysis.id === analysisId)) {
    if (!latest) return null;
    return { graph: latest.graph, source: 'latest', analysisId: latest.analysis.id };
  }

  // Diff: id matches the current diff.json.
  const diff = readDiff(repoPath);
  if (diff && diff.id === analysisId) {
    return { graph: diff.graph, source: 'diff', analysisId: diff.id };
  }

  // Historical per-analysis file.
  const filename = findAnalysisFilename(repoPath, analysisId);
  if (!filename) return null;
  const snap = readAnalysis(repoPath, filename);
  if (!snap) return null;
  return { graph: snap.graph, source: 'historical', analysisId: snap.id };
}

export interface DiffResultWithStale {
  diff: DiffSnapshot;
  /** True when the diff's baseAnalysisId no longer matches current LATEST. */
  isStale: boolean;
}

/** Read the current diff snapshot and compute stale-vs-LATEST. */
export function getDiffResult(repoPath: string): DiffResultWithStale | null {
  const diff = readDiff(repoPath);
  if (!diff) return null;
  const latest = readLatest(repoPath);
  const isStale = latest ? latest.analysis.id !== diff.baseAnalysisId : false;
  return { diff, isStale };
}
