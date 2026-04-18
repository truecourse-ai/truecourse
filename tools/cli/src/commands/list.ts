import * as p from "@clack/prompts";
import {
  listViolations,
  getDiffResult,
} from "@truecourse/server/services/violation-query";
import type { Violation, DiffResult } from "./helpers.js";
import { requireRegisteredRepo, renderViolations, renderDiffResults } from "./helpers.js";

export async function runList({ limit = 20, offset = 0 } = {}): Promise<void> {
  p.intro("Violations");

  const repo = requireRegisteredRepo();
  const { violations, total } = listViolations(repo.path, {
    limit: isFinite(limit) ? limit : 0,
    offset,
  });

  if (total === 0 && violations.length === 0) {
    p.log.info("No violations. Run `truecourse analyze` if you haven't yet.");
    return;
  }

  renderViolations(violations as unknown as Violation[], { total, offset });
}

export async function runListDiff(): Promise<void> {
  p.intro("Diff check results");

  const repo = requireRegisteredRepo();
  const result = getDiffResult(repo.path);

  if (!result) {
    p.log.info("No diff check found. Run `truecourse analyze --diff` first.");
    return;
  }

  const { diff, isStale } = result;
  if (isStale) {
    p.log.warn("Results may be stale — baseline analysis has changed.");
  }

  const rendered: DiffResult = {
    isStale,
    changedFiles: diff.changedFiles,
    newViolations: diff.newViolations as unknown as DiffResult["newViolations"],
    resolvedViolations: diff.resolvedViolations as unknown as DiffResult["resolvedViolations"],
    summary: { newCount: diff.summary.newCount, resolvedCount: diff.summary.resolvedCount },
  };

  renderDiffResults(rendered);
}
