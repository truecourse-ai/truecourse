import * as p from "@clack/prompts";
import { exec } from "node:child_process";
import { cpSync, existsSync } from "node:fs";
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

/** Return the path where the `truecourse` skill would be installed for a repo. */
function skillDestPath(repoPath: string): string {
  return resolve(repoPath, ".claude", "skills", "truecourse");
}

/** True if the `truecourse` skill is already present in `<repoPath>/.claude/skills/`. */
export function hasInstalledSkills(repoPath: string): boolean {
  return existsSync(skillDestPath(repoPath));
}

/**
 * Prompt to install Claude Code skills into a repo directory.
 *
 * No-op if the skills are already installed. Call this from any first-run
 * path (`truecourse add`, first `truecourse analyze`) and it will prompt
 * the user only once per repo.
 */
export async function promptInstallSkills(repoPath: string): Promise<void> {
  if (hasInstalledSkills(repoPath)) return;

  const installSkills = await p.confirm({
    message: "Would you like to install Claude Code skills?",
  });

  if (p.isCancel(installSkills) || !installSkills) return;

  const __dirname = dirname(fileURLToPath(import.meta.url));
  // In source: src/commands/ → ../../skills/truecourse
  // In dist:   dist/ → ./skills/truecourse
  const srcPath = resolve(__dirname, "..", "..", "skills", "truecourse");
  const distPath = resolve(__dirname, "skills", "truecourse");
  const skillsSrc = existsSync(srcPath) ? srcPath : distPath;

  if (!existsSync(skillsSrc)) {
    p.log.warn("Skills directory not found in package — skipping.");
    return;
  }

  const skillsDest = resolve(repoPath, ".claude", "skills");
  cpSync(skillsSrc, skillsDest, { recursive: true });

  p.log.success("Installed Claude Code skills:");
  p.log.message("  - truecourse-analyze  (run analysis)");
  p.log.message("  - truecourse-list     (list violations)");
  p.log.message("  - truecourse-fix      (apply fixes)");
}
