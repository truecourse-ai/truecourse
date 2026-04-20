import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import * as p from "@clack/prompts";
import { resolveRepoDir } from "@truecourse/server/config/paths";
import { getProjectByPath, registerProject } from "@truecourse/server/config/registry";
import { readLatest } from "@truecourse/server/lib/analysis-store";
import { diffInProcess } from "@truecourse/server/diff";
import { isInteractive, severityIcon, severityColor } from "./helpers.js";

// ---------------------------------------------------------------------------
// Hook script + identifier
// ---------------------------------------------------------------------------

const HOOK_IDENTIFIER = "# TrueCourse pre-commit hook";

// `npx -y` works whether or not the user has truecourse installed globally:
//   * globally installed  → npx exec's the local binary with no download
//   * cached npx install  → npx runs it from the cache
//   * nothing cached      → npx fetches the latest and runs it
// `-y` silences the "Need to install… Ok to proceed?" prompt, which would
// otherwise hang the git-commit flow. A bare `exec truecourse` fails with
// "command not found" on machines that only use truecourse via npx.
const HOOK_SCRIPT = `#!/bin/sh
${HOOK_IDENTIFIER}
# Installed by: truecourse hooks install
# Bypass with: git commit --no-verify

exec npx -y truecourse hooks run
`;

// ---------------------------------------------------------------------------
// Config: severity-only block list + optional LLM toggle
// ---------------------------------------------------------------------------

const SEVERITIES = ["info", "low", "medium", "high", "critical"] as const;
type Severity = (typeof SEVERITIES)[number];

interface HooksConfig {
  "pre-commit"?: {
    "block-on"?: Severity[];
    llm?: boolean;
  };
}

// `[critical, high]` because the hook only gates on *newly-introduced*
// violations via diff — it never surfaces existing debt. Blocking on new
// criticals and new highs catches things like SQL injection, unhandled
// async exceptions, race conditions, missing input validation. Medium
// and below (style, complexity) aren't worth friction on every commit.
// Users wanting stricter or more permissive override via hooks.yaml.
/**
 * Template written to `.truecourse/hooks.yaml` on `hooks install` when the
 * file doesn't already exist. **This is the only place default values
 * live.** At runtime the hook reads `hooks.yaml` and nothing else — no
 * code-level fallback. If the file is gone, the hook can't know what to
 * enforce, so it warns and passes.
 */
const HOOKS_YAML_TEMPLATE = `# TrueCourse pre-commit hook config.
# Commit this file — it's the team-shared policy for what blocks a commit.
# Check the live values with \`truecourse hooks status\`.
pre-commit:
  # Severities that block a commit when the diff surfaces NEW violations
  # at that level. Valid: info, low, medium, high, critical.
  block-on:
    - critical
    - high

  # Run LLM-powered rules on every commit? Off by default (no tokens per
  # commit). Set to true for deeper semantic checks at the commit gate —
  # each commit will then cost tokens.
  llm: false
`;

// ---------------------------------------------------------------------------
// Git directory resolution
// ---------------------------------------------------------------------------

