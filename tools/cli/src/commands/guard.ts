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
import { readGuardSetup } from "@truecourse/core/commands/guard-setup";
import {
  guardNeedsSetupServices,
  readGuardExternalsView,
} from "@truecourse/core/commands/guard-externals";
import { printExternalsView } from "./guard-externals.js";
import type {
  GuardBirthFinding,
  GuardFlow,
  GuardLastGenerateSummary,
  GuardScenarioResult,
  GuardGenerateReport,
  GuardUnadjudicatedStage,
} from "@truecourse/shared";
import type { StageTransportTally } from "@truecourse/shared/llm";
import { StepTracker } from "@truecourse/core/progress";
import {
  guardGenerateInProcess,
  guardRunInProcess,
  GUARD_GENERATE_STEPS,
  GUARD_RUN_STEPS,
  EstimateDeclined,
  OpenConflictsError,
  type AuthorFailure,
} from "@truecourse/core/commands/guard-in-process";
import {
  composeGuardStatus,
  orderGuardDrifts,
  guardDriverIds,
  guardGapDisplayLabel,
  guardUnadjudicatedEffect,
  GUARD_COVERAGE_PLAIN_ORDER,
  GUARD_COVERAGE_STATUS_WORD,
  GUARD_UNADJUDICATED_REMEDY,
  isCompositionFinding,
} from "@truecourse/shared";
import type { GuardCoveragePlainStatus, GuardGapDisplayKind } from "@truecourse/shared";
import { registerProject } from "@truecourse/core/config/registry";
import { createStdoutStepRenderer } from "../lib/stdout-step-renderer.js";
import { clip, flowInstanceLine } from "../lib/guard-flow-format.js";
import { requireGitRepo } from "./git-guard.js";
import { preflightLlmOrExit } from "../lib/claude-preflight.js";
import { estimateSpinnerPhase, promptLlmEstimate } from "./llm-prompt.js";

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
  blocked: "⊘",
};

/** One line per scenario result: severity icon, id, title, reason/duration. */
function scenarioLine(s: GuardScenarioResult): string {
  const suffix =
    s.outcome === "stale" || s.outcome === "orphaned"
      ? `  — ${BINDING_REASON[s.outcome]}`
      : s.outcome === "blocked"
        ? `  — blocked on the supplied dependency \`${s.blockedOn?.dependency ?? "?"}\``
        : `  (${Math.round(s.durationMs)}ms)`;
  return `${MARK[s.outcome]} ${s.id} — ${s.title}${suffix}`;
}

/**
 * What a BLOCKED scenario prints under its line: the requirement an instance has to
 * satisfy — attributed to the flow that asked for each part, so a reader sees why
 * every expectation is there — and the file to register one in. Nothing executed,
 * so there is no step, no expected/actual, and no evidence to point at; the
 * registration IS the whole story.
 */
export function blockedDetailLines(s: GuardScenarioResult): string[] {
  const blocked = s.blockedOn;
  if (!blocked) return [];
  const lines = [`    needs: ${blocked.requirement}`];
  for (const need of blocked.needs) lines.push(`      · ${need.need}  (${need.flowId})`);
  lines.push(`    register an instance in ${blocked.registerIn}`);
  return lines;
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
      const detail =
        s.outcome === "blocked" ? blockedDetailLines(s) : failureDetailLines(s, flowsById);
      for (const line of detail) renderer.log(line);
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
    // A blocked flow never executed, so it has no drift to report — counting it as
    // drift would claim a disagreement between doc and code that was never tested.
    const drifted = new Set(
      latest.scenarios
        .filter((s) => s.outcome !== "pass" && s.outcome !== "blocked")
        .map((s) => s.flowId)
        .filter(Boolean),
    );
    const blockedFlows = new Set(
      latest.scenarios.filter((s) => s.outcome === "blocked").map((s) => s.flowId).filter(Boolean),
    );
    const driftTag = drifted.size > 0 ? ` · ${drifted.size} with drift` : "";
    const blockedTag = blockedFlows.size > 0 ? ` · ${blockedFlows.size} blocked` : "";
    p.log.info(
      `flows       ${exercised.size}/${manifest.flows.length} exercised${driftTag}${blockedTag}`,
    );
  }

  const { pass, fail, error, stale, orphaned, blocked } = latest.summary;
  const parts = [`${pass} passed`];
  if (fail > 0) parts.push(`${fail} failed`);
  if (error > 0) parts.push(`${error} errored`);
  if (stale > 0) parts.push(`${stale} stale`);
  if (orphaned > 0) parts.push(`${orphaned} orphaned`);
  if (blocked > 0) parts.push(`${blocked} blocked`);
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
  // BLOCKED is not drift: nothing about the repo is in dispute, so the run does not
  // fail on it — but it is also not a clean bill of health, so the close says what
  // is still unproven and never claims those sections succeeded.
  if (blocked > 0) {
    p.log.warn(parts.join(" · "));
    p.log.info(
      "Register the supplied dependencies above in .truecourse/scenarios/dependencies.local.json, then re-run.",
    );
    p.outro("Every section that ran succeeded — some never ran.");
    return;
  }
  p.log.success(parts.join(" · "));
  p.outro("Every section that ran succeeded.");
}

