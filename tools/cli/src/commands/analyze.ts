import * as p from "@clack/prompts";
import path from "node:path";
import { analyzeInProcess } from "@truecourse/core/commands/analyze-in-process";
import { StepTracker, buildAnalysisSteps, type AnalysisStep } from "@truecourse/core/progress";
import { ensureRepoTruecourseDir, resolveRepoDir, wipeLegacyPostgresData } from "@truecourse/core/config/paths";
import { registerProject, type RegistryEntry } from "@truecourse/core/config/registry";
import { readProjectConfig } from "@truecourse/core/config/project-config";
import { getGit } from "@truecourse/core/lib/git";
import { closeLogger, configureLogger } from "@truecourse/core/lib/logger";
import { isCliBinaryAvailable } from "@truecourse/core/lib/cli-binary";
import { config } from "@truecourse/core/config";
import { exitMissingNonInteractiveFlag, isInteractive, promptInstallSkills, renderViolationsSummary } from "./helpers.js";
import { promptLlmEstimate } from "./llm-prompt.js";
import { showFirstRunNotice } from "../telemetry.js";

function ensureClaudeCli(): void {
  const binary = config.claudeCodeBinary;
  if (isCliBinaryAvailable(binary)) return;
  p.log.error(
    `Claude Code CLI not found (tried \`${binary}\`). TrueCourse requires the Claude Code binary to run analysis.\n` +
      "Install it from https://docs.anthropic.com/en/docs/claude-code, " +
      "or set CLAUDE_CODE_BINARY to its name or absolute path if it's installed elsewhere.",
  );
  process.exit(1);
}

function resolveOrInitProject(): RegistryEntry {
  const repoDir = resolveRepoDir(process.cwd()) ?? process.cwd();
  ensureRepoTruecourseDir(repoDir);
  return registerProject(repoDir);
}

// ---------------------------------------------------------------------------
// Console step renderer
// ---------------------------------------------------------------------------

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const PRE_LLM_STEPS = new Set(["parse", "scan"]);
let spinnerFrame = 0;
let spinnerInterval: ReturnType<typeof setInterval> | null = null;
let renderedLineCount = 0;
let latestSteps: AnalysisStep[] | null = null;
// Render phase:
//   'all'      — LLM disabled, no mid-analyze prompt → render every step.
//   'pre-llm'  — LLM enabled, prompt hasn't fired yet → only parse + scan.
//   'post-llm' — LLM enabled, prompt answered → domains + persist only
//                (parse + scan already printed above the prompt).
type RenderPhase = "all" | "pre-llm" | "post-llm";
let renderPhase: RenderPhase = "all";

function renderSteps(steps: AnalysisStep[]): void {
  const visible =
    renderPhase === "all"
      ? steps
      : renderPhase === "pre-llm"
        ? steps.filter((s) => PRE_LLM_STEPS.has(s.key))
        : steps.filter((s) => !PRE_LLM_STEPS.has(s.key));

  if (renderedLineCount > 0) {
    process.stderr.write(`\x1b[${renderedLineCount}A`);
  }
  for (const step of visible) {
    const detail = step.detail ? ` — ${step.detail}` : "";
    let icon: string;
    let color: string;
    const reset = "\x1b[0m";
    switch (step.status) {
      case "pending":
        icon = "○"; color = "\x1b[2m";
        break;
      case "active":
        icon = SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length]; color = "\x1b[36m";
        break;
      case "done":
        icon = "●"; color = "\x1b[32m";
        break;
      case "error":
        icon = "✕"; color = "\x1b[31m";
        break;
      default:
        icon = "○"; color = "";
    }
    process.stderr.write(`\x1b[2K${color}  ${icon} ${step.label}${detail}${reset}\n`);
  }
  renderedLineCount = visible.length;

  const hasActive = steps.some((s) => s.status === "active");
  if (hasActive && !spinnerInterval) {
    latestSteps = steps;
    spinnerInterval = setInterval(() => {
      spinnerFrame++;
      if (latestSteps) renderSteps(latestSteps);
    }, 80);
  } else if (hasActive) {
    latestSteps = steps;
  } else if (!hasActive && spinnerInterval) {
    clearInterval(spinnerInterval);
    spinnerInterval = null;
    latestSteps = null;
  }
}

function stopSpinner(): void {
  // Reset the redraw anchor so the next tracker update starts a fresh
  // block below wherever the terminal cursor ends up (typically below the
  // LLM estimate prompt that's about to fire).
  renderedLineCount = 0;
  if (spinnerInterval) {
    clearInterval(spinnerInterval);
    spinnerInterval = null;
  }
}

