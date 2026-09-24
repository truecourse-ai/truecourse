/**
 * ENTITLEMENTS, as addresses and as enforcement.
 *
 * `/api/operator/entitlements` is TrueCourse staff only, and a member who
 * reaches it is told there is NO SUCH ROUTE rather than that they may not have
 * it — the credits console's rule, and the two mount together.
 *
 * The enforcement is the other half, and it is what makes the grant more than a
 * record: an ungranted workspace is never offered the tool kinds in Add
 * context, and a revoke PAUSES the sources that read through the feature while
 * leaving their documents and every other source alone.
 *
 * The bundle has to be there too. A grant on a deployment that registered no
 * enterprise feature names something nobody mounted, so it entitles nothing —
 * which is why every case here registers one.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { AuthVerifier, ContextSourceKind } from '@truecourse/shared';
import {
  resetContextStore,
  setContextStore,
} from '@truecourse/core/lib/context-store';
import type { ContextSourceDriver } from '@truecourse/core/services/context';
import { createTestApp, resetTestWorkspaceLlm, TEST_ORG, TEST_USER } from '../helpers/test-app';
import { clearTestRegistry } from '../helpers/test-fixture';
import {
  installEntitlementsStore,
  type InstalledEntitlementsStore,
} from '../helpers/entitlements-store';
import { memoryContextStore, type MemoryContextStore } from '../helpers/memory-context-store';
import {
  clearServerFeatures,
  registerServerFeature,
} from '../../apps/dashboard/server/src/features';
import { setFeatureContextDrivers } from '../../apps/dashboard/server/src/services/context.service';
import {
  captureAction,
  EVENTS,
} from '../../apps/dashboard/server/src/observability/posthog';

// A grant and a revoke are reported from the route where each becomes true; the
// analytics module's one capture is a spy, so the call is asserted and nothing
// is sent.
vi.mock('../../apps/dashboard/server/src/observability/posthog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../apps/dashboard/server/src/observability/posthog')>()),
  captureAction: vi.fn(),
}));

const OPERATOR = 'user_operator';

/** A session that is TrueCourse staff. */
const asOperator: AuthVerifier = async () => ({
  user: { id: OPERATOR, email: 'ops@truecourse.dev', organizationId: TEST_ORG, isOperator: true },
});

let installed: InstalledEntitlementsStore;
let store: MemoryContextStore;

/** A driver that yields nothing: these cases are about whether it is OFFERED. */
function toolDriver(kind: ContextSourceKind): ContextSourceDriver {
  return {
    kind,
    async check() {
      return { title: `${kind} scope`, count: 0, sample: [] };
    },
    async scope(config) {
      return { id: `${kind}-1`, title: `${kind} scope`, config };
    },
    async sync() {
      return { documents: [], added: [], changed: [], removed: [], unchanged: [], skipped: [] };
    },
  } as unknown as ContextSourceDriver;
}

/** The deployment carries the connections feature and the two kinds it drives. */
function registerConnectionsFeature(): void {
  registerServerFeature({
    name: 'document connections',
    entitlement: 'connections',
    mount: () => [],
  });
  setFeatureContextDrivers([
    { kind: 'jira', entitlement: 'connections', driver: () => toolDriver('jira') },
    { kind: 'confluence', entitlement: 'connections', driver: () => toolDriver('confluence') },
  ]);
}

beforeEach(async () => {
  vi.mocked(captureAction).mockClear();
  installed = await installEntitlementsStore();
  store = memoryContextStore();
  setContextStore(store);
});

afterEach(async () => {
  clearServerFeatures();
  resetContextStore();
  resetTestWorkspaceLlm();
  clearTestRegistry();
  await installed.close();
});

function operatorApp(): Express {
  return createTestApp({ authVerifier: asOperator });
}

