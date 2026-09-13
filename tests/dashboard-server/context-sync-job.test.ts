/**
 * `context.sync` — one refresh of one workspace source, through the real job
 * lifecycle envelope (PGlite + `executeJob`), with a scripted driver in place
 * of a network.
 *
 * What is pinned: the diff the driver hands back becomes the stored ledger and
 * the sync record; a document that did not change keeps the stamp it already
 * had; the source's status moves `syncing` → `synced` (or `failed`, carrying
 * the reason); a paused source is skipped without touching anything; a source
 * removed while the job was queued settles quietly; and every mutation tells
 * the workspace.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type Db } from '@truecourse/db';
import { JobStore, NotificationStore, PgContextStore } from '@truecourse/data-store';
import { executeJob, type JobRuntime } from '@truecourse/jobs';
import type { ServerEvent } from '@truecourse/shared';
import {
  resetContextStore,
  setContextStore,
} from '@truecourse/core/lib/context-store';
import type {
  ContextDriverDocument,
  ContextLedgerEntry,
  ContextSourceDriver,
} from '@truecourse/core/services/context';
import {
  createContextSyncTask,
  type ContextSyncJobPayload,
  type ContextSyncJobResult,
} from '../../apps/dashboard/server/src/jobs/tasks/context-sync';
import {
  setContextEventPublisher,
} from '../../apps/dashboard/server/src/services/context.service';

const ORG = 'org_A';
const SOURCE = 'site-docs';
const AT = '2026-09-10T12:00:00.000Z';

let client: PGlite;
let db: Db;
let store: PgContextStore;
let published: { org: string; event: ServerEvent }[];

const hashOf = (body: string): string => createHash('sha256').update(body).digest('hex');

beforeEach(async () => {
  client = new PGlite();
  db = drizzle(client, { schema }) as unknown as Db;
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  store = new PgContextStore(db);
  setContextStore(store);
  published = [];
  setContextEventPublisher((org, event) => {
    published.push({ org, event });
  });
});

afterEach(async () => {
  resetContextStore();
  setContextEventPublisher(null);
  await client.close();
});

function runtime(): JobRuntime & { jobStore: JobStore } {
  return {
    db,
    jobStore: new JobStore(db),
    notifications: new NotificationStore(db),
    publish: async () => {},
  };
}

/** A document the scripted driver yields. */
const doc = (
  docId: string,
  body: string,
  over: Partial<ContextDriverDocument> = {},
): ContextDriverDocument => ({
  docId,
  docPath: `${docId}.md`,
  title: docId,
  url: null,
  contentHash: hashOf(body),
  body,
  updatedAt: AT,
  ...over,
});

/** A driver that yields exactly what the test says, and records what it saw. */
function scriptedDriver(
  documents: ContextDriverDocument[],
  opts: { title?: string; fail?: Error } = {},
): ContextSourceDriver & { ledgerSeen: ContextLedgerEntry[][] } {
  const ledgerSeen: ContextLedgerEntry[][] = [];
  return {
    kind: 'site',
    ledgerSeen,
    check: async () => ({ title: opts.title ?? 'Docs', count: documents.length, titles: [], skipped: [] }),
    sync: async (_config, ledger) => {
      ledgerSeen.push([...ledger]);
      if (opts.fail) throw opts.fail;
      const stored = new Map(ledger.map((entry) => [entry.docId, entry.contentHash]));
      const added: string[] = [];
      const changed: string[] = [];
      const unchanged: string[] = [];
      for (const document of documents) {
        const prior = stored.get(document.docId);
        if (prior === undefined) added.push(document.docId);
        else if (prior !== document.contentHash) changed.push(document.docId);
        else unchanged.push(document.docId);
      }
      const present = new Set(documents.map((d) => d.docId));
      return {
        title: opts.title ?? 'Docs',
        documents,
        added,
        changed,
        removed: ledger.map((e) => e.docId).filter((id) => !present.has(id)),
        unchanged,
        skipped: [],
      };
    },
  };
}

/** Run the job once against `driver`, and hand back the settled row. */
async function runSync(
  driver: ContextSourceDriver,
  over: Partial<ContextSyncJobPayload> = {},
  at = AT,
) {
  const rt = runtime();
  const job = await rt.jobStore.create({
    org: ORG,
    type: 'context.sync',
    key: `context.sync:${over.sourceId ?? SOURCE}`,
  });
  const def = createContextSyncTask({
    drivers: () => new Map([[driver.kind, driver]]),
    now: () => new Date(at),
  });
  // A failed job rethrows after the envelope settled the row — the row is what
  // this suite reads, so the throw is absorbed here.
  await executeJob(rt, def, {
    jobId: job.id,
    workspaceOrgId: ORG,
    sourceId: SOURCE,
    source: 'manual',
    ...over,
  }).catch(() => undefined);
  const settled = await rt.jobStore.get(job.id);
  return { settled, result: settled?.result as ContextSyncJobResult | null };
}

