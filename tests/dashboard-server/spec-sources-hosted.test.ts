/**
 * Web spec sources on a HOSTED repository — one with no working tree. The
 * routes run the file engine over a scratch tree of the stored sources and
 * keep what it left: an add lands in the store and never in the repo's own
 * path, the list and the detail read the store, a page can be opened before
 * any scan snapshotted it, the corpus labels a stored source's pages, a
 * refresh reconciles against the site, and a remove clears the store. The
 * network never leaves the machine — every fetch goes to the local llms.txt
 * fixture site.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import request from 'supertest';
import { type Express } from 'express';

// Only this fixture suite replaces the public transport with loopback HTTP.
// The network-policy suite exercises the real transport and pinned DNS lookup.
vi.mock('../../packages/spec-consolidator/dist/sources/public-fetch.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../packages/spec-consolidator/dist/sources/public-fetch.js')>(),
  fetchPublicSource: vi.fn((url: string, headers: Record<string, string>, signal: AbortSignal) =>
    fetch(url, { headers, signal })),
}));
import { fetchPublicSource } from '../../packages/spec-consolidator/dist/sources/public-fetch.js';

vi.mock('../../apps/dashboard/server/src/socket/handlers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../apps/dashboard/server/src/socket/handlers')>();
  return {
    ...actual,
    emitSpecProgress: vi.fn(),
    emitSpecComplete: vi.fn(),
    createSocketSpecTracker: () => ({ start() {}, done() {}, error() {}, detail() {} }),
  };
});

import { createTestApp, TEST_ORG } from '../helpers/test-app';
import { memoryContextStore } from '../helpers/memory-context-store';
import { resetContextStore, setContextStore } from '@truecourse/core/lib/context-store';
import { enrichWebSources } from '../../apps/dashboard/server/src/routes/spec';
import { setupTestFixture, teardownTestFixture, type TestFixture } from '../helpers/test-db';
import {
  setSpecStore,
  resetSpecStore,
  saveSpec,
  saveSpecDocs,
  saveWorkspaceSpec,
  type SpecStore,
  type RepoRef,
  type SpecArtifact,
} from '@truecourse/core/lib/spec-store';
import {
  resetSpecSourcesStore,
  setSpecSourcesStore,
  SpecSourcesConflictError,
  type SpecSourcesSnapshot,
  type SpecSourcesStore,
} from '@truecourse/core/lib/spec-sources';
import { resetRepoDocReader, setRepoDocReader } from '@truecourse/core/lib/repo-doc-reader';
import { readStoredRepoDoc } from '../../apps/dashboard/server/src/stores';
import { sourcesFilePath } from '../../packages/spec-consolidator/src/index.js';
import {
  INSTALLATION_MD,
  llmsTxtUrl,
  startDocsSite,
  type FixtureSite,
} from '../spec-consolidator/sources-fixture.js';
import { emitSpecComplete } from '../../apps/dashboard/server/src/socket/handlers';

/** The hosted spec store, in memory: enough for the corpus read the enrichment rides. */
function memSpecStore(): SpecStore {
  const rows = new Map<string, unknown>();
  const snapshots = new Map<string, Record<string, string>>();
  const key = (repoKey: string, artifact: SpecArtifact) => `${repoKey}\x00${artifact}`;
  return {
    materializesInPlace: false,
    async saveSpec(ref, artifact, json) {
      rows.set(key(ref.repoKey, artifact), json);
    },
    async loadSpec<T = unknown>(ref: RepoRef, artifact: SpecArtifact) {
      return (rows.get(key(ref.repoKey, artifact)) as T) ?? null;
    },
    async deleteSpec() {},
    async loadLatest<T = unknown>(repoKey: string, artifact: SpecArtifact) {
      return (rows.get(key(repoKey, artifact)) as T) ?? null;
    },
    async latestCommit() {
      return null;
    },
    async saveWorkspaceSpec(ref, artifact, json) {
      rows.set(key(`ws:${ref.workspaceOrgId}`, artifact), json);
    },
    async loadWorkspaceSpec<T = unknown>(ref, artifact: SpecArtifact) {
      return (rows.get(key(`ws:${ref.workspaceOrgId}`, artifact)) as T) ?? null;
    },
    async saveWorkspaceSpecDocs(ref, files) {
      snapshots.set(`ws:${ref.workspaceOrgId}`, files);
    },
    async loadWorkspaceSpecDoc(org, ref) {
      return snapshots.get(`ws:${org}`)?.[ref] ?? null;
    },
    async saveSpecDocs(ref, files) {
      snapshots.set(`${ref.repoKey}:${ref.commitSha}`, files);
      snapshots.set(ref.repoKey, files);
    },
    async loadSpecDoc(repoKey, ref, commit) {
      return snapshots.get(commit ? `${repoKey}:${commit}` : repoKey)?.[ref] ?? null;
    },
  } satisfies SpecStore;
}

