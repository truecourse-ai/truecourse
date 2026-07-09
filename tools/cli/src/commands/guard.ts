/**
 * `truecourse guard run` — build the entrypoint via the recipe, run the committed
 * scenarios in parallel sandboxes, print per-scenario results, and write
 * `.truecourse/guard/LATEST.json`. Deterministic and LLM-free: no `claude`
 * preflight, no cost estimate. Unlike `verify`, it exits non-zero on any
 * non-pass outcome — fail, error, stale, or orphaned — so it works as a CI drift
 * gate: code drift (fail), infra trouble (error), and spec-side drift
 * (stale/orphaned) all break the build.
 */

import path from "node:path";
import * as p from "@clack/prompts";
import { readManifest, readGuardLatest, readGuardResult, guardResultPath } from "@truecourse/guard-runner";
import type { GuardScenarioResult, GuardGenerateReport } from "@truecourse/shared";
import { StepTracker } from "@truecourse/core/progress";
import {
  guardGenerateInProcess,
  guardRunInProcess,
  GUARD_GENERATE_STEPS,
  GUARD_RUN_STEPS,
  EstimateDeclined,
} from "@truecourse/core/commands/guard-in-process";
import { composeGuardStatus, orderGuardDrifts, guardDriverIds } from "@truecourse/shared";
import { registerProject } from "@truecourse/core/config/registry";
import { createStdoutStepRenderer } from "../lib/stdout-step-renderer.js";
import { requireGitRepo } from "./git-guard.js";
import { preflightClaudeOrExit } from "../lib/claude-preflight.js";
import { promptLlmEstimate } from "./llm-prompt.js";

export interface RunGuardRunOptions {
  cwd?: string;
  /** Restrict the run to a single scenario id (`--scenario`). */
  scenario?: string;
}

const MARK: Record<GuardScenarioResult["outcome"], string> = {
  pass: "✓",
  fail: "✗",
  error: "⚠",
  stale: "~",
  orphaned: "○",
};