describe('the operator entitlements console', () => {
  it('is not there at all for a member who is not TrueCourse staff', async () => {
    const app = createTestApp();
    for (const [method, path] of [
      ['get', '/api/operator/entitlements'],
      ['post', '/api/operator/entitlements/grant'],
      ['post', '/api/operator/entitlements/revoke'],
    ] as const) {
      const res = await request(app)[method](path).send({
        workspaceOrgId: TEST_ORG,
        feature: 'connections',
      });
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'The server has no such route.' });
    }
    // And nothing was written on the way to being refused.
    expect(await installed.store.of(TEST_ORG)).toEqual([]);
  });

  it('lists every workspace and what it holds', async () => {
    await installed.store.grant({
      workspaceOrgId: TEST_ORG,
      feature: 'connections',
      actorUserId: OPERATOR,
    });
    const res = await request(operatorApp()).get('/api/operator/entitlements').expect(200);
    expect(res.body.workspaces).toEqual([
      { workspaceOrgId: TEST_ORG, workspaceName: null, features: ['connections'] },
    ]);
  });

  it('names a workspace the way the identity provider does, when it can', async () => {
    await installed.store.grant({
      workspaceOrgId: TEST_ORG,
      feature: 'connections',
      actorUserId: OPERATOR,
    });
    const app = createTestApp({
      authVerifier: asOperator,
      workspaceNames: async (id) => (id === TEST_ORG ? 'Acme' : undefined),
    });
    const res = await request(app).get('/api/operator/entitlements').expect(200);
    expect(res.body.workspaces[0]).toMatchObject({ workspaceName: 'Acme' });
  });

  it('grants one feature, and reports it against the workspace it was handed to', async () => {
    const res = await request(operatorApp())
      .post('/api/operator/entitlements/grant')
      .send({ workspaceOrgId: TEST_ORG, feature: 'connections', note: 'paid' })
      .expect(200);

    expect(res.body).toEqual({ workspaceOrgId: TEST_ORG, features: ['connections'] });
    expect(await installed.store.of(TEST_ORG)).toEqual(['connections']);
    expect(vi.mocked(captureAction).mock.calls).toEqual([
      [
        EVENTS.entitlementGranted,
        { userId: OPERATOR, workspaceId: TEST_ORG, properties: { feature: 'connections' } },
      ],
    ]);
  });

  it('refuses a feature that is not one of the three', async () => {
    const res = await request(operatorApp())
      .post('/api/operator/entitlements/grant')
      .send({ workspaceOrgId: TEST_ORG, feature: 'everything' })
      .expect(400);
    expect(res.body.error).toBe('Invalid grant');
    expect(vi.mocked(captureAction)).not.toHaveBeenCalled();
  });

  it('revokes one and leaves the others standing', async () => {
    for (const feature of ['connections', 'workspaces'] as const) {
      await installed.store.grant({ workspaceOrgId: TEST_ORG, feature, actorUserId: OPERATOR });
    }

    const res = await request(operatorApp())
      .post('/api/operator/entitlements/revoke')
      .send({ workspaceOrgId: TEST_ORG, feature: 'connections' })
      .expect(200);

    expect(res.body).toEqual({
      workspaceOrgId: TEST_ORG,
      features: ['workspaces'],
      paused: [],
    });
    expect(vi.mocked(captureAction).mock.calls).toEqual([
      [
        EVENTS.entitlementRevoked,
        {
          userId: OPERATOR,
          workspaceId: TEST_ORG,
          properties: { feature: 'connections', pausedSources: 0 },
        },
      ],
    ]);
  });

  it('revoking what a workspace never held is a no-op it reports nothing for', async () => {
    const res = await request(operatorApp())
      .post('/api/operator/entitlements/revoke')
      .send({ workspaceOrgId: TEST_ORG, feature: 'connections' })
      .expect(200);
    expect(res.body.features).toEqual([]);
    expect(vi.mocked(captureAction)).not.toHaveBeenCalled();
  });
});

