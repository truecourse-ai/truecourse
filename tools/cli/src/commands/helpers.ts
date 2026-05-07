import * as p from "@clack/prompts";
import { exec } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { resolveRepoDir } from "@truecourse/core/config/paths";
import { getProjectByPath, registerProject } from "@truecourse/core/config/registry";

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

// --------------------------------------------------------------------------
// Hash-based safe upgrade: lockfile records the SHA of each skill at the
// time we copied it. On later runs we can tell "unmodified, safe to
// overwrite" from "user-edited, leave alone" by comparing on-disk content
// to the recorded SHA.
// --------------------------------------------------------------------------

const SKILLS_LOCKFILE_NAME = ".truecourse-skills.json";

function skillFilePath(parent: string, name: string): string {
  return resolve(parent, name, "SKILL.md");
}

function sha256OfFile(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function skillsLockPath(repoPath: string): string {
  return resolve(skillsParentDir(repoPath), SKILLS_LOCKFILE_NAME);
}

function readSkillsLock(repoPath: string): Record<string, string> {
  const lockPath = skillsLockPath(repoPath);
  if (!existsSync(lockPath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(lockPath, "utf-8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeSkillsLock(repoPath: string, lock: Record<string, string>): void {
  const lockPath = skillsLockPath(repoPath);
  mkdirSync(dirname(lockPath), { recursive: true });
  writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n");
}

/**
 * Copy each named skill from the bundled source dir into the repo at the
 * flat layout. Never overwrites an existing skill — user customizations
 * are preserved; the "missing" list already excludes anything present.
 * Records the SHA of each freshly-installed `SKILL.md` so later sync runs
 * can tell "unmodified" from "customized."
 */
function copySkills(repoPath: string, skillNames: string[]): void {
  const src = resolveSkillsSrcDir();
  if (!src) {
    p.log.warn("Skills directory not found in package — skipping.");
    return;
  }

  const parent = skillsParentDir(repoPath);
  mkdirSync(parent, { recursive: true });

  const lock = readSkillsLock(repoPath);
  for (const name of skillNames) {
    const skillSrc = resolve(src, name);
    const skillDest = resolve(parent, name);
    if (existsSync(skillDest)) continue; // belt-and-suspenders
    cpSync(skillSrc, skillDest, { recursive: true });
    const sha = sha256OfFile(skillFilePath(parent, name));
    if (sha) lock[name] = sha;
  }
  writeSkillsLock(repoPath, lock);

  p.log.success(
    `Installed ${skillNames.length} Claude Code skill${skillNames.length === 1 ? "" : "s"}:`,
  );
  for (const name of skillNames) p.log.message(`  - ${name}`);
}

/**
 * Refresh shipped skills already present in the repo. For each, compare
 * the package's shipped `SKILL.md` SHA, the on-disk SHA, and the SHA
 * recorded at last install (the lockfile). Four outcomes:
 *
 *   shipped == on-disk      → already current, no-op
 *   on-disk == recorded     → unmodified since our last write, overwrite
 *   no recorded sha         → pre-lockfile install (one-time migration):
 *                             overwrite with shipped, record the new sha
 *   on-disk != recorded     → user edited after our last write, warn
 *
 * Lockfile entries are refreshed whenever the recorded sha drifts from
 * reality so future runs branch correctly.
 */
export function syncShippedSkills(repoPath: string, srcDirOverride?: string): void {
  const src = srcDirOverride ?? resolveSkillsSrcDir();
  if (!src) return;
  const parent = skillsParentDir(repoPath);
  if (!existsSync(parent)) return;

  const shipped = listSkillDirs(src);
  const lock = readSkillsLock(repoPath);
  const updated: string[] = [];
  const migrated: string[] = [];
  const customized: string[] = [];
  let lockChanged = false;

  const overwriteWithShipped = (name: string, shippedSha: string): void => {
    const skillSrc = resolve(src, name);
    const skillDest = resolve(parent, name);
    rmSync(skillDest, { recursive: true, force: true });
    cpSync(skillSrc, skillDest, { recursive: true });
    lock[name] = shippedSha;
    lockChanged = true;
  };

  for (const name of shipped) {
    const skillSrcFile = skillFilePath(src, name);
    const skillDestFile = skillFilePath(parent, name);
    if (!existsSync(skillDestFile)) continue; // not installed → handled separately

    const shippedSha = sha256OfFile(skillSrcFile);
    const installedSha = sha256OfFile(skillDestFile);
    if (!shippedSha || !installedSha) continue;

    if (shippedSha === installedSha) {
      if (lock[name] !== shippedSha) {
        lock[name] = shippedSha;
        lockChanged = true;
      }
      continue;
    }

    const recordedSha = lock[name];
    if (!recordedSha) {
      // Pre-lockfile install: we have no record of what we last wrote, so
      // we can't tell "old shipped version" from "user-customized." The
      // overwhelming common case is the former — almost no one edits
      // SKILL.md by hand. Treat this as a one-time migration: overwrite
      // and seed the lockfile so future upgrades branch cleanly.
      overwriteWithShipped(name, shippedSha);
      migrated.push(name);
      continue;
    }

    if (installedSha === recordedSha) {
      overwriteWithShipped(name, shippedSha);
      updated.push(name);
    } else {
      customized.push(name);
    }
  }

  if (lockChanged) writeSkillsLock(repoPath, lock);

  if (updated.length > 0) {
    p.log.info(
      `Updated ${updated.length} Claude Code skill${updated.length === 1 ? "" : "s"} to the current version: ${updated.join(", ")}`,
    );
  }
  if (migrated.length > 0) {
    const word = migrated.length === 1 ? "skill" : "skills";
    p.log.info(
      `Migrated ${migrated.length} pre-existing Claude Code ${word} to the current shipped version: ${migrated.join(", ")}.\n` +
        `If you had local edits, they're recoverable from git history. Future upgrades will preserve customizations automatically.`,
    );
  }
  if (customized.length > 0) {
    const word = customized.length === 1 ? "skill has" : "skills have";
    p.log.warn(
      `Claude Code ${word} local edits and a newer version is available — keeping yours: ${customized.join(", ")}.\n` +
        `To take the new version, delete the skill folder under .claude/skills/ and re-run truecourse.`,
    );
  }
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
  // `--no-skills` is a hard opt-out: don't sync, don't prompt, don't write.
  if (install === false) return;

  // Refresh already-installed shipped skills first so users on older
  // versions silently get the current SKILL.md (when unmodified).
  syncShippedSkills(repoPath);

  const missing = computeMissingSkills(repoPath);
  if (missing.length === 0) return;

  if (install === true) {
    copySkills(repoPath, missing);
    return;
  }

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

// --------------------------------------------------------------------------
// VS Code / Cursor / Windsurf extension install — silent .tc syntax highlight
// --------------------------------------------------------------------------
//
// Mirrors the skills-sync pattern but runs silently (no prompts, no logs)
// and installs into every editor extensions dir we can detect. Source is
// the bundled `vscode-extension/` tree shipped next to the CLI entry; the
// destination is `<editor>/extensions/truecourse.tc-syntax-<version>/`.
//
// Idempotent: re-running with the same shipped version no-ops. Bumping
// the version installs the new dir alongside; old dirs stay until the
// next sync removes them (cleanup handled below).
// --------------------------------------------------------------------------

const TC_EXT_PUBLISHER = "truecourse";
const TC_EXT_NAME = "tc-syntax";

function resolveTcExtSrcDir(): string | null {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const candidate = resolve(__dirname, "vscode-extension");
  return existsSync(candidate) ? candidate : null;
}

function readTcExtVersion(srcDir: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(resolve(srcDir, "package.json"), "utf-8"));
    return typeof pkg.version === "string" ? pkg.version : null;
  } catch {
    return null;
  }
}

/**
 * Editor extension dirs we attempt to populate. The list is union of the
 * common cross-platform conventions; non-existent ones are silently
 * skipped. Adding a new editor here is a one-line change.
 */
function candidateEditorExtDirs(): string[] {
  const home = os.homedir();
  const dirs = [
    resolve(home, ".vscode", "extensions"),
    resolve(home, ".vscode-insiders", "extensions"),
    resolve(home, ".vscode-server", "extensions"),
    resolve(home, ".cursor", "extensions"),
    resolve(home, ".windsurf", "extensions"),
    resolve(home, ".windsurf-next", "extensions"),
  ];
  return dirs.filter((d) => existsSync(d));
}

function tcExtDestPath(extensionsDir: string, version: string): string {
  return resolve(extensionsDir, `${TC_EXT_PUBLISHER}.${TC_EXT_NAME}-${version}`);
}

/**
 * Remove older versions of our extension from the given editor's
 * extensions dir. Only touches dirs we own (matching `truecourse.tc-syntax-*`).
 */
function cleanupOldTcExtVersions(extensionsDir: string, currentVersion: string): void {
  if (!existsSync(extensionsDir)) return;
  const prefix = `${TC_EXT_PUBLISHER}.${TC_EXT_NAME}-`;
  for (const entry of readdirSync(extensionsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.startsWith(prefix)) continue;
    if (entry.name === `${prefix}${currentVersion}`) continue;
    try {
      rmSync(resolve(extensionsDir, entry.name), { recursive: true, force: true });
    } catch {
      // Editor might have a file lock — try again next analyze. Silent.
    }
  }
}

/**
 * Silently sync the bundled VS Code extension into every detected editor
 * extensions dir. Never prompts, never logs. Errors are swallowed — a
 * failure to install editor highlighting must not break analyze.
 *
 * Called from `analyze` (and `add`) the same place `syncShippedSkills`
 * runs, so the user gets `.tc` highlighting without any opt-in step.
 */
export function syncShippedTcSyntax(): void {
  try {
    const src = resolveTcExtSrcDir();
    if (!src) return;
    const version = readTcExtVersion(src);
    if (!version) return;

    const editorDirs = candidateEditorExtDirs();
    if (editorDirs.length === 0) return;

    for (const editorDir of editorDirs) {
      try {
        cleanupOldTcExtVersions(editorDir, version);
        const dest = tcExtDestPath(editorDir, version);
        if (existsSync(dest)) continue; // current version already there
        mkdirSync(dest, { recursive: true });
        cpSync(src, dest, { recursive: true });
      } catch {
        // Per-editor failures don't propagate. Move on.
      }
    }
  } catch {
    // Top-level swallow: under no circumstances should this break analyze.
  }
}
