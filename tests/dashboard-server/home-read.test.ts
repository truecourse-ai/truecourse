/**
 * `GET /api/home`, the product owner's dashboard in one answer.
 *
 * Everything here is a fold of stored things, so what is pinned is the folding:
 * today's sections across the repositories that read a document, the trend
 * across the baseline runs (and what a repository that had not run yet
 * contributes, which is nothing), the areas' order, the five kinds of attention
 * row, the changes a run made and the period the whole page is read through.
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

import fs from 'node:fs';
import path from 'node:path';
import { manifestPath, writeGuardLatest } from '@truecourse/guard-runner';
import type { HomeResponse } from '@truecourse/shared';
import type { CuratedCorpus } from '@truecourse/spec-consolidator';
import { createTestApp, stubJobs, TEST_ORG } from '../helpers/test-app';
import { setupTestFixture, teardownTestFixture, type TestFixture } from '../helpers/test-db';
import { memoryContextStore } from '../helpers/memory-context-store';
import { memorySpecStore } from '../helpers/memory-spec-store';
import {
  resetContextStore,
  setContextBindings,
  setContextStore,
  type ContextStore,
} from '@truecourse/core/lib/context-store';
import { resetSpecStore, saveWorkspaceSpec, setSpecStore } from '@truecourse/core/lib/spec-store';
import { writeGuardRunSections } from '@truecourse/core/lib/guard-store';
import { createSessionRun } from '@truecourse/core/lib/sessions-store';
import {
  setWorkspaceLlmConfigStore,
  workspaceLlmConfigStore,
} from '../../apps/dashboard/server/src/services/workspace-llm.service';
import { readRegistry, unregisterProject } from '@truecourse/core/config/registry';

const SITE = 'site-docs-acme';
const ref = (name: string): string => `context/${SITE}/${name}`;
const REFUNDS = ref('refunds.md');
const SHIPPING = ref('shipping.md');

const REFUNDS_BODY = '# Refunds\n\nA refund settles within two business days.\n';
const SHIPPING_BODY = '# Shipping\n\nEvery parcel ships within a day.\n';

/** Days back from now, as the store stamps them. */
const daysAgo = (days: number): string =>
  new Date(Date.now() - days * 86_400_000).toISOString();

let app: Express;
let repoA: TestFixture;
let repoB: TestFixture;
let context: ContextStore;

const corpus = (withConflict = false): CuratedCorpus =>
  ({
    version: 3,
    generatedAt: '2026-01-01T00:00:00Z',
    docs: [
      { ref: REFUNDS, kind: 'prd', lastTouched: '', areaTags: ['acme/payments'], sourceId: SITE, sourceKind: 'site' },
      { ref: SHIPPING, kind: 'prd', lastTouched: '', areaTags: ['acme/logistics'], sourceId: SITE, sourceKind: 'site' },
    ],
    areas: withConflict
      ? [
          {
            id: 'acme/payments',
            product: 'acme',
            concern: 'payments',
            docRefs: [REFUNDS, SHIPPING],
            overlaps: [
              { docs: [REFUNDS, SHIPPING], note: 'refund window disagrees', sections: [], areas: [] },
            ],
          },
        ]
      : [],
    relations: [],
    skippedDocs: [],
  }) as unknown as CuratedCorpus;

/**
 * A stored run in one repository: the Refunds section failed, the Shipping
 * section passed. The manifest binds each flow to its section.
 */