export async function runGuardRun(opts: RunGuardRunOptions = {}): Promise<void> {
  const repoRoot = opts.cwd ?? process.cwd();
  p.intro("Guard");
  await requireGitRepo(repoRoot);

  const renderer = createStdoutStepRenderer();
  const tracker = new StepTracker(renderer.onProgress, GUARD_RUN_STEPS.map((s) => ({ ...s })));
  const result = await guardRunInProcess(repoRoot, { scenario: opts.scenario, tracker });
  renderer.dispose();

  switch (result.status) {
    case "no-recipe":
      p.log.error("No .truecourse/scenarios/recipe.json found. Add a recipe describing how to build and invoke the entrypoint.");
      p.outro("Aborted.");
      process.exit(1);
      return;
    case "invalid-recipe":
      p.log.error(`recipe.json is invalid: ${result.message}`);
      p.outro("Aborted.");
      process.exit(1);
      return;
    case "no-scenarios": {
      if (result.requestedId) {
        p.log.error(`No scenario with id "${result.requestedId}".`);
      } else {
        p.log.info("No scenarios found under .truecourse/scenarios/.");
      }
      printLoadErrors(result.loadErrors);
      p.outro("Nothing ran.");
      process.exit(result.requestedId || result.loadErrors.length > 0 ? 1 : 0);
      return;
    }
    case "build-failed": {
      p.log.error(`Build failed (\`${result.build.command}\`)${result.build.timedOut ? " — timed out" : ""}.`);
      const tail = result.build.output.trimEnd().split("\n").slice(-15);
      for (const line of tail) console.log(`  ${line}`);
      printLoadErrors(result.loadErrors);
      p.outro("Aborted — no scenarios ran.");
      process.exit(1);
      return;
    }
    case "entry-preflight-failed": {
      // The build succeeded but the entry can't start — ONE loud error with the FULL
      // (untruncated) startup stderr, never N identical scenario failures.
      p.log.error(`The recipe entry \`${result.preflight.entry}\` failed to start — every scenario would fail identically.`);
      for (const line of result.preflight.stderr.trimEnd().split("\n")) console.log(`  ${line}`);
      p.log.step(`Rebuild it with \`${result.buildCommand}\` (its build output is likely stale or incomplete), then re-run \`truecourse guard run\`.`);
      printLoadErrors(result.loadErrors);
      p.outro("Aborted — the entry could not start; no scenarios ran.");
      process.exit(1);
      return;
    }
    case "ok":
      break;
  }

  const { latest, loadErrors, manifest } = result;

  for (const s of latest.scenarios) {
    const suffix =
      s.outcome === "stale" || s.outcome === "orphaned"
        ? `  — ${BINDING_REASON[s.outcome]}`
        : `  (${Math.round(s.durationMs)}ms)`;
    p.log.message(`${MARK[s.outcome]} ${s.id} — ${s.title}${suffix}`);
  }

  const failing = latest.scenarios.filter((s) => s.outcome === "fail" || s.outcome === "error");
  if (failing.length > 0) {
    p.log.message("");
    for (const s of failing) {
      p.log.message(`${MARK[s.outcome]} ${s.id}`);
      if (s.failure) {
        p.log.message(`    step ${s.failure.step}`);
        p.log.message(`    expected: ${s.failure.expected}`);
        p.log.message(`    actual:   ${s.failure.actual}`);
      }
      if (s.evidencePath) p.log.message(`    evidence: ${s.evidencePath}`);
    }
  }

  printLoadErrors(loadErrors);
  if (manifest) p.log.info(`manifest: ${manifest.sections.length} section${manifest.sections.length === 1 ? "" : "s"} recorded`);

  const { pass, fail, error, stale, orphaned } = latest.summary;
  const parts = [`${pass} passed`];
  if (fail > 0) parts.push(`${fail} failed`);
  if (error > 0) parts.push(`${error} errored`);
  if (stale > 0) parts.push(`${stale} stale`);
  if (orphaned > 0) parts.push(`${orphaned} orphaned`);
  if (loadErrors.length > 0) parts.push(`${loadErrors.length} unloadable`);

  const bad = fail > 0 || error > 0 || stale > 0 || orphaned > 0 || loadErrors.length > 0;
  if (bad) {
    p.log.error(parts.join(" · "));
    p.outro("Guard found drift.");
    process.exit(1);
  }
  p.log.success(parts.join(" · "));
  p.outro("All sections guarded.");
}

// ---------------------------------------------------------------------------
// `truecourse guard generate` — the LLM pipeline (classify → generate → birth).
// ---------------------------------------------------------------------------

export interface RunGuardGenerateOptions {
  cwd?: string;
  /** Skip the pre-flight cost-estimate confirm (`-y` / `--yes`). */
  yes?: boolean;
  /** LLM transport: `cli` (default, spawn `claude -p`) or `agent` (mailbox under `io`). */
  llmTransport?: "cli" | "agent";
  /** I/O dir for the `agent` transport's request/response mailbox. */
  io?: string;
}

/**
 * Author scenarios from spec sections. Birth findings (a scenario that failed
 * against current code — a generation defect OR real existing drift) are surfaced
 * as work to review, NOT a failure: they're the user's call to resolve, so the
 * command exits 0 with them listed. Only a hard failure (no docs, recipe
 * discovery failed) exits non-zero.
 */
