/**
 * Postgres implementation of core's `RegistryStore` — the project registry,
 * which the hosted edition keeps in a `registry` table instead of the global
 * `~/.truecourse/registry.json`. The file impl's filesystem-coupled behaviour is
 * dropped here: there is no `.truecourse/` directory to create or to liveness-
 * check, so `registerProject` performs no filesystem side effects and
 * `pruneStaleProjects` is a no-op that returns the full set (rows are removed
 * only via `unregisterProject`). `path` is the opaque repo identity the caller
 * passes; the slug is derived with the shared `slugify`.
 */

import { asc, eq } from 'drizzle-orm';
import { registry, type EeDb } from '@truecourse/ee-db';
import { slugify, type RegistryEntry, type RegistryStore } from '@truecourse/core/config/registry';

interface RegistryRow {
  slug: string;
  name: string;
  path: string;
  lastOpened: string | null;
  lastAnalyzed: string | null;
}

function toEntry(row: RegistryRow): RegistryEntry {
  return {
    slug: row.slug,
    name: row.name,
    path: row.path,
    lastOpened: row.lastOpened ?? undefined,
    lastAnalyzed: row.lastAnalyzed ?? undefined,
  };
}

/** Last path-like segment, used only as a display-name fallback. */
function basename(repoPath: string): string {
  return repoPath.split('/').filter(Boolean).pop() ?? repoPath;
}

export class PgRegistryStore implements RegistryStore {
  constructor(private readonly db: EeDb) {}

  private async rows(): Promise<RegistryRow[]> {
    return this.db
      .select({
        slug: registry.slug,
        name: registry.name,
        path: registry.path,
        lastOpened: registry.lastOpened,
        lastAnalyzed: registry.lastAnalyzed,
      })
      .from(registry)
      .orderBy(asc(registry.createdAt), asc(registry.slug));
  }

  async readRegistry(): Promise<RegistryEntry[]> {
    return (await this.rows()).map(toEntry);
  }

  async pruneStaleProjects(): Promise<RegistryEntry[]> {
    // No filesystem to check server-side; rows are removed explicitly.
    return this.readRegistry();
  }

  async getProjectBySlug(slug: string): Promise<RegistryEntry | null> {
    const rows = await this.db.select().from(registry).where(eq(registry.slug, slug)).limit(1);
    return rows[0] ? toEntry(rows[0]) : null;
  }

  async getProjectByPath(repoPath: string): Promise<RegistryEntry | null> {
    const rows = await this.db.select().from(registry).where(eq(registry.path, repoPath)).limit(1);
    return rows[0] ? toEntry(rows[0]) : null;
  }

  async registerProject(repoPath: string, displayName?: string): Promise<RegistryEntry> {
    const now = new Date().toISOString();
    const name = displayName || basename(repoPath);
    const existing = await this.getProjectByPath(repoPath);

    if (existing) {
      await this.db
        .update(registry)
        .set({ name, lastOpened: now })
        .where(eq(registry.slug, existing.slug));
      return { ...existing, name, lastOpened: now };
    }

    const taken = (await this.rows()).map((r) => r.slug);
    const slug = slugify(name, taken);
    await this.db.insert(registry).values({ slug, name, path: repoPath, lastOpened: now });
    return { slug, name, path: repoPath, lastOpened: now };
  }

  async unregisterProject(slug: string): Promise<boolean> {
    const deleted = await this.db
      .delete(registry)
      .where(eq(registry.slug, slug))
      .returning({ slug: registry.slug });
    return deleted.length > 0;
  }

  async touchProject(slug: string): Promise<void> {
    await this.db
      .update(registry)
      .set({ lastOpened: new Date().toISOString() })
      .where(eq(registry.slug, slug));
  }

  async setLastAnalyzed(slug: string, isoTimestamp: string): Promise<void> {
    await this.db
      .update(registry)
      .set({ lastAnalyzed: isoTimestamp })
      .where(eq(registry.slug, slug));
  }
}
