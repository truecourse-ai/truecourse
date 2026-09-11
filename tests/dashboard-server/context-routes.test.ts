/**
 * The workspace Context routes, over the real app: the listing, the add (with
 * its two refusals), Check, Sync now, Pause / Resume, Remove, the ledger, the
 * document read by its corpus ref, and the per-repository links.
 *
 * The store is in memory and the drivers are scripted, so nothing here reaches
 * a network or a clone — what is pinned is the HTTP contract and what each
 * route leaves behind.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import type { Express } from 'express';
import type { ServerEvent } from '@truecourse/shared';
import {
  resetContextStore,
  setContextStore,
} from '@truecourse/core/lib/context-store';
import { createTestApp, stubJobs, TEST_ORG, type StubJobs } from '../helpers/test-app';
import { setupTestFixture, teardownTestFixture, type TestFixture } from '../helpers/test-db';
import { memoryContextStore, type MemoryContextStore } from '../helpers/memory-context-store';
import {
  setContextDriverDeps,
  setContextEventPublisher,
} from '../../apps/dashboard/server/src/services/context.service';
import { contextDocRef } from '@truecourse/core/lib/context-ref';

let app: Express;
let fixture: TestFixture;
let store: MemoryContextStore;
let jobs: StubJobs;
let published: { org: string; event: ServerEvent }[];
/** Every `enqueueContextSync` the routes made, in order. */
let syncs: { workspaceOrgId: string; sourceId: string; source: string }[];

beforeEach(async () => {
  fixture = await setupTestFixture();
  store = memoryContextStore();
  setContextStore(store);
  published = [];
  syncs = [];
  setContextEventPublisher((org, event) => {
    published.push({ org, event });
  });
  setContextDriverDeps({
    publicOnly: false,
    acquireTree: async () => ({ dir: fixture.repoPath, dispose: () => {} }),
  });
  jobs = stubJobs();
  (jobs.mount as unknown as { enqueueContextSync: unknown }).enqueueContextSync = async (
    request: { workspaceOrgId: string; sourceId: string; source: string },
  ) => {
    syncs.push(request);
    return jobs.answer;
  };
  app = createTestApp({ jobs: jobs.mount });
});

afterEach(async () => {
  resetContextStore();
  setContextEventPublisher(null);
  setContextDriverDeps(null);
  await teardownTestFixture(fixture.project.slug);
});

const changes = (): { change: string; sourceId?: string; repoFullName?: string }[] =>
  published.flatMap((p) =>
    p.event.type === 'context.changed'
      ? [{ change: p.event.change, sourceId: p.event.sourceId, repoFullName: p.event.repoFullName }]
      : [],
  );

function addSite(url = 'https://docs.acme.com/llms.txt', repoIds: string[] = []) {
  return request(app)
    .post('/api/context/sources')
    .send({ kind: 'site', config: { llmsTxtUrl: url }, repoIds });
}

describe('GET /api/context/sources', () => {
  it('is empty for a workspace with nothing registered', async () => {
    const res = await request(app).get('/api/context/sources').expect(200);
    expect(res.body).toEqual({ sources: [], changedAt: null });
  });

  it('lists each source with its document count and its readers', async () => {
    await store.createSource(TEST_ORG, {
      id: 'site-docs',
      kind: 'site',
      title: 'Acme Docs',
      config: { llmsTxtUrl: 'https://docs.acme.com/llms.txt' },
    });
    await store.writeDocuments(TEST_ORG, 'site-docs', {
      documents: [
        { docId: 'a', docPath: 'a.md', title: 'A', url: null, contentHash: 'h1', updatedAt: 'x', body: 'A' },
        { docId: 'b', docPath: 'b.md', title: 'B', url: null, contentHash: 'h2', updatedAt: 'x', body: 'B' },
      ],
      removed: [],
    });
    await store.setBindings(TEST_ORG, fixture.project.name, ['site-docs']);

    const res = await request(app).get('/api/context/sources').expect(200);
    expect(res.body.sources).toHaveLength(1);
    expect(res.body.sources[0]).toMatchObject({
      id: 'site-docs',
      kind: 'site',
      docCount: 2,
      repositories: [fixture.project.name],
    });
    expect(res.body.changedAt).not.toBeNull();
  });
});