// ---------------------------------------------------------------------------
// `truecourse guard generate` — the LLM pipeline (classify → generate → birth).
// ---------------------------------------------------------------------------

export interface RunGuardGenerateOptions {
  cwd?: string;
  /** Skip the pre-flight cost-estimate confirm (`-y` / `--yes`). */
  yes?: boolean;
  /** LLM transport for this run: `cli` (spawn `claude -p`), `agent` (mailbox under `io`), or `api`. */
  llmTransport?: "cli" | "agent" | "api";
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
  // Classification + generation shell out to `claude`; probe once up front — or,
  // in API mode, validate the provider config instead (the `agent` transport
  // answers via the filesystem mailbox, so neither applies there).
  await preflightLlmOrExit(opts.llmTransport);

  const autoApprove = !!opts.yes || opts.llmTransport === "agent";
  // The estimate resolves its own spinner line before the panel prints; the
  // checklist below only starts once the run does, so it paints exactly once.
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
      onEstimatePhase: estimateSpinnerPhase(),
      onLlmEstimate: (est) => {
        estimatedCostUsd = est.estimatedCostUsd;
        return promptLlmEstimate(est, { autoApprove, nouns: { verb: "Generate" } });
      },
      // Authoring failures surface LIVE — a warn line the moment each attempt
      // fails, above the checklist. A flow that is timing out never ticks the
      // settle counter, so it is otherwise indistinguishable from a slow one.
      onAuthorFailure: (f) => renderer.log(authorFailureLine(f)),
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
    // It may be MULTI-LINE (a guided datastore failure leads with the dependency
    // and its remedies, then quotes the boot output), so it renders line by line:
    // the same shape the entry-preflight failure above uses.
    const { headline, detail } = recipeFailureLines(guard.reason);
    p.log.error(headline);
    for (const line of detail) console.log(line);
    p.outro("Run `truecourse guard setup` (it derives, verifies, and prepares everything generate needs), then retry.");
    process.exit(1);
  }

  // A stage lost EVERY LLM call — nothing was generated and nothing on disk was
  // rewritten. Loud + non-zero so a CI gate can never read it as a clean no-op.
  if (guard.status === "llm-failed") {
    p.log.error(`Generate aborted — ${guard.reason}`);
    for (const f of guard.extractionFailures) p.log.message(`  • ${f.doc} — ${f.reason}`);
    p.outro("Aborted — fix the LLM error above and re-run `truecourse guard generate`.");
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
    // A generated datastore is a SECOND artifact at the repo root — name it here,
    // or a compose file nobody asked for appears in `git status` unexplained.
    p.log.step(
      guard.recipe.composePath
        ? `recipe      wrote ${guard.recipe.wrotePath} and ${guard.recipe.composePath} (the datastore it needs, derived from the app's own connection URL)${how} — review and commit BOTH`
        : `recipe      wrote ${guard.recipe.wrotePath}${how} — review and commit it`,
    );
    // Non-interactive by design: what the proposer could NOT decide is PRINTED, so
    // an agent or a CI log carries the fill-in list. Never a fabricated secret.
    if (guard.recipe.todos && guard.recipe.todos.length > 0) {
      p.log.warn(`The recipe has ${guard.recipe.todos.length} TODO(s) before an api run can authenticate:`);
      for (const todo of guard.recipe.todos) console.log(`  • ${todo}`);
    }
  }

  if (guard.noChanges) {
    printGuardLlmFailures(guard.llmFailures, guard.extractionFailures);
    p.log.success("Nothing changed — every section is already covered since the last generate.");
    p.outro("Done.");
    return;
  }

  // The generate persisted its report at the end (usage + generatedAt); read it
  // back so the summary reuses the exact `guard status` composition. Fall back to
  // the in-memory result if the file is somehow absent.
  const report: GuardGenerateReport = (await readGuardResult(repoRoot)) ?? { ...guard, generatedAt: new Date().toISOString() };
  printGuardGenerateSummary(report, path.relative(repoRoot, guardResultPath(repoRoot)), { estimatedCostUsd });

  // The runner DECLINED the run — a broken recipe, a half-configured external
  // account. Nothing was built, booted or validated, so this is the only news the
  // run has: it prints last, loudly, and exits non-zero. Re-running it changes
  // nothing until the configuration does, so it never suggests a retry.
  if (guard.refusal) {
    p.log.error(`Guard refused the run (${guard.refusal.status}) — nothing was built, started, or validated.`);
    for (const line of guard.refusal.message.trimEnd().split("\n")) console.log(`  ${line}`);
    if (guard.refusal.flowIds.length > 0) {
      p.log.step(`${guard.refusal.flowIds.length} flow${guard.refusal.flowIds.length === 1 ? "" : "s"} had tests authored but never validated — fix the above and re-run \`truecourse guard generate\` (authoring is cached).`);
    }
    p.outro(guardGenerateOutro({ written: 0, problems: 0, refused: true }));
    process.exit(1);
  }

  // Never an unqualified closing line when calls were lost — a run with failed
  // calls is an INCOMPLETE run, not a clean one.
  const lost = guard.llmFailures.reduce((n, f) => n + f.failures, 0);
  if (lost > 0) {
    p.log.warn(`${lost} LLM call${lost === 1 ? "" : "s"} failed — this generate is incomplete; re-run to retry them.`);
  }
  const closing = guardGenerateOutro({
    written: guard.written.length,
    problems: guard.birthFindings.length + guard.errors.length,
  });
  if (guard.written.length > 0) {
    p.log.success(`Wrote ${guard.written.length} test file${guard.written.length === 1 ? "" : "s"} to .truecourse/scenarios/.`);
  }
  p.outro(closing);
}

