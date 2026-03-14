#!/usr/bin/env node

import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { runSetup } from "./commands/setup.js";
import { runStart } from "./commands/start.js";
import { runAdd } from "./commands/add.js";

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
  .action(async () => {
    const configDir = path.join(os.homedir(), ".truecourse");
    const envPath = path.join(configDir, ".env");
    const isFirstRun = !fs.existsSync(envPath);

    if (isFirstRun) {
      await runSetup();
    } else {
      await runStart();
    }
  });

program.parse();
