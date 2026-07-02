/**
 * Provenance ledger for workspace Knowledge. One row per source document the
 * Knowledge was built from — identity + content hash only, NEVER the body. The
 * manual-upload route (and, in a later phase, the connector sync engine) upserts
 * a row per doc so the dashboard can list sources / "where did this come from?"
 * and incremental syncs can diff on the stored hash.
 *
 * This is an EE-internal store (not one of core's pluggable seams), so it is
 * constructed directly by the Knowledge router rather than installed globally.
 */

import { and, eq } from 'drizzle-orm';
import { knowledgeDocuments, type EeDb } from '@truecourse/ee-db';

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

export class PgKnowledgeStore {
  constructor(private readonly db: EeDb) {}

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
