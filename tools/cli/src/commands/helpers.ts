import * as p from "@clack/prompts";
import { exec } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRepoDir } from "@truecourse/server/config/paths";
import { getProjectByPath, registerProject } from "@truecourse/server/config/registry";

const DEFAULT_PORT = 3001;

// --- Config utilities ---

export type TrueCourseConfig = {
  runMode: "console" | "service";
};

const DEFAULT_CONFIG: TrueCourseConfig = { runMode: "console" };

export function getConfigPath(): string {
  return path.join(os.homedir(), ".truecourse", "config.json");
}

export function readConfig(): TrueCourseConfig {
  const configPath = getConfigPath();
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function writeConfig(partial: Partial<TrueCourseConfig>): void {
  const configPath = getConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const current = readConfig();
  const merged = { ...current, ...partial };
  fs.writeFileSync(configPath, JSON.stringify(merged, null, 2) + "\n", "utf-8");
}

export function getServerUrl(): string {
  const port = process.env.PORT || DEFAULT_PORT;
  return `http://localhost:${port}`;
}

/**
 * Resolve the current directory's registered project from the local registry.
 * Registers the repo on first use. Exits if no `.truecourse/` is found.
 */
export function requireRegisteredRepo(): { id: string; name: string; path: string } {
  const repoDir = resolveRepoDir(process.cwd());
  if (!repoDir) {
    p.log.error(
      "No TrueCourse project found here. Run `truecourse analyze` to set one up.",
    );
    process.exit(1);
  }
  const entry = getProjectByPath(repoDir) ?? registerProject(repoDir);
  return { id: entry.slug, name: entry.name, path: entry.path };
}

type Severity = string;

export function severityIcon(severity: Severity): string {
  const s = severity.toLowerCase();
  if (s === "critical" || s === "high") return "\u2716";
  if (s === "medium") return "\u26A0";
  return "\u2139";
}

export function severityColor(severity: Severity): (text: string) => string {
  const s = severity.toLowerCase();
  // 256-color ANSI to match UI: critical=red-700, high=red-500, medium=orange-500, low=amber-500, info=blue-500
  if (s === "critical") return (t) => `\x1b[38;5;160m${t}\x1b[0m`; // red-700
  if (s === "high") return (t) => `\x1b[38;5;196m${t}\x1b[0m`; // red-500
  if (s === "medium") return (t) => `\x1b[38;5;208m${t}\x1b[0m`; // orange-500
  if (s === "low") return (t) => `\x1b[38;5;214m${t}\x1b[0m`; // amber-500
  return (t) => `\x1b[38;5;33m${t}\x1b[0m`; // blue-500
}

export type Violation = {
  id: string;
  type: string;
  title: string;
  content: string;
  severity: string;
  targetServiceName?: string | null;
  targetModuleName?: string | null;
  targetMethodName?: string | null;
  targetDatabaseName?: string | null;
  targetTable?: string | null;
  fixPrompt?: string | null;
};

function buildTargetPath(v: Violation): string {
  const parts: string[] = [];
  if (v.targetServiceName) parts.push(v.targetServiceName);
  if (v.targetDatabaseName) parts.push(v.targetDatabaseName);
  if (v.targetModuleName) parts.push(v.targetModuleName);
  if (v.targetMethodName) parts.push(v.targetMethodName);
  if (v.targetTable) parts.push(`table: ${v.targetTable}`);
  return parts.join(" :: ");
}

function wrapText(text: string, indent: string, maxWidth: number): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && line.length + 1 + word.length > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.map((l, i) => (i === 0 ? l : `${indent}${l}`)).join("\n");
}

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0, high: 1, medium: 2, low: 3, info: 4,
};

