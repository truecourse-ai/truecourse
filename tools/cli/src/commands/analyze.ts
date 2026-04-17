import * as p from "@clack/prompts";
import { execSync } from "node:child_process";
import { analyzeInProcess } from "@truecourse/server/analyze";
import { StepTracker, buildAnalysisSteps, type AnalysisStep } from "@truecourse/server/progress";
import { ensureRepoTruecourseDir, resolveRepoDir } from "@truecourse/server/config/paths";
import { registerProject, type RegistryEntry } from "@truecourse/server/config/registry";
import { readProjectConfig } from "@truecourse/server/config/project-config";
import { getOrOpenProjectDb } from "@truecourse/server/config/database";
import { renderViolationsSummary } from "./helpers.js";
import { showFirstRunNotice } from "../telemetry.js";

function ensureClaudeCli(): void {
  try {
    execSync("which claude", { stdio: "ignore" });
  } catch {
    p.log.error(
      "Claude Code CLI not found on PATH. TrueCourse requires the `claude` binary to run analysis.\n" +
        "Install it from https://docs.anthropic.com/en/docs/claude-code and try again.",
    );
    process.exit(1);
  }
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
let spinnerFrame = 0;
let spinnerInterval: ReturnType<typeof setInterval> | null = null;
let renderedLineCount = 0;
let latestSteps: AnalysisStep[] | null = null;

function renderSteps(steps: AnalysisStep[]): void {
  if (renderedLineCount > 0) {
    process.stderr.write(`\x1b[${renderedLineCount}A`);
  }
  for (const step of steps) {
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
  renderedLineCount = steps.length;

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
  if (spinnerInterval) {
    clearInterval(spinnerInterval);
    spinnerInterval = null;
  }
}

// ---------------------------------------------------------------------------
// runAnalyze — main entry
// ---------------------------------------------------------------------------

export async function runAnalyze(_options: { noAutostart?: boolean } = {}): Promise<void> {
  p.intro("Analyzing repository");
  ensureClaudeCli();
  showFirstRunNotice();

  const project = resolveOrInitProject();
  p.log.step(`Repository: ${project.name}`);

  const config = readProjectConfig(project.path);
  const enabledCategories = config.enabledCategories ?? undefined;
  const enableLlmRules = config.enableLlmRules ?? true;

  // Open PGlite + run migrations up-front so the checklist starts clean.
  await getOrOpenProjectDb(project);

  const stepDefs = buildAnalysisSteps(enabledCategories, enableLlmRules);
  const tracker = new StepTracker((payload) => {
    if (payload.steps) renderSteps(payload.steps);
  }, stepDefs);

  const abortController = new AbortController();
  const onSigint = () => abortController.abort();
  process.on("SIGINT", onSigint);

  try {
    const result = await analyzeInProcess(project, {
      tracker,
      signal: abortController.signal,
      enabledCategoriesOverride: enabledCategories,
      enableLlmRulesOverride: enableLlmRules,
      onLlmEstimate: async (estimate) => {
        stopSpinner();
        const totalRules = estimate.uniqueRuleCount ?? estimate.tiers.reduce((s, t) => s + t.ruleCount, 0);
        const totalFiles = estimate.uniqueFileCount ?? estimate.tiers.reduce((s, t) => s + t.fileCount, 0);
        const tokens = estimate.totalEstimatedTokens;
        const tokenStr = tokens >= 1_000_000
          ? `~${(tokens / 1_000_000).toFixed(1)}M tokens`
          : `~${Math.round(tokens / 1000)}k tokens`;
        p.log.step(`LLM will analyze ${totalFiles} files with ${totalRules} rules (${tokenStr})`);
        const proceed = await p.confirm({ message: "Run LLM-powered rules?", initialValue: true });
        if (p.isCancel(proceed)) return false;
        if (!proceed) p.log.info("Skipping LLM rules.");
        return !!proceed;
      },
    });

    stopSpinner();
    p.log.success("Analysis complete");
    renderViolationsSummary([], result.violationsSummary);
    p.outro("Analysis complete — view results with: truecourse dashboard");
  } catch (err) {
    stopSpinner();
    if (err instanceof DOMException && err.name === "AbortError") {
      p.outro("Analysis cancelled");
      process.exit(130);
    }
    p.log.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  } finally {
    process.removeListener("SIGINT", onSigint);
  }
}

// ---------------------------------------------------------------------------
// Diff analyze — still served by the dashboard. Terminal diff command will be
// reintroduced in a follow-up that routes through analyzeInProcess.
// ---------------------------------------------------------------------------

export async function runAnalyzeDiff(_options: { noAutostart?: boolean } = {}): Promise<void> {
  p.log.error(
    "`truecourse analyze --diff` is currently available only from the dashboard's Git Diff mode.",
  );
  process.exit(1);
}