export async function runGuardGenerate(opts: RunGuardGenerateOptions = {}): Promise<void> {
  const repoRoot = opts.cwd ?? process.cwd();
  p.intro("Guard generate");
  await requireGitRepo(repoRoot);
  await registerProject(repoRoot);

  if (opts.llmTransport === "agent" && !opts.io) {
    p.log.error("--llm-transport agent requires --io <dir> (the request/response mailbox directory).");
    p.outro("Aborted.");
    process.exit(1);
  }
  // Classification + generation shell out to `claude`; probe once up front (the
  // `agent` transport answers via the filesystem mailbox, so skip it there).
  if (opts.llmTransport !== "agent") await preflightClaudeOrExit();

  const autoApprove = !!opts.yes || opts.llmTransport === "agent";
  const renderer = createStdoutStepRenderer();
  const tracker = new StepTracker(renderer.onProgress, GUARD_GENERATE_STEPS.map((s) => ({ ...s })));
  let guard;
  try {
    ({ guard } = await guardGenerateInProcess(repoRoot, {
      tracker,
      llm: opts.llmTransport,
      io: opts.io,
      onLlmEstimate: (est) => promptLlmEstimate(est, { autoApprove, nouns: { verb: "Generate" } }),
    }));
  } catch (e: unknown) {
    renderer.dispose();
    if (e instanceof EstimateDeclined) {
      p.cancel("Generate cancelled.");
      process.exit(0);
    }
    // Presentation boundary: any residual unexpected error renders cleanly, never
    // a raw stack trace. The engine keeps its rethrow semantics upstream.
    p.log.error(`Guard generate failed: ${(e as Error).message}`);
    p.outro("Aborted.");
    process.exit(1);
  }
  renderer.dispose();

  if (guard.status === "no-docs") {
    p.log.error(guard.reason ?? "No spec docs to guard.");
    p.outro("Run `truecourse spec scan` first.");
    process.exit(1);
  }
  if (guard.status === "recipe-failed") {
    p.log.error(`Recipe discovery failed: ${guard.reason}`);
    p.outro("Add or fix `.truecourse/scenarios/recipe.json` and retry.");
    process.exit(1);
  }

  // The built entry couldn't start — birth validation never ran, so every changed
  // section stayed unsettled. ONE loud error with the FULL startup stderr (also
  // recorded in guard/result.json errors); a rebuild + re-run picks up where it left
  // off (authoring is cached).
  if (guard.entryPreflight) {
    p.log.error(`The recipe entry \`${guard.entryPreflight.entry}\` failed to start — every scenario would fail identically, so nothing was validated.`);
    for (const line of guard.entryPreflight.stderr.trimEnd().split("\n")) console.log(`  ${line}`);
    p.log.step(`Rebuild it with \`${guard.entryPreflight.buildCommand}\` (its build output is likely stale or incomplete), then re-run \`truecourse guard generate\`.`);
    p.outro("Aborted — the entry could not start; no scenarios were validated.");
    process.exit(1);
  }

  if (guard.recipe?.status === "discovered") {
    p.log.step(`recipe      wrote ${guard.recipe.wrotePath} — review and commit it`);
  }

  if (guard.noChanges) {
    p.log.success("Nothing changed — every section is already guarded since the last generate.");
    p.outro("Done.");
    return;
  }

  // The generate persisted its report at the end (usage + generatedAt); read it
  // back so the summary reuses the exact `guard status` composition. Fall back to
  // the in-memory result if the file is somehow absent.
  const report: GuardGenerateReport = readGuardResult(repoRoot) ?? { ...guard, generatedAt: new Date().toISOString() };
  printGuardGenerateSummary(report, path.relative(repoRoot, guardResultPath(repoRoot)));

  if (guard.written.length === 0 && guard.birthFindings.length === 0 && guard.errors.length === 0) {
    p.outro("No scenarios written.");
    return;
  }
  if (guard.written.length > 0) {
    p.log.success(`Wrote ${guard.written.length} scenario file${guard.written.length === 1 ? "" : "s"} to .truecourse/scenarios/.`);
  }
  p.outro("Review + commit the scenarios, then `truecourse guard run`.");
}

/**
 * The closing summary for `guard generate` — a compact counts block, the top few
 * birth findings and authoring errors as one-liners, and pointers to the detail
 * surfaces. Reuses the `guard status` summary composition so the terminal and the
 * store never tell different stories; the full detail (expected/actual/evidence)
 * lives in `guard/result.json`, `guard drifts`, and `guard status`.
 */