export function renderViolations(violations: Violation[], { total = violations.length, offset = 0 } = {}): void {
  if (violations.length === 0 && total === 0) {
    p.log.info("No violations found. Run `truecourse analyze` first.");
    return;
  }

  console.log("");

  const counts: Record<string, number> = {};
  for (const v of violations) {
    const sev = v.severity.toLowerCase();
    counts[sev] = (counts[sev] || 0) + 1;
  }

  for (const v of violations) {
    const icon = severityIcon(v.severity);
    const color = severityColor(v.severity);
    const label = v.severity.toUpperCase();
    const target = buildTargetPath(v);

    console.log(`  ${color(`${icon} ${label}`)}  ${v.title}`);
    if (target) {
      console.log(`              ${target}`);
    }
    if (v.fixPrompt) {
      const indent = "              ";
      console.log("");
      console.log(`              Fix: ${wrapText(v.fixPrompt, indent + "     ", 60)}`);
    }
    console.log("");
  }

  console.log("  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");

  const parts: string[] = [];
  for (const sev of ["critical", "high", "medium", "low", "info"]) {
    if (counts[sev]) parts.push(`${counts[sev]} ${sev}`);
  }

  const showing = violations.length;
  const end = offset + showing;

  if (showing < total) {
    console.log(`  Showing ${offset + 1}\u2013${end} of ${total} violations (${parts.join(", ")})`);
    if (end < total) {
      console.log(`  Next page: truecourse list --offset ${end}`);
    }
  } else {
    console.log(`  ${total} violations (${parts.join(", ")})`);
  }
  console.log("");
}

export function renderViolationsSummary(
  violations: Violation[],
  summary?: { total: number; bySeverity: Record<string, number> },
): void {
  const counts: Record<string, number> = {};

  if (summary) {
    for (const [sev, c] of Object.entries(summary.bySeverity)) {
      counts[sev.toLowerCase()] = (counts[sev.toLowerCase()] || 0) + c;
    }
  } else {
    for (const v of violations) {
      const sev = v.severity.toLowerCase();
      counts[sev] = (counts[sev] || 0) + 1;
    }
  }

  const totalCount = summary?.total ?? violations.length;

  if (totalCount === 0) {
    p.log.info("No violations found.");
    return;
  }

  const parts: string[] = [];
  for (const sev of ["critical", "high", "medium", "low", "info"]) {
    if (counts[sev]) {
      const color = severityColor(sev);
      parts.push(color(`${counts[sev]} ${sev}`));
    }
  }

  console.log("");
  console.log(`  ${totalCount} violations (${parts.join(", ")})`);
  console.log("");
  p.log.info("Run `truecourse list` to see full details.");
}

export type DiffResult = {
  changedFiles: Array<{ path: string; status: "new" | "modified" | "deleted" }>;
  newViolations: Array<Violation & { fixPrompt?: string | null }>;
  resolvedViolations: Violation[];
  summary: { newCount: number; resolvedCount: number };
  isStale?: boolean;
};

