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

vi.mock('../../apps/dashboard/server/src/socket/handlers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../apps/dashboard/server/src/socket/handlers')>();
  return {
    ...actual,
    emitSpecProgress: vi.fn(),
    emitSpecComplete: vi.fn(),
    createSocketSpecTracker: () => ({ start() {}, done() {}, error() {}, detail() {} }),
  };
});

import { createTestApp } from '../helpers/test-app';
import { setupTestFixture, teardownTestFixture, type TestFixture } from '../helpers/test-db';
import {
  setSpecStore,
  resetSpecStore,
  loadSpecDoc,
  saveSpec,
  type SpecStore,
  type RepoRef,
  type SpecArtifact,
} from '@truecourse/core/lib/spec-store';
import {
  readSpecSourceDoc,
  resetSpecSourcesStore,
  setSpecSourcesStore,
  type SpecSourcesSnapshot,
  type SpecSourcesStore,
} from '@truecourse/core/lib/spec-sources';
import { resetRepoDocReader, setRepoDocReader } from '@truecourse/core/lib/repo-doc-reader';
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
    async saveWorkspaceSpec() {
      throw new Error('unused');
    },
    async loadWorkspaceSpec<T = unknown>() {
      return null as T | null;
    },
    async saveSpecDocs() {},
    async loadSpecDoc() {
      return null;
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
    async write(repoKey, next) {
      if (next.registry.sources.length === 0) rows.delete(repoKey);
      else rows.set(repoKey, next);
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
    setRepoDocReader(
      async (repoKey, docPath, opts) =>
        (await loadSpecDoc(repoKey, docPath, opts?.commit)) ?? (await readSpecSourceDoc(repoKey, docPath)),
    );
    vi.mocked(emitSpecComplete).mockClear();
    app = createTestApp();
  });
  afterEach(async () => {
    resetRepoDocReader();
    resetSpecSourcesStore();
    resetSpecStore();
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

  it('labels a stored source\'s pages in the corpus', async () => {
    const id = (await add()).body.source.id as string;
    const ref = `.truecourse/specs/sources/${id}/cms/installation.md`;
    await saveSpec(
      { repoKey: fixture.repoPath, commitSha: 'seed' },
      'corpus',
      {
        version: 3,
        generatedAt: '2026-01-01T00:00:00Z',
        docs: [{ ref, kind: 'reference', lastTouched: '2026-01-01T00:00:00Z', areaTags: [] }],
        areas: [],
        relations: [],
        skippedDocs: [],
      },
    );
    const res = await request(app).get(api('/spec/corpus')).expect(200);
    expect(res.body.corpus.docs[0]).toMatchObject({
      ref,
      origin: 'web',
      sourceId: id,
      sourceTitle: 'Strapi Docs',
      url: `${site.origin}/cms/installation.md`,
    });
  });

  it('lights docsChanged once the sources are newer than the corpus, until a scan is', async () => {
    const seedCorpus = (generatedAt: string) =>
      saveSpec({ repoKey: fixture.repoPath, commitSha: 'seed' }, 'corpus', {
        version: 3,
        generatedAt,
        docs: [],
        areas: [],
        relations: [],
        skippedDocs: [],
      });
    const staleness = async () =>
      (await request(app).get(api('/spec/staleness')).expect(200)).body as { docsChanged: boolean; hasCorpus: boolean };

    // No corpus, no sources: nothing to be behind on.
    expect(await staleness()).toMatchObject({ docsChanged: false, hasCorpus: false });
    await seedCorpus('2026-01-01T00:00:00Z');
    expect((await staleness()).docsChanged).toBe(false);

    await add();
    expect((await staleness()).docsChanged).toBe(true);

    // The scan that follows stamps the corpus after reading the sources.
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

  it('removes a source, clearing the store', async () => {
    const id = (await add()).body.source.id as string;
    await request(app).delete(api(`/spec/sources/${id}`)).expect(200);
    expect(sources.rows.has(fixture.repoPath)).toBe(false);
    expect((await request(app).get(api('/spec/sources')).expect(200)).body.sources).toEqual([]);
    const missing = await request(app).delete(api(`/spec/sources/${id}`)).expect(404);
    expect(missing.body.error).toContain('nothing is registered yet');
  });
});
