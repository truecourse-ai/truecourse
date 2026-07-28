/**
 * `truecourse guard run` — build the entrypoint via the recipe, run the committed
 * scenarios in parallel sandboxes, stream non-pass results as they settle, and
 * write `.truecourse/guard/LATEST.json`. Passes stay in the live counter and the
 * closing counts (`--verbose` lists every scenario). Deterministic and LLM-free:
 * no `claude` preflight, no cost estimate. Unlike `verify`, it exits non-zero on any
 * non-pass outcome — fail, error, stale, or orphaned — so it works as a CI drift
 * gate: code drift (fail), infra trouble (error), and spec-side drift
 * (stale/orphaned) all break the build.
 */

import path from "node:path";
import * as p from "@clack/prompts";
import { guardResultPath, runFailureMessage } from "@truecourse/guard-runner";
import { readFlowsFile } from "@truecourse/guard-generator";
import { readManifest, readGuardLatest, readGuardResult } from "@truecourse/core/lib/guard-store";
import { readGuardExternalsView } from "@truecourse/core/commands/guard-externals";
import type {
  GuardBirthFinding,
  GuardFlow,
  GuardLastGenerateSummary,
  GuardScenarioResult,
  GuardGenerateReport,
} from "@truecourse/shared";
import { StepTracker } from "@truecourse/core/progress";
import {
  guardGenerateInProcess,
  guardRunInProcess,
  GUARD_GENERATE_STEPS,
  GUARD_RUN_STEPS,
  EstimateDeclined,
  OpenConflictsError,
} from "@truecourse/core/commands/guard-in-process";
import {
  composeGuardStatus,
  orderGuardDrifts,
  guardDriverIds,
  guardGapDisplayLabel,
  isCompositionFinding,
} from "@truecourse/shared";
import { registerProject } from "@truecourse/core/config/registry";
import { createStdoutStepRenderer } from "../lib/stdout-step-renderer.js";
import { clip, flowInstanceLine } from "../lib/guard-flow-format.js";
import { requireGitRepo } from "./git-guard.js";
import { preflightClaudeOrExit } from "../lib/claude-preflight.js";
import { promptLlmEstimate } from "./llm-prompt.js";

export interface RunGuardRunOptions {
  cwd?: string;
  /** Restrict the run to a single scenario id (`--scenario`). */
  scenario?: string;
  /** List every scenario (one ✓ line per pass) after the run (`--verbose`). */
  verbose?: boolean;
}

const MARK: Record<GuardScenarioResult["outcome"], string> = {
  pass: "✓",
  fail: "✗",
  error: "⚠",
  stale: "~",
  orphaned: "○",
};

/** One line per scenario result: severity icon, id, title, reason/duration. */
function scenarioLine(s: GuardScenarioResult): string {
  const suffix =
    s.outcome === "stale" || s.outcome === "orphaned"
      ? `  — ${BINDING_REASON[s.outcome]}`
      : `  (${Math.round(s.durationMs)}ms)`;
  return `${MARK[s.outcome]} ${s.id} — ${s.title}${suffix}`;
}

/**
 * What a failing scenario prints UNDER its result line: the flow instance —
 * `create ✓ ── listed ✓ ── complete ✗ ── done filter · not reached` — projecting
 * the failing step's milestone onto its flow's path, the same paint the Runs tab
 * renders. A failure the path can't place (plumbing step, hand-written scenario,
 * a flow the corpus no longer has) falls back to the step line. The annotations
 * ride one extra line each — never outcomes: a blocked precondition (the failing
 * step only prepared the world, so no specified behavior was reached) and journey
 * drift (a re-ground hint).
 */
export function failureDetailLines(
  s: GuardScenarioResult,
  flowsById: Map<string, GuardFlow>,
): string[] {
  const lines: string[] = [];
  const flow = s.flowId ? flowsById.get(s.flowId) : undefined;
  const instance = flow ? flowInstanceLine(flow.milestones, s.failedMilestone) : null;
  if (instance) lines.push(`    ${instance}`);
  else if (s.failure) lines.push(`    failed at step ${s.failure.step}`);
  if (s.blockedPrecondition) {
    lines.push(
      "    ⊘ blocked precondition — a setup step failed before any specified behavior was reached",
    );
  }
  if (s.journeyDrifted) {
    lines.push("    ⟳ journey drifted — the code surface this was grounded on moved; re-generate to re-ground");
  }
  return lines;
}