describe('POST /api/context/sources', () => {
  it('stores a site source, links the repositories named, and enqueues its first sync', async () => {
    const res = await addSite('https://docs.acme.com/llms.txt', [fixture.project.slug]).expect(202);
    expect(res.body.source).toMatchObject({ kind: 'site', status: 'never' });
    expect(res.body.source.config).toEqual({ llmsTxtUrl: 'https://docs.acme.com/llms.txt' });
    expect(res.body.jobId).toBe('job_test');

    expect(await store.listSources(TEST_ORG)).toHaveLength(1);
    expect(await store.bindings(TEST_ORG, fixture.project.name)).toEqual([res.body.source.id]);
    expect(syncs).toEqual([
      { workspaceOrgId: TEST_ORG, sourceId: res.body.source.id, source: 'add' },
    ]);
  });

  it('links nothing when no repository is named', async () => {
    const res = await addSite().expect(202);
    expect(await store.reposForSource(TEST_ORG, res.body.source.id)).toEqual([]);
  });

  it('refuses a site URL the workspace already has', async () => {
    await addSite().expect(202);
    const again = await addSite().expect(409);
    expect(again.body.error).toContain('already a source of this workspace');
    expect(await store.listSources(TEST_ORG)).toHaveLength(1);
  });

  it('refuses a URL that is not an llms.txt', async () => {
    const res = await request(app)
      .post('/api/context/sources')
      .send({ kind: 'site', config: { llmsTxtUrl: 'https://docs.acme.com/' } })
      .expect(400);
    expect(res.body.error).toBeTruthy();
  });

  it('creates a repository source, always linked to the repository it scopes', async () => {
    const res = await request(app)
      .post('/api/context/sources')
      .send({ kind: 'repository', config: { repoFullName: fixture.project.name } })
      .expect(202);
    expect(res.body.source).toMatchObject({ kind: 'repository', title: fixture.project.name });
    expect(res.body.source.config).toMatchObject({
      repoFullName: fixture.project.name,
      include: ['docs/**', '**/*.md'],
    });
    expect(await store.bindings(TEST_ORG, fixture.project.name)).toEqual([res.body.source.id]);
  });

  it('refuses a second repository source for the same repository', async () => {
    await request(app)
      .post('/api/context/sources')
      .send({ kind: 'repository', config: { repoFullName: fixture.project.name } })
      .expect(202);
    const again = await request(app)
      .post('/api/context/sources')
      .send({ kind: 'repository', config: { repoFullName: fixture.project.name } })
      .expect(409);
    expect(again.body.error).toContain('already has a Repository source');
  });

  it('refuses a repository this workspace has not connected', async () => {
    await request(app)
      .post('/api/context/sources')
      .send({ kind: 'repository', config: { repoFullName: 'someone/else' } })
      .expect(404);
  });

  it('refuses a repoId that names nothing', async () => {
    await request(app)
      .post('/api/context/sources')
      .send({ kind: 'site', config: { llmsTxtUrl: 'https://x.example/llms.txt' }, repoIds: ['nope'] })
      .expect(404);
    expect(await store.listSources(TEST_ORG)).toHaveLength(0);
  });

  it('refuses a kind that has no implementation', async () => {
    const res = await request(app)
      .post('/api/context/sources')
      .send({ kind: 'notion', config: {} })
      .expect(400);
    expect(res.body.error).toContain('not available yet');
  });

  it('refuses a kind that is not a kind at all', async () => {
    const res = await request(app)
      .post('/api/context/sources')
      .send({ kind: 'carrier-pigeon', config: {} })
      .expect(400);
    expect(res.body.error).toContain('Unknown source kind');
  });

  it('tells the workspace a source appeared', async () => {
    const res = await addSite().expect(202);
    expect(changes()).toContainEqual({
      change: 'sources',
      sourceId: res.body.source.id,
      repoFullName: undefined,
    });
  });
});