async function seedSource(over: Record<string, unknown> = {}): Promise<void> {
  await store.createSource(ORG, {
    id: SOURCE,
    kind: 'site',
    title: 'Docs',
    config: { llmsTxtUrl: 'https://docs.example.com/llms.txt' },
    ...over,
  });
}

const changes = (): string[] =>
  published.flatMap((p) => (p.event.type === 'context.changed' ? [p.event.change] : []));

describe('the first sync', () => {
  it('stores every document and its body, and marks the source synced', async () => {
    await seedSource();
    const { settled, result } = await runSync(scriptedDriver([doc('a', 'A'), doc('b', 'B')]));

    expect(settled?.status).toBe('succeeded');
    expect(result).toMatchObject({ outcome: 'synced', added: 2, changed: 0, removed: 0, unchanged: 0 });

    const rows = await store.listDocuments(ORG, SOURCE);
    expect(rows.map((row) => row.docId)).toEqual(['a', 'b']);
    expect(await store.readBody(ORG, hashOf('A'))).toBe('A');

    const source = await store.getSource(ORG, SOURCE);
    expect(source).toMatchObject({ status: 'synced', statusNote: null });
    expect(source!.lastSyncAt).toBe(AT);
  });

  it('records the sync with no parent', async () => {
    await seedSource();
    await runSync(scriptedDriver([doc('a', 'A')]));
    const syncs = await store.listSyncs(ORG, SOURCE);
    expect(syncs).toHaveLength(1);
    expect(syncs[0]).toMatchObject({ added: 1, changed: 0, removed: 0, unchanged: 0 });
    expect(syncs[0]!.parentAt).toBeNull();
  });

  it('takes the title the origin gives itself', async () => {
    await seedSource();
    await runSync(scriptedDriver([doc('a', 'A')], { title: 'Acme Docs' }));
    expect((await store.getSource(ORG, SOURCE))!.title).toBe('Acme Docs');
  });

  it('posts one success notification naming what changed', async () => {
    await seedSource();
    const rt = runtime();
    const job = await rt.jobStore.create({ org: ORG, type: 'context.sync', key: 'k' });
    await executeJob(
      rt,
      createContextSyncTask({
        drivers: () => new Map([['site', scriptedDriver([doc('a', 'A')])]]),
        now: () => new Date(AT),
      }),
      { jobId: job.id, workspaceOrgId: ORG, sourceId: SOURCE, source: 'add' },
    );
    const feed = await rt.notifications.listForOrg(ORG);
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({ kind: 'context.sync', level: 'success', title: 'Source synced' });
    expect(feed[0]!.body).toContain('1 added');
    // The source itself is neither in the title nor the body: the row's address
    // carries it, and the page names it from the source.
    expect(feed[0]!.body).not.toContain('Docs');
    expect(feed[0]!.data).toMatchObject({ sourceId: SOURCE, sourceTitle: 'Docs' });
  });

  it('tells the workspace twice: it started, and what it holds now', async () => {
    await seedSource();
    await runSync(scriptedDriver([doc('a', 'A')]));
    expect(changes()).toEqual(['sources', 'documents']);
  });
});

