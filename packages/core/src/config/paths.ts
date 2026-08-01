import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TRUECOURSE_DIR = '.truecourse';
// Committable (NOT ignored): `config.json`, `LATEST.json`, `specs/corpus.json`,
// `specs/decisions.json` — and the `contracts/` `.tc` tree, which is git-tracked
// ON PURPOSE so the generated spec→code map travels with the repo. `LATEST.json`
// travels so fresh clones inherit a baseline; commit it (and the other
// LATEST-convention files) only after merging to main, to avoid PR conflicts on
// generated JSON.
//
// Ignored below: the analyze store snapshots, the `.cache/` re-run caches,
// `contracts/result.json` — the last-generate run result (transient run output
// the dashboard reads back; the rest of `contracts/` stays tracked) — and the
// guard run store: `guard/runs/` snapshots, `guard/result.json` (last-generate
// report), `guard/evidence/` transcripts, `guard/journeys.json` (the journey
// catalog, re-derived from the working tree on every mapping — what travels with
// the repo are the journey fingerprints embedded in scenarios),
// `guard/auto-resolutions.json` (the auto-resolve ledger + flow-taint set —
// transient run memory, item 83), and `guard/history.json` (covered by the
// unanchored `history.json` rule). `guard/LATEST.json` stays committable, same
// LATEST convention as the analyze baseline.
//
// `scenarios/externals.local.json` is the secrets overlay for the committed
// `api.externals` declaration (item 62): base URLs and API keys for the external
// accounts a developer provided. Ignored ON PURPOSE — the recipe declares WHICH
// services exist (and is committed so the team shares the declaration), this file
// holds the values that must never reach git.
/** The template written to `<repo>/.truecourse/.gitignore` on first use — the
 *  materialized committable-vs-derived split (exported so a test can pin it). */
export const GITIGNORE_CONTENTS = [
  'analyses/',
  'history.json',
  'diff.json',
  'ui-state.json',
  'logs/',
  '.analyze.lock',
  '.cache/',
  'contracts/result.json',
  'guard/runs/',
  'guard/result.json',
  'guard/setup.json',
  'guard/evidence/',
  'guard/journeys.json',
  'guard/auto-resolutions.json',
  'scenarios/externals.local.json',
].join('\n') + '\n';

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