/**
 * A live authoring-failure warn line: the flow (with its surface), the one-line
 * reason, and whether a corrective re-ask follows (`retrying (2/2)`) or the flow
 * is given up on for this run.
 */
export function authorFailureLine(f: AuthorFailure): string {
  const subject = `${f.flowId} · ${f.surface}`;
  return f.willRetry
    ? `✗ ${subject} — ${f.reason}, retrying (${f.attempt + 1}/2)`
    : `✗ ${subject} — ${f.reason}; flow failed, will retry next generate`;
}

/**
 * The closing line of `guard generate`, from what the run actually left behind.
 *
 * Its one rule: a run that wrote NO test file never says there are tests to review
 * and commit. That line used to be reached whenever anything at all went wrong —
 * the "No tests written." early return was gated on there being no findings AND no
 * errors — so a generate that recorded 50 errors and wrote zero files signed off
 * with "Review + commit the tests, then `truecourse guard run`."
 */
export function guardGenerateOutro(o: {
  written: number;
  /** Findings + errors — anything the summary above already listed. */
  problems: number;
  /** The runner declined the run; nothing was validated and re-running won't help. */
  refused?: boolean;
}): string {
  if (o.refused) return "Aborted — the run was refused; no tests were written.";
  if (o.written === 0) return o.problems > 0 ? "No tests written — see the errors above." : "No tests written.";
  return "Review + commit the tests, then `truecourse guard run`.";
}