// ---------------------------------------------------------------------------
// runAnalyze — main entry
// ---------------------------------------------------------------------------

/**
 * Per-invocation flags that control prompts.
 *
 * Agent-friendly: every prompt has an explicit override flag so scripted
 * callers never hang on a stdin they can't reach.
 *   - `llm === true`  → run LLM rules (pre-approve the cost estimate)
 *   - `llm === false` → skip LLM rules entirely (deterministic-only, no cost)
 *   - `llm` undefined → fall back to per-repo config; if non-interactive,
 *                       exit with an error telling the caller to pass one.
 * Same shape as `installSkills` below.
 */
export interface AnalyzeOptions {
  /** Override `enableLlmRules` for this run. */
  llm?: boolean;
  /**
   * Stash decision override.
   *   - `true`  → pre-approve stashing dirty working tree (no prompt).
   *   - `false` → don't stash; analyze the working tree as-is.
   *   - undefined → interactive prompt (or exit on non-interactive + dirty).
   */
  stash?: boolean;
  /** Force-install / force-skip the Claude Code skills first-run prompt. */
  installSkills?: boolean;
  specCompliance?: boolean;
  specComplianceOnly?: boolean;
  specs?: string[];
  showSatisfied?: boolean;
  output?: "text" | "json";
}

/** Resolve the per-run `enableLlmRules` decision from flag + config + TTY state. */
function resolveLlmDecision(
  options: AnalyzeOptions,
  configDefault: boolean,
): { enabled: boolean; autoApproveEstimate: boolean } {
  if (options.llm === true) return { enabled: true, autoApproveEstimate: true };
  if (options.llm === false) return { enabled: false, autoApproveEstimate: false };

  // Flag not passed. If interactive, the estimate prompt will fire and the
  // user decides there. If non-interactive, we can't prompt — exit loudly.
  if (!isInteractive()) {
    exitMissingNonInteractiveFlag(
      "analyze needs a decision on LLM rules before running non-interactively.",
      "Pass --llm to run with LLM rules (cost) or --no-llm to skip them.",
    );
  }
  return { enabled: configDefault, autoApproveEstimate: false };
}

/**
 * Resolve the per-run stash decision from flag + git state + TTY state.
 *
 * Returning `{ skipStash: false }` lets the analyzer service stash the
 * working tree (its existing behaviour). `{ skipStash: true }` analyzes the
 * tree as-is. The CLI does the dirty-tree check + prompt here so the shared
 * core service stays free of TTY assumptions.
 */
export async function resolveStashDecision(
  options: AnalyzeOptions,
  repoPath: string,
): Promise<{ skipStash: boolean }> {
  if (options.stash === true) return { skipStash: false };
  if (options.stash === false) return { skipStash: true };

  // No flag passed. If the tree is clean there's nothing to stash and no
  // need to prompt. If it's dirty we either ask (interactive) or exit
  // loudly (non-interactive) — never stash silently.
  let modifiedCount = 0;
  let untrackedCount = 0;
  try {
    const git = await getGit(repoPath);
    const status = await git.status();
    if (status.isClean()) return { skipStash: false };
    modifiedCount =
      status.modified.length + status.staged.length + status.deleted.length + status.created.length;
    untrackedCount = status.not_added.length;
  } catch {
    // Not a git repo / git unavailable — nothing for the analyzer to stash.
    return { skipStash: false };
  }

  if (!isInteractive()) {
    exitMissingNonInteractiveFlag(
      "analyze needs a decision on stashing before running non-interactively.",
      "Pass --stash to stash pending changes (analyze committed state) or --no-stash to analyze the working tree as-is.",
    );
  }

  p.log.warn(
    `Your repository has ${modifiedCount} modified and ${untrackedCount} untracked file(s).`,
  );

  const choice = await p.select<"stash" | "no-stash">({
    message: "How should TrueCourse handle them?",
    options: [
      {
        value: "stash",
        label: "Stash and analyze committed state (recommended)",
        hint: "changes are temporarily stashed and restored after the run",
      },
      {
        value: "no-stash",
        label: "Don't stash — analyze the working tree as-is",
        hint: "uncommitted changes are included in the analysis",
      },
    ],
  });
  if (p.isCancel(choice)) {
    p.cancel("Cancelled — no changes made");
    process.exit(0);
  }
  return { skipStash: choice === "no-stash" };
}

