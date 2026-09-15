/**
 * `GET /api/context/documents` — the rows of the Documents view.
 *
 * The row itself is a join of stored things (the corpus, the ledger, the
 * sources, the links) and is unit-tested pure in `tests/core`. What is pinned
 * HERE is the half only the route can do: reading each repository's guard state
 * and folding what every repository that reads a document says about it into
 * the one word the row wears — worst first, and Not linked when nobody reads it.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

vi.mock('../../apps/dashboard/server/src/socket/handlers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../apps/dashboard/server/src/socket/handlers')>();
  return {
    ...actual,
    emitSpecProgress: vi.fn(),
    emitSpecComplete: vi.fn(),
    createSocketSpecTracker: () => ({ start() {}, done() {}, error() {}, detail() {} }),
  };
});

import { createTestApp, stubJobs, TEST_ORG } from '../helpers/test-app';
import { setupTestFixture, teardownTestFixture, type TestFixture } from '../helpers/test-fixture';
import { memoryContextStore } from '../helpers/memory-context-store';
import { memorySpecStore } from '../helpers/memory-spec-store';
import {
  resetContextStore,
  setContextBindings,
  setContextStore,
  type ContextStore,
} from '@truecourse/core/lib/context-store';
import { resetSpecStore, saveWorkspaceSpec, setSpecStore } from '@truecourse/core/lib/spec-store';
import { clearTestRegistry } from '../helpers/test-fixture';
import { installWorkTreeGuardStore, resetGuardStore } from '../helpers/work-tree-guard-store';
import { installMemoryGuardOverlays, resetGuardOverlayStore } from '../helpers/memory-guard-overlays';
import { manifestPath, writeGuardLatest } from '@truecourse/guard-runner';
import fs from 'node:fs';
import path from 'node:path';
import type { ContextDocumentRow } from '@truecourse/shared';
import type { CuratedCorpus } from '@truecourse/spec-consolidator';

const SITE = 'site-docs-acme';
const ONLY = 'site-docs-only';
const ref = (sourceId: string, name: string): string => `context/${sourceId}/${name}`;

const REFUNDS = ref(SITE, 'refunds.md');
const ORPHAN = ref(ONLY, 'nobody.md');

/** A document with one heading: a section the coverage join has something to say about. */
const BODY = '# Refunds\n\nA refund settles within two business days.\n';

let app: Express;
let repoA: TestFixture;
let repoB: TestFixture;
let context: ContextStore;

const corpus = (): CuratedCorpus =>
  ({
    version: 3,
    generatedAt: '2026-01-01T00:00:00Z',
    docs: [
      {
        ref: REFUNDS,
        kind: 'prd',
        lastTouched: '',
        areaTags: ['acme/payments'],
        sourceId: SITE,
        sourceKind: 'site',
      },
      {
        ref: ORPHAN,
        kind: 'prd',
        lastTouched: '',
        areaTags: ['acme/platform'],
        sourceId: ONLY,
        sourceKind: 'site',
      },
    ],
    areas: [],
    relations: [],
    skippedDocs: [],
  }) as unknown as CuratedCorpus;

/**
 * A stored run in which the document's one section FAILED: the manifest binds
 * the flow to the section, and the run says the flow's scenario failed there.
 */
function failingRun(repoPath: string): void {
  const binding = { doc: REFUNDS, anchor: 'refunds', fingerprint: 'sha256:x' };
  fs.mkdirSync(path.dirname(manifestPath(repoPath)), { recursive: true });
  fs.writeFileSync(
    manifestPath(repoPath),
    JSON.stringify({
      flows: [
        {
          flowId: 'f1',
          flowFingerprint: 'sha256:f',
          bindings: [binding],
          scenarios: [{ id: 's1', drivers: ['cli'] }],
          interfaces: [],
          generationInputsHash: null,
          gaps: [],
          retiredScenarios: [],
        },
      ],
    }),
  );
  writeGuardLatest(repoPath, {
    run: {
      runId: 'run-1',
      ranAt: '2026-01-02T00:00:00.000Z',
      branch: 'main',
      commit: 'abcdef1234567890',
      recipeFingerprint: 'sha256:r',
    },
    summary: { total: 1, pass: 0, fail: 1, stale: 0, orphaned: 0, error: 0 },
    scenarios: [
      {
        id: 's1',
        title: 'a refund settles',
        binds: { doc: REFUNDS, section: 'refunds', fingerprint: 'sha256:x' },
        outcome: 'fail',
        durationMs: 1,
      },
    ],
    sections: [],
  });
}