/**
 * Split a `recipe-failed` reason into its terminal shape. The engine's reason may
 * be MULTI-LINE — a datastore boot failure leads with the detected dependency and
 * its remedies, then quotes the boot output — and cramming that onto one clack
 * line makes the actionable half unreadable. The first line is the error headline;
 * every later line prints indented underneath, blanks preserved.
 */
export function recipeFailureLines(reason: string | undefined): { headline: string; detail: string[] } {
  const [head, ...rest] = (reason ?? "recipe discovery failed").split("\n");
  return { headline: `Recipe unusable: ${head}`, detail: rest.map((line) => (line ? `  ${line}` : "")) };
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
  printGuardLlmFailures(g.llmFailures, report.extractionFailures, g.unadjudicated);
  printUnadjudicated(g.unadjudicated);
  // Orphan honesty: a dismissal whose claim text no longer matches any
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

  // EVERY failed unit, deduped and collapsed — one line each, no top-3 cap. A run
  // that could not author 9 flows must say which 9: they are exactly the work a
  // re-run retries, and a truncated list hides half of it.
  if (report.errors.length > 0) {
    const units = collapseAuthoringErrors(report.errors);
    p.log.step(`errors      ${g.errors} authoring error${g.errors === 1 ? "" : "s"} — nothing was written for ${units.length === 1 ? "this unit" : `these ${units.length} units`}, re-run generate to retry`);
    for (const u of units) p.log.message(`  ✗ ${u.subject} — ${u.reason}`);
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
      // The findings this summary just counted, in full — by flow, split into the
      // repo's drift and our own defects (`--json` for an agent).
      "      `truecourse guard findings`  — what this generate found, by flow",
      "      `truecourse guard drifts`  — inspect failures",
      `      report: ${reportPath}`,
    ].join("\n"),
  );
}

/**
 * `18 blocked · 25 never run` — a per-coverage-word tally, worst first, silent
 * about the words nothing is in. The ONE way `guard status` says what is known
 * about sections or flows: exactly the five words the dashboard's chips wear.
 */
function statusTally(byStatus: Record<GuardCoveragePlainStatus, number>): string {
  const parts = GUARD_COVERAGE_PLAIN_ORDER.flatMap((status) =>
    byStatus[status] > 0 ? [`${byStatus[status]} ${GUARD_COVERAGE_STATUS_WORD[status].toLowerCase()}`] : [],
  );
  return parts.length > 0 ? parts.join(" · ") : "nothing recorded";
}

/**
 * `12 written · 10 passing · 2 failing (birth)` — the committed test inventory.
 * A failing test is committed like any other; "(birth)" says the stage that judged
 * it, never that it was withheld. The failing and never-run halves are dropped when
 * there are none; a never-run test is one nothing has executed, so it is never
 * counted among the passing.
 */
