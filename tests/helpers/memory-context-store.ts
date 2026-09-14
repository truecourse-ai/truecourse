/**
 * The workspace context store, in memory — what a route, job or hook test needs
 * from it without a database. Same contract as `PgContextStore`, staleness
 * included: ONE workspace stamp, moved by a sync that reconciled something, by
 * a link set that actually differs, and by a source being removed.
 */

import type {
  ContextBinding,
  ContextDocument,
  ContextSource,
  ContextSyncRecord,
} from '@truecourse/shared';
import type {
  ContextLedgerWrite,
  ContextSourceInput,
  ContextSourcePatch,
  ContextStore,
} from '@truecourse/core/lib/context-store';

export type MemoryContextStore = ContextStore;

const listOf = <T>(map: Map<string, T[]>, org: string): T[] => {
  const rows = map.get(org) ?? [];
  map.set(org, rows);
  return rows;
};

export function memoryContextStore(clock: () => string = () => new Date().toISOString()): MemoryContextStore {
  const sources = new Map<string, ContextSource[]>();
  const documents = new Map<string, ContextDocument[]>();
  const bodies = new Map<string, Map<string, string>>();
  const syncs = new Map<string, ContextSyncRecord[]>();
  const bindings = new Map<string, ContextBinding[]>();
  /** The workspace's staleness stamp — what `changedAt` answers with. */
  const stale = new Map<string, string>();

  /** Move the stamp forward; never backwards. */
  const touch = (org: string, at = clock()): void => {
    const current = stale.get(org);
    if (current === undefined || current < at) stale.set(org, at);
  };

  const pool = (org: string): Map<string, string> => {
    const map = bodies.get(org) ?? new Map<string, string>();
    bodies.set(org, map);
    return map;
  };

  const store: MemoryContextStore = {
    async listSources(org) {
      return [...listOf(sources, org)];
    },
    async getSource(org, sourceId) {
      return listOf(sources, org).find((source) => source.id === sourceId) ?? null;
    },
    async createSource(org, input: ContextSourceInput) {
      const rows = listOf(sources, org);
      if (rows.some((source) => source.id === input.id)) {
        throw new Error(`A context source "${input.id}" already exists in this workspace.`);
      }
      const now = clock();
      const source: ContextSource = {
        id: input.id,
        kind: input.kind,
        title: input.title,
        config: input.config,
        status: input.status ?? 'never',
        statusNote: input.statusNote ?? null,
        lastSyncAt: null,
        createdAt: now,
        updatedAt: now,
      };
      rows.push(source);
      return source;
    },
    async updateSource(org, sourceId, patch: ContextSourcePatch) {
      const rows = listOf(sources, org);
      const index = rows.findIndex((source) => source.id === sourceId);
      if (index < 0) return null;
      const next: ContextSource = { ...rows[index]!, updatedAt: clock() };
      if (patch.title !== undefined) next.title = patch.title;
      if (patch.config !== undefined) next.config = patch.config;
      if (patch.status !== undefined) next.status = patch.status;
      if (patch.statusNote !== undefined) next.statusNote = patch.statusNote;
      if (patch.lastSyncAt !== undefined) next.lastSyncAt = patch.lastSyncAt;
      rows[index] = next;
      return next;
    },
    async removeSource(org, sourceId) {
      const removed = listOf(sources, org).some((source) => source.id === sourceId);
      sources.set(org, listOf(sources, org).filter((source) => source.id !== sourceId));
      documents.set(org, listOf(documents, org).filter((doc) => doc.sourceId !== sourceId));
      syncs.set(org, listOf(syncs, org).filter((sync) => sync.sourceId !== sourceId));
      bindings.set(org, listOf(bindings, org).filter((binding) => binding.sourceId !== sourceId));
      if (removed) touch(org);
      sweep(org);
    },

    async recordSync(org, record) {
      listOf(syncs, org).push(record);
      if (record.added + record.changed + record.removed > 0) touch(org, record.at);
    },
    async listSyncs(org, sourceId, limit = 50) {
      return listOf(syncs, org)
        .filter((sync) => sync.sourceId === sourceId)
        .sort((a, b) => (a.at < b.at ? 1 : -1))
        .slice(0, limit);
    },

    async listDocuments(org, sourceId) {
      const rows = listOf(documents, org);
      return sourceId ? rows.filter((doc) => doc.sourceId === sourceId) : [...rows];
    },
    async writeDocuments(org, sourceId, write: ContextLedgerWrite) {
      for (const doc of write.documents) pool(org).set(doc.contentHash, doc.body);
      const rows = listOf(documents, org).filter(
        (doc) => doc.sourceId !== sourceId || !write.removed.includes(doc.docId),
      );
      const now = clock();
      for (const doc of write.documents) {
        const index = rows.findIndex((row) => row.sourceId === sourceId && row.docId === doc.docId);
        const next: ContextDocument = {
          sourceId,
          docId: doc.docId,
          docPath: doc.docPath,
          title: doc.title,
          url: doc.url,
          contentHash: doc.contentHash,
          updatedAt: doc.updatedAt,
          createdAt: index >= 0 ? rows[index]!.createdAt : now,
        };
        if (index >= 0) rows[index] = next;
        else rows.push(next);
      }
      documents.set(org, rows);
      sweep(org);
    },
    async readBody(org, contentHash) {
      return pool(org).get(contentHash) ?? null;
    },

    async bindings(org, repoFullName) {
      return listOf(bindings, org)
        .filter((binding) => binding.repoFullName === repoFullName)
        .map((binding) => binding.sourceId)
        .sort();
    },
    async setBindings(org, repoFullName, sourceIds) {
      const wanted = [...new Set(sourceIds)];
      const rows = listOf(bindings, org);
      const kept = rows.filter(
        (binding) => binding.repoFullName !== repoFullName || wanted.includes(binding.sourceId),
      );
      const have = new Set(
        kept.filter((binding) => binding.repoFullName === repoFullName).map((b) => b.sourceId),
      );
      const dropped = rows.length - kept.length;
      const now = clock();
      const added = wanted.filter((sourceId) => !have.has(sourceId));
      for (const sourceId of added) kept.push({ repoFullName, sourceId, createdAt: now });
      bindings.set(org, kept);
      if (added.length > 0 || dropped > 0) touch(org, now);
    },
    async reposForSource(org, sourceId) {
      return listOf(bindings, org)
        .filter((binding) => binding.sourceId === sourceId)
        .map((binding) => binding.repoFullName)
        .sort();
    },
    async listBindings(org) {
      return [...listOf(bindings, org)];
    },

    async changedAt(org) {
      return stale.get(org) ?? null;
    },
  };

  /** Drop bodies no live ledger row still names, as the Postgres store does. */
  function sweep(org: string): void {
    const live = new Set(listOf(documents, org).map((doc) => doc.contentHash));
    for (const hash of [...pool(org).keys()]) if (!live.has(hash)) pool(org).delete(hash);
  }

  return store;
}
