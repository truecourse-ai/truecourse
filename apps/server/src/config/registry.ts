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
}

interface RegistryFile {
  projects: RegistryEntry[];
}

const EMPTY: RegistryFile = { projects: [] };

// ---------------------------------------------------------------------------
// Read / write
// ---------------------------------------------------------------------------

function loadRaw(): RegistryFile {
  const file = getRegistryPath();
  if (!fs.existsSync(file)) return { projects: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<RegistryFile>;
    return { projects: parsed.projects ?? [] };
  } catch {
    return { projects: [] };
  }
}

function persist(file: RegistryFile): void {
  fs.mkdirSync(getGlobalDir(), { recursive: true });
  fs.writeFileSync(getRegistryPath(), JSON.stringify(file, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Return all registered projects. */
export function readRegistry(): RegistryEntry[] {
  return loadRaw().projects;
}

/** Drop entries whose `.truecourse/` directory no longer exists. Returns the pruned list. */
export function pruneStaleProjects(): RegistryEntry[] {
  const file = loadRaw();
  const alive = file.projects.filter((entry) =>
    fs.existsSync(getRepoTruecourseDir(entry.path)),
  );
  if (alive.length !== file.projects.length) {
    persist({ projects: alive });
  }
  return alive;
}

export function getProjectBySlug(slug: string): RegistryEntry | null {
  return readRegistry().find((p) => p.slug === slug) ?? null;
}

export function getProjectByPath(repoPath: string): RegistryEntry | null {
  const normalized = path.resolve(repoPath);
  return readRegistry().find((p) => p.path === normalized) ?? null;
}

/**
 * Add (or update) an entry for `repoPath`. Returns the resulting entry.
 * Existing entries keep their slug; lastOpened is refreshed.
 */
export function registerProject(repoPath: string, displayName?: string): RegistryEntry {
  const normalized = path.resolve(repoPath);
  ensureRepoTruecourseDir(normalized);
  const file = loadRaw();
  const name = displayName || path.basename(normalized);
  const existing = file.projects.find((p) => p.path === normalized);

  if (existing) {
    existing.name = name;
    existing.lastOpened = new Date().toISOString();
    persist(file);
    return existing;
  }

  const entry: RegistryEntry = {
    slug: slugify(name, file.projects.map((p) => p.slug)),
    name,
    path: normalized,
    lastOpened: new Date().toISOString(),
  };
  file.projects.push(entry);
  persist(file);
  return entry;
}

export function unregisterProject(slug: string): boolean {
  const file = loadRaw();
  const before = file.projects.length;
  file.projects = file.projects.filter((p) => p.slug !== slug);
  if (file.projects.length === before) return false;
  persist(file);
  return true;
}

export function touchProject(slug: string): void {
  const file = loadRaw();
  const entry = file.projects.find((p) => p.slug === slug);
  if (!entry) return;
  entry.lastOpened = new Date().toISOString();
  persist(file);
}

/**
 * Record a successful analysis completion for `slug`. Called once per
 * analyze run from `analyzeInProcess`. This is the ONLY write path for
 * `lastAnalyzed` — everything else treats it as read-only.
 */
export function setLastAnalyzed(slug: string, isoTimestamp: string): void {
  const file = loadRaw();
  const entry = file.projects.find((p) => p.slug === slug);
  if (!entry) return;
  entry.lastAnalyzed = isoTimestamp;
  persist(file);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(name: string, taken: string[]): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'project';
  if (!taken.includes(base)) return base;
  let i = 2;
  while (taken.includes(`${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}