function testsLine(g: GuardLastGenerateSummary): string {
  const parts = [`${g.written} written`];
  if (g.testsPassing > 0 || (g.testsFailing === 0 && g.testsNeverRun === 0)) {
    parts.push(`${g.testsPassing} passing`);
  }
  if (g.testsFailing > 0) parts.push(`${g.testsFailing} failing (birth)`);
  if (g.testsNeverRun > 0) parts.push(`${g.testsNeverRun} never run`);
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
 * saw; every other finding names the flow surface and the claim it asserted —
 * with the triage verdict as the kind word when the test carries one.
 */
function findingLine(f: GuardBirthFinding): string {
  const subject = f.flowId ? `${f.flowId}${f.surface ? ` · ${f.surface}` : ""}` : sectionLeaf(f.anchor);
  if (isCompositionFinding(f)) {
    return `▲ ${subject} · milestone ${f.failedMilestone}: ${clip(f.actual, 70)}`;
  }
  const kind = f.kind === "fidelity" ? "fidelity" : (f.triage?.verdict ?? "birth");
  return `✗ ${subject} · ${kind}: ${clip(f.title, 70)}`;
}

/**
 * Per-stage LLM failure lines for a generate that completed anyway: what fraction
 * of each stage's calls was lost, what the loss cost, the affected documents (for
 * extraction), and the first underlying error — a self-healed failure is still a
 * defect, so it never gets summarized away.
 */
function printGuardLlmFailures(
  failures: readonly StageTransportTally[],
  extractionFailures: readonly GuardGenerateReport["extractionFailures"][number][],
  unadjudicated: readonly GuardUnadjudicatedStage[] = [],
): void {
  if (failures.length === 0) return;
  // A stage that lost EVERY call is stated in full by the unadjudicated block that
  // follows. Its per-call effect sentence describes a PARTIAL loss (some tests
  // unreviewed), so printing both would tell two stories about one stage.
  const blind = new Set(unadjudicated.map((u) => u.stage as string));
  p.log.warn("LLM calls failed — this generate is incomplete:");
  for (const f of failures) {
    const stage = GUARD_STAGE_LABEL[f.stage] ?? f.stage;
    const effect = blind.has(f.stage)
      ? "the WHOLE stage — see “Shipped unadjudicated” below"
      : (GUARD_STAGE_EFFECT[f.stage] ?? "affected work left unsettled");
    p.log.message(`  • ${stage}: ${f.failures} of ${f.attempts} calls failed — ${effect}`);
    if (f.stage === "guard.extract") {
      for (const d of extractionFailures) p.log.message(`    ${d.doc} — ${d.reason}`);
    }
    if (f.firstError) p.log.message(`    first failure: ${f.firstError}`);
  }
}

/**
 * The adjudication stages that lost EVERY call, and what shipped without them. The
 * run was NOT aborted (plan item 88 — fidelity and triage judge content birth
 * already validated, so losing them costs annotation, not correctness), which is
 * only honest if the terminal says the corpus is unadjudicated. Never summarized
 * away: a test nobody reviewed must not read like a reviewed one.
 */
function printUnadjudicated(stages: readonly GuardUnadjudicatedStage[]): void {
  if (stages.length === 0) return;
  p.log.warn("Shipped unadjudicated — a verdict stage lost every call:");
  for (const s of stages) {
    p.log.message(`  • ${GUARD_STAGE_LABEL[s.stage] ?? s.stage}: ${guardUnadjudicatedEffect(s)}`);
  }
  p.log.message(`    ${GUARD_UNADJUDICATED_REMEDY}`);
}

/** The compact per-stage unadjudicated detail `guard status` reads back from the report. */
function printStatusUnadjudicated(stages: readonly GuardUnadjudicatedStage[]): void {
  if (stages.length === 0) return;
  const parts = stages.map((s) => `${GUARD_STAGE_LABEL[s.stage] ?? s.stage} ${s.affected}`);
  p.log.message(`    unadjudicated (the stage lost every call): ${parts.join(" · ")}`);
}

/** The compact per-stage failed-call detail `guard status` reads back from the report. */
function printStatusLlmFailures(failures: readonly StageTransportTally[]): void {
  if (failures.length === 0) return;
  const parts = failures.map((f) => `${GUARD_STAGE_LABEL[f.stage] ?? f.stage} ${f.failures}/${f.attempts}`);
  p.log.message(`    llm calls failed: ${parts.join(" · ")}`);
}

/** The guard stage's short name, so the failure line reads as prose. */
const GUARD_STAGE_LABEL: Record<string, string> = {
  "guard.recipe": "recipe discovery",
  "guard.seed": "seed drafting",
  "guard.extract": "claim extraction",
  "guard.flows": "flow synthesis",
  "guard.match": "realization matching",
  "guard.generate": "authoring",
  "guard.retry": "evidence retry",
  "guard.fidelity": "fidelity review",
  "guard.triage": "failure triage",
};

/** What each stage's per-item fail-soft default did to the calls it lost. */
const GUARD_STAGE_EFFECT: Record<string, string> = {
  "guard.recipe": "no recipe proposed",
  "guard.seed": "no seed drafted; the flows it would unblock stay blocked",
  "guard.extract": "affected documents yielded no claims; their sections stay blocked",
  "guard.flows": "affected areas composed no flow; their claims stay blocked",
  "guard.match": "affected flows got no realization plan and authored nothing",
  "guard.generate": "affected flows wrote no test",
  "guard.retry": "affected tests stayed birth findings",
  "guard.fidelity": "affected tests were left unreviewed and their flows unsettled",
  "guard.triage": "affected failing tests committed untriaged",
};

/** The trailing heading of a section anchor (`cli/version` → `version`). */
function sectionLeaf(anchor: string): string {
  return anchor.split("/").pop() || anchor;
}

/** One failed authoring unit: how it is named, plus a reason collapsed from all
 *  its error entries. */
interface FailedAuthoringUnit {
  subject: string;
  reason: string;
}

/**
 * Dedupe the report's authoring errors by their UNIT — the flow when the error
 * names one (authoring is one call per flow+surface), else the section it was
 * attributed to — and collapse each unit's messages into one reason with an
 * attempt count. Order is first-seen, so the terminal reads in the order the run
 * produced them.
 */
export function collapseAuthoringErrors(
  errors: readonly { doc: string; anchor: string; message: string; flowId?: string }[],
): FailedAuthoringUnit[] {
  const groups = new Map<string, { subject: string; messages: string[] }>();
  for (const e of errors) {
    const key = e.flowId ?? `${e.doc}\0${e.anchor}`;
    const subject = e.flowId ?? sectionLeaf(e.anchor);
    const g = groups.get(key);
    if (g) g.messages.push(e.message);
    else groups.set(key, { subject, messages: [e.message] });
  }
  return [...groups.values()].map((g) => ({ subject: g.subject, reason: collapseFailureReason(g.messages) }));
}

/** Collapse one unit's authoring-error messages into a single reason + count. */
export function collapseFailureReason(messages: readonly string[]): string {
  const n = messages.length;
  const attempts = `${n} attempt${n === 1 ? "" : "s"}`;
  const isTimeout = (m: string) => /timed out/i.test(m);
  const isInvalid = (m: string) => /invalid|unrealized/i.test(m);
  if (messages.every(isTimeout)) return `timed out (${attempts})`;
  if (messages.every(isInvalid)) return n === 1 ? "invalid output twice" : `invalid output twice (${attempts})`;
  const first = clip(messages[0], 100);
  return n === 1 ? first : `${first} (+${n - 1} more)`;
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

  const latest = await readGuardLatest(repoRoot);
  const summary = composeGuardStatus(
    await readManifest(repoRoot),
    latest,
    await readGuardResult(repoRoot),
  );

  // Setup — the FIRST row, because it is the first stage and the gate for
  // everything below it: a repo that has not been set up cannot generate at all, and
  // that is more useful to read than "coverage (none)".
  printSetupStatus(repoRoot);

  // Coverage — scenarios/manifest.json. Sections stay the coverage pivot, but the
  // unit that guards them is the FLOW, so the count says which it went through.
  if (!summary.coverage) {
    p.log.info("coverage    (none) — run `truecourse guard generate`");
  } else {
    const c = summary.coverage;
    const via = ` (via ${c.flows.total} flow${c.flows.total === 1 ? "" : "s"})`;
    // The coverage line is the five words and nothing else, so the terminal and
    // the dashboard's totals strip say the same thing about the same sections.
    p.log.step(
      `coverage    ${c.totalSections} section${c.totalSections === 1 ? "" : "s"}${via} · ${statusTally(c.byStatus)}`,
    );
    const cl = c.classification;
    const parts = [...guardDriverIds.map((d) => `${d} ${cl[d]}`), `not testable ${cl.untestable}`];
    if (cl.unclassified > 0) parts.push(`unclassified ${cl.unclassified}`);
    p.log.message(`    ${parts.join(" · ")}`);

    // The flows line — the same five words over the flows, with the gap labels
    // behind the blocked ones so "why" needs no second command.
    const f = c.flows;
    const why = f.gapLabels.length > 0 ? ` (${f.gapLabels.join(" · ")})` : "";
    p.log.step(`flows       ${f.total} total · ${statusTally(f.byStatus)}${why}`);
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
    if (s.blocked > 0) parts.push(`${MARK.blocked} ${s.blocked} blocked`);
    p.log.message(`    ${parts.join(" · ")}`);
    // WHICH dependency, per scenario that never ran — the tally alone says a number
    // and leaves the reader with nothing to do about it.
    for (const line of blockedDependencyLines(latest?.scenarios ?? [])) p.log.message(`    ${line}`);
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
      printStatusLlmFailures(g.llmFailures);
      printStatusUnadjudicated(g.unadjudicated);
    } else {
      p.log.step(`last gen    ${g.generatedAt} · ${testsLine(g)}`);
      const gapTotal = Object.values(g.coverageGapsByKind).reduce((a, b) => a + b, 0);
      const detail: string[] = [];
      if (gapTotal > 0) {
        // The gap breakdown is the WHY behind the blocked/not-testable counts
        // above, so it names each gap in words (`no journey`), never as the wire
        // kind token it is keyed by.
        const kinds = Object.entries(g.coverageGapsByKind)
          .filter(([, n]) => n > 0)
          .map(([k, n]) => {
            const label = guardGapDisplayLabel(k as GuardGapDisplayKind);
            return k === "blocked-on"
              ? `${n} ${label}${blockedOnBreakdown(g.blockedOnCapabilities)}`
              : `${n} ${label}`;
          });
        detail.push(`${gapTotal} gap${gapTotal === 1 ? "" : "s"} (${kinds.join(", ")})`);
      }
      if (g.readyButHeld > 0) detail.push(`${g.readyButHeld} ready but held`);
      if (g.fidelityRejections > 0) detail.push(`${g.fidelityRejections} rejected by fidelity review`);
      if (g.errors > 0) detail.push(`${g.errors} error${g.errors === 1 ? "" : "s"}`);
      if (detail.length > 0) p.log.message(`    ${detail.join(" · ")}`);
      // The actionable slice of those blocked flows — the ones waiting on
      // a third party the user can hand guard an account for. Same derivation the
      // dashboard's needs-setup status uses; silent when nothing is providable.
      const needsSetup = needsSetupLine(repoRoot);
      if (needsSetup) p.log.message(`    ${needsSetup}`);
      if (g.usage) p.log.message(`    ${g.usage.calls} call${g.usage.calls === 1 ? "" : "s"} · $${g.usage.costUsd.toFixed(2)}`);
      printStatusLlmFailures(g.llmFailures);
      printStatusUnadjudicated(g.unadjudicated);
    }
  }

  // External API accounts — read-only here: one line per service the repo
  // depends on, saying whether the user has provided an account for it and how many
  // flows the last generate left blocked on it. Silent when the repo neither
  // declares nor detects any, so a repo with no third party prints exactly as before.
  printExternalsStatus(repoRoot);

  if (!summary.coverage && !summary.lastRun && !summary.lastGenerate) {
    p.outro("No guard data yet. Run `truecourse guard setup`, then `truecourse guard generate`, then `truecourse guard run`.");
    return;
  }
  p.outro("Guard status.");
}

