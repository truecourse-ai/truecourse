import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { type Express } from 'express';

vi.mock('../../apps/dashboard/server/src/socket/handlers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../apps/dashboard/server/src/socket/handlers')>();
  return {
    ...actual,
    emitSpecProgress: vi.fn(),
    emitSpecComplete: vi.fn(),
    createSocketSpecTracker: () => ({ start() {}, done() {}, error() {}, detail() {} }),
    createSocketSpecEstimateHandler: () => () => Promise.resolve(true),
  };
});

// The curate engine has its own suite (tests/spec-consolidator), so stub it to a
// no-op here — leaving the seeded corpus.json intact. A decision route must NEVER
// invoke it: a decision is not a corpus change.
vi.mock('@truecourse/core/commands/spec-in-process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@truecourse/core/commands/spec-in-process')>();
  return {
    ...actual,
    curateInProcess: vi.fn(async () => ({ noChanges: false })),
  };
});

import { createTestApp, TEST_ORG } from '../helpers/test-app';
import { memoryContextStore } from '../helpers/memory-context-store';
import { resetContextStore, setContextStore } from '@truecourse/core/lib/context-store';
import { curateInProcess } from '@truecourse/core/commands/spec-in-process';
import {
  setSpecStore,
  resetSpecStore,
  saveWorkspaceSpec,
  type SpecStore,
  type SpecArtifact,
  type WorkspaceRef,
} from '@truecourse/core/lib/spec-store';
import { setContextBindings } from '@truecourse/core/lib/context-store';
import {
  addWorkspaceManualExclude,
  addWorkspaceManualInclude,
} from '@truecourse/core/commands/spec-in-process';
import { installMemorySpecStore } from '../helpers/memory-spec-store';
import { installWorkTreeDocReader, resetRepoDocReader } from '../helpers/work-tree-doc-reader';
import {
  setupTestFixture,
  teardownTestFixture,
  type TestFixture,
} from '../helpers/test-fixture';





/**
 * Spec route tests assert the HTTP shape of the corpus routes. The
 * curate/generate engine has its own suite under tests/spec-consolidator/.
 */

/**
 * A minimal in-memory `SpecStore` — the shape boot actually installs, Map-backed
 * so the route paths (which read through the ACTIVE spec store) work without a
 * real database. Everything in it is the WORKSPACE's: the corpus, the decisions
 * and the documents a scan kept.
 */
function makeMemSpecStore(): SpecStore {
  const workspace = new Map<string, unknown>(); // (org, artifact) → json
  const workspaceDocs = new Map<string, string>(); // (org, ref) → body
  return {
    async saveWorkspaceSpec(ref, artifact, json) {
      workspace.set(`${ref.workspaceOrgId}\x00${artifact}`, json);
    },
    async loadWorkspaceSpec<T = unknown>(ref: WorkspaceRef, artifact: SpecArtifact) {
      return (workspace.get(`${ref.workspaceOrgId}\x00${artifact}`) as T) ?? null;
    },
    async saveWorkspaceSpecDocs(ref, files) {
      for (const [docRef, body] of Object.entries(files)) {
        workspaceDocs.set(`${ref.workspaceOrgId}\x00${docRef}`, body);
      }
    },
    async loadWorkspaceSpecDoc(org: string, docRef: string) {
      return workspaceDocs.get(`${org}\x00${docRef}`) ?? null;
    },
  } satisfies SpecStore;
}

/**
 * The hosted corpus as the store holds it now: ONE workspace corpus over
 * `context/<sourceId>/…` documents. `conflict` flags a v1/v2 disagreement so the
 * workspace has exactly one open conflict.
 */
async function seedWorkspaceCorpus(
  store: SpecStore,
  opts: { conflict?: boolean } = {},
): Promise<void> {
  const ref = (name: string) => `context/repo-src/docs/${name}`;
  await store.saveWorkspaceSpec({ workspaceOrgId: TEST_ORG }, 'corpus', {
    version: 3,
    generatedAt: '2026-01-01T00:00:00Z',
    docs: [
      { ref: ref('v1.md'), kind: 'prd', lastTouched: '2026-01-01T00:00:00Z', areaTags: ['booking/appointments'], sourceId: 'repo-src', sourceKind: 'repository' },
      { ref: ref('v2.md'), kind: 'prd', lastTouched: '2026-02-01T00:00:00Z', areaTags: ['booking/appointments'], sourceId: 'repo-src', sourceKind: 'repository' },
    ],
    areas: [
      {
        id: 'booking/appointments',
        product: 'booking',
        concern: 'appointments',
        docRefs: [ref('v1.md'), ref('v2.md')],
        overlaps: opts.conflict
          ? [
              {
                docs: [ref('v1.md'), ref('v2.md')],
                note: '24h vs 48h',
                sections: [
                  { doc: ref('v1.md'), heading: 'Cancellation' },
                  { doc: ref('v2.md'), heading: 'Cancellation policy' },
                ],
              },
            ]
          : [],
      },
    ],
    skippedDocs: [{ ref: ref('dropped.md'), reason: 'changelog' }],
  });
}