export function printGuardGenerateSummary(report: GuardGenerateReport, reportPath: string): void {
  const g = composeGuardStatus(null, null, report).lastGenerate!;

  // Changed sections split into settled (recorded) and unsettled (re-attempt next
  // run — a birth finding or an authoring error). Extraction failures re-attempt
  // whole docs and are surfaced on their own line below.
  const unsettled = new Set<string>();
  for (const f of report.birthFindings) unsettled.add(`${f.doc}\0${f.anchor}`);
  for (const e of report.errors) unsettled.add(`${e.doc}\0${e.anchor}`);
  const settled = Math.max(0, report.sectionsChanged - unsettled.size);

  p.log.step(`sections    ${report.sectionsChanged} changed · ${settled} settled · ${unsettled.size} unsettled · ${report.skippedUnchanged} unchanged`);
  const birth = g.birthPassed !== null ? ` · ${g.birthPassed} passed birth` : "";
  p.log.step(`scenarios   ${g.written} written${birth}`);
  // Ready-but-held: birth-passed scenarios an unsettled sibling withheld — validated
  // work that would otherwise vanish into the authoring cache. Only when any exist.
  if (g.readyButHeld > 0) {
    p.log.step(
      `held        ${g.readyButHeld} ready but held (${g.heldByFindings} finding${g.heldByFindings === 1 ? "" : "s"} · ${g.heldByErrors} error${g.heldByErrors === 1 ? "" : "s"})`,
    );
  }

  const gapTotal = Object.values(g.coverageGapsByKind).reduce((a, b) => a + b, 0);
  if (gapTotal > 0) {
    const kinds = Object.entries(g.coverageGapsByKind)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => (k === "blocked-on" ? `${n} blocked-on${blockedOnBreakdown(g.blockedOnCapabilities)}` : `${n} ${k}`));
    p.log.step(`gaps        ${gapTotal} not guarded (${kinds.join(", ")})`);
  }
  if (report.orphaned.length > 0) {
    p.log.step(`orphaned    ${report.orphaned.length} section${report.orphaned.length === 1 ? "" : "s"} — bound but gone; scenarios kept`);
  }
  if (report.extractionFailures.length > 0) {
    p.log.step(`extraction  ${report.extractionFailures.length} document${report.extractionFailures.length === 1 ? "" : "s"} failed — re-run to retry`);
  }
  // Orphan honesty (item 20): a dismissal whose claim text no longer matches any
  // live claim in a re-read doc — surfaced so it is never silently honored forever.
  if (report.orphanedDismissals && report.orphanedDismissals.length > 0) {
    const n = report.orphanedDismissals.length;
    p.log.step(`dismissals  ${n} orphaned — the dismissed claim no longer exists; re-dismiss the new text or drop it from decisions.json`);
  }
  if (g.birthFindings > 0) p.log.step(`findings    ${g.birthFindings} birth finding${g.birthFindings === 1 ? "" : "s"}`);
  if (g.errors > 0) p.log.step(`errors      ${g.errors} authoring error${g.errors === 1 ? "" : "s"}`);
  if (g.usage) p.log.step(`cost        ${g.usage.calls} call${g.usage.calls === 1 ? "" : "s"} · $${g.usage.costUsd.toFixed(2)}`);

  // Top 3 birth findings, one line each (title + section leaf). The rest live in
  // the store surfaces — the terminal is for the story, not the dump.
  if (report.birthFindings.length > 0) {
    p.log.warn(`Top birth finding${report.birthFindings.length === 1 ? "" : "s"} (generation defect or real drift — your call):`);
    for (const f of report.birthFindings.slice(0, 3)) p.log.message(`✗ ${f.title} — ${sectionLeaf(f.anchor)}`);
    const more = report.birthFindings.length - 3;
    if (more > 0) p.log.message(`… and ${more} more — see \`truecourse guard drifts\``);
  }

  if (report.errors.length > 0) {
    p.log.warn(`Top authoring error${report.errors.length === 1 ? "" : "s"}:`);
    for (const e of report.errors.slice(0, 3)) p.log.message(`• ${sectionLeaf(e.anchor)}: ${oneLine(e.message)}`);
    const more = report.errors.length - 3;
    if (more > 0) p.log.message(`… and ${more} more — see the report`);
  }

  // Pointers — the surfaces hold the detail the terminal no longer dumps.
  p.log.info(
    [
      "`truecourse guard drifts`  — inspect failures",
      "`truecourse guard status`  — coverage",
      `report: ${reportPath}`,
    ].join("\n"),
  );
}

/** The trailing heading of a section anchor (`cli/version` → `version`). */
function sectionLeaf(anchor: string): string {
  return anchor.split("/").pop() || anchor;
}

/** Collapse whitespace and clip an error message to one readable line. */
function oneLine(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 100 ? `${t.slice(0, 100)}…` : t;
}

