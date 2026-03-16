import * as p from "@clack/prompts";
import type { Violation, DiffResult } from "./helpers.js";
import {
  ensureServer,
  ensureRepo,
  getServerUrl,
  renderViolations,
  renderDiffResults,
} from "./helpers.js";

export async function runList(): Promise<void> {
  p.intro("Violations");

  await ensureServer();
  const repo = await ensureRepo();

  const serverUrl = getServerUrl();
  const res = await fetch(`${serverUrl}/api/repos/${repo.id}/violations`);

  if (!res.ok) {
    p.log.error(`Failed to fetch violations: ${res.status}`);
    process.exit(1);
  }

  const violations = (await res.json()) as Violation[];
  renderViolations(violations);
}

export async function runListDiff(): Promise<void> {
  p.intro("Diff check results");

  await ensureServer();
  const repo = await ensureRepo();

  const serverUrl = getServerUrl();
  const res = await fetch(`${serverUrl}/api/repos/${repo.id}/diff-check`);

  if (!res.ok) {
    p.log.error(`Failed to fetch diff check results: ${res.status}`);
    process.exit(1);
  }

  const result = (await res.json()) as DiffResult | null;

  if (!result) {
    p.log.info("No diff check found. Run `truecourse analyze --diff` first.");
    return;
  }

  if (result.isStale) {
    p.log.warn("Results may be stale — baseline analysis has changed.");
  }

  renderDiffResults(result);
}