/**
 * The `guard setup` row: whether preparation has run, and what it left to do. Reads
 * the gitignored `guard/setup.json` — derived and safe to delete, so "no record" is
 * "setup has not run here", never an error. Silent about nothing: a repo with no
 * record is exactly the one that most needs to be told to run it.
 */
function printSetupStatus(repoRoot: string): void {
  const setup = readGuardSetup(repoRoot);
  if (!setup) {
    p.log.info("setup       (none) — run `truecourse guard setup` before `truecourse guard generate`");
    return;
  }
  if (setup.status === "failed") {
    p.log.error(`setup       ${setup.ranAt} · failed — ${firstLine(setup.reason)}`);
    return;
  }
  const parts: string[] = [];
  parts.push(setup.recipe.outcome === "discovered" ? "recipe derived" : "recipe present");
  const probes = setup.recipe.probes ?? [];
  if (probes.length > 0) parts.push(`${probes.length} server${probes.length === 1 ? "" : "s"} reached`);
  const seed = setup.seed;
  if (seed?.status === "ok") {
    const principals = seed.credentials?.length ?? 0;
    parts.push(`seed ${seed.outcome === "drafted" ? "drafted" : "present"}${principals > 0 ? ` (${principals} principal${principals === 1 ? "" : "s"})` : ""}`);
  } else if (seed) {
    parts.push("no seed");
  }
  p.log.step(`setup       ${setup.ranAt} · ${parts.join(" · ")}`);
  const externals = setup.externals;
  if (externals && externals.unprovided.length > 0) {
    p.log.message(
      `    ${externals.unprovided.length} external${externals.unprovided.length === 1 ? "" : "s"} awaiting an account (${externals.unprovided.join(", ")}) — \`truecourse guard setup\``,
    );
  }
  if (externals && externals.undeclarable.length > 0) {
    p.log.message(
      `    ${externals.undeclarable.join(", ")} could not be declared — no base-URL env var was detected for them`,
    );
  }
  if (seed && seed.status !== "ok") p.log.message(`    seed: ${seed.reason ?? "not prepared"}`);
  for (const error of setup.credentialSchemes?.errors ?? []) p.log.error(`    ${error}`);
}