describe('POST /api/context/sources/preview', () => {
  it('reports what a repository scope would yield, without storing it', async () => {
    fs.mkdirSync(path.join(fixture.repoPath, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(fixture.repoPath, 'docs/guide.md'), '# Getting started\n', 'utf-8');
    const res = await request(app)
      .post('/api/context/sources/preview')
      .send({ kind: 'repository', config: { repoFullName: fixture.project.name } })
      .expect(200);
    expect(res.body).toMatchObject({ title: fixture.project.name, count: 1 });
    expect(res.body.titles).toEqual(['Getting started']);
    expect(await store.listSources(TEST_ORG)).toEqual([]);
  });

  it('honors the include patterns it was given', async () => {
    fs.mkdirSync(path.join(fixture.repoPath, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(fixture.repoPath, 'docs/guide.md'), '# Guide\n', 'utf-8');
    fs.writeFileSync(path.join(fixture.repoPath, 'NOTES.md'), '# Notes\n', 'utf-8');
    const res = await request(app)
      .post('/api/context/sources/preview')
      .send({
        kind: 'repository',
        config: { repoFullName: fixture.project.name, include: ['docs/**'] },
      })
      .expect(200);
    expect(res.body.count).toBe(1);
  });

  it('refuses a scope it cannot read', async () => {
    await request(app)
      .post('/api/context/sources/preview')
      .send({ kind: 'site', config: { llmsTxtUrl: 'not a url' } })
      .expect(400);
  });

  it('refuses to check a repository this workspace has not connected', async () => {
    await request(app)
      .post('/api/context/sources/preview')
      .send({ kind: 'repository', config: { repoFullName: 'someone/else' } })
      .expect(404);
  });

  it('stores nothing', async () => {
    await request(app)
      .post('/api/context/sources/preview')
      .send({ kind: 'site', config: { llmsTxtUrl: 'not a url' } })
      .expect(400);
    expect(await store.listSources(TEST_ORG)).toEqual([]);
  });
});

describe('POST /api/context/sources/:id/sync', () => {
  it('enqueues a manual sync and answers with the job', async () => {
    const created = await addSite().expect(202);
    syncs.length = 0;
    const res = await request(app)
      .post(`/api/context/sources/${created.body.source.id}/sync`)
      .expect(202);
    expect(res.body).toEqual({ jobId: 'job_test' });
    expect(syncs).toEqual([
      { workspaceOrgId: TEST_ORG, sourceId: created.body.source.id, source: 'manual' },
    ]);
  });

  it('is a 409 when one is already in flight', async () => {
    const created = await addSite().expect(202);
    jobs.answer = { status: 'busy' };
    const res = await request(app)
      .post(`/api/context/sources/${created.body.source.id}/sync`)
      .expect(409);
    expect(res.body.error).toContain('already syncing');
  });

  it('refuses to sync a paused source', async () => {
    const created = await addSite().expect(202);
    await request(app)
      .post(`/api/context/sources/${created.body.source.id}/pause`)
      .send({ paused: true })
      .expect(200);
    syncs.length = 0;
    await request(app).post(`/api/context/sources/${created.body.source.id}/sync`).expect(409);
    expect(syncs).toEqual([]);
  });

  it('is a 404 for a source that does not exist', async () => {
    await request(app).post('/api/context/sources/ghost/sync').expect(404);
  });
});

describe('POST /api/context/sources/:id/pause', () => {
  it('pauses and resumes, restoring what the source was', async () => {
    const created = await addSite().expect(202);
    const id = created.body.source.id;

    const paused = await request(app)
      .post(`/api/context/sources/${id}/pause`)
      .send({ paused: true })
      .expect(200);
    expect(paused.body.source.status).toBe('paused');

    // Never synced ⇒ resuming lands back on `never`, not on a fake `synced`.
    const resumed = await request(app)
      .post(`/api/context/sources/${id}/pause`)
      .send({ paused: false })
      .expect(200);
    expect(resumed.body.source.status).toBe('never');
  });

  it('puts a FAILED source back where it was, note and all', async () => {
    const created = await addSite().expect(202);
    const id = created.body.source.id;
    await store.updateSource(TEST_ORG, id, { status: 'failed', statusNote: 'HTTP 503' });
    await request(app).post(`/api/context/sources/${id}/pause`).send({ paused: true }).expect(200);
    const resumed = await request(app)
      .post(`/api/context/sources/${id}/pause`)
      .send({ paused: false })
      .expect(200);
    expect(resumed.body.source).toMatchObject({ status: 'failed', statusNote: 'HTTP 503' });
  });

  it('resumes a source that HAS synced back to synced', async () => {
    const created = await addSite().expect(202);
    const id = created.body.source.id;
    await store.updateSource(TEST_ORG, id, { status: 'synced', lastSyncAt: '2026-09-10T10:00:00.000Z' });
    await request(app).post(`/api/context/sources/${id}/pause`).send({ paused: true }).expect(200);
    const resumed = await request(app)
      .post(`/api/context/sources/${id}/pause`)
      .send({ paused: false })
      .expect(200);
    expect(resumed.body.source.status).toBe('synced');
  });

  it('needs a boolean', async () => {
    const created = await addSite().expect(202);
    await request(app)
      .post(`/api/context/sources/${created.body.source.id}/pause`)
      .send({})
      .expect(400);
  });
});

describe('DELETE /api/context/sources/:id', () => {
  it('removes the source, its documents and its links, and names the readers', async () => {
    const created = await addSite('https://docs.acme.com/llms.txt', [fixture.project.slug]);
    const id = created.body.source.id;
    await store.writeDocuments(TEST_ORG, id, {
      documents: [
        { docId: 'a', docPath: 'a.md', title: 'A', url: null, contentHash: 'h1', updatedAt: 'x', body: 'A' },
      ],
      removed: [],
    });

    const res = await request(app).delete(`/api/context/sources/${id}`).expect(200);
    expect(res.body.repositories).toEqual([fixture.project.name]);
    expect(res.body.removed).toMatchObject({ id });

    expect(await store.getSource(TEST_ORG, id)).toBeNull();
    expect(await store.listDocuments(TEST_ORG, id)).toEqual([]);
    expect(await store.bindings(TEST_ORG, fixture.project.name)).toEqual([]);
  });

  it('is a 404 for a source that does not exist', async () => {
    await request(app).delete('/api/context/sources/ghost').expect(404);
  });
});

describe('the ledger and the document', () => {
  it('lists the documents of one source', async () => {
    const created = await addSite().expect(202);
    const id = created.body.source.id;
    await store.writeDocuments(TEST_ORG, id, {
      documents: [
        {
          docId: 'https://docs.acme.com/a',
          docPath: 'a.md',
          title: 'A',
          url: 'https://docs.acme.com/a',
          contentHash: 'h1',
          updatedAt: '2026-09-10T10:00:00.000Z',
          body: '# A\n',
        },
      ],
      removed: [],
    });
    const res = await request(app).get(`/api/context/sources/${id}/documents`).expect(200);
    expect(res.body.source).toMatchObject({ id, docCount: 1 });
    expect(res.body.documents).toHaveLength(1);
    expect(res.body.documents[0]).toMatchObject({ docPath: 'a.md', title: 'A' });
  });

  it('is a 404 for a source that does not exist', async () => {
    await request(app).get('/api/context/sources/ghost/documents').expect(404);
  });

  it('reads one document by its corpus ref', async () => {
    const created = await addSite().expect(202);
    const id = created.body.source.id;
    await store.writeDocuments(TEST_ORG, id, {
      documents: [
        {
          docId: 'https://docs.acme.com/a',
          docPath: 'a.md',
          title: 'A',
          url: 'https://docs.acme.com/a',
          contentHash: 'h1',
          updatedAt: 'x',
          body: '# A\n\nBody.\n',
        },
      ],
      removed: [],
    });
    const ref = contextDocRef(id, 'a.md');
    const res = await request(app).get(`/api/context/doc?ref=${encodeURIComponent(ref)}`).expect(200);
    expect(res.body).toEqual({ ref, content: '# A\n\nBody.\n' });
  });

  it('needs a ref, and 404s one that names nothing', async () => {
    await request(app).get('/api/context/doc').expect(400);
    await request(app).get('/api/context/doc?ref=context/ghost/a.md').expect(404);
  });

  it('refuses a ref that escapes its source', async () => {
    await request(app)
      .get(`/api/context/doc?ref=${encodeURIComponent('context/site/../../etc/passwd')}`)
      .expect(404);
  });
});

describe('the repository’s links', () => {
  it('starts empty and is replaced whole by a PUT', async () => {
    const first = await addSite('https://a.example/llms.txt').expect(202);
    const second = await addSite('https://b.example/llms.txt').expect(202);
    const slug = fixture.project.slug;

    const before = await request(app).get(`/api/repos/${slug}/context/bindings`).expect(200);
    expect(before.body).toEqual({ repoFullName: fixture.project.name, sourceIds: [] });

    const put = await request(app)
      .put(`/api/repos/${slug}/context/bindings`)
      .send({ sourceIds: [first.body.source.id, second.body.source.id] })
      .expect(200);
    expect(put.body.sourceIds.sort()).toEqual([first.body.source.id, second.body.source.id].sort());

    const narrowed = await request(app)
      .put(`/api/repos/${slug}/context/bindings`)
      .send({ sourceIds: [second.body.source.id] })
      .expect(200);
    expect(narrowed.body.sourceIds).toEqual([second.body.source.id]);
  });

  it('refuses a source the workspace does not have', async () => {
    await request(app)
      .put(`/api/repos/${fixture.project.slug}/context/bindings`)
      .send({ sourceIds: ['ghost'] })
      .expect(404);
  });

  it('needs a list', async () => {
    await request(app)
      .put(`/api/repos/${fixture.project.slug}/context/bindings`)
      .send({})
      .expect(400);
  });

  it('tells the workspace the links changed', async () => {
    const created = await addSite().expect(202);
    published.length = 0;
    await request(app)
      .put(`/api/repos/${fixture.project.slug}/context/bindings`)
      .send({ sourceIds: [created.body.source.id] })
      .expect(200);
    expect(changes()).toEqual([
      { change: 'bindings', sourceId: undefined, repoFullName: fixture.project.name },
    ]);
  });

  it('is a 404 for a repository this workspace cannot see', async () => {
    await request(app).get('/api/repos/not-a-slug/context/bindings').expect(404);
  });
});