/** The verdict that resolves the seeded workspace v1/v2 dispute. */
const WS_VERDICT = {
  docA: 'context/repo-src/docs/v1.md',
  anchorA: 'Cancellation',
  docB: 'context/repo-src/docs/v2.md',
  anchorB: 'Cancellation policy',
  verdict: 'b',
};

describe('GET /api/repos/:id/spec/decisions', () => {
  let app: Express;
  let fixture: TestFixture;

  beforeEach(async () => {
    installMemorySpecStore();
    setContextStore(memoryContextStore());
    fixture = await setupTestFixture();
    app = createTestApp();
  });

  afterEach(async () => {
    resetSpecStore();
    resetContextStore();
    await teardownTestFixture(fixture.project.slug);
  });

  it('returns the empty default when decisions.json is absent', async () => {
    const res = await request(app)
      .get(`/api/repos/${fixture.project.slug}/spec/corpus`)
      .expect(404);
    expect(res.body.error).toMatch(/no corpus/i);
  });
});

/** The one Context source the workspace holds, and the repository reads. */
const SOURCE = 'repo-fixture';

describe('corpus routes (spec-scan redesign)', () => {
  let app: Express;
  let fixture: TestFixture;

  /**
   * The WORKSPACE corpus, and the repository's link to the source it came from.
   * A repository's corpus is that slice, so there is nothing repo-scoped to seed;
   * the document bodies are files because the doc route reads them as such.
   */
  const seedCorpus = async (
    overlaps: Array<{ docs: [string, string]; note: string }>,
    generatedAt = '2026-01-01T00:00:00Z',
  ): Promise<void> => {
    await saveWorkspaceSpec({ workspaceOrgId: TEST_ORG }, 'corpus', {
      version: 3,
      generatedAt,
      docs: [
        { ref: 'docs/v1.md', kind: 'prd', lastTouched: '2026-01-01T00:00:00Z', areaTags: ['booking/appointments'], sourceId: SOURCE },
        { ref: 'docs/v2.md', kind: 'prd', lastTouched: '2026-02-01T00:00:00Z', areaTags: ['booking/appointments'], sourceId: SOURCE },
      ],
      areas: [
        { id: 'booking/appointments', product: 'booking', concern: 'appointments', docRefs: ['docs/v1.md', 'docs/v2.md'], overlaps },
      ],
      relations: [],
      skippedDocs: [{ ref: `context/${SOURCE}/archived.md`, reason: 'archived directory' }],
    });
    const docs = path.join(fixture.repoPath, 'docs');
    fs.mkdirSync(docs, { recursive: true });
    fs.writeFileSync(path.join(docs, 'v1.md'), '# Booking v1\nCancel up to 24h before.');
    fs.writeFileSync(path.join(docs, 'v2.md'), '# Booking v2\nCancel up to 48h before.');
  };

  beforeEach(async () => {
    installMemorySpecStore();
    installWorkTreeDocReader();
    fixture = await setupTestFixture();
    setContextStore(memoryContextStore());
    await setContextBindings(TEST_ORG, fixture.repoPath, [SOURCE]);
    vi.mocked(curateInProcess).mockClear();
    app = createTestApp();
  });
  afterEach(async () => {
    resetSpecStore();
    resetContextStore();
    resetRepoDocReader();
    await teardownTestFixture(fixture.project.slug);
  });

  it('GET /spec/corpus → 404 before any scan', async () => {
    await request(app).get(`/api/repos/${fixture.project.slug}/spec/corpus`).expect(404);
  });

  it('GET /spec/corpus → the corpus', async () => {
    await seedCorpus([{ docs: ['docs/v1.md', 'docs/v2.md'], note: '24h vs 48h' }]);
    const res = await request(app).get(`/api/repos/${fixture.project.slug}/spec/corpus`).expect(200);
    expect(res.body.corpus.areas).toHaveLength(1);
    expect(res.body.corpus.areas[0].overlaps).toHaveLength(1);
  });

  it('GET /spec/doc → the markdown content; rejects traversal', async () => {
    await seedCorpus([]);
    const ok = await request(app).get(`/api/repos/${fixture.project.slug}/spec/doc`).query({ ref: 'docs/v2.md' }).expect(200);
    expect(ok.body.content).toContain('48h');
    await request(app).get(`/api/repos/${fixture.project.slug}/spec/doc`).query({ ref: '../../etc/passwd' }).expect(400);
  });

  it('has no /spec/relations routes — unknown spec mutations 404', async () => {
    await seedCorpus([]);
    await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/relations`)
      .send({ type: 'precedence', older: 'docs/v1.md', newer: 'docs/v2.md' })
      .expect(404);
    await request(app)
      .delete(`/api/repos/${fixture.project.slug}/spec/relations`)
      .send({ older: 'docs/v1.md', newer: 'docs/v2.md' })
      .expect(404);
  });

  // Every decision here is the WORKSPACE's — the repository routes refuse an
  // unscoped one (see "no repository decision routes"),
  // and the reads below fold the workspace ledger they are written to.
  it('GET /spec/staleness pends a WORKSPACE decision the corpus has not absorbed', async () => {
    await seedCorpus([]);
    const staleness = () =>
      request(app).get(`/api/repos/${fixture.project.slug}/spec/staleness`).expect(200);

    // No decisions yet → nothing pending.
    expect((await staleness()).body.decisionsPending).toBe(false);

    // A workspace exclude of a doc the corpus still keeps.
    await addWorkspaceManualExclude(TEST_ORG, 'docs/v2.md');
    expect((await staleness()).body.decisionsPending).toBe(true);

    // A fresh scan drops the excluded doc → the pending signal clears.
    await saveWorkspaceSpec({ workspaceOrgId: TEST_ORG }, 'corpus', {
      version: 3,
      generatedAt: '2099-01-01T00:00:00Z',
      docs: [
        { ref: 'docs/v1.md', kind: 'prd', lastTouched: '2026-01-01T00:00:00Z', areaTags: ['booking/appointments'], sourceId: SOURCE },
      ],
      areas: [
        { id: 'booking/appointments', product: 'booking', concern: 'appointments', docRefs: ['docs/v1.md'], overlaps: [] },
      ],
      relations: [],
      skippedDocs: [{ ref: `context/${SOURCE}/archived.md`, reason: 'archived directory' }],
    });
    expect((await staleness()).body.decisionsPending).toBe(false);
  });

  it('GET /spec/corpus exposes the WORKSPACE manualIncludes + skippedDocs', async () => {
    await seedCorpus([]);
    await addWorkspaceManualInclude(TEST_ORG, 'docs/v1.md');
    const res = await request(app).get(`/api/repos/${fixture.project.slug}/spec/corpus`).expect(200);
    expect(res.body.manualIncludes).toContain('docs/v1.md');
    expect(res.body.corpus.skippedDocs).toContainEqual({ ref: `context/${SOURCE}/archived.md`, reason: 'archived directory' });
  });

});

// Hosted: repo.path is a repoKey and the corpus lives in the store,
// with no local working tree to read. What a repository still answers over that
// stored state is its staleness — the decisions it is read against are the
// WORKSPACE's, written through the workspace routes.
describe('corpus routes — EE (stored corpus, no live tree)', () => {
  let app: Express;
  let fixture: TestFixture;
  let memSpec: SpecStore;

  beforeEach(async () => {
    fixture = await setupTestFixture();
    memSpec = makeMemSpecStore();
    setSpecStore(memSpec);
    app = createTestApp();
  });
  afterEach(async () => {
    resetSpecStore();
    resetContextStore();
    await teardownTestFixture(fixture.project.slug);
  });

  // The Rescan dot: an include/exclude the stored corpus has not absorbed pends
  // (a Scan would materialize it); a verdict derives live and never does. Both
  // the corpus and the decisions it is read against are the WORKSPACE's now, so
  // the decisions are written through the workspace routes.
  it('GET /spec/staleness reports decisionsPending for an unabsorbed exclude, not for a verdict', async () => {
    setContextStore(memoryContextStore());
    await seedWorkspaceCorpus(memSpec, { conflict: true });
    const staleness = () =>
      request(app).get(`/api/repos/${fixture.project.slug}/spec/staleness`).expect(200);

    const before = await staleness();
    expect(before.body.decisionsPending).toBe(false);
    await request(app).post('/api/context/conflict-resolution').send(WS_VERDICT).expect(200);
    const afterVerdict = await staleness();
    expect(afterVerdict.body.decisionsPending).toBe(false);
    await request(app)
      .post('/api/context/excludes')
      .send({ ref: 'context/repo-src/docs/v2.md' })
      .expect(200);
    const afterExclude = await staleness();
    expect(afterExclude.body.decisionsPending).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Doc-content staleness (docsChanged). There is no tree to stat: what can move
// under the stored corpus is the workspace's CONTEXT — a source synced, a link
// made or dropped, a source removed — and the workspace stamps every one of
// those. A stamp later than the corpus lights the Rescan dot.
// ---------------------------------------------------------------------------

describe('spec docs-content staleness', () => {
  let app: Express;
  let fixture: TestFixture;

  const DOC = `context/${SOURCE}/spec.md`;

  /** A one-doc workspace corpus curated at `generatedAt`. */
  const seed = (generatedAt: string): Promise<void> =>
    saveWorkspaceSpec({ workspaceOrgId: TEST_ORG }, 'corpus', {
      version: 3,
      generatedAt,
      docs: [{ ref: DOC, kind: 'spec', lastTouched: '2026-01-01T00:00:00Z', areaTags: ['core/persistence'], sourceId: SOURCE }],
      areas: [{ id: 'core/persistence', product: 'core', concern: 'persistence', docRefs: [DOC], overlaps: [] }],
      relations: [],
      skippedDocs: [],
    });

  const staleness = () =>
    request(app).get(`/api/repos/${fixture.project.slug}/spec/staleness`).expect(200);

  /** The workspace's clock, so "the context moved after the corpus" is exact. */
  let now: string;

  beforeEach(async () => {
    installMemorySpecStore();
    now = '2026-06-01T00:00:00.000Z';
    setContextStore(memoryContextStore(() => now));
    fixture = await setupTestFixture();
    app = createTestApp();
    // The link the repository reads the source through — and the first thing to
    // move the workspace's stamp.
    await setContextBindings(TEST_ORG, fixture.repoPath, [SOURCE]);
  });
  afterEach(async () => {
    resetSpecStore();
    resetContextStore();
    await teardownTestFixture(fixture.project.slug);
  });

  it('docsChanged is false for a corpus curated after the last context change, true after the next one', async () => {
    // Curated AFTER the link that moved the stamp.
    await seed('2026-06-02T00:00:00.000Z');
    const before = await staleness();
    expect(before.body.docsChanged).toBe(false);
    expect(before.body.decisionsPending).toBe(false);

    // The workspace's context moves again — the last scan never saw this.
    now = '2026-06-03T00:00:00.000Z';
    await setContextBindings(TEST_ORG, fixture.repoPath, [SOURCE, 'another-source']);

    const after = await staleness();
    expect(after.body.docsChanged).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The repository decision routes are gone: a repository reads its SLICE of the
// workspace corpus folded with the WORKSPACE decisions, so there is nothing
// repository-scoped to decide, and the writes live at `/api/context/*`.
// ---------------------------------------------------------------------------

describe('no repository decision routes', () => {
  let app: Express;
  let fixture: TestFixture;

  const DECISIONS: Array<{ method: 'post' | 'delete'; path: string }> = [
    { method: 'post', path: 'includes' },
    { method: 'delete', path: 'includes' },
    { method: 'post', path: 'excludes' },
    { method: 'delete', path: 'excludes' },
    { method: 'post', path: 'conflict-resolution' },
    { method: 'delete', path: 'conflict-resolution' },
  ];

  beforeEach(async () => {
    installMemorySpecStore();
    setContextStore(memoryContextStore());
    fixture = await setupTestFixture();
    vi.mocked(curateInProcess).mockClear();
    app = createTestApp();
  });
  afterEach(async () => {
    resetSpecStore();
    resetContextStore();
    await teardownTestFixture(fixture.project.slug);
  });

  it.each(DECISIONS)('$method /spec/$path answers 404', async ({ method, path }) => {
    await request(app)
      [method](`/api/repos/${fixture.project.slug}/spec/${path}`)
      .send({ ref: 'docs/v1.md' })
      .expect(404);
    expect(vi.mocked(curateInProcess)).not.toHaveBeenCalled();
  });
});
