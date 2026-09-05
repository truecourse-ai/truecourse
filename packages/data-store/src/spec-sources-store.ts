/**
 * The hosted half of core's `SpecSourcesStore`: a repo's registered web spec
 * sources as ONE registry row (`spec_sources`), with every snapshotted page's
 * body content-addressed in the repo's spec scope of `content` — the same pool
 * the scan's document snapshot writes into. The pool keys a body by
 * `sha256-<hex>` and the registry carries the same digest bare as each page's
 * `contentHash`, so a page the scan later keeps is stored once and a page is
 * read back by the hash the registry names.
 *
 * Bodies are never swept here: the scan's snapshots share the scope, and the
 * disconnect purge drops the whole scope with the row.
 */

import { eq } from 'drizzle-orm';
import { specSources, type Db } from '@truecourse/db';
import { SourcesFileSchema, type SourcesFile } from '@truecourse/spec-consolidator';
import type { SpecSourcesSnapshot, SpecSourcesStore } from '@truecourse/core/lib/spec-sources';
import { ContentStore, contentScope } from './content-store.js';

export class PgSpecSourcesStore implements SpecSourcesStore {
  readonly materializesInPlace = false;
  private readonly content: ContentStore;

  constructor(private readonly db: Db) {
    this.content = new ContentStore(db);
  }

  async readRegistry(repoKey: string): Promise<SourcesFile> {
    const rows = await this.db
      .select({ registry: specSources.registry })
      .from(specSources)
      .where(eq(specSources.repoKey, repoKey))
      .limit(1);
    // A row the schema no longer accepts is a loud error, as a corrupt
    // `sources.json` is for the engine: reading it as empty would let the next
    // write orphan every page it names.
    return rows[0] ? SourcesFileSchema.parse(rows[0].registry) : { version: 1, sources: [] };
  }

  readBody(repoKey: string, contentHash: string): Promise<string | null> {
    return this.content.get(contentScope.spec(repoKey), poolSha(contentHash));
  }

  async changedAt(repoKey: string): Promise<string | null> {
    const rows = await this.db
      .select({ updatedAt: specSources.updatedAt })
      .from(specSources)
      .where(eq(specSources.repoKey, repoKey))
      .limit(1);
    return rows[0]?.updatedAt ?? null;
  }

  async write(repoKey: string, snapshot: SpecSourcesSnapshot): Promise<void> {
    if (snapshot.registry.sources.length === 0) {
      await this.db.delete(specSources).where(eq(specSources.repoKey, repoKey));
      return;
    }
    const scope = contentScope.spec(repoKey);
    for (const body of Object.values(snapshot.bodies)) await this.content.putText(scope, body);
    const updatedAt = new Date().toISOString();
    await this.db
      .insert(specSources)
      .values({ repoKey, registry: snapshot.registry, updatedAt })
      .onConflictDoUpdate({
        target: [specSources.repoKey],
        set: { registry: snapshot.registry, updatedAt },
      });
  }
}

/** The content pool's key for a body whose registry `contentHash` is `hex`. */
function poolSha(contentHash: string): string {
  return `sha256-${contentHash}`;
}
