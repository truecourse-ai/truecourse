import * as p from "@clack/prompts";
import { execSync } from "node:child_process";

export async function runSetup(): Promise<void> {
  p.intro("Welcome to TrueCourse");

  // Claude Code CLI is the only supported LLM provider.
  try {
    execSync("which claude", { stdio: "ignore" });
  } catch {
    p.log.error(
      "Claude Code CLI not found on PATH. Install it first: https://docs.anthropic.com/en/docs/claude-code",
    );
    process.exit(1);
  }
  p.log.success("Claude Code CLI detected.");

  // Run mode selection
  const runMode = await p.select({
    message: "How would you like to run TrueCourse?",
    options: [
      { value: "service" as const, label: "Background service (Recommended)" },
      { value: "console" as const, label: "Console (keep terminal open)" },
    ],
  });

  if (p.isCancel(runMode)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  // Rule category selection — use saved config if available
  const { readConfig: readExistingConfig } = await import("./helpers.js");
  const existingConfig = readExistingConfig();
  const { DEFAULT_DOMAINS } = await import("@truecourse/shared");
  const defaultCategories = [...DEFAULT_DOMAINS] as string[];
  const savedCategories = existingConfig.enabledCategories?.length
    ? existingConfig.enabledCategories
    : defaultCategories;

  const categories = await p.multiselect({
    message: "Which rule categories would you like to enable?",
    options: [
      { value: "security" as const, label: "Security (secrets, injection, crypto, auth)", hint: "recommended" },
      { value: "bugs" as const, label: "Bugs (runtime errors, null derefs, type issues)", hint: "recommended" },
      { value: "architecture" as const, label: "Architecture (service boundaries, layers, coupling)", hint: "recommended" },
      { value: "performance" as const, label: "Performance (N+1 queries, memory leaks, inefficient patterns)", hint: "recommended" },
      { value: "reliability" as const, label: "Reliability (error handling, timeouts, retries)", hint: "recommended" },
      { value: "code-quality" as const, label: "Code Quality (complexity, dead code, smells)", hint: "recommended" },
      { value: "database" as const, label: "Database (schema, indexes, constraints)", hint: "recommended" },
      { value: "style" as const, label: "Style (formatting, naming conventions, docstrings)" },
    ],
    initialValues: savedCategories,
    required: true,
  });

  if (p.isCancel(categories)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  // LLM rules toggle — use saved config if available
  const enableLlm = await p.confirm({
    message: "Enable LLM-powered rules? (costs tokens, slower but deeper analysis)",
    initialValue: existingConfig.enableLlmRules ?? true,
  });

  if (p.isCancel(enableLlm)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  const { writeConfig } = await import("./helpers.js");
  writeConfig({ runMode, enabledCategories: categories as string[], enableLlmRules: enableLlm });

  p.outro("Setup complete! Run `truecourse start` to start TrueCourse.");
}
