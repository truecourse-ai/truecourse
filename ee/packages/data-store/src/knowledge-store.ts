/**
 * Provenance ledger for workspace Knowledge. One row per source document the
 * Knowledge was built from — identity + content hash. The connector sync engine
 * upserts a row per doc so the dashboard can list sources / "where did this come
 * from?" and incremental syncs can diff on the stored hash. The doc BODY is stored
 * separately, content-addressed in the shared `content` table under a per-org
 * knowledge scope keyed by that same `contentHash` (see the body helpers below);
 * Process and the doc viewer read it back from there — no connector re-fetch.
 *
 * This is an EE-internal store (not one of core's pluggable seams), so it is
 * constructed directly by the Knowledge router rather than installed globally.
 */

import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { knowledgeDocuments, type EeDb } from '@truecourse/ee-db';
import { ContentStore, contentScope } from './content-store.js';

export interface KnowledgeDocRow {
  workspaceOrgId: string;
  sourceKind: string;
  externalId: string;
  docPath: string;
  title: string;
  url: string | null;
  version: string | null;
  contentHash: string;
  lastSyncedAt: string;
}

/** Filter + slice for the Sources tab's server-paginated ledger listing. */
export interface ListDocumentsPageOptions {
  /** Case-insensitive substring on title / externalId (blank = no filter). */
  query?: string;
  /** Restrict to one connector kind (blank/absent = every source). */
  kind?: string;
  limit: number;
  offset: number;
}

export class PgKnowledgeStore {
  private readonly content: ContentStore;

  constructor(private readonly db: EeDb) {
    this.content = new ContentStore(db);
  }

  // --- Doc bodies (content-addressed by the ledger's contentHash) ------------

  /** Persist one synced doc body under the org's knowledge scope, keyed by its
   *  ledger contentHash. Idempotent + deduped: identical content is stored once. */
  async putDocBody(workspaceOrgId: string, contentHash: string, markdown: string): Promise<void> {
    await this.content.put(contentScope.knowledge(workspaceOrgId), contentHash, markdown);
  }

  /** Load one synced doc body by its ledger contentHash, or null if not stored. */
  async getDocBody(workspaceOrgId: string, contentHash: string): Promise<string | null> {
    return this.content.get(contentScope.knowledge(workspaceOrgId), contentHash);
  }

  /** Sweep-time GC: delete stored bodies whose sha no live ledger row references.
   *  `liveHashes` is every current ledger row's contentHash for the org. Returns
   *  the number of orphaned bodies deleted. */
  async gcDocBodies(workspaceOrgId: string, liveHashes: Set<string>): Promise<number> {
    return this.content.gc(contentScope.knowledge(workspaceOrgId), liveHashes);
  }

  /** Insert or update one source-doc provenance row (keyed by org+sourceKind+externalId). */
  async upsertDocument(
    row: Omit<KnowledgeDocRow, 'lastSyncedAt'> & { lastSyncedAt?: string },
  ): Promise<void> {
    const now = row.lastSyncedAt ?? new Date().toISOString();
    await this.db
      .insert(knowledgeDocuments)
      .values({
        workspaceOrgId: row.workspaceOrgId,
        sourceKind: row.sourceKind,
        externalId: row.externalId,
        docPath: row.docPath,
        title: row.title,
        url: row.url,
        version: row.version,
        contentHash: row.contentHash,
        lastSyncedAt: now,
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: [
          knowledgeDocuments.workspaceOrgId,
          knowledgeDocuments.sourceKind,
          knowledgeDocuments.externalId,
        ],
        set: {
          docPath: row.docPath,
          title: row.title,
          url: row.url,
          version: row.version,
          contentHash: row.contentHash,
          lastSyncedAt: now,
        },
      });
  }

  /** Every source doc for a workspace, newest-synced first. */
  async listDocuments(workspaceOrgId: string): Promise<KnowledgeDocRow[]> {
    const rows = await this.db
      .select()
      .from(knowledgeDocuments)
      .where(eq(knowledgeDocuments.workspaceOrgId, workspaceOrgId));
    return rows
      .map((r) => ({
        workspaceOrgId: r.workspaceOrgId,
        sourceKind: r.sourceKind,
        externalId: r.externalId,
        docPath: r.docPath,
        title: r.title,
        url: r.url,
        version: r.version,
        contentHash: r.contentHash,
        lastSyncedAt: r.lastSyncedAt,
      }))
      .sort((a, b) => (a.lastSyncedAt < b.lastSyncedAt ? 1 : a.lastSyncedAt > b.lastSyncedAt ? -1 : 0));
  }

