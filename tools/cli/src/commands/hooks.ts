import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { severityIcon, severityColor } from "./helpers.js";

const HOOK_IDENTIFIER = "# TrueCourse pre-commit hook";

const HOOK_SCRIPT = `#!/bin/sh
${HOOK_IDENTIFIER}
# Installed by: truecourse hooks install
# Bypass with: git commit --no-verify

exec truecourse hooks run
`;

type BlockRule =
  | string // rule key like "hardcoded-secret" or "code/hardcoded-secret"
  | { severity: string };

type HooksConfig = {
  "pre-commit"?: {
    "block-on"?: BlockRule[];
    timeout?: string;
  };
};

const DEFAULT_BLOCK_ON: BlockRule[] = [
  "code/hardcoded-secret",
  { severity: "critical" },
];

const DEFAULT_TIMEOUT_MS = 30_000;

// --- Git directory resolution ---

function findGitDir(from: string): string | null {
  let dir = from;
  while (true) {
    const gitPath = path.join(dir, ".git");
    if (fs.existsSync(gitPath)) {
      const stat = fs.statSync(gitPath);
      if (stat.isDirectory()) {
        return gitPath;
      }
      // Worktree: .git is a file containing "gitdir: <path>"
      if (stat.isFile()) {
        const content = fs.readFileSync(gitPath, "utf-8").trim();
        const match = content.match(/^gitdir:\s*(.+)$/);
        if (match) {
          const resolved = path.resolve(dir, match[1]);
          return resolved;
        }
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function findProjectRoot(from: string): string | null {
  let dir = from;
  while (true) {
    if (fs.existsSync(path.join(dir, ".git"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// --- Config loading ---

function parseTimeout(value: string): number {
  const match = value.match(/^(\d+)\s*(s|ms|m)?$/);
  if (!match) return DEFAULT_TIMEOUT_MS;
  const num = parseInt(match[1], 10);
  const unit = match[2] || "s";
  if (unit === "ms") return num;
  if (unit === "m") return num * 60_000;
  return num * 1_000;
}

function loadConfig(projectRoot: string): HooksConfig {
  const configPath = path.join(projectRoot, ".truecourse", "hooks.yaml");
  if (!fs.existsSync(configPath)) return {};

  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    return (yaml.load(raw) as HooksConfig) || {};
  } catch {
    return {};
  }
}

function getBlockRules(config: HooksConfig): BlockRule[] {
  return config["pre-commit"]?.["block-on"] ?? DEFAULT_BLOCK_ON;
}

function getTimeoutMs(config: HooksConfig): number {
  const raw = config["pre-commit"]?.timeout;
  return raw ? parseTimeout(raw) : DEFAULT_TIMEOUT_MS;
}

// --- Install / Uninstall / Status ---

export function runHooksInstall(): void {
  const gitDir = findGitDir(process.cwd());
  if (!gitDir) {
    console.error("Error: Not a git repository.");
    process.exit(1);
  }

  const hooksDir = path.join(gitDir, "hooks");
  fs.mkdirSync(hooksDir, { recursive: true });

  const hookPath = path.join(hooksDir, "pre-commit");

  if (fs.existsSync(hookPath)) {
    const existing = fs.readFileSync(hookPath, "utf-8");
    if (!existing.includes(HOOK_IDENTIFIER)) {
      console.error(
        "Error: A pre-commit hook already exists and was not installed by TrueCourse.",
      );
      console.error(`  ${hookPath}`);
      console.error("Remove it manually or integrate TrueCourse into your existing hook.");
      process.exit(1);
    }
    // Already installed by TrueCourse — overwrite with latest version
  }

  fs.writeFileSync(hookPath, HOOK_SCRIPT, { mode: 0o755 });
  console.log("TrueCourse pre-commit hook installed.");
  console.log(`  ${hookPath}`);
}

export function runHooksUninstall(): void {
  const gitDir = findGitDir(process.cwd());
  if (!gitDir) {
    console.error("Error: Not a git repository.");
    process.exit(1);
  }

  const hookPath = path.join(gitDir, "hooks", "pre-commit");

  if (!fs.existsSync(hookPath)) {
    console.log("No pre-commit hook installed.");
    return;
  }

  const content = fs.readFileSync(hookPath, "utf-8");
  if (!content.includes(HOOK_IDENTIFIER)) {
    console.error("Error: The pre-commit hook was not installed by TrueCourse. Leaving it in place.");
    process.exit(1);
  }

  fs.unlinkSync(hookPath);
  console.log("TrueCourse pre-commit hook removed.");
}

export function runHooksStatus(): void {
  const gitDir = findGitDir(process.cwd());
  if (!gitDir) {
    console.error("Error: Not a git repository.");
    process.exit(1);
  }

  const hookPath = path.join(gitDir, "hooks", "pre-commit");
  const installed =
    fs.existsSync(hookPath) &&
    fs.readFileSync(hookPath, "utf-8").includes(HOOK_IDENTIFIER);

  if (installed) {
    console.log("TrueCourse pre-commit hook: installed");
    console.log(`  ${hookPath}`);
  } else {
    console.log("TrueCourse pre-commit hook: not installed");
    console.log('  Run "truecourse hooks install" to set up.');
  }

  const projectRoot = findProjectRoot(process.cwd());
  if (projectRoot) {
    const configPath = path.join(projectRoot, ".truecourse", "hooks.yaml");
    if (fs.existsSync(configPath)) {
      console.log(`\nConfig: ${configPath}`);
      const config = loadConfig(projectRoot);
      const blockRules = getBlockRules(config);
      console.log("Block on:");
      for (const rule of blockRules) {
        if (typeof rule === "string") {
          console.log(`  - ${rule}`);
        } else {
          console.log(`  - severity: ${rule.severity}`);
        }
      }
      const timeoutMs = getTimeoutMs(config);
      console.log(`Timeout: ${timeoutMs / 1000}s`);
    } else {
      console.log("\nNo config file. Using defaults (block on: code/hardcoded-secret, severity: critical).");
    }
  }
}

// --- Run (called by the hook) ---

type CodeViolation = {
  ruleKey: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  columnStart: number;
  columnEnd: number;
  severity: string;
  title: string;
  content: string;
  snippet: string;
  fixPrompt?: string;
};

function shouldBlock(violation: CodeViolation, blockRules: BlockRule[]): boolean {
  for (const rule of blockRules) {
    if (typeof rule === "string") {
      // Match by rule key — support both "hardcoded-secret" and "code/hardcoded-secret"
      if (
        violation.ruleKey === rule ||
        violation.ruleKey === `code/${rule}`
      ) {
        return true;
      }
    } else if (rule.severity) {
      if (violation.severity.toLowerCase() === rule.severity.toLowerCase()) {
        return true;
      }
    }
  }
  return false;
}

export async function runHooksRun(): Promise<void> {
  const startTime = Date.now();

  process.stdout.write("TrueCourse pre-commit check...");

  const projectRoot = findProjectRoot(process.cwd());
  if (!projectRoot) {
    console.log(" skipped (not a git repository)");
    process.exit(0);
  }

  const config = loadConfig(projectRoot);
  const blockRules = getBlockRules(config);
  const timeoutMs = getTimeoutMs(config);

  // Get staged files (Added, Copied, Modified — skip Deleted)
  let stagedFiles: string[];
  try {
    const output = execSync("git diff --cached --name-only --diff-filter=ACM", {
      encoding: "utf-8",
      cwd: projectRoot,
    }).trim();
    stagedFiles = output ? output.split("\n") : [];
  } catch {
    console.log(" skipped (git error)");
    process.exit(0);
  }

  if (stagedFiles.length === 0) {
    console.log(" \u2714 passed (no staged files)");
    process.exit(0);
  }

  // Import analyzer dynamically to avoid loading tree-sitter when not needed
  let parseCode: typeof import("@truecourse/analyzer").parseCode;
  let detectLanguage: typeof import("@truecourse/analyzer").detectLanguage;
  let checkCodeRules: typeof import("@truecourse/analyzer").checkCodeRules;
  let CODE_RULES: typeof import("@truecourse/analyzer").CODE_RULES;

  try {
    const analyzer = await import("@truecourse/analyzer");
    parseCode = analyzer.parseCode;
    detectLanguage = analyzer.detectLanguage;
    checkCodeRules = analyzer.checkCodeRules;
    CODE_RULES = analyzer.CODE_RULES;
  } catch {
    console.log(" skipped (analyzer not available)");
    process.exit(0);
  }

  // Filter to supported languages
  const supportedFiles = stagedFiles.filter((f) => detectLanguage(f) !== null);

  if (supportedFiles.length === 0) {
    console.log(" \u2714 passed");
    process.exit(0);
  }

  const allViolations: CodeViolation[] = [];

  for (const filePath of supportedFiles) {
    // Check timeout
    if (Date.now() - startTime > timeoutMs) {
      console.log("\n  Warning: timeout reached, skipping remaining files.");
      break;
    }

    const language = detectLanguage(filePath);
    if (!language) continue;

    // Read staged content (not working copy)
    let content: string;
    try {
      content = execSync(`git show ":${filePath}"`, {
        encoding: "utf-8",
        cwd: projectRoot,
        maxBuffer: 5 * 1024 * 1024, // 5MB
      });
    } catch {
      // File might be binary or inaccessible
      continue;
    }

    // Parse and check
    try {
      const tree = parseCode(content, language);
      const violations = checkCodeRules(tree, filePath, content, CODE_RULES, language);
      allViolations.push(...violations);
    } catch {
      // Skip files that fail to parse
      continue;
    }
  }

  // Filter to blocking violations
  const blocking = allViolations.filter((v) => shouldBlock(v, blockRules));

  if (blocking.length === 0) {
    console.log(" \u2714 passed");
    process.exit(0);
  }

  // Print blocking violations
  console.log("\n");

  for (const v of blocking) {
    const icon = severityIcon(v.severity);
    const color = severityColor(v.severity);
    console.log(` ${color(`${icon} BLOCKED`)}: ${v.title}`);
    console.log(`   ${v.filePath}:${v.lineStart} \u2014 ${v.content}`);
    console.log("");
  }

  console.log("Commit blocked. Fix the issue or bypass with --no-verify.");
  process.exit(1);
}
