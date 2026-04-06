#!/usr/bin/env node

import { Command } from "commander";
import * as p from "@clack/prompts";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { runSetup } from "./commands/setup.js";
import { runStart } from "./commands/start.js";
import { runAdd } from "./commands/add.js";
import { runAnalyze, runAnalyzeDiff } from "./commands/analyze.js";
import { runList, runListDiff } from "./commands/list.js";
import { registerServiceCommand } from "./commands/service/index.js";
import { readConfig } from "./commands/helpers.js";
import { getPlatform } from "./commands/service/platform.js";
import { readTelemetryConfig, writeTelemetryConfig } from "./telemetry.js";
import { runHooksInstall, runHooksUninstall, runHooksStatus, runHooksRun } from "./commands/hooks.js";

const program = new Command();

program
  .name("truecourse")
  .version("0.2.2")
  .description("TrueCourse CLI - Setup and manage your TrueCourse instance");

program
  .command("setup")
  .description("Run the setup wizard to configure TrueCourse")
  .action(async () => {
    await runSetup();
  });

program
  .command("start")
  .description("Start TrueCourse services")
  .action(async () => {
    await runStart();
  });

program
  .command("dashboard")
  .description("Open the TrueCourse dashboard in your browser")
  .action(async () => {
    const { getServerUrl, openInBrowser } = await import("./commands/helpers.js");
    const url = getServerUrl();
    try {
      const res = await fetch(`${url}/api/health`);
      if (!res.ok) throw new Error();
    } catch {
      p.log.error("TrueCourse server is not running.");
      p.log.info("Start it first with: truecourse start");
      process.exit(1);
    }
    openInBrowser(url);
    p.log.success(`Dashboard opened at ${url}`);
  });

program
  .command("add")
  .description("Add the current directory as a repository")
  .action(async () => {
    await runAdd();
  });

program
  .command("analyze")
  .description("Analyze the current repository")
  .option("--diff", "Run diff check against latest analysis")
  .option("--no-autostart", "Don't auto-start the server (for use from Claude Code skills)")
  .action(async (options) => {
    if (options.diff) {
      await runAnalyzeDiff({ noAutostart: !options.autostart });
    } else {
      await runAnalyze({ noAutostart: !options.autostart });
    }
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
      await runList({ limit: options.all ? Infinity : (options.limit ?? 20), offset: options.offset ?? 0 });
    }
  });

// Rules management
const rulesCmd = program
  .command("rules")
  .description("Manage analysis rules");

rulesCmd
  .command("categories")
  .description("View or override rule categories for this repository")
  .option("--enable <category>", "Enable a category (architecture, security, bugs, code-quality, style, performance, reliability, database)")
  .option("--disable <category>", "Disable a category (architecture, security, bugs, code-quality, style, performance, reliability, database)")
  .option("--reset", "Reset to global default")
  .action(async (options) => {
    const { getServerUrl, ensureServer, ensureRepo } = await import("./commands/helpers.js");
    await ensureServer();
    const repo = await ensureRepo();
    const serverUrl = getServerUrl();

    const allCategories = ["architecture", "security", "bugs", "code-quality", "style", "performance", "reliability", "database"];

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

      // Fetch current repo state — start from per-repo override or global config
      const { readConfig } = await import("./commands/helpers.js");
      const globalConfig = readConfig();
      const repoRes = await fetch(`${serverUrl}/api/repos/${repo.id}`);
      const repoData = (await repoRes.json()) as { enabledCategories?: string[] | null };
      const hasOverride = repoData.enabledCategories !== null && repoData.enabledCategories !== undefined;
      const current = new Set<string>(hasOverride ? repoData.enabledCategories! : (globalConfig.enabledCategories ?? allCategories));

      if (options.enable) {
        current.add(cat);
      } else {
        current.delete(cat);
      }

      await fetch(`${serverUrl}/api/repos/${repo.id}/categories`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabledCategories: [...current] }),
      });
      p.log.success(`${options.enable ? "Enabled" : "Disabled"} ${cat} rules for ${repo.name}.`);
      return;
    }

    // Show current state — per-repo override > global config
    const { readConfig } = await import("./commands/helpers.js");
    const globalConfig = readConfig();
    const repoRes = await fetch(`${serverUrl}/api/repos/${repo.id}`);
    const repoData = (await repoRes.json()) as { enabledCategories?: string[] | null };
    const isOverride = repoData.enabledCategories !== null && repoData.enabledCategories !== undefined;
    const enabled = new Set<string>(isOverride ? repoData.enabledCategories! : (globalConfig.enabledCategories ?? allCategories));

    const status = (cat: string) => enabled.has(cat) ? "\x1b[32menabled\x1b[0m" : "\x1b[31mdisabled\x1b[0m";

    p.log.info(`Rule categories for ${repo.name}${isOverride ? " (per-repo override)" : " (global default)"}:`);
    console.log(`  security       ${status("security")}`);
    console.log(`  bugs           ${status("bugs")}`);
    console.log(`  architecture   ${status("architecture")}`);
    console.log(`  performance    ${status("performance")}`);
    console.log(`  reliability    ${status("reliability")}`);
    console.log(`  code-quality   ${status("code-quality")}`);
    console.log(`  database       ${status("database")}`);
    console.log(`  style          ${status("style")}`);
    console.log("");
    if (!isOverride) {
      p.log.info("Override with: truecourse rules categories --enable/--disable <name>");
    }
  });

// Register service subcommands
registerServiceCommand(program);

// Top-level stop command
program
  .command("stop")
  .description("Stop the TrueCourse background service")
  .action(async () => {
    const config = readConfig();

    if (config.runMode === "service") {
      const platform = getPlatform();
      const { running } = await platform.status();
      if (running) {
        p.log.step("Stopping background service...");
        await platform.stop();
        p.log.success("Service stopped.");
      } else {
        p.log.info("Service is not running.");
      }
    } else {
      p.log.info("TrueCourse is running in console mode.");
      p.log.info("Press Ctrl+C in the terminal where TrueCourse is running.");
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

program
  .action(async () => {
    const configDir = path.join(os.homedir(), ".truecourse");
    const envPath = path.join(configDir, ".env");
    const isFirstRun = !fs.existsSync(envPath);

    if (isFirstRun) {
      await runSetup();
    }
    await runStart();
  });

program.parse();
