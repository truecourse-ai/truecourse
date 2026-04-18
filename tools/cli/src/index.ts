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
import { runList, runListDiff } from "./commands/list.js";
import {
  getServerUrl,
  requireDashboard,
  requireRegisteredRepo,
} from "./commands/helpers.js";
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
  .version("0.4.0")
  .description("TrueCourse CLI — analyze your repository and open the dashboard");

const dashboardCmd = program
  .command("dashboard")
  .description("Start the TrueCourse dashboard and open it in your browser")
  .action(async () => {
    await runDashboard();
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
  .action(() => {
    runDashboardLogs();
  });

dashboardCmd
  .command("uninstall")
  .description("Remove the background service and revert to console mode")
  .action(async () => {
    await runDashboardUninstall();
  });

program
  .command("analyze")
  .description("Analyze the current repository")
  .option("--diff", "Run diff check against latest analysis")
  .action(async (options) => {
    if (options.diff) {
      await runAnalyzeDiff();
    } else {
      await runAnalyze();
    }
  });

program
  .command("add")
  .description("Register the current directory with TrueCourse")
  .action(async () => {
    await runAdd();
  });

program
  .command("list")
  .description("List violations from the latest analysis")
  .option("--diff", "Show diff check results (new and resolved)")
  .option("--limit <n>", "Number of violations to show (default: 20)", parseInt)
  .option("--offset <n>", "Skip first N violations", parseInt)
  .option("--all", "Show all violations")
  .action(async (options) => {
    if (options.diff) {
      await runListDiff();
    } else {
      await runList({
        limit: options.all ? Infinity : (options.limit ?? 20),
        offset: options.offset ?? 0,
      });
    }
  });

// Rules management — talks to the dashboard API.
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
    await requireDashboard();
    const repo = requireRegisteredRepo();
    const serverUrl = getServerUrl();

    const { DOMAIN_ORDER } = await import("@truecourse/shared");
    const allCategories = [...DOMAIN_ORDER] as string[];

    if (options.reset) {
      await fetch(`${serverUrl}/api/repos/${repo.id}/categories`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabledCategories: null }),
      });
      p.log.success("Reset to global default categories.");
      return;
    }

    if (options.enable || options.disable) {
      const cat = options.enable || options.disable;
      if (!allCategories.includes(cat)) {
        p.log.error(`Invalid category: ${cat}. Valid: ${allCategories.join(", ")}`);
        process.exit(1);
      }

      const repoRes = await fetch(`${serverUrl}/api/repos/${repo.id}`);
      const repoData = (await repoRes.json()) as { enabledCategories?: string[] | null };
      const hasOverride =
        repoData.enabledCategories !== null && repoData.enabledCategories !== undefined;
      const current = new Set<string>(
        hasOverride ? repoData.enabledCategories! : allCategories,
      );

      if (options.enable) current.add(cat);
      else current.delete(cat);

      await fetch(`${serverUrl}/api/repos/${repo.id}/categories`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabledCategories: [...current] }),
      });
      p.log.success(`${options.enable ? "Enabled" : "Disabled"} ${cat} rules for ${repo.name}.`);
      return;
    }

    const repoRes = await fetch(`${serverUrl}/api/repos/${repo.id}`);
    const repoData = (await repoRes.json()) as { enabledCategories?: string[] | null };
    const isOverride =
      repoData.enabledCategories !== null && repoData.enabledCategories !== undefined;
    const enabled = new Set<string>(
      isOverride ? repoData.enabledCategories! : allCategories,
    );

    const status = (cat: string) =>
      enabled.has(cat) ? "\x1b[32menabled\x1b[0m" : "\x1b[31mdisabled\x1b[0m";

    p.log.info(
      `Rule categories for ${repo.name}${isOverride ? " (per-repo override)" : " (global default)"}:`,
    );
    for (const cat of allCategories) {
      console.log(`  ${cat.padEnd(14)} ${status(cat)}`);
    }
    console.log("");
    if (!isOverride) {
      p.log.info("Override with: truecourse rules categories --enable/--disable <name>");
    }
  });

rulesCmd
  .command("llm")
  .description("Enable or disable LLM-powered rules for this repository")
  .option("--enable", "Enable LLM rules")
  .option("--disable", "Disable LLM rules")
  .option("--reset", "Reset to global default")
  .action(async (options) => {
    await requireDashboard();
    const repo = requireRegisteredRepo();
    const serverUrl = getServerUrl();

    if (options.reset) {
      await fetch(`${serverUrl}/api/repos/${repo.id}/llm`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enableLlmRules: null }),
      });
      p.log.success("Reset LLM rules to global default.");
      return;
    }

    if (options.enable || options.disable) {
      const enabled = !!options.enable;
      await fetch(`${serverUrl}/api/repos/${repo.id}/llm`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enableLlmRules: enabled }),
      });
      p.log.success(`LLM rules ${enabled ? "enabled" : "disabled"} for ${repo.name}.`);
      return;
    }

    const repoRes = await fetch(`${serverUrl}/api/repos/${repo.id}`);
    const repoData = (await repoRes.json()) as { enableLlmRules?: boolean | null };
    const isOverride =
      repoData.enableLlmRules !== null && repoData.enableLlmRules !== undefined;
    const effective = isOverride ? repoData.enableLlmRules! : true;
    const status = effective ? "\x1b[32menabled\x1b[0m" : "\x1b[31mdisabled\x1b[0m";
    p.log.info(
      `LLM rules for ${repo.name}${isOverride ? " (per-repo override)" : " (global default)"}: ${status}`,
    );
    if (!isOverride) {
      p.log.info("Override with: truecourse rules llm --enable/--disable");
    }
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
  .action(() => {
    runHooksInstall();
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
