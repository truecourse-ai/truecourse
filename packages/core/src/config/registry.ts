/**
 * Project registry — the dashboard's list of known projects. File-backed by
 * default (global `~/.truecourse/registry.json`); the enterprise edition injects
 * a Postgres-backed impl via `setRegistryStore` (the registry collapses into the
 * server-side `repos` table for hosted, multi-instance deploys). Async so a DB
 * impl is possible; the file impl wraps synchronous `fs`.
 *
 * The whole public API is on the interface (not just read/write): several
 * methods are filesystem-coupled today (`path.resolve`, `ensureRepoTruecourseDir`,
 * a `.truecourse/`-exists liveness check) and the EE impl must replace that logic
 * with row operations.
 */

import fs from 'node:fs';
import path from 'node:path';
import { ensureRepoTruecourseDir, getGlobalDir, getRegistryPath, getRepoTruecourseDir } from './paths.js';

export interface RegistryEntry {
  /** Stable URL-safe identifier derived from the project name. */
  slug: string;
  /** Display name (defaults to the directory basename). */
  name: string;
  /** Absolute path to the repo root that contains `.truecourse/`. */
  path: string;
  /**
   * ISO timestamp of the last dashboard interaction (add / open / any
   * project-scoped request). Used purely for "recent projects" UX — never
   * surfaced as an analysis timestamp.
   */
  lastOpened?: string;
  /**
   * ISO timestamp of the last SUCCESSFUL analysis completion. Written only
   * by `analyzeInProcess` at the end of a completed run. `null`/undefined
   * means "never analyzed".
   */
  lastAnalyzed?: string;
  /**
   * Default branch (e.g. `main`). Set by registries that track it without a
   * local checkout — the hosted `gh_repos`-derived registry. OSS leaves it
   * unset, and the repo route reads the branch from the on-disk git repo.
   */
  defaultBranch?: string;
}

interface RegistryFile {
  projects: RegistryEntry[];
}

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