async function seedWorkspace(): Promise<void> {
  await saveWorkspaceSpec({ workspaceOrgId: TEST_ORG }, 'corpus', corpus());
  for (const [id, title] of [
    [SITE, 'docs.acme.com'],
    [ONLY, 'docs.nobody.com'],
  ] as const) {
    await context.createSource(TEST_ORG, { id, kind: 'site', title, config: { llmsTxtUrl: `https://${title}/llms.txt` } });
  }
  await context.writeDocuments(TEST_ORG, SITE, {
    documents: [
      {
        docId: 'https://docs.acme.com/refunds',
        docPath: 'refunds.md',
        title: 'Refunds',
        url: 'https://docs.acme.com/refunds',
        contentHash: 'hash-refunds',
        updatedAt: '2026-01-03T00:00:00.000Z',
        body: BODY,
      },
    ],
    removed: [],
  });
  await context.writeDocuments(TEST_ORG, ONLY, {
    documents: [
      {
        docId: 'https://docs.nobody.com/x',
        docPath: 'nobody.md',
        title: 'Nobody reads this',
        url: null,
        contentHash: 'hash-nobody',
        updatedAt: '2026-01-04T00:00:00.000Z',
        body: BODY,
      },
    ],
    removed: [],
  });
}

const rows = async (query = ''): Promise<ContextDocumentRow[]> => {
  const res = await request(app).get(`/api/context/documents${query}`).expect(200);
  return res.body.documents as ContextDocumentRow[];
};

beforeEach(async () => {
  // Earlier suites leave registrations behind; the workspace is exactly what
  // this test registers, because every one of them is a reader of a source.
  installWorkTreeGuardStore();
  installMemoryGuardOverlays();
  clearTestRegistry();
  repoA = await setupTestFixture();
  repoB = await setupTestFixture();
  context = memoryContextStore();
  setContextStore(context);
  setSpecStore(memorySpecStore());
  app = createTestApp({ jobs: stubJobs().mount });
  await seedWorkspace();
});

afterEach(async () => {
  resetContextStore();
  resetSpecStore();
  clearTestRegistry();
  resetGuardStore();
  resetGuardOverlayStore();
  await teardownTestFixture();
});

describe('GET /api/context/documents', () => {
  it('answers an empty view before the first scan', async () => {
    resetSpecStore();
    setSpecStore(memorySpecStore());
    const res = await request(app).get('/api/context/documents').expect(200);
    expect(res.body).toEqual({ documents: [], corpusAt: null });
  });

  it('composes one row per document, with the source and the corpus it came from', async () => {
    await setContextBindings(TEST_ORG, repoA.project.name, [SITE]);

    const [refunds, nobody] = await rows();
    expect(refunds).toMatchObject({
      ref: REFUNDS,
      title: 'Refunds',
      area: 'acme/payments',
      sourceId: SITE,
      sourceTitle: 'docs.acme.com',
      sourceKind: 'site',
      repositories: [repoA.project.name],
      updatedAt: '2026-01-03T00:00:00.000Z',
    });
    // Nothing reads the other source, and that is a status of its own.
    expect(nobody).toMatchObject({ ref: ORPHAN, repositories: [], status: 'not-linked' });
  });

  it('folds the status WORST FIRST across every repository that reads it', async () => {
    await setContextBindings(TEST_ORG, repoA.project.name, [SITE]);
    await setContextBindings(TEST_ORG, repoB.project.name, [SITE]);
    // One repository ran the document's section and it failed; the other has
    // run nothing, so its sections are unguarded — which the engine calls
    // blocked. Failed outranks blocked, and the row says so.
    failingRun(repoA.repoPath);

    const [refunds] = await rows();
    expect(refunds!.repositories).toHaveLength(2);
    expect(refunds!.status).toBe('failed');
    expect(refunds!.readings.map((r) => r.status)).toEqual(['failed', 'blocked']);
  });

  it('says what the one repository that reads it says, when only one does', async () => {
    await setContextBindings(TEST_ORG, repoB.project.name, [SITE]);
    failingRun(repoA.repoPath); // not a reader: its verdict is not this row's

    const [refunds] = await rows();
    expect(refunds!.repositories).toEqual([repoB.project.name]);
    expect(refunds!.status).toBe('blocked');
  });

  it('narrows by source, repository, area and status, AND across dimensions', async () => {
    await setContextBindings(TEST_ORG, repoA.project.name, [SITE]);

    expect((await rows(`?source=${SITE}`)).map((r) => r.ref)).toEqual([REFUNDS]);
    expect((await rows(`?repo=${encodeURIComponent(repoA.project.name)}`)).map((r) => r.ref)).toEqual([
      REFUNDS,
    ]);
    expect((await rows('?area=acme/platform')).map((r) => r.ref)).toEqual([ORPHAN]);
    expect((await rows('?status=not-linked')).map((r) => r.ref)).toEqual([ORPHAN]);
    // AND across dimensions: the orphan is not in the linked source.
    expect(await rows(`?status=not-linked&source=${SITE}`)).toEqual([]);
    // OR within one.
    expect((await rows(`?source=${SITE}&source=${ONLY}`)).map((r) => r.ref).sort()).toEqual(
      [ORPHAN, REFUNDS].sort(),
    );
  });

  it('carries the corpus stamp the rows were composed from', async () => {
    const res = await request(app).get('/api/context/documents').expect(200);
    expect(res.body.corpusAt).toBe('2026-01-01T00:00:00Z');
  });
});

