/**
 * The hosted half of core's `ContextStore`: the workspace's sources, their
 * documents, their syncs and the repositories that read them, over the four
 * `context_*` tables — with every document BODY content-addressed in the shared
 * `content` pool under scope `context:ws:<org>`.
 *
 * The pool keys a body `sha256-<hex>` while the ledger carries the same digest
 * bare as `content_hash`: a
 * body identical across two sources (a page mirrored into a repository) is
 * stored once per workspace, and a body is read back by the hash the ledger
 * names.
 *
 * Bodies are swept when the ledger stops naming them: a document removed or
 * rewritten by a sync, and every document of a removed source. The sweep is
 * workspace-wide (every live ledger row of the org), so a body two sources
 * share survives one of them losing it.
 *
 * Every timestamp LEAVES here as ISO-8601 with a `Z` — Postgres renders a
 * `timestamptz` as `2026-09-10 12:00:00+00`, which sorts and compares wrong
 * against the ISO stamps the rest of the pipeline writes (the corpus's own
 * timestamp, which the workspace scan diffs `changedAt` against).
 *
 * STALENESS is ONE stamp (`context_workspaces`), bumped by every mutation that
 * changes what a repository would read: a sync that added, changed or removed
 * anything, a link made or dropped, a source removed. It is a stamp rather than
 * a query over the rows because the two mutations that matter most leave
 * NOTHING behind to read a timestamp off — an unlink deletes its binding row,
 * and removing a source deletes every binding to it.
 */

import { and, asc, desc, eq, inArray, isNull, lt, ne, or } from 'drizzle-orm';
import {
  contextBindings,
  contextDocuments,
  contextSources,
  contextSyncs,
  contextWorkspaces,
  type Db,
} from '@truecourse/db';
import type {
  ContextBinding,
  ContextDocument,
  ContextSource,
  ContextSourceConfig,
  ContextSourceKind,
  ContextSourceStatus,
  ContextSyncRecord,
} from '@truecourse/shared';
import type {
  ContextLedgerWrite,
  ContextSourceInput,
  ContextSourcePatch,
  ContextStore,
} from '@truecourse/core/lib/context-store';
import { ContentStore, contentScope } from './content-store.js';

/**
 * Move a workspace's staleness stamp forward — the ONE write behind
 * `changedAt`. Never backwards: two mutations settling out of order must not
 * make the corpus look current again, so an older stamp is ignored.
 *
 * Exported because one writer outside the store bumps it: the disconnect purge,
 * which drops a repository's links directly.
 */
export async function touchContextWorkspace(
  db: Db,
  org: string,
  at = new Date().toISOString(),
): Promise<void> {
  await db
    .insert(contextWorkspaces)
    .values({ workspaceOrgId: org, changedAt: at })
    .onConflictDoUpdate({
      target: [contextWorkspaces.workspaceOrgId],
      set: { changedAt: at },
      setWhere: lt(contextWorkspaces.changedAt, at),
    });
}

/** The content pool's key for a body whose ledger `contentHash` is `hex`. */
function poolSha(contentHash: string): string {
  return `sha256-${contentHash}`;
}

/** One source somewhere in the deployment that is due a sync. */
export interface DueContextSource {
  workspaceOrgId: string;
  sourceId: string;
}

/**
 * Every source of EVERY workspace the sweep should sync, excluding the ones the
 * user paused:
 *
 *  - a SITE whose last sync is older than `before` — a site has no event that
 *    announces a change, so it is refreshed on the clock;
 *  - a source of ANY KIND that has NEVER synced — a repository source is
 *    normally synced by its push, but one whose first sync was lost with the
 *    process that ran it would otherwise wait for a commit that may never come.
 *
 * The sweep's one query — cross-workspace by construction, which is why it is a
 * function here rather than a method on the workspace-scoped store seam.
 */
export async function listDueContextSources(db: Db, before: string): Promise<DueContextSource[]> {
  const rows = await db
    .select({
      workspaceOrgId: contextSources.workspaceOrgId,
      sourceId: contextSources.id,
    })
    .from(contextSources)
    .where(
      and(
        ne(contextSources.status, 'paused'),
        or(
          isNull(contextSources.lastSyncAt),
          and(eq(contextSources.kind, 'site'), lt(contextSources.lastSyncAt, before)),
        ),
      ),
    )
    .orderBy(asc(contextSources.workspaceOrgId), asc(contextSources.id));
  return rows;
}

