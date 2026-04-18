import * as p from "@clack/prompts";
import { readLatest, readDiff } from "@truecourse/server/lib/analysis-store";
import type { Violation, DiffResult } from "./helpers.js";
import {
  requireRegisteredRepo,
  renderViolations,
  renderDiffResults,
} from "./helpers.js";

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

export async function runList({ limit = 20, offset = 0 } = {}): Promise<void> {
  p.intro("Violations");

  const repo = requireRegisteredRepo();
  const latest = readLatest(repo.path);

  if (!latest) {
    p.log.info("No analysis found. Run `truecourse analyze` first.");
    return;
  }

  // Active set: new + unchanged. Matches the default filter on
  // GET /api/repos/:id/violations so CLI and dashboard agree.
  const active = latest.violations
    .filter((v) => v.status === "new" || v.status === "unchanged")
    .sort((a, b) => {
      const sa = SEVERITY_ORDER[a.severity] ?? 5;
      const sb = SEVERITY_ORDER[b.severity] ?? 5;
      if (sa !== sb) return sa - sb;
      return b.createdAt.localeCompare(a.createdAt);
    });

  const total = active.length;
  const showAll = !isFinite(limit);
  const paged = showAll ? active : active.slice(offset, offset + limit);

  renderViolations(paged as unknown as Violation[], { total, offset });
}

export async function runListDiff(): Promise<void> {
  p.intro("Diff check results");

  const repo = requireRegisteredRepo();
  const diff = readDiff(repo.path);

  if (!diff) {
    p.log.info("No diff check found. Run `truecourse analyze --diff` first.");
    return;
  }

  const latest = readLatest(repo.path);
  const isStale = latest ? latest.analysis.id !== diff.baseAnalysisId : false;

  if (isStale) {
    p.log.warn("Results may be stale — baseline analysis has changed.");
  }

  const result: DiffResult = {
    isStale,
    changedFiles: diff.changedFiles,
    newViolations: diff.newViolations as unknown as DiffResult["newViolations"],
    resolvedViolations: diff.resolvedViolations as unknown as DiffResult["resolvedViolations"],
    summary: { newCount: diff.summary.newCount, resolvedCount: diff.summary.resolvedCount },
  };

  renderDiffResults(result);
}