  /**
   * A page of source docs matching an optional query + kind filter, newest-synced
   * first, plus the total matching rows (before the limit/offset slice) for the
   * pager. The Sources tab uses this; the sync engine keeps the unpaged
   * {@link listDocuments} for its whole-set reconcile.
   */
  async listDocumentsPage(
    workspaceOrgId: string,
    opts: ListDocumentsPageOptions,
  ): Promise<{ documents: KnowledgeDocRow[]; total: number }> {
    const filters = [eq(knowledgeDocuments.workspaceOrgId, workspaceOrgId)];
    const kind = opts.kind?.trim();
    if (kind) filters.push(eq(knowledgeDocuments.sourceKind, kind));
    const query = opts.query?.trim();
    if (query) {
      const like = `%${query}%`;
      filters.push(
        or(ilike(knowledgeDocuments.title, like), ilike(knowledgeDocuments.externalId, like))!,
      );
    }
    const where = and(...filters);

    const [countRow] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(knowledgeDocuments)
      .where(where);
    const rows = await this.db
      .select()
      .from(knowledgeDocuments)
      .where(where)
      .orderBy(desc(knowledgeDocuments.lastSyncedAt))
      .limit(opts.limit)
      .offset(opts.offset);
    return {
      documents: rows.map((r) => ({
        workspaceOrgId: r.workspaceOrgId,
        sourceKind: r.sourceKind,
        externalId: r.externalId,
        docPath: r.docPath,
        title: r.title,
        url: r.url,
        version: r.version,
        contentHash: r.contentHash,
        lastSyncedAt: r.lastSyncedAt,
      })),
      total: countRow?.total ?? 0,
    };
  }

  /** One source doc by its stable relative path (the `GET /spec/doc` ref → stored body). */
  async findByDocPath(workspaceOrgId: string, docPath: string): Promise<KnowledgeDocRow | null> {
    const rows = await this.db
      .select()
      .from(knowledgeDocuments)
      .where(
        and(
          eq(knowledgeDocuments.workspaceOrgId, workspaceOrgId),
          eq(knowledgeDocuments.docPath, docPath),
        ),
      )
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return {
      workspaceOrgId: r.workspaceOrgId,
      sourceKind: r.sourceKind,
      externalId: r.externalId,
      docPath: r.docPath,
      title: r.title,
      url: r.url,
      version: r.version,
      contentHash: r.contentHash,
      lastSyncedAt: r.lastSyncedAt,
    };
  }

  /**
   * The human title + deep-link for a batch of doc paths, keyed by docPath. One
   * query. Used to enrich corpus/skipped refs (the synthetic stable docPaths) with
   * the ledger's title + URL at read time; a ref with no live row (pruned since the
   * corpus was built) is simply absent from the map, so the caller falls back to the
   * ref.
   */
  async titlesByDocPath(
    workspaceOrgId: string,
    docPaths: string[],
  ): Promise<Map<string, { title: string; url: string | null }>> {
    const out = new Map<string, { title: string; url: string | null }>();
    if (docPaths.length === 0) return out;
    const rows = await this.db
      .select({
        docPath: knowledgeDocuments.docPath,
        title: knowledgeDocuments.title,
        url: knowledgeDocuments.url,
      })
      .from(knowledgeDocuments)
      .where(
        and(
          eq(knowledgeDocuments.workspaceOrgId, workspaceOrgId),
          inArray(knowledgeDocuments.docPath, docPaths),
        ),
      );
    for (const r of rows) out.set(r.docPath, { title: r.title, url: r.url });
    return out;
  }

  /** Remove one source doc's provenance row (its derived contracts drop on the next sync). */
  async deleteDocument(workspaceOrgId: string, sourceKind: string, externalId: string): Promise<void> {
    await this.db
      .delete(knowledgeDocuments)
      .where(
        and(
          eq(knowledgeDocuments.workspaceOrgId, workspaceOrgId),
          eq(knowledgeDocuments.sourceKind, sourceKind),
          eq(knowledgeDocuments.externalId, externalId),
        ),
      );
  }
}