/** The first line of a possibly multi-line reason — a status row is one line. */
function firstLine(reason: string | undefined): string {
  return reason?.split("\n")[0]?.trim() || "no reason recorded";
}

/**
 * The needs-setup line: how many blocked flows are waiting on a third
 * party the user could provide, and which. Split out of the raw `blocked-on`
 * count because the two need opposite things — one is a to-do with a command
 * behind it, the other a wall. A service that is ALREADY provided is named
 * separately: its flows convert on the next `guard generate`, not on a form.
 * Empty (and therefore silent) when no blocked flow names a known service.
 */
/**
 * The blocked block of `guard status`: one line per unregistered supplied
 * dependency, with how many scenarios it holds back and what an instance must
 * satisfy. Grouped by DEPENDENCY, not by scenario, because registering one
 * instance clears every scenario that binds it — that is the action, so that is
 * the unit. Empty when nothing is blocked.
 */
export function blockedDependencyLines(
  scenarios: readonly GuardScenarioResult[],
): string[] {
  const byDependency = new Map<string, { requirement: string; count: number }>();
  for (const s of scenarios) {
    if (s.outcome !== "blocked" || !s.blockedOn) continue;
    const entry = byDependency.get(s.blockedOn.dependency) ?? {
      requirement: s.blockedOn.requirement,
      count: 0,
    };
    entry.count += 1;
    byDependency.set(s.blockedOn.dependency, entry);
  }
  return [...byDependency.entries()].map(
    ([dependency, { requirement, count }]) =>
      `${MARK.blocked} ${dependency} — ${count} scenario${count === 1 ? "" : "s"} held back; needs ${requirement}`,
  );
}