// ---------------------------------------------------------------------------
// `truecourse guard status` — a compact, deterministic, LLM-free summary read
// from three store files (manifest / LATEST / result). Thin printer over the
// pure `composeGuardStatus` composition in core.
// ---------------------------------------------------------------------------

export interface RunGuardStatusOptions {
  cwd?: string;
}

export async function runGuardStatus(opts: RunGuardStatusOptions = {}): Promise<void> {
  const repoRoot = opts.cwd ?? process.cwd();
  p.intro("Guard status");

  const summary = composeGuardStatus(
    readManifest(repoRoot),
    readGuardLatest(repoRoot),
    readGuardResult(repoRoot),
  );

  // Coverage — scenarios/manifest.json.
  if (!summary.coverage) {
    p.log.info("coverage    (none) — run `truecourse guard generate`");
  } else {
    const c = summary.coverage;
    p.log.step(`coverage    ${c.withScenarios}/${c.totalSections} section${c.totalSections === 1 ? "" : "s"} guarded`);
    const cl = c.classification;
    const parts = [...guardDriverIds.map((d) => `${d} ${cl[d]}`), `untestable ${cl.untestable}`];
    if (cl.unclassified > 0) parts.push(`unclassified ${cl.unclassified}`);
    p.log.message(`    ${parts.join(" · ")}`);
  }

  // Last run — guard/LATEST.json.
  if (!summary.lastRun) {
    p.log.info("last run    (none) — run `truecourse guard run`");
  } else {
    const r = summary.lastRun;
    const ref = [r.branch, r.commit ? r.commit.slice(0, 8) : null].filter(Boolean).join(" @ ");
    p.log.step(`last run    ${r.ranAt}${ref ? ` · ${ref}` : ""}`);
    const s = r.summary;
    const parts = [`${MARK.pass} ${s.pass} pass`];
    if (s.fail > 0) parts.push(`${MARK.fail} ${s.fail} fail`);
    if (s.error > 0) parts.push(`${MARK.error} ${s.error} error`);
    if (s.stale > 0) parts.push(`${MARK.stale} ${s.stale} stale`);
    if (s.orphaned > 0) parts.push(`${MARK.orphaned} ${s.orphaned} orphaned`);
    p.log.message(`    ${parts.join(" · ")}`);
  }

  // Last generate — guard/result.json.
  if (!summary.lastGenerate) {
    p.log.info("last gen    (none) — run `truecourse guard generate`");
  } else {
    const g = summary.lastGenerate;
    if (g.noChanges) {
      p.log.step(`last gen    ${g.generatedAt} · nothing changed`);
    } else if (g.status !== "ok") {
      p.log.step(`last gen    ${g.generatedAt} · ${g.status}`);
    } else {
      const birth = g.birthPassed !== null ? ` · ${g.birthPassed} passed birth` : "";
      p.log.step(`last gen    ${g.generatedAt} · ${g.written} written${birth}`);
      const gapTotal = Object.values(g.coverageGapsByKind).reduce((a, b) => a + b, 0);
      const detail: string[] = [];
      if (gapTotal > 0) {
        const kinds = Object.entries(g.coverageGapsByKind)
          .filter(([, n]) => n > 0)
          .map(([k, n]) => (k === "blocked-on" ? `${n} blocked-on${blockedOnBreakdown(g.blockedOnCapabilities)}` : `${n} ${k}`));
        detail.push(`${gapTotal} gap${gapTotal === 1 ? "" : "s"} (${kinds.join(", ")})`);
      }
      if (g.readyButHeld > 0) detail.push(`${g.readyButHeld} ready but held`);
      if (g.birthFindings > 0) detail.push(`${g.birthFindings} birth finding${g.birthFindings === 1 ? "" : "s"}`);
      if (g.errors > 0) detail.push(`${g.errors} error${g.errors === 1 ? "" : "s"}`);
      if (detail.length > 0) p.log.message(`    ${detail.join(" · ")}`);
      if (g.usage) p.log.message(`    ${g.usage.calls} call${g.usage.calls === 1 ? "" : "s"} · $${g.usage.costUsd.toFixed(2)}`);
    }
  }

  if (!summary.coverage && !summary.lastRun && !summary.lastGenerate) {
    p.outro("No guard data yet. Run `truecourse guard generate`, then `truecourse guard run`.");
    return;
  }
  p.outro("Guard status.");
}