export async function runGuardRun(opts: RunGuardRunOptions = {}): Promise<void> {
  const repoRoot = opts.cwd ?? process.cwd();
  p.intro("Guard");
  await requireGitRepo(repoRoot);

  const renderer = createStdoutStepRenderer();
  const tracker = new StepTracker(renderer.onProgress, GUARD_RUN_STEPS.map((s) => ({ ...s })));
  // The flow corpus is what turns a failing step into a milestone path; absent
  // (never generated, hand-written corpus) the failure prints its step instead.
  const flowsById = new Map((readFlowsFile(repoRoot)?.flows ?? []).map((f) => [f.id, f]));
  const result = await guardRunInProcess(repoRoot, {
    scenario: opts.scenario,
    tracker,
    // Non-pass results surface the moment they settle — a full line each,
    // printed above the live counter so they are never buried under pass
    // output. Passes ride the counter only (`--verbose` lists them at the end).
    onScenarioResult: (s) => {
      if (s.outcome === "pass") return;
      renderer.log(scenarioLine(s));
      for (const line of failureDetailLines(s, flowsById)) renderer.log(line);
    },
  });
  renderer.dispose();

  switch (result.status) {
    case "no-recipe":
    case "invalid-recipe":
    case "missing-credential-env":
    case "missing-external-env":
    case "seed-failed":
    case "credential-request-failed":
      p.log.error(runFailureMessage(result));
      p.outro("Aborted.");
      process.exit(1);
      return;
    case "no-scenarios": {
      if (result.requestedId) {
        p.log.error(runFailureMessage(result));
      } else {
        p.log.info(runFailureMessage(result));
      }
      printLoadErrors(result.loadErrors);
      p.outro("Nothing ran.");
      process.exit(result.requestedId || result.loadErrors.length > 0 ? 1 : 0);
      return;
    }
    case "build-failed": {
      p.log.error(runFailureMessage(result));
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
      p.log.error(runFailureMessage(result));
      printLoadErrors(result.loadErrors);
      p.outro("Aborted — the entry could not start; no scenarios ran.");
      process.exit(1);
      return;
    }
    case "run-timed-out":
    case "aborted":
      p.log.error(runFailureMessage(result));
      p.outro("Aborted.");
      process.exit(1);
      return;
    case "ok":
      break;
  }

  const { latest, loadErrors, manifest } = result;

  // `--verbose` restores the full per-scenario listing (one ✓ line per pass);
  // by default passes stay in the live counter and only the summary tells the story.
  if (opts.verbose) {
    for (const s of latest.scenarios) p.log.message(scenarioLine(s));
  }

  printLoadErrors(loadErrors);
  // The run is flow-led: how much of the recorded flow corpus this run exercised,
  // and how many of those flows came back with drift.
  if (manifest) {
    const exercised = new Set(latest.scenarios.map((s) => s.flowId).filter(Boolean));
    const drifted = new Set(
      latest.scenarios.filter((s) => s.outcome !== "pass").map((s) => s.flowId).filter(Boolean),
    );
    const driftTag = drifted.size > 0 ? ` · ${drifted.size} with drift` : "";
    p.log.info(`flows       ${exercised.size}/${manifest.flows.length} exercised${driftTag}`);
  }

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
    // Pointers — the failure detail (step/expected/actual/evidence) lives in
    // the drift surfaces, mirroring the generate close.
    p.log.info(
      [
        "`truecourse guard drifts`  — inspect failures (expected/actual/evidence)",
        "`truecourse guard status`  — coverage",
      ].join("\n"),
    );
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
  // The ceiling the gate quoted, kept so the summary can print spend against it.
  let estimatedCostUsd: number | undefined;
  let guard;
  try {
    ({ guard } = await guardGenerateInProcess(repoRoot, {
      tracker,
      llm: opts.llmTransport,
      io: opts.io,
      onLlmEstimate: (est) => {
        estimatedCostUsd = est.estimatedCostUsd;
        return promptLlmEstimate(est, { autoApprove, nouns: { verb: "Generate" } });
      },
    }));
  } catch (e: unknown) {
    renderer.dispose();
    if (e instanceof EstimateDeclined) {
      p.cancel("Generate cancelled.");
      process.exit(0);
    }
    // Open spec conflicts block generate before any spend — print the FULL list
    // (area, both repo-relative paths, note) and the resolution pointers, exit 1.
    if (e instanceof OpenConflictsError) {
      p.log.error(`${e.conflicts.length} open spec conflict${e.conflicts.length === 1 ? "" : "s"} block guard generate — resolve them first:`);
      for (const c of e.conflicts) {
        p.log.message(`  ${c.area}`);
        p.log.message(`    ${c.a}  ↔  ${c.b}${c.note ? `   · ${c.note}` : ""}`);
      }
      p.log.step("Resolve with `truecourse spec conflicts list` (or the dashboard Conflicts group), then re-run `truecourse guard generate`.");
      p.outro("Aborted — resolve the conflicts first.");
      process.exit(1);
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
    // Both a discovery/verification failure and a recipe VALIDATION failure (an
    // unresolvable credential `satisfies`) land here — the reason carries which.
    p.log.error(`Recipe unusable: ${guard.reason}`);
    p.outro("Add or fix `.truecourse/scenarios/recipe.json` and retry.");
    process.exit(1);
  }

  // Advisory recipe diagnostics — printed before the summary, whether the recipe was
  // discovered this run or already existed. Never a stop.
  if (guard.recipe?.warnings && guard.recipe.warnings.length > 0) {
    for (const warning of guard.recipe.warnings) p.log.warn(warning);
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
    const how =
      guard.recipe.source === "deterministic"
        ? " (derived from the repo's own manifests — no LLM call)"
        : guard.recipe.source === "llm"
          ? " (proposed by the model, verified by the engine)"
          : "";
    p.log.step(`recipe      wrote ${guard.recipe.wrotePath}${how} — review and commit it`);
    // Non-interactive by design: what the proposer could NOT decide is PRINTED, so
    // an agent or a CI log carries the fill-in list. Never a fabricated secret.
    if (guard.recipe.todos && guard.recipe.todos.length > 0) {
      p.log.warn(`The recipe has ${guard.recipe.todos.length} TODO(s) before an api run can authenticate:`);
      for (const todo of guard.recipe.todos) console.log(`  • ${todo}`);
    }
  }

  if (guard.noChanges) {
    p.log.success("Nothing changed — every section is already guarded since the last generate.");
    p.outro("Done.");
    return;
  }

  // The generate persisted its report at the end (usage + generatedAt); read it
  // back so the summary reuses the exact `guard status` composition. Fall back to
  // the in-memory result if the file is somehow absent.
  const report: GuardGenerateReport = (await readGuardResult(repoRoot)) ?? { ...guard, generatedAt: new Date().toISOString() };
  printGuardGenerateSummary(report, path.relative(repoRoot, guardResultPath(repoRoot)), { estimatedCostUsd });

  if (guard.written.length === 0 && guard.birthFindings.length === 0 && guard.errors.length === 0) {
    p.outro("No tests written.");
    return;
  }
  if (guard.written.length > 0) {
    p.log.success(`Wrote ${guard.written.length} test file${guard.written.length === 1 ? "" : "s"} to .truecourse/scenarios/.`);
  }
  p.outro("Review + commit the tests, then `truecourse guard run`.");
}

export interface GuardGenerateSummaryOptions {
  /**
   * The ceiling the pre-flight estimate quoted, when this run went through the
   * gate — printed next to what the run actually spent so the trust rule ("never
   * a ceiling the bill can exceed") is visible in the terminal, not just in docs.
   */
  estimatedCostUsd?: number;
}

/**
 * The closing summary for `guard generate` — FLOW-LED, since the flow is the
 * generation unit: settled/unsettled flows, the scenarios they were realized as,
 * the gaps by kind, one line per top finding, spend against the estimate, and
 * pointers. Reuses the `guard status` summary composition so the terminal and the
 * store never tell different stories; the full detail (expected/actual/evidence)
 * lives in `guard/result.json`, `guard drifts`, and the dashboard.
 */
export function printGuardGenerateSummary(
  report: GuardGenerateReport,
  reportPath: string,
  opts: GuardGenerateSummaryOptions = {},
): void {
  const g = composeGuardStatus(null, null, report).lastGenerate!;

  if (report.flows) {
    const f = report.flows;
    const parts = [`${f.settled} settled`, `${f.unsettled} unsettled`];
    if (f.skipped > 0) parts.push(`${f.skipped} unchanged`);
    if (f.dismissed > 0) parts.push(`${f.dismissed} dismissed`);
    if (f.orphaned > 0) parts.push(`${f.orphaned} orphaned`);
    p.log.step(`flows       ${parts.join(" · ")}`);
  } else {
    // A report from before flow-keyed generation: fall back to the section split
    // it does carry (changed → settled/unsettled) rather than inventing flows.
    const unsettled = new Set<string>();
    for (const f of report.birthFindings) unsettled.add(`${f.doc} ${f.anchor}`);
    for (const e of report.errors) unsettled.add(`${e.doc} ${e.anchor}`);
    const settled = Math.max(0, report.sectionsChanged - unsettled.size);
    p.log.step(
      `sections    ${report.sectionsChanged} changed · ${settled} settled · ${unsettled.size} unsettled · ${report.skippedUnchanged} unchanged`,
    );
  }

  // Guard commits every authored test, so the headline is the test inventory: how
  // many landed, and how many of them are already red because the code disagrees.
  p.log.step(`tests       ${testsLine(g)}`);
  // Ready-but-held: birth-passed scenarios an unsettled sibling withheld. Flow-keyed
  // generation persists independently and never holds, so this only renders for the
  // older reports that recorded it.
  if (g.readyButHeld > 0) {
    p.log.step(
      `held        ${g.readyButHeld} ready but held (${g.heldByFindings} finding${g.heldByFindings === 1 ? "" : "s"} · ${g.heldByErrors} error${g.heldByErrors === 1 ? "" : "s"})`,
    );
  }

  const gapTotal = Object.values(g.coverageGapsByKind).reduce((a, b) => a + b, 0);
  if (gapTotal > 0) p.log.step(`gaps        ${gapTotal} (${gapBreakdown(g)})`);
  if (report.orphaned.length > 0) {
    p.log.step(`orphaned    ${report.orphaned.length} section${report.orphaned.length === 1 ? "" : "s"} — bound but gone; scenarios kept`);
  }
  if (report.extractionFailures.length > 0) {
    p.log.step(`extraction  ${report.extractionFailures.length} document${report.extractionFailures.length === 1 ? "" : "s"} failed — re-run to retry`);
  }
  // Orphan honesty (item 20): a dismissal whose claim text no longer matches any
  // live claim in a re-read doc — surfaced so it is never silently honored forever.
  const orphanedDismissals = (report.orphanedDismissals?.length ?? 0) + (report.orphanedFlowDismissals?.length ?? 0);
  if (orphanedDismissals > 0) {
    p.log.step(`dismissals  ${orphanedDismissals} orphaned — the dismissed claim/flow no longer exists; re-dismiss it or drop it from decisions.json`);
  }

  // The failing tests, ONE line each (top 3): a composition failure — the chain
  // broke mid-path, earlier milestones passed — is marked so "milestones don't
  // chain" never reads as ordinary doc-vs-code drift. They are COMMITTED, so this
  // block explains the `failing` count above; it never means work was withheld.
  const failing = report.birthFindings.filter((f) => f.kind !== "fidelity");
  if (failing.length > 0) {
    p.log.step(`failing     ${failing.length} — committed red; the code and the doc disagree`);
    for (const f of failing.slice(0, 3)) p.log.message(`  ${findingLine(f)}`);
    const more = failing.length - 3;
    if (more > 0) p.log.message(`  … and ${more} more — see \`truecourse guard drifts\``);
  }
  // Fidelity rejections are the one verdict that still withholds a test: the
  // scenario itself was judged wrong, so it is re-authored next generate.
  if (g.fidelityRejections > 0) {
    p.log.step(`rejected    ${g.fidelityRejections} by fidelity review — re-authored next generate`);
    for (const f of report.birthFindings.filter((x) => x.kind === "fidelity").slice(0, 3)) {
      p.log.message(`  ${findingLine(f)}`);
    }
  }

  if (report.errors.length > 0) {
    p.log.step(`errors      ${g.errors} authoring error${g.errors === 1 ? "" : "s"}`);
    for (const e of report.errors.slice(0, 3)) p.log.message(`  • ${sectionLeaf(e.anchor)}: ${clip(e.message, 100)}`);
    const more = report.errors.length - 3;
    if (more > 0) p.log.message(`  … and ${more} more — see the report`);
  }

  if (g.usage) {
    const ceiling = opts.estimatedCostUsd != null ? ` (≤ $${opts.estimatedCostUsd.toFixed(2)} estimated)` : "";
    p.log.step(`usage       ${g.usage.calls} call${g.usage.calls === 1 ? "" : "s"} · $${g.usage.costUsd.toFixed(2)}${ceiling}`);
  }

  // Pointers — the surfaces hold the detail the terminal no longer dumps.
  const focusFlow = report.birthFindings.find((f) => f.flowId)?.flowId;
  p.log.info(
    [
      "next  `truecourse guard run`",
      focusFlow ? `      \`truecourse guard flows --show ${focusFlow}\`` : "      `truecourse guard flows`",
      "      `truecourse guard drifts`  — inspect failures",
      `      report: ${reportPath}`,
    ].join("\n"),
  );
}

/**
 * `12 written · 10 passing · 2 failing (birth)` — the committed test inventory.
 * A failing test is committed like any other; "(birth)" says the stage that judged
 * it, never that it was withheld. The failing half is dropped when there is none.
 */
function testsLine(g: GuardLastGenerateSummary): string {
  const parts = [`${g.written} written`, `${g.testsPassing} passing`];
  if (g.testsFailing > 0) parts.push(`${g.testsFailing} failing (birth)`);
  return parts.join(" · ");
}

/** `1 no journey · 1 awaiting web driver · 2 blocked-on (git 2)` — gaps by display kind. */
function gapBreakdown(g: { coverageGapsByKind: Record<string, number>; blockedOnCapabilities: Record<string, number> }): string {
  return Object.entries(g.coverageGapsByKind)
    .filter(([, n]) => n > 0)
    .map(([kind, n]) =>
      kind === "blocked-on"
        ? `${n} blocked-on${blockedOnBreakdown(g.blockedOnCapabilities)}`
        : `${n} ${guardGapDisplayLabel(kind as Parameters<typeof guardGapDisplayLabel>[0])}`,
    )
    .join(" · ");
}

/**
 * One finding, one line. A COMPOSITION finding (the milestone chain broke
 * mid-path) leads with `▲` and names the milestone that broke plus what the run
 * saw; every other finding names the flow surface and the claim it asserted.
 */
function findingLine(f: GuardBirthFinding): string {
  const subject = f.flowId ? `${f.flowId}${f.surface ? ` · ${f.surface}` : ""}` : sectionLeaf(f.anchor);
  if (isCompositionFinding(f)) {
    return `▲ ${subject} · milestone ${f.failedMilestone}: ${clip(f.actual, 70)}`;
  }
  const kind = f.kind === "fidelity" ? "fidelity" : "birth";
  return `✗ ${subject} · ${kind}: ${clip(f.title, 70)}`;
}

/** The trailing heading of a section anchor (`cli/version` → `version`). */
function sectionLeaf(anchor: string): string {
  return anchor.split("/").pop() || anchor;
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
    await readManifest(repoRoot),
    await readGuardLatest(repoRoot),
    await readGuardResult(repoRoot),
  );

  // Coverage — scenarios/manifest.json. Sections stay the coverage pivot, but the
  // unit that guards them is the FLOW, so the count says which it went through.
  if (!summary.coverage) {
    p.log.info("coverage    (none) — run `truecourse guard generate`");
  } else {
    const c = summary.coverage;
    const via = ` (via ${c.flows.total} flow${c.flows.total === 1 ? "" : "s"})`;
    p.log.step(`coverage    ${c.withScenarios}/${c.totalSections} section${c.totalSections === 1 ? "" : "s"} guarded${via}`);
    const cl = c.classification;
    const parts = [...guardDriverIds.map((d) => `${d} ${cl[d]}`), `untestable ${cl.untestable}`];
    if (cl.unclassified > 0) parts.push(`unclassified ${cl.unclassified}`);
    p.log.message(`    ${parts.join(" · ")}`);

    // The flows line — guarded / partly guarded / nothing realized, with the gap
    // labels behind the incomplete ones so "why" needs no second command.
    const f = c.flows;
    const flowParts = [`${f.total} total`, `${f.guarded} guarded`];
    if (f.partial > 0) flowParts.push(`${f.partial} partial`);
    if (f.blocked > 0) flowParts.push(`${f.blocked} blocked`);
    const why = f.gapLabels.length > 0 ? ` (${f.gapLabels.join(" · ")})` : "";
    p.log.step(`flows       ${flowParts.join(" · ")}${why}`);
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
      p.log.step(`last gen    ${g.generatedAt} · ${testsLine(g)}`);
      const gapTotal = Object.values(g.coverageGapsByKind).reduce((a, b) => a + b, 0);
      const detail: string[] = [];
      if (gapTotal > 0) {
        const kinds = Object.entries(g.coverageGapsByKind)
          .filter(([, n]) => n > 0)
          .map(([k, n]) => (k === "blocked-on" ? `${n} blocked-on${blockedOnBreakdown(g.blockedOnCapabilities)}` : `${n} ${k}`));
        detail.push(`${gapTotal} gap${gapTotal === 1 ? "" : "s"} (${kinds.join(", ")})`);
      }
      if (g.readyButHeld > 0) detail.push(`${g.readyButHeld} ready but held`);
      if (g.fidelityRejections > 0) detail.push(`${g.fidelityRejections} rejected by fidelity review`);
      if (g.errors > 0) detail.push(`${g.errors} error${g.errors === 1 ? "" : "s"}`);
      if (detail.length > 0) p.log.message(`    ${detail.join(" · ")}`);
      if (g.usage) p.log.message(`    ${g.usage.calls} call${g.usage.calls === 1 ? "" : "s"} · $${g.usage.costUsd.toFixed(2)}`);
    }
  }

  // External API accounts (item 62) — read-only here: one line per service the repo
  // depends on, saying whether the user has provided an account for it and how many
  // flows the last generate left blocked on it. Silent when the repo neither
  // declares nor detects any, so a repo with no third party prints exactly as before.
  printExternalsStatus(repoRoot);

  if (!summary.coverage && !summary.lastRun && !summary.lastGenerate) {
    p.outro("No guard data yet. Run `truecourse guard generate`, then `truecourse guard run`.");
    return;
  }
  p.outro("Guard status.");
}