export function renderDiffResults(result: DiffResult): void {
  console.log("");

  // Changed files summary
  const modified = result.changedFiles.filter((f) => f.status === "modified").length;
  const newFiles = result.changedFiles.filter((f) => f.status === "new").length;
  const deleted = result.changedFiles.filter((f) => f.status === "deleted").length;
  const fileParts: string[] = [];
  if (modified) fileParts.push(`${modified} modified`);
  if (newFiles) fileParts.push(`${newFiles} new`);
  if (deleted) fileParts.push(`${deleted} deleted`);
  console.log(`  Changed files: ${result.changedFiles.length} (${fileParts.join(", ")})`);
  console.log("");

  if (result.isStale) {
    console.log(`  \x1b[33m\u26A0 Results may be stale \u2014 baseline analysis has changed.\x1b[0m`);
    console.log("");
  }

  // New issues
  if (result.newViolations.length > 0) {
    console.log(`  NEW ISSUES (${result.newViolations.length})`);
    console.log("  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
    for (const v of result.newViolations) {
      const icon = severityIcon(v.severity);
      const color = severityColor(v.severity);
      const label = v.severity.toUpperCase();
      const target = buildTargetPath(v);

      console.log(`  ${color(`${icon} ${label}`)}  ${v.title}`);
      if (target) {
        console.log(`              ${target}`);
      }
      if (v.fixPrompt) {
        const indent = "              ";
        console.log("");
        console.log(`              Fix: ${wrapText(v.fixPrompt, indent + "     ", 60)}`);
      }
      console.log("");
    }
  } else {
    console.log("  NEW ISSUES (0)");
    console.log("  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
    console.log("  None");
    console.log("");
  }

  // Resolved
  if (result.resolvedViolations.length > 0) {
    console.log(`  RESOLVED (${result.resolvedViolations.length})`);
    console.log("  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
    for (const v of result.resolvedViolations) {
      const target = buildTargetPath(v);
      const color = severityColor(v.severity);
      const label = v.severity.toUpperCase();

      console.log(`  ${color(`\u2714 ${label}`)}  ${v.title}`);
      if (target) {
        console.log(`              ${target}`);
      }
      console.log("");
    }
  } else {
    console.log("  RESOLVED (0)");
    console.log("  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
    console.log("  None");
    console.log("");
  }

  console.log("  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
  console.log(`  Summary: ${result.summary.newCount} new issues, ${result.summary.resolvedCount} resolved`);
  console.log("");
}

export function renderDiffResultsSummary(result: DiffResult): void {
  console.log("");

  // Changed files summary
  const modified = result.changedFiles.filter((f) => f.status === "modified").length;
  const newFiles = result.changedFiles.filter((f) => f.status === "new").length;
  const deleted = result.changedFiles.filter((f) => f.status === "deleted").length;
  const fileParts: string[] = [];
  if (modified) fileParts.push(`${modified} modified`);
  if (newFiles) fileParts.push(`${newFiles} new`);
  if (deleted) fileParts.push(`${deleted} deleted`);
  console.log(`  Changed files: ${result.changedFiles.length} (${fileParts.join(", ")})`);
  console.log("");

  if (result.isStale) {
    console.log(`  \x1b[33m\u26A0 Results may be stale \u2014 baseline analysis has changed.\x1b[0m`);
    console.log("");
  }

  console.log(`  Summary: ${result.summary.newCount} new issues, ${result.summary.resolvedCount} resolved`);
  console.log("");
  p.log.info("Run `truecourse list --diff` to see full details.");
}

export function openInBrowser(url: string): void {
  console.log(`   Opening ${url}`);
  const cmd = process.platform === "darwin"
    ? "open"
    : process.platform === "win32"
      ? "start"
      : "xdg-open";
  exec(`${cmd} ${url}`);
}

/** True when stdin is an interactive terminal (safe to prompt the user). */
export function isInteractive(): boolean {
  return !!process.stdin.isTTY;
}

/**
 * Emit a clear error when a command needs a user decision but is running
 * non-interactively and no flag provided an answer. The message names the
 * exact flag(s) the caller should pass — agents and CI can act on it.
 */
export function exitMissingNonInteractiveFlag(
  context: string,
  flagGuidance: string,
): never {
  p.log.error(
    `${context}\n\nRunning non-interactively with no answer. ${flagGuidance}`,
  );
  process.exit(1);
}

// --------------------------------------------------------------------------
// Claude Code skills install — per-skill sync
// --------------------------------------------------------------------------

/**
 * Locate the bundled skills source directory. In the published CLI the
 * bundled entry sits next to `skills/` (see `scripts/build.ts` — the skills
 * tree is copied into dist). Returns null if the skills bundle is missing
 * (degrades to a warning rather than a crash).
 */
function resolveSkillsSrcDir(): string | null {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const candidate = resolve(__dirname, "skills", "truecourse");
  return existsSync(candidate) ? candidate : null;
}

/**
 * Where skills live in the consumer repo. Claude Code's canonical layout
 * is flat: each skill at `<repo>/.claude/skills/<skill-name>/SKILL.md`.
 * Don't nest under a `truecourse/` namespace folder — the docs call that
 * out as non-standard and it won't be discovered by some tooling.
 */
function skillsParentDir(repoPath: string): string {
  return resolve(repoPath, ".claude", "skills");
}

/** Subdirectory names immediately under `root`. */
function listSkillDirs(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/**
 * Names of shipped skills not yet present in the user's repo. We only
 * consider truecourse-owned names — other tools' skills sitting in the
 * same `.claude/skills/` are ignored.
 */
function computeMissingSkills(repoPath: string): string[] {
  const src = resolveSkillsSrcDir();
  if (!src) return [];
  const shipped = listSkillDirs(src);
  const parent = skillsParentDir(repoPath);
  return shipped.filter((name) => !existsSync(resolve(parent, name)));
}

/** True when every shipped skill is already present (at the flat layout). */
export function hasInstalledSkills(repoPath: string): boolean {
  return computeMissingSkills(repoPath).length === 0;
}

/**
 * Pre-0.5.3 installs sometimes ended up with a wrapper folder at
 * `.claude/skills/truecourse/<skill-name>/`. That's not a layout Claude
 * Code discovers cleanly. Warn the user once on install so they can
 * delete it — we don't remove anything automatically.
 */
function warnAboutLegacyWrapper(repoPath: string): void {
  const legacy = resolve(skillsParentDir(repoPath), "truecourse");
  if (!existsSync(legacy)) return;
  const nestedSkills = listSkillDirs(legacy);
  if (nestedSkills.length === 0) return;
  p.log.warn(
    `Found legacy nested skills at ${legacy}. The current layout is flat ` +
      `(\`.claude/skills/<skill>/\`), so that directory is now unused and ` +
      `can be deleted: \`rm -rf ${legacy}\`.`,
  );
}

/**
 * Copy each named skill from the bundled source dir into the repo at the
 * flat layout. Never overwrites an existing skill — user customizations
 * are preserved; the "missing" list already excludes anything present.
 */
function copySkills(repoPath: string, skillNames: string[]): void {
  const src = resolveSkillsSrcDir();
  if (!src) {
    p.log.warn("Skills directory not found in package — skipping.");
    return;
  }

  const parent = skillsParentDir(repoPath);
  mkdirSync(parent, { recursive: true });

  for (const name of skillNames) {
    const skillSrc = resolve(src, name);
    const skillDest = resolve(parent, name);
    if (existsSync(skillDest)) continue; // belt-and-suspenders
    cpSync(skillSrc, skillDest, { recursive: true });
  }

  p.log.success(
    `Installed ${skillNames.length} Claude Code skill${skillNames.length === 1 ? "" : "s"}:`,
  );
  for (const name of skillNames) p.log.message(`  - ${name}`);

  warnAboutLegacyWrapper(repoPath);
}

/**
 * Offer to install any Claude Code skills that ship with this truecourse
 * version but aren't yet present in the repo. Handles both first-time
 * install (nothing local yet) and upgrade (new skills shipped in a later
 * truecourse release).
 *
 * Decision precedence:
 *   1. all shipped skills already present   → return (nothing to do)
 *   2. `install === true`                   → install missing, no prompt
 *   3. `install === false`                  → skip, no prompt
 *   4. interactive TTY                      → prompt, then install on "yes"
 *   5. non-interactive                      → silently skip (scripted
 *                                             callers should pass `install`)
 */
export async function promptInstallSkills(
  repoPath: string,
  { install }: { install?: boolean } = {},
): Promise<void> {
  const missing = computeMissingSkills(repoPath);
  if (missing.length === 0) return;

  if (install === true) {
    copySkills(repoPath, missing);
    return;
  }
  if (install === false) return;

  if (!isInteractive()) return;

  // First-time install vs upgrade phrasing — the latter names the new
  // skill(s) so the user can decide whether they want that specific
  // capability rather than being asked a generic yes/no. "Upgrade" means
  // at least one of our shipped skills is already present in the repo.
  const src = resolveSkillsSrcDir();
  const shipped = src ? listSkillDirs(src) : [];
  const parent = skillsParentDir(repoPath);
  const alreadyInstalled = shipped.some((name) => existsSync(resolve(parent, name)));
  const message = alreadyInstalled
    ? `New Claude Code skill${missing.length === 1 ? "" : "s"} available: ${missing.join(", ")}. Install?`
    : "Would you like to install Claude Code skills?";

  const answer = await p.confirm({ message });
  if (p.isCancel(answer) || !answer) return;

  copySkills(repoPath, missing);
}