describe('a second sync', () => {
  it('shows the driver the ledger it already holds', async () => {
    await seedSource();
    await runSync(scriptedDriver([doc('a', 'A')]));
    const driver = scriptedDriver([doc('a', 'A')]);
    await runSync(driver);
    expect(driver.ledgerSeen[0]).toEqual([{ docId: 'a', docPath: 'a.md', contentHash: hashOf('A') }]);
  });

  it('reconciles an edit, an addition and a removal', async () => {
    await seedSource();
    await runSync(scriptedDriver([doc('a', 'A'), doc('b', 'B')]));
    const { result } = await runSync(
      scriptedDriver([doc('a', 'A2'), doc('c', 'C')]),
      {},
      '2026-09-11T12:00:00.000Z',
    );
    expect(result).toMatchObject({ added: 1, changed: 1, removed: 1, unchanged: 0 });
    const rows = await store.listDocuments(ORG, SOURCE);
    expect(rows.map((row) => row.docId)).toEqual(['a', 'c']);
    expect(await store.readBody(ORG, hashOf('B'))).toBeNull();
    expect(await store.readBody(ORG, hashOf('A2'))).toBe('A2');
  });

  it('chains the sync record onto the previous one', async () => {
    await seedSource();
    await runSync(scriptedDriver([doc('a', 'A')]));
    await runSync(scriptedDriver([doc('a', 'A')]), {}, '2026-09-11T12:00:00.000Z');
    const syncs = await store.listSyncs(ORG, SOURCE);
    expect(syncs).toHaveLength(2);
    expect(syncs[0]!.parentAt).not.toBeNull();
    expect(syncs[0]).toMatchObject({ unchanged: 1, added: 0, changed: 0 });
  });

  it('keeps the stamp of a document that did not change', async () => {
    await seedSource();
    await runSync(scriptedDriver([doc('a', 'A', { updatedAt: '2026-01-01T00:00:00.000Z' })]));
    const before = (await store.listDocuments(ORG, SOURCE))[0]!.updatedAt;
    // The driver re-reads the page and stamps it "now"; the content is the same,
    // so the stored stamp must not move.
    await runSync(
      scriptedDriver([doc('a', 'A', { updatedAt: '2026-09-11T12:00:00.000Z' })]),
      {},
      '2026-09-11T12:00:00.000Z',
    );
    expect((await store.listDocuments(ORG, SOURCE))[0]!.updatedAt).toBe(before);
  });

  it('takes the new stamp of a document that did change', async () => {
    await seedSource();
    await runSync(scriptedDriver([doc('a', 'A', { updatedAt: '2026-01-01T00:00:00.000Z' })]));
    await runSync(
      scriptedDriver([doc('a', 'A2', { updatedAt: '2026-09-11T12:00:00.000Z' })]),
      {},
      '2026-09-11T12:00:00.000Z',
    );
    const row = (await store.listDocuments(ORG, SOURCE))[0]!;
    expect(row.updatedAt).toBe('2026-09-11T12:00:00.000Z');
  });
});

describe('a sync that fails', () => {
  it('records the reason on the source and fails the job', async () => {
    await seedSource();
    const { settled } = await runSync(
      scriptedDriver([], { fail: new Error('HTTP 503 Service Unavailable') }),
    );
    expect(settled?.status).toBe('failed');
    expect(await store.getSource(ORG, SOURCE)).toMatchObject({
      status: 'failed',
      statusNote: 'HTTP 503 Service Unavailable',
    });
  });

  it('leaves the documents it already held alone', async () => {
    await seedSource();
    await runSync(scriptedDriver([doc('a', 'A')]));
    await runSync(scriptedDriver([], { fail: new Error('boom') }));
    expect((await store.listDocuments(ORG, SOURCE)).map((row) => row.docId)).toEqual(['a']);
    expect(await store.readBody(ORG, hashOf('A'))).toBe('A');
  });

  it('posts the failure as a notification', async () => {
    await seedSource();
    const rt = runtime();
    const job = await rt.jobStore.create({ org: ORG, type: 'context.sync', key: 'k' });
    await executeJob(
      rt,
      createContextSyncTask({
        drivers: () => new Map([['site', scriptedDriver([], { fail: new Error('boom') })]]),
      }),
      { jobId: job.id, workspaceOrgId: ORG, sourceId: SOURCE, source: 'manual' },
    ).catch(() => undefined);
    const feed = await rt.notifications.listForOrg(ORG);
    expect(feed[0]).toMatchObject({ level: 'error', kind: 'context.sync' });
  });
});

describe('what the job refuses to do', () => {
  it('skips a paused source without reading it or touching anything', async () => {
    await seedSource();
    await store.updateSource(ORG, SOURCE, { status: 'paused' });
    const driver = scriptedDriver([doc('a', 'A')]);
    const { settled, result } = await runSync(driver);

    expect(result).toMatchObject({ outcome: 'paused', added: 0 });
    expect(settled?.status).toBe('succeeded');
    expect(driver.ledgerSeen).toEqual([]);
    expect(await store.listDocuments(ORG, SOURCE)).toEqual([]);
    expect((await store.getSource(ORG, SOURCE))!.status).toBe('paused');
    expect(changes()).toEqual([]);
  });

  it('settles quietly when the source was removed while it waited', async () => {
    const driver = scriptedDriver([doc('a', 'A')]);
    const { settled, result } = await runSync(driver);
    expect(result).toMatchObject({ outcome: 'missing' });
    expect(settled?.status).toBe('succeeded');
    expect(driver.ledgerSeen).toEqual([]);
  });

  it('refuses a kind that has no driver', async () => {
    await seedSource({ kind: 'notion' });
    const { settled } = await runSync(scriptedDriver([]));
    expect(settled?.status).toBe('failed');
    expect(settled?.error).toContain('not available yet');
  });
});