/** Postgres's rendering of a timestamptz → ISO-8601 with a `Z`. */
function iso(stamp: string): string;
function iso(stamp: string | null): string | null;
function iso(stamp: string | null): string | null {
  if (stamp === null) return null;
  // `2026-09-10 12:00:00+00` — a space for the `T`, and a two-digit offset the
  // Date parser does not accept without its minutes.
  const dated = stamp.includes('T') ? stamp : stamp.replace(' ', 'T');
  const parsed = new Date(/[+-]\d{2}$/.test(dated) ? `${dated}:00` : dated);
  return Number.isNaN(parsed.getTime()) ? stamp : parsed.toISOString();
}

type SourceRow = typeof contextSources.$inferSelect;
type DocumentRow = typeof contextDocuments.$inferSelect;

function toSource(row: SourceRow): ContextSource {
  return {
    id: row.id,
    kind: row.kind as ContextSourceKind,
    title: row.title,
    config: row.config as ContextSourceConfig,
    status: row.status as ContextSourceStatus,
    statusNote: row.statusNote,
    lastSyncAt: iso(row.lastSyncAt),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function toDocument(row: DocumentRow): ContextDocument {
  return {
    sourceId: row.sourceId,
    docId: row.docId,
    docPath: row.docPath,
    title: row.title,
    url: row.url,
    contentHash: row.contentHash,
    updatedAt: iso(row.updatedAt),
    createdAt: iso(row.createdAt),
  };
}

export class PgContextStore implements ContextStore {
  private readonly content: ContentStore;

  constructor(private readonly db: Db) {
    this.content = new ContentStore(db);
  }

  // --- Sources -------------------------------------------------------------

  async listSources(org: string): Promise<ContextSource[]> {
    const rows = await this.db
      .select()
      .from(contextSources)
      .where(eq(contextSources.workspaceOrgId, org))
      .orderBy(asc(contextSources.createdAt), asc(contextSources.id));
    return rows.map(toSource);
  }

  async getSource(org: string, sourceId: string): Promise<ContextSource | null> {
    const rows = await this.db
      .select()
      .from(contextSources)
      .where(and(eq(contextSources.workspaceOrgId, org), eq(contextSources.id, sourceId)))
      .limit(1);
    return rows[0] ? toSource(rows[0]) : null;
  }

  async createSource(org: string, input: ContextSourceInput): Promise<ContextSource> {
    const now = new Date().toISOString();
    const rows = await this.db
      .insert(contextSources)
      .values({
        workspaceOrgId: org,
        id: input.id,
        kind: input.kind,
        title: input.title,
        config: input.config,
        status: input.status ?? 'never',
        statusNote: input.statusNote ?? null,
        lastSyncAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error(`A context source "${input.id}" already exists in this workspace.`);
    return toSource(row);
  }

  async updateSource(
    org: string,
    sourceId: string,
    patch: ContextSourcePatch,
  ): Promise<ContextSource | null> {
    const set: Partial<SourceRow> = { updatedAt: new Date().toISOString() };
    if (patch.title !== undefined) set.title = patch.title;
    if (patch.config !== undefined) set.config = patch.config;
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.statusNote !== undefined) set.statusNote = patch.statusNote;
    if (patch.lastSyncAt !== undefined) set.lastSyncAt = patch.lastSyncAt;
    const rows = await this.db
      .update(contextSources)
      .set(set)
      .where(and(eq(contextSources.workspaceOrgId, org), eq(contextSources.id, sourceId)))
      .returning();
    return rows[0] ? toSource(rows[0]) : null;
  }

  async removeSource(org: string, sourceId: string): Promise<void> {
    // A removal is a link change for every repository that read it — but only
    // when a source was actually there to remove.
    let removed = false;
    await this.db.transaction(async (tx) => {
      await tx
        .delete(contextDocuments)
        .where(
          and(eq(contextDocuments.workspaceOrgId, org), eq(contextDocuments.sourceId, sourceId)),
        );
      await tx
        .delete(contextSyncs)
        .where(and(eq(contextSyncs.workspaceOrgId, org), eq(contextSyncs.sourceId, sourceId)));
      await tx
        .delete(contextBindings)
        .where(and(eq(contextBindings.workspaceOrgId, org), eq(contextBindings.sourceId, sourceId)));
      const gone = await tx
        .delete(contextSources)
        .where(and(eq(contextSources.workspaceOrgId, org), eq(contextSources.id, sourceId)))
        .returning({ id: contextSources.id });
      removed = gone.length > 0;
    });
    if (removed) await this.touch(org);
    await this.sweepBodies(org);
  }

  // --- Syncs ---------------------------------------------------------------

  async recordSync(org: string, record: ContextSyncRecord): Promise<void> {
    await this.db
      .insert(contextSyncs)
      .values({
        workspaceOrgId: org,
        sourceId: record.sourceId,
        at: record.at,
        parentAt: record.parentAt,
        added: record.added,
        changed: record.changed,
        removed: record.removed,
        unchanged: record.unchanged,
      })
      .onConflictDoUpdate({
        target: [contextSyncs.workspaceOrgId, contextSyncs.sourceId, contextSyncs.at],
        set: {
          parentAt: record.parentAt,
          added: record.added,
          changed: record.changed,
          removed: record.removed,
          unchanged: record.unchanged,
        },
      });
    // A sync that reconciled nothing leaves the corpus exactly as current as it
    // was — only a sync that MOVED something makes it stale.
    if (record.added + record.changed + record.removed > 0) await this.touch(org, record.at);
  }

  async listSyncs(org: string, sourceId: string, limit = 50): Promise<ContextSyncRecord[]> {
    const rows = await this.db
      .select()
      .from(contextSyncs)
      .where(and(eq(contextSyncs.workspaceOrgId, org), eq(contextSyncs.sourceId, sourceId)))
      .orderBy(desc(contextSyncs.at))
      .limit(limit);
    return rows.map((row) => ({
      sourceId: row.sourceId,
      at: iso(row.at),
      parentAt: iso(row.parentAt),
      added: row.added,
      changed: row.changed,
      removed: row.removed,
      unchanged: row.unchanged,
    }));
  }

  // --- Documents -----------------------------------------------------------

  async listDocuments(org: string, sourceId?: string): Promise<ContextDocument[]> {
    const where = sourceId
      ? and(eq(contextDocuments.workspaceOrgId, org), eq(contextDocuments.sourceId, sourceId))
      : eq(contextDocuments.workspaceOrgId, org);
    const rows = await this.db
      .select()
      .from(contextDocuments)
      .where(where)
      .orderBy(asc(contextDocuments.sourceId), asc(contextDocuments.docPath));
    return rows.map(toDocument);
  }

  async writeDocuments(org: string, sourceId: string, write: ContextLedgerWrite): Promise<void> {
    const scope = contentScope.context(org);
    // Bodies first: a ledger row must never point at a body that is not there.
    for (const doc of write.documents) {
      await this.content.put(scope, poolSha(doc.contentHash), doc.body);
    }
    const now = new Date().toISOString();
    await this.db.transaction(async (tx) => {
      if (write.removed.length > 0) {
        await tx
          .delete(contextDocuments)
          .where(
            and(
              eq(contextDocuments.workspaceOrgId, org),
              eq(contextDocuments.sourceId, sourceId),
              inArray(contextDocuments.docId, write.removed),
            ),
          );
      }
      for (const doc of write.documents) {
        await tx
          .insert(contextDocuments)
          .values({
            workspaceOrgId: org,
            sourceId,
            docId: doc.docId,
            docPath: doc.docPath,
            title: doc.title,
            url: doc.url,
            contentHash: doc.contentHash,
            updatedAt: doc.updatedAt,
            createdAt: now,
          })
          .onConflictDoUpdate({
            target: [
              contextDocuments.workspaceOrgId,
              contextDocuments.sourceId,
              contextDocuments.docId,
            ],
            set: {
              docPath: doc.docPath,
              title: doc.title,
              url: doc.url,
              contentHash: doc.contentHash,
              updatedAt: doc.updatedAt,
            },
          });
      }
    });
    await this.sweepBodies(org);
  }

  readBody(org: string, contentHash: string): Promise<string | null> {
    return this.content.get(contentScope.context(org), poolSha(contentHash));
  }

  /** Drop every stored body no live ledger row of the workspace still names. */
  private async sweepBodies(org: string): Promise<void> {
    const rows = await this.db
      .select({ contentHash: contextDocuments.contentHash })
      .from(contextDocuments)
      .where(eq(contextDocuments.workspaceOrgId, org));
    const live = new Set(rows.map((row) => poolSha(row.contentHash)));
    await this.content.gc(contentScope.context(org), live);
  }

  // --- Bindings ------------------------------------------------------------

  async bindings(org: string, repoFullName: string): Promise<string[]> {
    const rows = await this.db
      .select({ sourceId: contextBindings.sourceId })
      .from(contextBindings)
      .where(
        and(
          eq(contextBindings.workspaceOrgId, org),
          eq(contextBindings.repoFullName, repoFullName),
        ),
      )
      .orderBy(asc(contextBindings.sourceId));
    return rows.map((row) => row.sourceId);
  }

  async setBindings(org: string, repoFullName: string, sourceIds: string[]): Promise<void> {
    const wanted = [...new Set(sourceIds)];
    const now = new Date().toISOString();
    let changed = false;
    await this.db.transaction(async (tx) => {
      const existing = await tx
        .select({ sourceId: contextBindings.sourceId })
        .from(contextBindings)
        .where(
          and(
            eq(contextBindings.workspaceOrgId, org),
            eq(contextBindings.repoFullName, repoFullName),
          ),
        );
      const have = new Set(existing.map((row) => row.sourceId));
      const gone = [...have].filter((sourceId) => !wanted.includes(sourceId));
      changed = gone.length > 0 || wanted.some((sourceId) => !have.has(sourceId));
      if (gone.length > 0) {
        await tx
          .delete(contextBindings)
          .where(
            and(
              eq(contextBindings.workspaceOrgId, org),
              eq(contextBindings.repoFullName, repoFullName),
              inArray(contextBindings.sourceId, gone),
            ),
          );
      }
      // Only NEW links are inserted, so re-saving an unchanged set writes
      // nothing and — with `changed` false — leaves the staleness stamp alone.
      for (const sourceId of wanted) {
        if (have.has(sourceId)) continue;
        await tx
          .insert(contextBindings)
          .values({ workspaceOrgId: org, repoFullName, sourceId, createdAt: now })
          .onConflictDoNothing();
      }
    });
    if (changed) await this.touch(org, now);
  }

  async reposForSource(org: string, sourceId: string): Promise<string[]> {
    const rows = await this.db
      .select({ repoFullName: contextBindings.repoFullName })
      .from(contextBindings)
      .where(and(eq(contextBindings.workspaceOrgId, org), eq(contextBindings.sourceId, sourceId)))
      .orderBy(asc(contextBindings.repoFullName));
    return rows.map((row) => row.repoFullName);
  }

  async listBindings(org: string): Promise<ContextBinding[]> {
    const rows = await this.db
      .select()
      .from(contextBindings)
      .where(eq(contextBindings.workspaceOrgId, org))
      .orderBy(asc(contextBindings.repoFullName), asc(contextBindings.sourceId));
    return rows.map((row) => ({
      repoFullName: row.repoFullName,
      sourceId: row.sourceId,
      createdAt: iso(row.createdAt),
    }));
  }

  // --- Staleness -----------------------------------------------------------

  async changedAt(org: string): Promise<string | null> {
    const rows = await this.db
      .select({ changedAt: contextWorkspaces.changedAt })
      .from(contextWorkspaces)
      .where(eq(contextWorkspaces.workspaceOrgId, org))
      .limit(1);
    return iso(rows[0]?.changedAt ?? null);
  }

  private touch(org: string, at?: string): Promise<void> {
    return touchContextWorkspace(this.db, org, at);
  }
}
