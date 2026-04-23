import fs from 'node:fs';
import { ensureRepoTruecourseDir, getRepoConfigPath } from './paths.js';

export interface AdrConfig {
  /** Directory ADR markdown files are written to. Relative to the repo root.
   *  null/undefined = use default `docs/adr`. */
  path?: string | null;
  /** Draft-confidence floor for the suggest review queue. 0-1.
   *  null/undefined = show all drafts. */
  defaultThreshold?: number | null;
  /** Max drafts a single `suggest` run may produce. null/undefined = 5. */
  maxDraftsPerRun?: number | null;
}

export interface ProjectConfig {
  /** Rule categories enabled for this project. null/undefined = use all defaults. */
  enabledCategories?: string[] | null;
  /** Whether LLM-powered rules are enabled. null/undefined = use default (true). */
  enableLlmRules?: boolean | null;
  /** ADR-related settings (Phase 19). */
  adr?: AdrConfig | null;
}

const EMPTY: ProjectConfig = {};

export function readProjectConfig(repoDir: string): ProjectConfig {
  const file = getRepoConfigPath(repoDir);
  if (!fs.existsSync(file)) return { ...EMPTY };
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as ProjectConfig;
  } catch {
    return { ...EMPTY };
  }
}

export function writeProjectConfig(repoDir: string, config: ProjectConfig): void {
  ensureRepoTruecourseDir(repoDir);
  fs.writeFileSync(getRepoConfigPath(repoDir), JSON.stringify(config, null, 2), 'utf-8');
}

export function updateProjectConfig(
  repoDir: string,
  patch: Partial<ProjectConfig>,
): ProjectConfig {
  const current = readProjectConfig(repoDir);
  const next = { ...current, ...patch };
  writeProjectConfig(repoDir, next);
  return next;
}
