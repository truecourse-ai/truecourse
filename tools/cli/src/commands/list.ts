import * as p from "@clack/prompts";
import {
  listViolations,
  getDiffResult,
  SEVERITIES,
  type Severity,
} from "@truecourse/core/services/violation-query";
import type { Violation, DiffResult } from "./helpers.js";
import { requireRegisteredRepo, renderViolations, renderDiffResults } from "./helpers.js";

export interface RunListOptions {
  limit?: number;
  offset?: number;
  /** One or more severities to include; others are filtered out. */
  severity?: Severity[];
}

export async function runList({ limit = 20, offset = 0, severity }: RunListOptions = {}): Promise<void> {
  p.intro("Violations");

  const repo = requireRegisteredRepo();
  const { violations, total } = listViolations(repo.path, {
    limit: isFinite(limit) ? limit : 0,
    offset,
    severity,
  });

  if (total === 0 && violations.length === 0) {
    if (severity && severity.length > 0) {
      p.log.info(`No violations match severity filter: ${severity.join(", ")}.`);
    } else {
      p.log.info("No violations. Run `truecourse analyze` if you haven't yet.");
    }
    return;
  }

  renderViolations(violations as unknown as Violation[], { total, offset });
}

/**
 * Parse and validate a `--severity` option value.
 *
 * Accepts a comma-separated list (e.g. `critical,high`) or the string
 * repeated if commander passed it through as multiple. Unknown severities
 * exit with a clear error listing the valid values.
 */
export function parseSeverityFlag(raw: string | undefined): Severity[] | undefined {
  if (!raw) return undefined;
  const parts = raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (parts.length === 0) return undefined;
  const invalid = parts.filter((s) => !(SEVERITIES as readonly string[]).includes(s));
  if (invalid.length > 0) {
    console.error(
      `error: unknown severity value(s): ${invalid.join(", ")}. Valid: ${SEVERITIES.join(", ")}`,
    );
    process.exit(1);
  }
  return parts as Severity[];
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