function needsSetupLine(repoRoot: string): string | null {
  const services = guardNeedsSetupServices(readGuardExternalsView(repoRoot));
  if (services.length === 0) return null;
  const pending = services.filter((s) => s.state !== "provided");
  const provided = services.filter((s) => s.state === "provided");
  const flows = (rows: typeof services) => rows.reduce((n, s) => n + s.blockedFlows, 0);
  const parts: string[] = [];
  if (pending.length > 0) {
    const n = flows(pending);
    parts.push(
      `${n} flow${n === 1 ? "" : "s"} need setup (${pending
        .map((s) => s.service)
        .join(", ")} — run: truecourse guard externals)`,
    );
  }
  if (provided.length > 0) {
    const n = flows(provided);
    parts.push(
      `${provided.map((s) => s.service).join(", ")} provided — re-run \`truecourse guard generate\` to author ${n} flow${n === 1 ? "" : "s"}`,
    );
  }
  return parts.join(" · ");
}

/**
 * The externals block of `guard status`: `<name>  <state> · <detail>`, declared
 * services first — the SAME renderer `guard externals` prints, so the two surfaces
 * can never disagree. Provisioning is interactive and lives in `guard externals`;
 * this is a read-only footprint, and a repo with no third party prints nothing at
 * all (status is a summary, not a tour of what could exist).
 */
function printExternalsStatus(repoRoot: string): void {
  const view = readGuardExternalsView(repoRoot);
  if (view.services.length === 0) return;
  printExternalsView(view);
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
    p.log.success("No drift — every section that ran succeeded.");
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