export async function runAnalyze(options: AnalyzeOptions = {}): Promise<void> {
  const jsonOutput = options.output === "json";
  if (!jsonOutput) p.intro("Analyzing repository");
  if (!jsonOutput) showFirstRunNotice();

  const project = resolveOrInitProject();
  if (!jsonOutput) p.log.step(`Repository: ${project.name}`);

  // First-time setup convenience: offer to install Claude Code skills if
  // they haven't been installed for this repo yet. `--install-skills` /
  // `--no-skills` bypasses the prompt; non-interactive runs skip silently.
  if (!jsonOutput) {
    await promptInstallSkills(project.path, { install: options.installSkills });
  }

  const config = readProjectConfig(project.path);
  const enabledCategories = config.enabledCategories ?? undefined;
  const llmDecision = options.specComplianceOnly
    ? { enabled: false, autoApproveEstimate: false }
    : resolveLlmDecision(options, config.enableLlmRules ?? true);
  const enableLlmRules = !options.specComplianceOnly && llmDecision.enabled;
  const enableSpecCompliance = options.specComplianceOnly
    ? options.specCompliance ?? true
    : options.specCompliance ?? config.specCompliance?.enabled ?? true;
  const specUsesLlm = enableSpecCompliance
    && options.llm !== false
    && (config.specCompliance?.useLlm ?? true);
  if (enableLlmRules || specUsesLlm) ensureClaudeCli();

  // All internal pipeline logs (`[Pipeline]`, `[LLM]`, `[CLI]`, `[Analyzer]`,
  // `[Flows]`, `[Violations]`) go to this repo's analyze.log. The terminal
  // stays clean for the clack checklist + LLM estimate prompt + final
  // summary. `ensureRepoTruecourseDir` has already run via resolveOrInitProject.
  configureLogger({
    filePath: path.join(project.path, ".truecourse/logs/analyze.log"),
  });

  // Resolve stash decision before any analyzer work — keeps the prompt out
  // of the shared core service (which the dashboard server also calls).
  const stashDecision = await resolveStashDecision(options, project.path);

  // LLM disabled → no prompt will fire → render everything inline.
  // LLM enabled → start in pre-llm phase (parse + scan only). `onLlmEstimate`
  // flips to 'post-llm' once the user answers.
  renderPhase = enableLlmRules ? "pre-llm" : "all";

  // One-time cleanup of pre-0.4 embedded-postgres data dir.
  if (wipeLegacyPostgresData()) {
    p.log.info("Legacy Postgres data wiped. Re-analyze to repopulate.");
  }

  const stepDefs = buildAnalysisSteps(
    enabledCategories,
    enableLlmRules,
    enableSpecCompliance,
    !options.specComplianceOnly,
  );
  const tracker = new StepTracker((payload) => {
    if (!jsonOutput && payload.steps) renderSteps(payload.steps);
  }, stepDefs);

  const abortController = new AbortController();
  // Two-stage SIGINT: first Ctrl+C requests a graceful abort and lets the
  // pipeline finish writing logs / restoring stashed state. Second Ctrl+C
  // force-exits immediately for users who don't want to wait.
  let sigintRequested = false;
  const onSigint = () => {
    if (sigintRequested) {
      process.stderr.write("\nForce quit.\n");
      process.exit(130);
    }
    sigintRequested = true;
    abortController.abort();
    process.stderr.write("\nCancelling… (press Ctrl+C again to force quit)\n");
  };
  process.on("SIGINT", onSigint);

  try {
    const result = await analyzeInProcess(project, {
      tracker,
      signal: abortController.signal,
      skipStash: stashDecision.skipStash,
      enabledCategoriesOverride: enabledCategories,
      enableLlmRulesOverride: enableLlmRules,
      specCompliance: enableSpecCompliance,
      specComplianceOnly: options.specComplianceOnly,
      specs: options.specs,
      showSatisfied: options.showSatisfied,
      noLlm: options.llm === false,
      source: "cli",
      onLlmEstimate: async (estimate) => {
        stopSpinner();
        const proceed = await promptLlmEstimate(estimate, {
          autoApprove: llmDecision.autoApproveEstimate,
        });
        // Prompt answered — subsequent renders show domain + persist steps
        // below the prompt; parse + scan are already printed above it.
        renderPhase = "post-llm";
        return proceed;
      },
    });

    stopSpinner();
    if (jsonOutput) {
      process.stdout.write(`${JSON.stringify({
        serviceCount: result.serviceCount,
        fileCount: result.fileCount,
        architecture: result.architecture,
        violationsSummary: result.violationsSummary,
        ...(result.specCompliance ? { specCompliance: result.specCompliance } : {}),
      }, null, 2)}\n`);
      return;
    }
    p.log.success("Analysis complete");
    renderViolationsSummary([], result.violationsSummary);
    p.outro("Analysis complete — view results with: truecourse dashboard");
  } catch (err) {
    stopSpinner();
    if (err instanceof DOMException && err.name === "AbortError") {
      if (!jsonOutput) p.outro("Analysis cancelled");
      process.exit(130);
    }
    if (jsonOutput) {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    } else {
      p.log.error(err instanceof Error ? err.message : String(err));
    }
    process.exit(1);
  } finally {
    process.removeListener("SIGINT", onSigint);
    await closeLogger();
  }
}