describe('a revoke and the sources that read through the feature', () => {
  /** One source of each kind, so what a revoke stops can be told from what it leaves. */
  async function threeSources(): Promise<void> {
    for (const [id, kind] of [
      ['jira-1', 'jira'],
      ['confluence-1', 'confluence'],
      ['site-1', 'site'],
    ] as const) {
      await store.createSource(TEST_ORG, {
        id,
        kind,
        title: id,
        config: {} as never,
      });
    }
  }

  it('pauses the tool sources with the reason and leaves a site source alone', async () => {
    registerConnectionsFeature();
    await threeSources();
    await installed.store.grant({
      workspaceOrgId: TEST_ORG,
      feature: 'connections',
      actorUserId: OPERATOR,
    });

    const res = await request(operatorApp())
      .post('/api/operator/entitlements/revoke')
      .send({ workspaceOrgId: TEST_ORG, feature: 'connections' })
      .expect(200);

    expect(res.body.paused.sort()).toEqual(['confluence-1', 'jira-1']);
    const sources = await store.listSources(TEST_ORG);
    const byId = new Map(sources.map((source) => [source.id, source]));
    expect(byId.get('jira-1')).toMatchObject({
      status: 'paused',
      statusNote:
        'This workspace is no longer entitled to the Connections that this source reads through.',
    });
    expect(byId.get('confluence-1')?.status).toBe('paused');
    // A site source reads through nothing that was revoked.
    expect(byId.get('site-1')?.status).not.toBe('paused');
  });

  it('leaves the documents where they are, so a grant restored is a Resume', async () => {
    registerConnectionsFeature();
    await threeSources();
    await store.writeDocuments(TEST_ORG, 'jira-1', {
      documents: [
        {
          docId: 'ENG-1',
          docPath: 'ENG-1.md',
          title: 'ENG-1',
          url: null,
          contentHash: 'h1',
          updatedAt: '2026-03-01T10:00:00.000Z',
          body: '# ENG-1',
        },
      ],
      removed: [],
    });

    await request(operatorApp())
      .post('/api/operator/entitlements/revoke')
      .send({ workspaceOrgId: TEST_ORG, feature: 'connections' })
      .expect(200);

    expect(await store.listDocuments(TEST_ORG, 'jira-1')).toHaveLength(1);
  });
});

describe('the kinds a workspace is offered in Add context', () => {
  it('leaves out an edition kind the workspace was never granted', async () => {
    registerConnectionsFeature();
    const res = await request(createTestApp()).get('/api/context/sources').expect(200);
    expect(res.body.addableKinds).toEqual(['repository', 'site']);
  });

  it('offers it once the workspace holds the grant', async () => {
    registerConnectionsFeature();
    await installed.store.grant({
      workspaceOrgId: TEST_ORG,
      feature: 'connections',
      actorUserId: OPERATOR,
    });
    const res = await request(createTestApp()).get('/api/context/sources').expect(200);
    expect(res.body.addableKinds).toEqual(['repository', 'site', 'jira', 'confluence']);
  });

  it('refuses to store a source of a kind the workspace may not use', async () => {
    registerConnectionsFeature();
    const res = await request(createTestApp())
      .post('/api/context/sources')
      .send({ kind: 'jira', config: { projectKey: 'ENG' } })
      .expect(400);
    // The same refusal a kind nothing can sync gets: an ungranted workspace has
    // no driver for it, which is the whole of the answer.
    expect(res.body.error).toContain('"jira" sources are not available yet.');
    expect(await store.listSources(TEST_ORG)).toEqual([]);
  });

  it('is unaffected for a workspace that holds the grant', async () => {
    registerConnectionsFeature();
    await installed.store.grant({
      workspaceOrgId: TEST_ORG,
      feature: 'connections',
      actorUserId: OPERATOR,
    });
    await request(createTestApp())
      .post('/api/context/sources/preview')
      .send({ kind: 'jira', config: { projectKey: 'ENG' } })
      .expect(200);
  });
});
