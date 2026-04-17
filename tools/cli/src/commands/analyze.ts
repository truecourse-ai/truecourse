import * as p from "@clack/prompts";
import { execSync } from "node:child_process";
import path from "node:path";
import { analyzeInProcess } from "@truecourse/server/analyze";
import { StepTracker, buildAnalysisSteps, type AnalysisStep } from "@truecourse/server/progress";
import { ensureRepoTruecourseDir, resolveRepoDir } from "@truecourse/server/config/paths";
import { registerProject, type RegistryEntry } from "@truecourse/server/config/registry";
import { readProjectConfig } from "@truecourse/server/config/project-config";
import {
  autoConfigureMigrations,
  closeAllProjectDbs,
  getOrOpenProjectDb,
  initializeProjectDb,
} from "@truecourse/server/config/database";
import { closeLogger, configureLogger } from "@truecourse/server/lib/logger";
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

export async function runAnalyze(_options: { noAutostart?: boolean } = {}): Promise<void> {
  p.intro("Analyzing repository");
  ensureClaudeCli();
  showFirstRunNotice();

  const project = resolveOrInitProject();
  p.log.step(`Repository: ${project.name}`);

  // All internal pipeline logs (`[Pipeline]`, `[LLM]`, `[CLI]`, `[Analyzer]`,
  // `[Flows]`, `[Violations]`) go to this repo's analyze.log. The terminal
  // stays clean for the clack checklist + LLM estimate prompt + final
  // summary. `ensureRepoTruecourseDir` has already run via resolveOrInitProject.
  configureLogger({
    filePath: path.join(project.path, ".truecourse/logs/analyze.log"),
  });

  const config = readProjectConfig(project.path);
  const enabledCategories = config.enabledCategories ?? undefined;
  const enableLlmRules = config.enableLlmRules ?? true;

  // LLM disabled → no prompt will fire → render everything inline.
  // LLM enabled → start in pre-llm phase (parse + scan only). `onLlmEstimate`
  // flips to 'post-llm' once the user answers.
  renderPhase = enableLlmRules ? "pre-llm" : "all";

  // Bootstrap .truecourse/ + db/ on first analyze, then open PGlite and run
  // migrations up-front so the checklist starts clean.
  autoConfigureMigrations();
  await initializeProjectDb(project);
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
        // Prompt answered — subsequent renders show domain + persist steps
        // below the prompt; parse + scan are already printed above it.
        renderPhase = "post-llm";
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
    // PGlite runs in WASM and holds event-loop handles; close it explicitly
    // so the CLI exits as soon as analysis finishes instead of waiting for
    // the loop to drain.
    await closeAllProjectDbs();
    await closeLogger();
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