/**
 * The documents the corpus does NOT hold have rows here too, because a document
 * with no row anywhere cannot be decided about. Three states, and the route
 * says which each document is in and why: the scan's own words for skipping
 * one, and nothing invented for one a reader dropped.
 */
describe('GET /api/context/documents, the documents outside the corpus', () => {
  const EXTRA = 'site-docs-extra';
  const CHANGELOG = ref(EXTRA, 'changelog.md');
  const LEGACY = ref(EXTRA, 'legacy.md');

  /** A second site whose two documents the corpus does not hold. */
  async function seedOutside(): Promise<void> {
    await context.createSource(TEST_ORG, {
      id: EXTRA,
      kind: 'site',
      title: 'docs.extra.com',
      config: { llmsTxtUrl: 'https://docs.extra.com/llms.txt' },
    });
    await context.writeDocuments(TEST_ORG, EXTRA, {
      documents: [
        {
          docId: 'https://docs.extra.com/changelog',
          docPath: 'changelog.md',
          title: 'Changelog',
          url: null,
          contentHash: 'hash-changelog',
          updatedAt: '2026-01-05T00:00:00.000Z',
          body: BODY,
        },
        {
          docId: 'https://docs.extra.com/legacy',
          docPath: 'legacy.md',
          title: 'Legacy',
          url: null,
          contentHash: 'hash-legacy',
          updatedAt: '2026-01-06T00:00:00.000Z',
          body: BODY,
        },
      ],
      removed: [],
    });
    await saveWorkspaceSpec({ workspaceOrgId: TEST_ORG }, 'corpus', {
      ...corpus(),
      skippedDocs: [
        { ref: CHANGELOG, reason: 'a changelog, not a specification', category: 'changelog' },
      ],
    } as CuratedCorpus);
  }

  const rowFor = async (ref: string): Promise<ContextDocumentRow> =>
    (await rows()).find((row) => row.ref === ref)!;

  beforeEach(seedOutside);

  it('answers the document the scan skipped, with the reason it gave', async () => {
    const row = await rowFor(CHANGELOG);
    expect(row).toMatchObject({
      title: 'Changelog',
      sourceTitle: 'docs.extra.com',
      inCorpus: false,
      inclusion: 'not-included',
      decision: null,
      skipReason: 'a changelog, not a specification',
      status: null,
      repositories: [],
      readings: [],
    });
  });

  it('answers a document the corpus holds as in the corpus, with its coverage word', async () => {
    await setContextBindings(TEST_ORG, repoA.project.name, [SITE]);
    expect(await rowFor(REFUNDS)).toMatchObject({
      inCorpus: true,
      inclusion: 'in-corpus',
      decision: null,
      skipReason: null,
      status: 'blocked',
    });
  });

  it('carries the decision a reader just made, which no scan has applied', async () => {
    await request(app).post('/api/context/includes').send({ ref: CHANGELOG }).expect(200);
    expect(await rowFor(CHANGELOG)).toMatchObject({
      inCorpus: false,
      decision: 'include',
      inclusion: 'not-included',
    });

    await request(app).post('/api/context/excludes').send({ ref: REFUNDS }).expect(200);
    // Still in the corpus until a scan runs, so it keeps its coverage word.
    expect(await rowFor(REFUNDS)).toMatchObject({
      inCorpus: true,
      decision: 'exclude',
      inclusion: 'excluded',
      status: 'not-linked',
    });
  });

  it('answers a document the scan dropped whole off the decision alone', async () => {
    await request(app).post('/api/context/excludes').send({ ref: LEGACY }).expect(200);
    expect(await rowFor(LEGACY)).toMatchObject({
      title: 'Legacy',
      inCorpus: false,
      decision: 'exclude',
      inclusion: 'excluded',
      skipReason: null,
      status: null,
    });
  });

  it('narrows by inclusion, and answers no status with a document that has none', async () => {
    await request(app).post('/api/context/excludes').send({ ref: LEGACY }).expect(200);

    expect((await rows('?inclusion=not-included')).map((r) => r.ref)).toEqual([CHANGELOG]);
    expect((await rows('?inclusion=excluded')).map((r) => r.ref)).toEqual([LEGACY]);
    expect((await rows('?inclusion=in-corpus')).map((r) => r.ref).sort()).toEqual(
      [ORPHAN, REFUNDS].sort(),
    );
    // AND across dimensions, as every other pair of them reads.
    expect(await rows(`?inclusion=not-included&source=${SITE}`)).toEqual([]);
    expect((await rows('?status=not-linked')).map((r) => r.ref).sort()).toEqual(
      [ORPHAN, REFUNDS].sort(),
    );
  });
});