function storedRun(repoPath: string): void {
  fs.mkdirSync(path.dirname(manifestPath(repoPath)), { recursive: true });
  fs.writeFileSync(
    manifestPath(repoPath),
    JSON.stringify({
      flows: [
        {
          flowId: 'f1',
          flowFingerprint: 'sha256:f1',
          bindings: [{ doc: REFUNDS, anchor: 'refunds', fingerprint: 'sha256:a' }],
          scenarios: [{ id: 's1', drivers: ['cli'] }],
          interfaces: [],
          generationInputsHash: null,
          gaps: [],
          retiredScenarios: [],
        },
        {
          flowId: 'f2',
          flowFingerprint: 'sha256:f2',
          bindings: [{ doc: SHIPPING, anchor: 'shipping', fingerprint: 'sha256:b' }],
          scenarios: [{ id: 's2', drivers: ['cli'] }],
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
      ranAt: daysAgo(1),
      branch: 'main',
      commit: 'abcdef1234567890',
      recipeFingerprint: 'sha256:r',
    },
    summary: { total: 2, pass: 1, fail: 1, stale: 0, orphaned: 0, error: 0 },
    scenarios: [
      {
        id: 's1',
        title: 'a refund settles',
        binds: { doc: REFUNDS, section: 'refunds', fingerprint: 'sha256:a' },
        outcome: 'fail',
        durationMs: 1,
      },
      {
        id: 's2',
        title: 'a parcel ships',
        binds: { doc: SHIPPING, section: 'shipping', fingerprint: 'sha256:b' },
        outcome: 'pass',
        durationMs: 1,
      },
    ],
    sections: [],
  });
}

async function seedWorkspace(): Promise<void> {
  await saveWorkspaceSpec({ workspaceOrgId: TEST_ORG }, 'corpus', corpus());
  await context.createSource(TEST_ORG, {
    id: SITE,
    kind: 'site',
    title: 'docs.acme.com',
    config: { llmsTxtUrl: 'https://docs.acme.com/llms.txt' },
  });
  await context.writeDocuments(TEST_ORG, SITE, {
    documents: [
      {
        docId: 'https://docs.acme.com/refunds',
        docPath: 'refunds.md',
        title: 'Refunds',
        url: 'https://docs.acme.com/refunds',
        contentHash: 'hash-refunds',
        updatedAt: '2026-01-03T00:00:00.000Z',
        body: REFUNDS_BODY,
      },
      {
        docId: 'https://docs.acme.com/shipping',
        docPath: 'shipping.md',
        title: 'Shipping',
        url: 'https://docs.acme.com/shipping',
        contentHash: 'hash-shipping',
        updatedAt: '2026-01-04T00:00:00.000Z',
        body: SHIPPING_BODY,
      },
    ],
    removed: [],
  });
}

const home = async (query = ''): Promise<HomeResponse> => {
  const res = await request(app).get(`/api/home${query}`).expect(200);
  return res.body as HomeResponse;
};

/** A workspace whose provider is set, so the provider row stays out of the way. */
function withProvider(): void {
  const store = workspaceLlmConfigStore();
  setWorkspaceLlmConfigStore({
    ...store,
    getView: async () => ({ provider: 'anthropic', model: 'claude-test' }) as never,
  });
}

beforeEach(async () => {
  for (const entry of await readRegistry()) await unregisterProject(entry.slug);
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
  await unregisterProject(repoA.project.slug);
  await unregisterProject(repoB.project.slug);
  await teardownTestFixture();
  vi.restoreAllMocks();
});

describe('GET /api/home', () => {
  it('answers an empty page before anything is scanned', async () => {
    resetSpecStore();
    setSpecStore(memorySpecStore());
    const page = await home();
    expect(page.period).toBe('30d');
    expect(page.today).toEqual({
      total: 0,
      byStatus: { proved: 0, failed: 0, blocked: 0, 'not-testable': 0, 'not-run': 0 },
    });
    expect(page.trend).toEqual([]);
    expect(page.areas).toEqual([]);
    expect(page.changed).toEqual([]);
  });

  it('counts the sections of linked documents, folded across every repository that reads them', async () => {
    await setContextBindings(TEST_ORG, repoA.project.name, [SITE]);
    await setContextBindings(TEST_ORG, repoB.project.name, [SITE]);
    storedRun(repoA.repoPath);

    const page = await home();

    // Two sections, two repositories. A failed one outranks the other
    // repository's silence; a passed one does not, because the repository that
    // ran nothing has nothing proven.
    expect(page.today).toEqual({
      total: 2,
      byStatus: { proved: 0, failed: 1, blocked: 1, 'not-testable': 0, 'not-run': 0 },
    });
  });

  it('counts only the documents a repository reads', async () => {
    // Nothing is linked: every document is somebody's to link, nobody's promise.
    expect((await home()).today.total).toBe(0);

    await setContextBindings(TEST_ORG, repoA.project.name, [SITE]);
    storedRun(repoA.repoPath);
    expect((await home()).today).toEqual({
      total: 2,
      byStatus: { proved: 1, failed: 1, blocked: 0, 'not-testable': 0, 'not-run': 0 },
    });
  });

  it('sorts the areas by the share of failed and blocked', async () => {
    await setContextBindings(TEST_ORG, repoA.project.name, [SITE]);
    storedRun(repoA.repoPath);

    const page = await home();

    expect(page.areas.map((area) => area.area)).toEqual(['acme/payments', 'acme/logistics']);
    expect(page.areas[0]).toMatchObject({
      area: 'acme/payments',
      total: 1,
      byStatus: { proved: 0, failed: 1, blocked: 0, 'not-testable': 0, 'not-run': 0 },
    });
    expect(page.areas[1]!.byStatus.proved).toBe(1);
  });

  describe('the trend', () => {
    beforeEach(async () => {
      await setContextBindings(TEST_ORG, repoA.project.name, [SITE]);
      await setContextBindings(TEST_ORG, repoB.project.name, [SITE]);
      await writeGuardRunSections(repoA.repoPath, {
        runId: 'a-1',
        ranAt: daysAgo(40),
        commit: 'aaa',
        sections: { [`${REFUNDS}#refunds`]: 'failed' },
      });
      await writeGuardRunSections(repoB.repoPath, {
        runId: 'b-1',
        ranAt: daysAgo(20),
        commit: 'bbb',
        sections: { [`${REFUNDS}#refunds`]: 'succeeded' },
      });
      await writeGuardRunSections(repoA.repoPath, {
        runId: 'a-2',
        ranAt: daysAgo(2),
        commit: 'aab',
        sections: { [`${REFUNDS}#refunds`]: 'succeeded' },
      });
    });

    it('draws one point per baseline run, folded across the runs standing at that moment', async () => {
      const page = await home('?period=all');

      expect(page.trend).toHaveLength(3);
      // The first moment: only one repository has ever run, and the other
      // contributes nothing rather than a guess.
      expect(page.trend[0]!.byStatus).toMatchObject({ failed: 1, proved: 0 });
      // The second: the other repository proves it, but the failure stands.
      expect(page.trend[1]!.byStatus).toMatchObject({ failed: 1, proved: 0 });
      // The third: the failure is gone, so the section is proved.
      expect(page.trend[2]!.byStatus).toMatchObject({ failed: 0, proved: 1 });
    });

    it('reads the period asked for, and 30d when none is', async () => {
      expect((await home('?period=7d')).trend).toHaveLength(1);
      expect((await home('?period=30d')).trend).toHaveLength(2);
      expect((await home()).period).toBe('30d');
      expect((await home('?period=nonsense')).trend).toHaveLength(2);
    });

    it('says what happened to a document at each run, newest first', async () => {
      const page = await home('?period=all');

      expect(page.changed.map((row) => row.event)).toEqual(['Proved', 'First read']);
      expect(page.changed[0]).toMatchObject({
        ref: REFUNDS,
        title: 'Refunds',
        href: `/preview/context/doc/${encodeURIComponent(REFUNDS)}`,
      });
      // The middle run changed nothing about the document: the failure stood.
      expect(page.changed).toHaveLength(2);
    });

    it('leaves the changes outside the period out', async () => {
      expect((await home('?period=7d')).changed.map((row) => row.event)).toEqual(['Proved']);
    });
  });

  describe('what needs attention', () => {
    it('names the latest conversation of its kind that ended badly, and no other', async () => {
      withProvider();
      createSessionRun(repoA.repoPath, { command: 'spec-scan', gitRef: 'abc' }).finish('failed', {
        error: { message: 'the provider refused' },
      });
      // A later success on the same kind clears an older failure.
      createSessionRun(repoA.repoPath, { command: 'guard-setup', gitRef: 'abc' }).finish('failed');
      createSessionRun(repoA.repoPath, { command: 'guard-setup', gitRef: 'abc' }).finish('completed');

      const rows = (await home()).attention.filter((row) => row.kind === 'conversation');

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ title: 'Document scan', status: 'Failed' });
      expect(rows[0]!.fact).toContain('the provider refused');
      expect(rows[0]!.href).toMatch(/^\/preview\/agent\//);
    });

    it('names every open conflict of the workspace corpus', async () => {
      withProvider();
      await saveWorkspaceSpec({ workspaceOrgId: TEST_ORG }, 'corpus', corpus(true));

      const rows = (await home()).attention.filter((row) => row.kind === 'conflict');

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ title: 'refund window disagrees', status: 'Conflict' });
      expect(rows[0]!.href).toMatch(/^\/preview\/context\/conflicts\//);
    });

    it('names every linked document nothing can prove, with its blocked count', async () => {
      withProvider();
      await setContextBindings(TEST_ORG, repoA.project.name, [SITE]);

      const rows = (await home()).attention.filter((row) => row.kind === 'blocked-document');

      expect(rows.map((row) => row.title).sort()).toEqual(['Refunds', 'Shipping']);
      expect(rows[0]).toMatchObject({ status: 'Blocked', fact: '1 section blocked' });
      expect(rows[0]!.href).toMatch(/^\/preview\/context\/doc\//);
    });

    it('names a source whose last sync failed', async () => {
      withProvider();
      await context.updateSource(TEST_ORG, SITE, {
        status: 'failed',
        statusNote: 'the site answered 404',
        lastSyncAt: daysAgo(1),
      });

      const rows = (await home()).attention.filter((row) => row.kind === 'source');

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        title: 'docs.acme.com',
        status: 'Sync failed',
        fact: 'the site answered 404',
        href: `/preview/context/sources/${SITE}`,
      });
    });

    it('names the missing provider once, and says nothing when one is set', async () => {
      const missing = (await home()).attention.filter((row) => row.kind === 'provider');
      expect(missing).toHaveLength(1);
      expect(missing[0]).toMatchObject({ status: 'Needs setup', href: '/preview/settings/models' });

      withProvider();
      expect((await home()).attention.filter((row) => row.kind === 'provider')).toEqual([]);
    });
  });
});