function findGitDir(from: string): string | null {
  let dir = from;
  while (true) {
    const gitPath = path.join(dir, ".git");
    if (fs.existsSync(gitPath)) {
      const stat = fs.statSync(gitPath);
      if (stat.isDirectory()) return gitPath;
      // Worktree: .git is a file containing "gitdir: <path>"
      if (stat.isFile()) {
        const content = fs.readFileSync(gitPath, "utf-8").trim();
        const match = content.match(/^gitdir:\s*(.+)$/);
        if (match) return path.resolve(dir, match[1]);
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
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// ---------------------------------------------------------------------------
// Config loading + validation
// ---------------------------------------------------------------------------

interface LoadedHooksConfig {
  blockOn: readonly Severity[];
  llm: boolean;
  configPath: string;
}

/**
 * Load `.truecourse/hooks.yaml`. Returns `null` when the file doesn't
 * exist — callers decide what to do (the hook runner warns and passes;
 * status reports "no config"). A malformed file exits 1 with a clear
 * message; we never silently accept garbage.
 */
function loadConfig(projectRoot: string): LoadedHooksConfig | null {
  const configPath = path.join(projectRoot, ".truecourse", "hooks.yaml");
  if (!fs.existsSync(configPath)) return null;

  let parsed: HooksConfig;
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    parsed = (yaml.load(raw) as HooksConfig) || {};
  } catch (err) {
    console.error(`Error parsing ${configPath}: ${(err as Error).message}`);
    process.exit(1);
  }

  const preCommit = parsed["pre-commit"] ?? {};
  const rawBlockOn = preCommit["block-on"];
  if (!Array.isArray(rawBlockOn)) {
    console.error(
      `Invalid ${configPath}: \`pre-commit.block-on\` must be an array of severity names.`,
    );
    console.error(`  Valid severities: ${SEVERITIES.join(", ")}`);
    process.exit(1);
  }
  const invalid = rawBlockOn.filter(
    (s) => typeof s !== "string" || !(SEVERITIES as readonly string[]).includes(s),
  );
  if (invalid.length > 0) {
    console.error(
      `Invalid ${configPath}: unknown value(s) in \`pre-commit.block-on\`: ${invalid
        .map((v) => JSON.stringify(v))
        .join(", ")}`,
    );
    console.error(`  Valid severities: ${SEVERITIES.join(", ")}`);
    process.exit(1);
  }

  return {
    blockOn: rawBlockOn as Severity[],
    llm: preCommit.llm === true,
    configPath,
  };
}

// ---------------------------------------------------------------------------
// Install / Uninstall / Status
// ---------------------------------------------------------------------------

const INSTALL_WARNING =
  "The pre-commit hook runs `truecourse analyze --diff` on every commit.\n" +
  "Commits will take as long as a full diff analysis of this repo —\n" +
  "on large repos that can be tens of seconds per commit.";

export async function runHooksInstall(): Promise<void> {
  const gitDir = findGitDir(process.cwd());
  if (!gitDir) {
    console.error("Error: Not a git repository.");
    process.exit(1);
  }

  // Warn about commit latency. In a TTY, require explicit confirmation;
  // non-interactive installs (CI, devcontainer setup) get the notice and
  // proceed — they're intentional and shouldn't hang.
  if (isInteractive()) {
    p.log.warn(INSTALL_WARNING);
    const proceed = await p.confirm({
      message: "Install the pre-commit hook?",
      initialValue: false,
    });
    if (p.isCancel(proceed) || !proceed) {
      p.cancel("Install cancelled.");
      process.exit(0);
    }
  } else {
    console.log(INSTALL_WARNING);
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

  // Seed the team-shared policy file on first install. We never overwrite
  // an existing hooks.yaml — that's the user's config.
  const projectRoot = findProjectRoot(process.cwd());
  if (projectRoot) {
    const cfgDir = path.join(projectRoot, ".truecourse");
    const cfgPath = path.join(cfgDir, "hooks.yaml");
    if (!fs.existsSync(cfgPath)) {
      fs.mkdirSync(cfgDir, { recursive: true });
      fs.writeFileSync(cfgPath, HOOKS_YAML_TEMPLATE);
      console.log(`  ${cfgPath} (starter config — edit to customize, commit to share with the team)`);
    }
  }
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
    const cfg = loadConfig(projectRoot);
    if (!cfg) {
      console.log(
        "\nNo `.truecourse/hooks.yaml` — hook has no policy. Run `truecourse hooks install` to generate one.",
      );
    } else {
      console.log(`\nConfig: ${cfg.configPath}`);
      console.log(`Block on severities: ${cfg.blockOn.join(", ")}`);
      console.log(`LLM rules on commit: ${cfg.llm ? "enabled (tokens per commit)" : "disabled"}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Run (called by the hook script)
// ---------------------------------------------------------------------------

/**
 * The hook runs the same `analyze --diff` pipeline the user would get from
 * `truecourse analyze --diff`, then filters new violations by severity. No
 * custom per-file parse loop — one pipeline keeps the hook aligned with the
 * dashboard and with `truecourse list --diff`.
 */
export async function runHooksRun(): Promise<void> {
  process.stdout.write("TrueCourse pre-commit check...");

  const projectRoot = findProjectRoot(process.cwd());
  if (!projectRoot) {
    console.log(" skipped (not a git repository)");
    process.exit(0);
  }

  // Any staged files at all? No staged content → nothing to check.
  let hasStaged = false;
  try {
    const output = execSync("git diff --cached --name-only --diff-filter=ACM", {
      encoding: "utf-8",
      cwd: projectRoot,
    }).trim();
    hasStaged = output.length > 0;
  } catch {
    console.log(" skipped (git error)");
    process.exit(0);
  }
  if (!hasStaged) {
    console.log(" \u2714 passed (no staged files)");
    process.exit(0);
  }

  // hooks.yaml is the single source of truth. If it's gone, the hook
  // has no policy to enforce — warn and pass. Users who want the hook
  // active can recreate the file with `truecourse hooks install`.
  const cfg = loadConfig(projectRoot);
  if (!cfg) {
    console.log(" skipped");
    console.error(
      "No `.truecourse/hooks.yaml` found. The pre-commit hook has no policy to\n" +
        "enforce — run `truecourse hooks install` to generate one.",
    );
    process.exit(0);
  }

  // The diff pipeline compares against the last full analysis. Without
  // a `.truecourse/` dir or a LATEST snapshot, there's nothing to diff
  // against — block with a clear message rather than letting commits
  // silently pass (a silent-pass hook is worse than no hook: the user
  // would think they were protected when they aren't).
  const repoDir = resolveRepoDir(process.cwd());
  const project = repoDir
    ? (getProjectByPath(repoDir) ?? registerProject(repoDir))
    : null;
  if (!project || !readLatest(project.path)) {
    console.log("");
    console.error(
      "No baseline analysis yet. Run `truecourse analyze` once in this repo before\n" +
        "the pre-commit hook can block new violations. Or bypass this commit with\n" +
        "`git commit --no-verify`.",
    );
    process.exit(1);
  }

  // Ctrl-C during a long commit should cancel the diff cleanly.
  const abortController = new AbortController();
  const onSigint = () => abortController.abort();
  process.on("SIGINT", onSigint);

  process.stdout.write(" running analysis...");

  let newViolations: Awaited<ReturnType<typeof diffInProcess>>["diff"]["newViolations"];
  try {
    const { diff } = await diffInProcess(project, {
      signal: abortController.signal,
      enableLlmRulesOverride: cfg.llm,
      // Pre-approved: the user opted into LLM-in-hook by setting llm: true
      // in hooks.yaml, so we don't re-prompt for the token cost estimate.
      onLlmEstimate: async () => true,
    });
    newViolations = diff.newViolations;
  } catch (err) {
    console.log("");
    if (err instanceof DOMException && err.name === "AbortError") {
      console.error("Pre-commit check cancelled.");
      process.exit(130);
    }
    console.error(`Pre-commit check failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  } finally {
    process.removeListener("SIGINT", onSigint);
  }

  const blockSet = new Set<string>(cfg.blockOn);
  const blocking = newViolations.filter((v) => blockSet.has(v.severity.toLowerCase()));

  if (blocking.length === 0) {
    console.log(` \u2714 passed (${newViolations.length} new violations, none at or above ${cfg.blockOn.join("/")})`);
    process.exit(0);
  }

  console.log("\n");
  for (const v of blocking) {
    const icon = severityIcon(v.severity);
    const color = severityColor(v.severity);
    const location = v.filePath
      ? `${v.filePath}${v.lineStart ? `:${v.lineStart}` : ""}`
      : "(no file)";
    console.log(` ${color(`${icon} BLOCKED`)}: ${v.title}`);
    console.log(`   ${location} \u2014 ${v.content}`);
    if (v.fixPrompt) console.log(`   Fix: ${v.fixPrompt}`);
    console.log("");
  }

  console.log("Commit blocked. Fix the issue or bypass with --no-verify.");
  process.exit(1);
}