/** Pluggable project registry. File-backed by default; EE injects Postgres. */
export interface RegistryStore {
  readRegistry(): Promise<RegistryEntry[]>;
  pruneStaleProjects(): Promise<RegistryEntry[]>;
  getProjectBySlug(slug: string): Promise<RegistryEntry | null>;
  getProjectByPath(repoPath: string): Promise<RegistryEntry | null>;
  registerProject(repoPath: string, displayName?: string): Promise<RegistryEntry>;
  unregisterProject(slug: string): Promise<boolean>;
  touchProject(slug: string): Promise<void>;
  setLastAnalyzed(slug: string, isoTimestamp: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// File-backed default impl (OSS) — synchronous fs under an async surface.
// ---------------------------------------------------------------------------

class FileRegistryStore implements RegistryStore {
  private loadRaw(): RegistryFile {
    const file = getRegistryPath();
    if (!fs.existsSync(file)) return { projects: [] };
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<RegistryFile>;
      return { projects: parsed.projects ?? [] };
    } catch {
      return { projects: [] };
    }
  }

  private persist(file: RegistryFile): void {
    fs.mkdirSync(getGlobalDir(), { recursive: true });
    fs.writeFileSync(getRegistryPath(), JSON.stringify(file, null, 2), 'utf-8');
  }

  async readRegistry(): Promise<RegistryEntry[]> {
    return this.loadRaw().projects;
  }

  async pruneStaleProjects(): Promise<RegistryEntry[]> {
    const file = this.loadRaw();
    const alive = file.projects.filter((entry) => fs.existsSync(getRepoTruecourseDir(entry.path)));
    if (alive.length !== file.projects.length) {
      this.persist({ projects: alive });
    }
    return alive;
  }

  async getProjectBySlug(slug: string): Promise<RegistryEntry | null> {
    return this.loadRaw().projects.find((p) => p.slug === slug) ?? null;
  }

  async getProjectByPath(repoPath: string): Promise<RegistryEntry | null> {
    const normalized = path.resolve(repoPath);
    return this.loadRaw().projects.find((p) => p.path === normalized) ?? null;
  }

  async registerProject(repoPath: string, displayName?: string): Promise<RegistryEntry> {
    const normalized = path.resolve(repoPath);
    ensureRepoTruecourseDir(normalized);
    const file = this.loadRaw();
    const name = displayName || path.basename(normalized);
    const existing = file.projects.find((p) => p.path === normalized);

    if (existing) {
      existing.name = name;
      existing.lastOpened = new Date().toISOString();
      this.persist(file);
      return existing;
    }

    const entry: RegistryEntry = {
      slug: slugify(name, file.projects.map((p) => p.slug)),
      name,
      path: normalized,
      lastOpened: new Date().toISOString(),
    };
    file.projects.push(entry);
    this.persist(file);
    return entry;
  }

  async unregisterProject(slug: string): Promise<boolean> {
    const file = this.loadRaw();
    const before = file.projects.length;
    file.projects = file.projects.filter((p) => p.slug !== slug);
    if (file.projects.length === before) return false;
    this.persist(file);
    return true;
  }

  async touchProject(slug: string): Promise<void> {
    const file = this.loadRaw();
    const entry = file.projects.find((p) => p.slug === slug);
    if (!entry) return;
    entry.lastOpened = new Date().toISOString();
    this.persist(file);
  }

  async setLastAnalyzed(slug: string, isoTimestamp: string): Promise<void> {
    const file = this.loadRaw();
    const entry = file.projects.find((p) => p.slug === slug);
    if (!entry) return;
    entry.lastAnalyzed = isoTimestamp;
    this.persist(file);
  }
}

let active: RegistryStore = new FileRegistryStore();

/** The active project registry (file-backed unless EE installed a Postgres one). */
export function getRegistryStore(): RegistryStore {
  return active;
}
/** Install a project registry (e.g. the enterprise Postgres impl). */
export function setRegistryStore(store: RegistryStore): void {
  active = store;
}
/** Restore the file-backed default (tests). */
export function resetRegistryStore(): void {
  active = new FileRegistryStore();
}

// ---------------------------------------------------------------------------
// Public API (delegators)
// ---------------------------------------------------------------------------

/** Return all registered projects. */
export const readRegistry = (): Promise<RegistryEntry[]> => active.readRegistry();

/** Drop entries whose `.truecourse/` directory no longer exists. Returns the pruned list. */
export const pruneStaleProjects = (): Promise<RegistryEntry[]> => active.pruneStaleProjects();

export const getProjectBySlug = (slug: string): Promise<RegistryEntry | null> =>
  active.getProjectBySlug(slug);

export const getProjectByPath = (repoPath: string): Promise<RegistryEntry | null> =>
  active.getProjectByPath(repoPath);

/**
 * Add (or update) an entry for `repoPath`. Returns the resulting entry.
 * Existing entries keep their slug; lastOpened is refreshed.
 */
export const registerProject = (repoPath: string, displayName?: string): Promise<RegistryEntry> =>
  active.registerProject(repoPath, displayName);

export const unregisterProject = (slug: string): Promise<boolean> =>
  active.unregisterProject(slug);

export const touchProject = (slug: string): Promise<void> => active.touchProject(slug);

/**
 * Record a successful analysis completion for `slug`. Called once per
 * analyze run from `analyzeInProcess`. This is the ONLY write path for
 * `lastAnalyzed` — everything else treats it as read-only.
 */
export const setLastAnalyzed = (slug: string, isoTimestamp: string): Promise<void> =>
  active.setLastAnalyzed(slug, isoTimestamp);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Derive a unique URL-safe slug from a display name, avoiding `taken`. */
export function slugify(name: string, taken: string[]): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'project';
  if (!taken.includes(base)) return base;
  let i = 2;
  while (taken.includes(`${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}