// ---------------------------------------------------------------------------
// `truecourse guard drifts` — the current run's non-pass scenarios, most severe
// first. Informational (always exits 0); `guard run` is the gate. Mirrors the
// `drifts list` UX (pagination flags, `--json`, empty-state pointer).
// ---------------------------------------------------------------------------

export interface RunGuardDriftsOptions {
  cwd?: string;
  /** Page size. Pass Infinity (via `--all`) to show every drift. */
  limit?: number;
  offset?: number;
  /** Emit machine-readable JSON instead of the formatted list. */
  json?: boolean;
}

export async function runGuardDrifts(opts: RunGuardDriftsOptions = {}): Promise<void> {
  const repoRoot = opts.cwd ?? process.cwd();
  const latest = readGuardLatest(repoRoot);
  const drifts = orderGuardDrifts(latest?.scenarios);

  if (opts.json) {
    const payload = {
      total: drifts.length,
      drifts: drifts.map((d) => ({
        id: d.id,
        title: d.title,
        outcome: d.outcome,
        doc: d.binds.doc,
        section: d.binds.section,
        ...(d.failure ? { failure: d.failure } : {}),
        ...(d.evidencePath ? { evidencePath: d.evidencePath } : {}),
      })),
    };
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  p.intro("Guard drifts");

  if (!latest) {
    p.log.info("No guard run yet. Run `truecourse guard run` first.");
    p.outro("Nothing to show.");
    return;
  }

  if (drifts.length === 0) {
    p.log.success("No drift — every guarded section passed.");
    p.outro("Nothing to show.");
    return;
  }

  const total = drifts.length;
  const offset = Math.max(0, opts.offset ?? 0);
  const limit = opts.limit ?? 20;
  const end = isFinite(limit) ? offset + limit : total;
  const page = drifts.slice(offset, end);

  p.log.message("");
  p.log.message("Drifts:");
  for (const d of page) {
    p.log.message(`  ${MARK[d.outcome]} [${d.outcome}] ${d.id} — ${d.title}`);
    p.log.message(`      ${d.binds.doc} › ${d.binds.section}`);
    if (d.outcome === "fail" && d.failure) {
      p.log.message(`      step ${d.failure.step} · expected ${d.failure.expected} · actual ${d.failure.actual}`);
    }
    if (d.evidencePath) p.log.message(`      evidence: ${d.evidencePath}`);
  }

  const shownFrom = offset + 1;
  const shownTo = offset + page.length;
  const remaining = total - shownTo;
  if (remaining > 0) {
    p.log.message("");
    p.log.message(
      `  … ${remaining} more — \`truecourse guard drifts --offset ${shownTo}\` (or \`--all\`)`,
    );
  }

  p.outro(`Showing ${shownFrom}–${shownTo} of ${total} drift${total === 1 ? "" : "s"}.`);
}

/** ` (git 9, db 3, … 12 more)` — top blocked-on capabilities; the full tally lives
 *  in the report/`guard status`, the terminal shows the story. */
function blockedOnBreakdown(byCapability: Record<string, number>): string {
  const parts = Object.entries(byCapability)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([cap, n]) => `${cap} ${n}`);
  if (parts.length === 0) return "";
  const TOP = 5;
  const shown = parts.slice(0, TOP);
  const rest = parts.length - shown.length;
  return ` (${shown.join(", ")}${rest > 0 ? `, … ${rest} more` : ""})`;
}

/** One-line reason for the binding outcomes that skip execution. */
const BINDING_REASON: Record<"stale" | "orphaned", string> = {
  stale: "section edited since binding",
  orphaned: "section not found",
};

function printLoadErrors(loadErrors: { file: string; message: string }[]): void {
  if (loadErrors.length === 0) return;
  p.log.warn(`${loadErrors.length} scenario file${loadErrors.length === 1 ? "" : "s"} could not be loaded:`);
  for (const e of loadErrors) console.log(`  ${e.file}: ${e.message}`);
}