// ---------------------------------------------------------------------------
// Diff analyze — parses the working tree, compares against LATEST, writes diff.json.
// Shares `diffInProcess` with POST /api/repos/:id/diff-check.
// ---------------------------------------------------------------------------

export async function runAnalyzeDiff(options: AnalyzeOptions = {}): Promise<void> {
  const { diffInProcess } = await import("@truecourse/core/commands/diff-in-process");
  const { renderDiffResultsSummary } = await import("./helpers.js");

  p.intro("Running diff check");
  showFirstRunNotice();

  const project = resolveOrInitProject();
  p.log.step(`Repository: ${project.name}`);

  // Same first-run skill convenience as `runAnalyze`.
  await promptInstallSkills(project.path, { install: options.installSkills });

  const config = readProjectConfig(project.path);
  const enabledCategories = config.enabledCategories ?? undefined;
  const llmDecision = options.specComplianceOnly
    ? { enabled: false, autoApproveEstimate: false }
    : resolveLlmDecision(options, config.enableLlmRules ?? true);
  const enableLlmRules = !options.specComplianceOnly && llmDecision.enabled;
  const enableSpecCompliance = options.specComplianceOnly
    ? options.specCompliance ?? true
    : options.specCompliance ?? config.specCompliance?.enabled ?? true;
  const specUsesLlm = enableSpecCompliance
    && options.llm !== false
    && (config.specCompliance?.useLlm ?? true);
  if (enableLlmRules || specUsesLlm) ensureClaudeCli();

  configureLogger({
    filePath: path.join(project.path, ".truecourse/logs/analyze.log"),
  });

  // Diff is by definition working-tree analysis — it never stashes, so
  // --stash / --no-stash are accepted (for symmetry with `analyze`) but the
  // dirty-tree prompt does not fire here.

  // Reset module-level renderer state between runs. runAnalyze and
  // runAnalyzeDiff share the same `renderPhase`, `spinnerFrame`, and
  // `renderedLineCount` globals.
  renderPhase = enableLlmRules ? "pre-llm" : "all";

  const stepDefs = buildAnalysisSteps(
    enabledCategories,
    enableLlmRules,
    enableSpecCompliance,
    !options.specComplianceOnly,
  );
  const tracker = new StepTracker((payload) => {
    if (payload.steps) renderSteps(payload.steps);
  }, stepDefs);

  const abortController = new AbortController();
  let sigintRequested = false;
  const onSigint = () => {
    if (sigintRequested) {
      process.stderr.write("\nForce quit.\n");
      process.exit(130);
    }
    sigintRequested = true;
    abortController.abort();
    process.stderr.write("\nCancelling… (press Ctrl+C again to force quit)\n");
  };
  process.on("SIGINT", onSigint);

  try {
    const { diff } = await diffInProcess(project, {
      tracker,
      signal: abortController.signal,
      enabledCategoriesOverride: enabledCategories,
      enableLlmRulesOverride: enableLlmRules,
      specCompliance: enableSpecCompliance,
      specComplianceOnly: options.specComplianceOnly,
      specs: options.specs,
      showSatisfied: options.showSatisfied,
      noLlm: options.llm === false,
      source: "cli",
      onLlmEstimate: async (estimate) => {
        stopSpinner();
        const proceed = await promptLlmEstimate(estimate, {
          autoApprove: llmDecision.autoApproveEstimate,
        });
        renderPhase = "post-llm";
        return proceed;
      },
    });

    stopSpinner();
    p.log.success("Diff check complete");
    renderDiffResultsSummary({
      changedFiles: diff.changedFiles,
      newViolations: diff.newViolations as never,
      resolvedViolations: diff.resolvedViolations as never,
      summary: diff.summary,
      isStale: false,
    });
    p.outro("Diff complete — view results with: truecourse dashboard");
  } catch (err) {
    stopSpinner();
    if (err instanceof DOMException && err.name === "AbortError") {
      p.outro("Diff cancelled");
      process.exit(130);
    }
    p.log.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  } finally {
    process.removeListener("SIGINT", onSigint);
    await closeLogger();
  }
}
