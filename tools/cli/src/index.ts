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

const program = new Command();

program
  .name("truecourse")
  .version("0.3.0")
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
  .command("add")
  .description("Add the current directory as a repository")
  .action(async () => {
    await runAdd();
  });

program
  .command("analyze")
  .description("Analyze the current repository")
  .option("--diff", "Run diff check against latest analysis")
  .option("--code-review", "Include LLM code review (off by default)")
  .option("--no-llm", "Skip all LLM calls, run only deterministic checks")
  .option("--no-autostart", "Don't auto-start the server (for use from Claude Code skills)")
  .action(async (options) => {
    if (options.diff) {
      await runAnalyzeDiff({ noAutostart: !options.autostart });
    } else {
      await runAnalyze({ noAutostart: !options.autostart, codeReview: options.codeReview ?? false, deterministicOnly: !options.llm });
    }
  });

program
  .command("code-review")
  .description("Run LLM code review on the latest analysis")
  .option("--diff", "Run on the latest diff analysis instead")
  .option("--no-autostart", "Don't auto-start the server")
  .action(async (options) => {
    const { runCodeReviewCmd } = await import("./commands/code-review.js");
    await runCodeReviewCmd({ noAutostart: !options.autostart, diff: options.diff ?? false });
  });

program
  .command("list")
  .description("List violations from the latest analysis")
  .option("--diff", "Show diff check results (new and resolved)")
  .action(async (options) => {
    if (options.diff) {
      await runListDiff();
    } else {
      await runList();
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
