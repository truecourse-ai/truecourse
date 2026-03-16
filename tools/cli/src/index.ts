#!/usr/bin/env node

import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { runSetup } from "./commands/setup.js";
import { runStart } from "./commands/start.js";
import { runAdd } from "./commands/add.js";
import { runAnalyze, runAnalyzeDiff } from "./commands/analyze.js";
import { runList, runListDiff } from "./commands/list.js";

const program = new Command();

program
  .name("truecourse")
  .version("0.1.0")
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
  .action(async (options) => {
    if (options.diff) {
      await runAnalyzeDiff();
    } else {
      await runAnalyze();
    }
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
