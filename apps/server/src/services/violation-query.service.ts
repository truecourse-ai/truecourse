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

import type { DiffSnapshot, ViolationStatus, ViolationWithNames } from '../types/snapshot.js';
import { readDiff, readLatest } from '../lib/analysis-store.js';

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
 * Filter + sort + paginate the active LATEST violation set. Returns an empty
 * result if LATEST doesn't exist or `analysisId` is set and doesn't match.
 */
export function listViolations(
  repoPath: string,
  options: ListViolationsOptions = {},
): ListViolationsResult {
  const latest = readLatest(repoPath);
  if (!latest) return { violations: [], total: 0 };
  if (options.analysisId && latest.analysis.id !== options.analysisId) {
    return { violations: [], total: 0 };
  }

  const statusMode = options.status ?? 'active';
  let filtered: ViolationWithNames[];
  if (statusMode === 'resolved') {
    filtered = latest.violations.filter((v) => v.status === 'resolved');
  } else if (statusMode === 'all') {
    filtered = latest.violations;
  } else {
    const active: ViolationStatus[] = ['new', 'unchanged'];
    filtered = latest.violations.filter((v) => active.includes(v.status));
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