/**
 * The externals block of `guard status`: `<name>  <state> · <detail>`, declared
 * services first. `unprovided` is the honest default (the flows stay blocked);
 * `incomplete` is the one that needs action — a run would stop on it — so its
 * unmet requirements are named. Provisioning is interactive and lives elsewhere;
 * this is a read-only footprint.
 */
function printExternalsStatus(repoRoot: string): void {
  const view = readGuardExternalsView(repoRoot);
  if (view.services.length === 0) return;
  p.log.step(`externals   ${view.services.length} service${view.services.length === 1 ? "" : "s"}`);
  for (const s of view.services) {
    const state = s.declared ? s.state : "unprovided";
    const detail: string[] = [];
    if (s.baseUrl) detail.push(s.mode ? `${s.mode} @ ${s.baseUrl}` : s.baseUrl);
    if (state === "incomplete") {
      detail.push(
        ...s.requirements.filter((r) => !r.resolved).map((r) => `${r.envVar}: ${r.reason ?? "unresolved"}`),
      );
    }
    if (!s.declared) detail.push("not declared in recipe.json");
    if (s.blockedFlows > 0) detail.push(`${s.blockedFlows} blocked flow${s.blockedFlows === 1 ? "" : "s"}`);
    p.log.message(`    ${s.service}  ${state}${detail.length > 0 ? ` · ${detail.join(" · ")}` : ""}`);
  }
  if (!view.detectionAvailable) {
    p.log.message("    (no generate report yet — detection has not run, so only declared services are listed)");
  }
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
  const latest = await readGuardLatest(repoRoot);
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