/** The hosted sources store, in memory: one snapshot per repo key. */
function memSourcesStore(): SpecSourcesStore & { rows: Map<string, SpecSourcesSnapshot> } {
  const rows = new Map<string, SpecSourcesSnapshot>();
  const changed = new Map<string, string>();
  return {
    rows,
    materializesInPlace: false,
    async readRegistry(repoKey) {
      return rows.get(repoKey)?.registry ?? { version: 1, sources: [] };
    },
    async readBody(repoKey, sha) {
      return rows.get(repoKey)?.bodies[sha] ?? null;
    },
    async write(repoKey, next, expected) {
      if (expected && JSON.stringify(expected) !== JSON.stringify(rows.get(repoKey)?.registry ?? { version: 1, sources: [] })) {
        throw new SpecSourcesConflictError();
      }
      rows.set(repoKey, next);
      changed.set(repoKey, new Date().toISOString());
    },
    async changedAt(repoKey) {
      return rows.has(repoKey) ? (changed.get(repoKey) ?? null) : null;
    },
  };
}

describe('web source routes — hosted (stored sources, no working tree)', () => {
  let app: Express;
  let fixture: TestFixture;
  let site: FixtureSite;
  let sources: ReturnType<typeof memSourcesStore>;

  const api = (path: string): string => `/api/repos/${fixture.project.slug}${path}`;
  const add = () => request(app).post(api('/spec/sources')).send({ url: llmsTxtUrl(site) }).expect(200);

  beforeEach(async () => {
    fixture = await setupTestFixture();
    site = await startDocsSite();
    setSpecStore(memSpecStore());
    sources = memSourcesStore();
    setSpecSourcesStore(sources);
    // What boot installs: the scan snapshot first, then a source page the
    // sources store holds.
    setRepoDocReader(readStoredRepoDoc);
    vi.mocked(fetchPublicSource).mockClear();
    vi.mocked(emitSpecComplete).mockClear();
    app = createTestApp();
  });
  afterEach(async () => {
    resetRepoDocReader();
    resetSpecSourcesStore();
    resetSpecStore();
    resetContextStore();
    await site.close();
    await teardownTestFixture(fixture.project.slug);
  });

  it('adds a source into the store, never into the repo path, and lists it from there', async () => {
    expect((await request(app).get(api('/spec/sources')).expect(200)).body.sources).toEqual([]);

    const added = await add();
    const id = added.body.source.id as string;
    expect(added.body.written).toBe(6);
    expect(vi.mocked(emitSpecComplete)).toHaveBeenCalledWith(fixture.project.slug, 'sources');

    // Stored: the registry and every page body, keyed by the hash it names.
    const stored = sources.rows.get(fixture.repoPath)!;
    expect(stored.registry.sources.map((s) => s.id)).toEqual([id]);
    const hashes = stored.registry.sources[0]!.docs.map((d) => d.contentHash);
    expect(hashes).toHaveLength(6);
    expect(Object.keys(stored.bodies).sort()).toEqual([...new Set(hashes)].sort());
    // Not in the repo's own tree, and no scratch tree left behind.
    expect(fs.existsSync(sourcesFilePath(fixture.repoPath))).toBe(false);

    const list = await request(app).get(api('/spec/sources')).expect(200);
    expect(list.body.sources).toHaveLength(1);
    expect(list.body.sources[0]).toMatchObject({ id, docCount: 6, title: 'Strapi Docs' });

    const detail = await request(app).get(api(`/spec/sources/${id}`)).expect(200);
    expect(detail.body.source.docs.map((d: { path: string }) => d.path)).toContain('cms/installation.md');
  });

  it('opens a page before any scan snapshotted it', async () => {
    const id = (await add()).body.source.id as string;
    const ref = `.truecourse/specs/sources/${id}/cms/installation.md`;
    const res = await request(app).get(api(`/spec/doc?ref=${encodeURIComponent(ref)}`)).expect(200);
    expect(res.body.content).toBe(INSTALLATION_MD);
  });

  it('reads refreshed pages independently of the scan and never substitutes a pinned miss', async () => {
    const id = (await add()).body.source.id as string;
    const ref = `.truecourse/specs/sources/${id}/cms/installation.md`;
    await saveSpecDocs({ repoKey: fixture.repoPath, commitSha: 'scan' }, { [ref]: INSTALLATION_MD });
    site.routes['/cms/installation.md'] = { body: '# New installation instructions' };
    await request(app).post(api(`/spec/sources/${id}/refresh`)).expect(200);
    const current = await request(app).get(api(`/spec/source-doc?ref=${encodeURIComponent(ref)}`)).expect(200);
    expect(current.body.content).toBe('# New installation instructions');
    const scanned = await request(app).get(api(`/spec/doc?ref=${encodeURIComponent(ref)}&commit=scan`)).expect(200);
    expect(scanned.body.content).toBe(INSTALLATION_MD);
    await request(app).get(api(`/spec/doc?ref=${encodeURIComponent(ref)}&commit=before-add`)).expect(404);
    await request(app).delete(api(`/spec/sources/${id}`)).expect(200);
    await request(app).get(api(`/spec/source-doc?ref=${encodeURIComponent(ref)}`)).expect(404);
    await request(app).get(api(`/spec/doc?ref=${encodeURIComponent(ref)}&commit=scan`)).expect(200);
  });

  it('uses public-only transport for hosted preview, add and refresh', async () => {
    await request(app).post(api('/spec/sources/preview')).send({ url: llmsTxtUrl(site) }).expect(200);
    expect(fetchPublicSource).toHaveBeenCalled();
    vi.mocked(fetchPublicSource).mockClear();
    const id = (await add()).body.source.id as string;
    expect(fetchPublicSource).toHaveBeenCalled();
    vi.mocked(fetchPublicSource).mockClear();
    await request(app).post(api(`/spec/sources/${id}/refresh`)).expect(200);
    expect(fetchPublicSource).toHaveBeenCalled();
  });

  it('rejects a hosted preview of a private address through the real transport', async () => {
    const actual = await vi.importActual<typeof import('../../packages/spec-consolidator/dist/sources/public-fetch.js')>(
      '../../packages/spec-consolidator/dist/sources/public-fetch.js',
    );
    vi.mocked(fetchPublicSource).mockImplementationOnce(actual.fetchPublicSource);
    const result = await request(app).post(api('/spec/sources/preview')).send({ url: llmsTxtUrl(site) }).expect(400);
    expect(result.body.error).toContain('public network');
    expect(site.hits).toHaveLength(0);
  });

  it('returns 409 when the store rejects a stale mutation', async () => {
    vi.spyOn(sources, 'write').mockRejectedValueOnce(new SpecSourcesConflictError());
    const result = await request(app).post(api('/spec/sources')).send({ url: llmsTxtUrl(site) }).expect(409);
    expect(result.body.error).toContain('Reload');
  });

  // The corpus the registry's pages are labelled in is no longer a
  // per-repository one (the workspace's corpus stamps each document's source
  // into the artifact), so the labelling is pinned on the enricher itself,
  // which still serves the file-mode corpus until slice 4 retires it.
  it('labels a stored source\'s pages for display', async () => {
    const id = (await add()).body.source.id as string;
    const ref = `.truecourse/specs/sources/${id}/cms/installation.md`;
    const enriched = await enrichWebSources(fixture.repoPath, {
      version: 3,
      generatedAt: '2026-01-01T00:00:00Z',
      docs: [{ ref, kind: 'reference', lastTouched: '2026-01-01T00:00:00Z', areaTags: [] }],
      areas: [],
      skippedDocs: [],
    });
    expect(enriched!.docs[0]).toMatchObject({
      ref,
      origin: 'web',
      sourceId: id,
      sourceTitle: 'Strapi Docs',
      url: `${site.origin}/cms/installation.md`,
    });
  });

  // The docs half of a hosted repository's staleness is the WORKSPACE's context
  // stamp against the workspace corpus — a repository's own registry no longer
  // decides whether its spec is behind.
  it('lights docsChanged from the workspace context stamp, until a scan catches up', async () => {
    const context = memoryContextStore();
    setContextStore(context);
    const seedCorpus = (generatedAt: string) =>
      saveWorkspaceSpec({ workspaceOrgId: TEST_ORG }, 'corpus', {
        version: 3,
        generatedAt,
        docs: [],
        areas: [],
        skippedDocs: [],
      });
    const staleness = async () =>
      (await request(app).get(api('/spec/staleness')).expect(200)).body as { docsChanged: boolean; hasCorpus: boolean };

    // No corpus, no context: nothing to be behind on.
    expect(await staleness()).toMatchObject({ docsChanged: false, hasCorpus: false });
    await seedCorpus('2026-01-01T00:00:00Z');
    expect((await staleness()).docsChanged).toBe(false);

    // A sync that reconciled something moves the workspace's stamp.
    await context.recordSync(TEST_ORG, {
      sourceId: 'site-1',
      at: new Date().toISOString(),
      parentAt: null,
      added: 3,
      changed: 0,
      removed: 0,
      unchanged: 0,
    });
    expect((await staleness()).docsChanged).toBe(true);

    // The scan that follows stamps the corpus after reading the context.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await seedCorpus(new Date().toISOString());
    expect((await staleness()).docsChanged).toBe(false);
  });

  it('refuses a second add of the same site, and refreshes the stored one against it', async () => {
    const id = (await add()).body.source.id as string;
    await request(app).post(api('/spec/sources')).send({ url: llmsTxtUrl(site) }).expect(409);

    const res = await request(app).post(api(`/spec/sources/${id}/refresh`)).expect(200);
    expect(res.body.results[0]).toMatchObject({ added: [], changed: [], removed: [], unchanged: 6 });
    expect(sources.rows.get(fixture.repoPath)!.registry.sources[0]!.docs).toHaveLength(6);

    const missing = await request(app).post(api('/spec/sources/nope/refresh')).expect(404);
    expect(missing.body.error).toContain(id);
  });

  it('removes the last source from the registry', async () => {
    const id = (await add()).body.source.id as string;
    await request(app).delete(api(`/spec/sources/${id}`)).expect(200);
    expect((await request(app).get(api('/spec/sources')).expect(200)).body.sources).toEqual([]);
    const missing = await request(app).delete(api(`/spec/sources/${id}`)).expect(404);
    expect(missing.body.error).toContain('nothing is registered yet');
  });
});
