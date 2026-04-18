import * as p from "@clack/prompts";
import type { Violation, DiffResult } from "./helpers.js";
import {
  requireDashboard,
  requireRegisteredRepo,
  getServerUrl,
  renderViolations,
  renderDiffResults,
} from "./helpers.js";

export async function runList({ limit = 20, offset = 0 } = {}): Promise<void> {
  p.intro("Violations");

  await requireDashboard();
  const repo = requireRegisteredRepo();

  const serverUrl = getServerUrl();
  const showAll = !isFinite(limit);

  const params = new URLSearchParams();
  if (!showAll) {
    params.set("limit", String(limit));
    params.set("offset", String(offset));
  }

  const url = `${serverUrl}/api/repos/${repo.id}/violations${params.toString() ? `?${params}` : ""}`;
  const res = await fetch(url);

  if (!res.ok) {
    p.log.error(`Failed to fetch violations: ${res.status}`);
    process.exit(1);
  }

  const body = await res.json();

  // Server returns { violations, total } when paginated, or array when not
  if (Array.isArray(body)) {
    renderViolations(body, { total: body.length });
  } else {
    const { violations, total } = body as { violations: Violation[]; total: number };
    renderViolations(violations, { total, offset });
  }
}

export async function runListDiff(): Promise<void> {
  p.intro("Diff check results");

  await requireDashboard();
  const repo = requireRegisteredRepo();

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
