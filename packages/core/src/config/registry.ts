/**
 * The repository registry — how a `:id` slug in a route resolves to a
 * repository. It is a VIEW of the connected repositories, not a table of its
 * own, so it can neither drift nor orphan: the slug is a column of the
 * repository's row, minted once when it was connected.
 *
 * Every read is scoped to a workspace. A slug is unique within its workspace
 * and nowhere else, so a lookup takes the workspace it runs in and another
 * workspace's repository is unreachable through it rather than fetched and
 * then rejected.
 *
 * The seam exists because `@truecourse/core` cannot depend on
 * `@truecourse/data-store` (the dependency runs the other way): boot installs
 * the Postgres-backed view over it. Nothing is installed only in a process that
 * never booted the server, and every read then fails loud rather than
 * inventing an empty registry.
 */

export interface RegistryEntry {
  /** The URL-safe identifier the routes address it by; unique within its workspace. */
  slug: string;
  /** Display name. */
  name: string;
  /** The opaque repository identity (`owner/repo`) every per-repo store keys by. */
  path: string;
  /** The provider it was connected through (`github`, `local`). */
  provider?: string;
  /** Default branch (e.g. `main`) — a hosted repository has no checkout to read it from. */
  defaultBranch?: string;
  /** The https git URL the repository was connected from. */
  remoteUrl?: string;
}

/** The connected repositories of one workspace, as the routes read them. */
export interface RegistryStore {
  readRegistry(workspaceOrgId: string): Promise<RegistryEntry[]>;
  getProjectBySlug(workspaceOrgId: string, slug: string): Promise<RegistryEntry | null>;
  getProjectByPath(workspaceOrgId: string, repoPath: string): Promise<RegistryEntry | null>;
}

let active: RegistryStore | null = null;

/** Install the registry view (boot, and the tests that stand a server up). */
export function setRegistryStore(store: RegistryStore): void {
  active = store;
}

/** Forget the installed view (tests). */
export function resetRegistryStore(): void {
  active = null;
}

function store(): RegistryStore {
  if (!active) throw new Error('No repository registry installed (boot did not run installDbStores).');
  return active;
}

/** The active registry view. */
export function getRegistryStore(): RegistryStore {
  return store();
}

export const readRegistry = (workspaceOrgId: string): Promise<RegistryEntry[]> =>
  store().readRegistry(workspaceOrgId);

export const getProjectBySlug = (workspaceOrgId: string, slug: string): Promise<RegistryEntry | null> =>
  store().getProjectBySlug(workspaceOrgId, slug);

export const getProjectByPath = (workspaceOrgId: string, repoPath: string): Promise<RegistryEntry | null> =>
  store().getProjectByPath(workspaceOrgId, repoPath);

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
