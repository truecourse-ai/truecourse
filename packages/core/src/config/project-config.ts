/**
 * Per-repo config (`<repo>/.truecourse/config.json`). File-backed by default
 * (OSS/local — unchanged); the enterprise edition injects a Postgres-backed impl
 * via `setRepoConfigStore`. Keyed by `repoDir`: a filesystem path for the file
 * impl, an opaque repo identity for the EE impl. Async so a DB-backed impl is
 * possible; the file impl wraps synchronous `fs`.
 */

import fs from 'node:fs';
import { ensureRepoTruecourseDir, getRepoConfigPath } from './paths.js';

export interface ProjectConfig {
  /** Rule categories enabled for this project. null/undefined = use all defaults. */
  enabledCategories?: string[] | null;
  /** Whether LLM-powered rules are enabled. null/undefined = use default (true). */
  enableLlmRules?: boolean | null;
  /** Rule keys explicitly disabled for this project. Defaults are enabled. */
  disabledRules?: string[];
}

const EMPTY: ProjectConfig = {};

/** Pluggable per-repo config store. File-backed by default; EE injects Postgres. */
export interface RepoConfigStore {
  readProjectConfig(repoDir: string): Promise<ProjectConfig>;
  writeProjectConfig(repoDir: string, config: ProjectConfig): Promise<void>;
}

class FileRepoConfigStore implements RepoConfigStore {
  async readProjectConfig(repoDir: string): Promise<ProjectConfig> {
    const file = getRepoConfigPath(repoDir);
    if (!fs.existsSync(file)) return { ...EMPTY };
    try {
      return JSON.parse(fs.readFileSync(file, 'utf-8')) as ProjectConfig;
    } catch {
      return { ...EMPTY };
    }
  }

  async writeProjectConfig(repoDir: string, config: ProjectConfig): Promise<void> {
    ensureRepoTruecourseDir(repoDir);
    fs.writeFileSync(getRepoConfigPath(repoDir), JSON.stringify(config, null, 2), 'utf-8');
  }
}

let active: RepoConfigStore = new FileRepoConfigStore();

/** The active repo-config store (file-backed unless EE installed a Postgres one). */
export function getRepoConfigStore(): RepoConfigStore {
  return active;
}
/** Install a repo-config store (e.g. the enterprise Postgres impl). */
export function setRepoConfigStore(store: RepoConfigStore): void {
  active = store;
}
/** Restore the file-backed default (tests). */
export function resetRepoConfigStore(): void {
  active = new FileRepoConfigStore();
}

export const readProjectConfig = (repoDir: string): Promise<ProjectConfig> =>
  active.readProjectConfig(repoDir);
export const writeProjectConfig = (repoDir: string, config: ProjectConfig): Promise<void> =>
  active.writeProjectConfig(repoDir, config);

/** Read-modify-write a patch over the current config. Returns the merged result. */
export async function updateProjectConfig(
  repoDir: string,
  patch: Partial<ProjectConfig>,
): Promise<ProjectConfig> {
  const current = await active.readProjectConfig(repoDir);
  const next = { ...current, ...patch };
  await active.writeProjectConfig(repoDir, next);
  return next;
}
