#!/usr/bin/env node

import { Command } from "commander";
import * as p from "@clack/prompts";
import { runAdd } from "./commands/add.js";
import { runAnalyze, runAnalyzeDiff } from "./commands/analyze.js";
import {
  runDashboard,
  runDashboardStop,
  runDashboardStatus,
  runDashboardLogs,
  runDashboardUninstall,
} from "./commands/dashboard.js";
import { runList, runListDiff, parseSeverityFlag } from "./commands/list.js";
import { runRulesCategories, runRulesLlm } from "./commands/rules.js";
import { readTelemetryConfig, writeTelemetryConfig } from "./telemetry.js";
import {
  runHooksInstall,
  runHooksUninstall,
  runHooksStatus,
  runHooksRun,
} from "./commands/hooks.js";

const program = new Command();

program
  .name("truecourse")
  .version("0.5.1")
  .description("TrueCourse CLI — analyze your repository and open the dashboard");

const dashboardCmd = program
  .command("dashboard")
  .description("Start the TrueCourse dashboard and open it in your browser")
  .option("--reconfigure", "Re-prompt for console vs background service mode")
  .option("--service", "Run as a background service (skips mode prompt)")
  .option("--console", "Run in this terminal (skips mode prompt)")
  .action(async (options) => {
    if (options.service && options.console) {
      console.error("error: --service and --console are mutually exclusive");
      process.exit(1);
    }
    const mode = options.service ? "service" : options.console ? "console" : undefined;
    await runDashboard({ reconfigure: options.reconfigure, mode });
  });

dashboardCmd
  .command("stop")
  .description("Stop the dashboard")
  .action(async () => {
    await runDashboardStop();
  });

dashboardCmd
  .command("status")
  .description("Show dashboard status")
  .action(async () => {
    await runDashboardStatus();
  });

dashboardCmd
  .command("logs")
  .description("Tail dashboard logs (service mode only)")
  .action(async () => {
    await runDashboardLogs();
  });

dashboardCmd
  .command("uninstall")
  .description("Remove the background service and revert to console mode")
  .action(async () => {
    await runDashboardUninstall();
  });

/**
 * Resolve the skills-install override from commander options.
 *
 * `--install-skills` and `--no-skills` are exposed as two separate flags
 * (rather than a paired `--skills` / `--no-skills`) because `--skills`
 * alone is ambiguous. That means commander stores them under two different
 * properties: `options.installSkills === true` for the first, and
 * `options.skills === false` for the second (commander's `--no-X` convention
 * creates a negated boolean under the `X` property).
 */
function resolveInstallSkills(
  options: { installSkills?: boolean; skills?: boolean },
): boolean | undefined {
  if (options.installSkills === true) return true;
  if (options.skills === false) return false;
  return undefined;
}

program
  .command("analyze")
  .description("Analyze the current repository")
  .option("--diff", "Run diff check against latest analysis")
  // `--llm` and `--no-llm` are auto-paired by commander — they both control
  // `options.llm`. Passing `--llm` → true, `--no-llm` → false, neither →
  // undefined (falls through to config / interactive prompt).
  .option("--llm", "Run LLM-powered rules (pre-approves the cost estimate)")
  .option("--no-llm", "Skip LLM-powered rules for this run")
  .option("--install-skills", "Install Claude Code skills without prompting")
  .option("--no-skills", "Skip the Claude Code skills prompt")
  .action(async (options) => {
    const llm: boolean | undefined = typeof options.llm === "boolean" ? options.llm : undefined;
    const installSkills = resolveInstallSkills(options);
    if (options.diff) {
      await runAnalyzeDiff({ llm, installSkills });
    } else {
      await runAnalyze({ llm, installSkills });
    }
  });

program
  .command("add")
  .description("Register the current directory with TrueCourse")
  .option("--install-skills", "Install Claude Code skills without prompting")
  .option("--no-skills", "Skip the Claude Code skills prompt")
  .action(async (options) => {
    await runAdd({ installSkills: resolveInstallSkills(options) });
  });

program
  .command("list")
  .description("List violations from the latest analysis")
  .option("--diff", "Show diff check results (new and resolved)")
  .option("--limit <n>", "Number of violations to show (default: 20)", parseInt)
  .option("--offset <n>", "Skip first N violations", parseInt)
  .option("--all", "Show all violations")
  .option(
    "--severity <list>",
    "Comma-separated severities to include (critical,high,medium,low,info)",
  )
  .action(async (options) => {
    if (options.diff) {
      await runListDiff();
    } else {
      await runList({
        limit: options.all ? Infinity : (options.limit ?? 20),
        offset: options.offset ?? 0,
        severity: parseSeverityFlag(options.severity),
      });
    }
  });

// Rules management — reads/writes per-repo config.json directly. No server needed.
const rulesCmd = program
  .command("rules")
  .description("Manage analysis rules");

rulesCmd
  .command("categories")
  .description("View or override rule categories for this repository")
  .option("--enable <category>", "Enable a category")
  .option("--disable <category>", "Disable a category")
  .option("--reset", "Reset to global default")
  .action(async (options) => {
    await runRulesCategories(options);
  });

rulesCmd
  .command("llm")
  .description("Enable or disable LLM-powered rules for this repository")
  .option("--enable", "Enable LLM rules")
  .option("--disable", "Disable LLM rules")
  .option("--reset", "Reset to global default")
  .action(async (options) => {
    await runRulesLlm(options);
  });

// Telemetry management
const telemetryCmd = program
  .command("telemetry")
  .description("Manage anonymous usage telemetry");

telemetryCmd
  .command("enable")
  .description("Enable anonymous usage telemetry")
  .action(() => {
    writeTelemetryConfig({ enabled: true });
    p.log.success("Telemetry enabled. Thank you for helping improve TrueCourse!");
  });

telemetryCmd
  .command("disable")
  .description("Disable anonymous usage telemetry")
  .action(() => {
    writeTelemetryConfig({ enabled: false });
    p.log.success("Telemetry disabled. No data will be collected.");
  });

telemetryCmd
  .command("status")
  .description("Show current telemetry status")
  .action(() => {
    const config = readTelemetryConfig();
    if (process.env.CI === "true") {
      p.log.info("Telemetry is automatically disabled in CI environments.");
    } else if (config.enabled) {
      p.log.info("Telemetry is enabled.");
    } else {
      p.log.info("Telemetry is disabled.");
    }
  });

// Git hooks management
const hooksCmd = program
  .command("hooks")
  .description("Manage git hooks");

hooksCmd
  .command("install")
  .description("Install pre-commit hook")
  .action(async () => {
    await runHooksInstall();
  });

hooksCmd
  .command("uninstall")
  .description("Remove pre-commit hook")
  .action(() => {
    runHooksUninstall();
  });

hooksCmd
  .command("status")
  .description("Show hook installation status")
  .action(() => {
    runHooksStatus();
  });

hooksCmd
  .command("run")
  .description("Run pre-commit checks (called by the hook)")
  .action(async () => {
    await runHooksRun();
  });

program.action(() => {
  program.outputHelp();
});

program.parse();
