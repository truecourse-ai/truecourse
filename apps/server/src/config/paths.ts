import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TRUECOURSE_DIR = '.truecourse';
const GITIGNORE_CONTENTS =
  'analyses/\nLATEST.json\nhistory.json\ndiff.json\nui-state.json\nlogs/\n.analyze.lock\nadrs.json\ndrafts/\nadr-rejected.json\n';

// ---------------------------------------------------------------------------
// Global paths (user-level)
// ---------------------------------------------------------------------------

export function getGlobalDir(): string {
  return process.env.TRUECOURSE_HOME || path.join(os.homedir(), TRUECOURSE_DIR);
}

export function getGlobalConfigPath(): string {
  return path.join(getGlobalDir(), 'config.json');
}

export function getRegistryPath(): string {
  return path.join(getGlobalDir(), 'registry.json');
}

export function getLogDir(): string {
  return path.join(getGlobalDir(), 'logs');
}

// ---------------------------------------------------------------------------
// Per-repo paths
// ---------------------------------------------------------------------------

export function getRepoTruecourseDir(repoDir: string): string {
  return path.join(repoDir, TRUECOURSE_DIR);
}

export function getRepoDbDir(repoDir: string): string {
  return path.join(getRepoTruecourseDir(repoDir), 'db');
}

export function getRepoConfigPath(repoDir: string): string {
  return path.join(getRepoTruecourseDir(repoDir), 'config.json');
}

export function getRepoUiStatePath(repoDir: string): string {
  return path.join(getRepoTruecourseDir(repoDir), 'ui-state.json');
}

// ---------------------------------------------------------------------------
// ADR paths
// ---------------------------------------------------------------------------

export function getAdrCorpusPath(repoDir: string): string {
  return path.join(getRepoTruecourseDir(repoDir), 'adrs.json');
}

export function getAdrDraftsDir(repoDir: string): string {
  return path.join(getRepoTruecourseDir(repoDir), 'drafts');
}

export function getAdrDraftPath(repoDir: string, draftId: string): string {
  return path.join(getAdrDraftsDir(repoDir), `${draftId}.md`);
}

export function getAdrRejectedPath(repoDir: string): string {
  return path.join(getRepoTruecourseDir(repoDir), 'adr-rejected.json');
}

/** Output directory for accepted ADR markdown files. Default is `docs/adr/`
 *  under the repo root; overridable per-repo via `config.adr.path` (read by
 *  callers, not computed here).
 */
export function getDefaultAdrOutputDir(repoDir: string): string {
  return path.join(repoDir, 'docs', 'adr');
}

// ---------------------------------------------------------------------------
// Repo resolution (walks up from cwd looking for .truecourse/)
// ---------------------------------------------------------------------------

/**
 * Walk up from `startDir` looking for a `.truecourse/` directory. Returns the
 * directory that contains it, or `null` if none is found before the filesystem
 * root.
 *
 * Skips the global `~/.truecourse/` directory — that one is a per-user
 * registry, not a project marker. Walking into it would wrongly treat
 * `$HOME` as an analyzable project.
 */
export function resolveRepoDir(startDir: string): string | null {
  const globalDir = path.resolve(getGlobalDir());
  let current = path.resolve(startDir);
  while (true) {
    const candidate = path.join(current, TRUECOURSE_DIR);
    if (
      path.resolve(candidate) !== globalDir &&
      fs.existsSync(candidate) &&
      fs.statSync(candidate).isDirectory()
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Ensure `<repoDir>/.truecourse/` exists, writing a default `.gitignore`
 * alongside it so runtime state (db, ui-state, logs) stays out of version
 * control while `config.json` can be committed by the team.
 */
export function ensureRepoTruecourseDir(repoDir: string): string {
  const tcDir = getRepoTruecourseDir(repoDir);
  fs.mkdirSync(tcDir, { recursive: true });

  const gitignore = path.join(tcDir, '.gitignore');
  if (!fs.existsSync(gitignore)) {
    fs.writeFileSync(gitignore, GITIGNORE_CONTENTS, 'utf-8');
  }
  return tcDir;
}

// ---------------------------------------------------------------------------
// Legacy data wipe
// ---------------------------------------------------------------------------

/**
 * Delete the pre-PGlite global data directory (`~/.truecourse/data/`) from
 * the embedded-postgres era. Safe to call every boot — no-op if absent.
 */
export function wipeLegacyPostgresData(): boolean {
  const legacyDir = path.join(getGlobalDir(), 'data');
  if (!fs.existsSync(legacyDir)) return false;
  fs.rmSync(legacyDir, { recursive: true, force: true });
  return true;
}
