/**
 * `truecourse drifts list` — paginated, agent-friendly view of the drifts
 * found by the latest `truecourse verify`.
 *
 * Reads the materialized `verifier/LATEST.json` (the same baseline the
 * dashboard reads) — it does NOT re-run verification, so it's cheap and
 * side-effect-free. Run `truecourse verify` first to produce/refresh it.
 *
 * Mirrors `truecourse list` (violations): `--limit` / `--offset` / `--all`
 * pagination plus a `--severity` filter.
 */

import * as p from "@clack/prompts";
import path from "node:path";
import { readVerifyLatest } from "@truecourse/core/commands/spec-in-process";
import type { Severity } from "@truecourse/contract-verifier";

const DRIFT_SEVERITIES: readonly Severity[] = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
];

export interface RunDriftsListOptions {
  cwd?: string;
  /** Page size. Pass Infinity (via `--all`) to show every drift. */
  limit?: number;
  offset?: number;
  /** One or more severities to include; others are filtered out. */
  severity?: Severity[];
}

const repoRoot = (opts: { cwd?: string }): string => opts.cwd ?? process.cwd();

export async function runDriftsList(opts: RunDriftsListOptions = {}): Promise<void> {
  const root = repoRoot(opts);
  p.intro("Drifts");

  const latest = readVerifyLatest(root);
  if (!latest) {
    p.log.info("No verify results yet. Run `truecourse verify` first.");
    p.outro("Nothing to show.");
    return;
  }

  const sevFilter = opts.severity && opts.severity.length > 0 ? new Set(opts.severity) : null;
  const all = sevFilter ? latest.drifts.filter((d) => sevFilter.has(d.severity)) : latest.drifts;
  const total = all.length;

  if (total === 0) {
    if (sevFilter) {
      p.log.info(`No drifts match severity filter: ${[...sevFilter].join(", ")}.`);
    } else {
      p.log.info("No drift detected.");
    }
    p.outro("Nothing to show.");
    return;
  }

  const offset = Math.max(0, opts.offset ?? 0);
  const limit = opts.limit ?? 20;
  const end = isFinite(limit) ? offset + limit : total;
  const page = all.slice(offset, end);

  p.log.message("");
  p.log.message("Drifts:");
  for (const d of page) {
    const loc = d.filePath ? ` ${path.relative(root, d.filePath)}:${d.lineStart ?? "?"}` : "";
    p.log.message(`  [${d.severity}] ${d.obligationKey}${loc}`);
    p.log.message(`    → ${d.message}`);
  }

  const shownFrom = total === 0 ? 0 : offset + 1;
  const shownTo = offset + page.length;
  const remaining = total - shownTo;
  if (remaining > 0) {
    p.log.message("");
    p.log.message(
      `  … ${remaining} more — \`truecourse drifts list --offset ${shownTo}\` (or \`--all\`)`,
    );
  }

  p.outro(`Showing ${shownFrom}–${shownTo} of ${total} drift${total === 1 ? "" : "s"}.`);
}

/**
 * Parse and validate a `--severity` option value (comma-separated, e.g.
 * `critical,high`). Unknown severities exit with a clear error.
 */
export function parseDriftSeverityFlag(raw: string | undefined): Severity[] | undefined {
  if (!raw) return undefined;
  const parts = raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (parts.length === 0) return undefined;
  const invalid = parts.filter((s) => !(DRIFT_SEVERITIES as readonly string[]).includes(s));
  if (invalid.length > 0) {
    console.error(
      `error: unknown severity value(s): ${invalid.join(", ")}. Valid: ${DRIFT_SEVERITIES.join(", ")}`,
    );
    process.exit(1);
  }
  return parts as Severity[];
}
