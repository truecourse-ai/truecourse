/**
 * The per-workspace entitlements over the real SQL.
 *
 * What is being proved is that a row IS the grant: a workspace holds exactly
 * what was granted to it and nothing another workspace was granted, granting
 * the same feature twice leaves one row with the later operator on it, revoking
 * deletes it and says whether there was one to delete, and the operator's
 * listing covers every workspace this deployment knows about — including ones
 * that have never been granted anything, which are the ones there is a point in
 * granting to.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { repositories, workspaceEntitlements } from '@truecourse/db';
import {
  installEntitlementsStore,
  type InstalledEntitlementsStore,
} from '../helpers/entitlements-store';

const ORG = 'org_acme';
const OTHER = 'org_northwind';
const OPERATOR = 'user_operator';
const SECOND_OPERATOR = 'user_second';

let installed: InstalledEntitlementsStore;

beforeEach(async () => {
  installed = await installEntitlementsStore();
});

afterEach(async () => {
  await installed.close();
});

/** A connected repository, which is one of the ways a workspace exists at all. */
async function connectRepo(org: string, repoFullName: string): Promise<void> {
  const at = '2026-03-01T10:00:00.000Z';
  await installed.db.insert(repositories).values({
    repoFullName,
    provider: 'github',
    workspaceOrgId: org,
    slug: repoFullName.split('/')[1]!,
    createdAt: at,
    updatedAt: at,
  });
}

describe('PgEntitlementsStore', () => {
  it('holds nothing for a workspace nobody granted anything', async () => {
    expect(await installed.store.of(ORG)).toEqual([]);
  });

  it('holds what it was granted, and nothing another workspace was', async () => {
    await installed.store.grant({ workspaceOrgId: ORG, feature: 'connections', actorUserId: OPERATOR });
    await installed.store.grant({ workspaceOrgId: OTHER, feature: 'workspaces', actorUserId: OPERATOR });

    expect(await installed.store.of(ORG)).toEqual(['connections']);
    expect(await installed.store.of(OTHER)).toEqual(['workspaces']);
  });

  it('answers the features in the vocabulary’s own order, whatever order they were granted in', async () => {
    await installed.store.grant({ workspaceOrgId: ORG, feature: 'workspaces', actorUserId: OPERATOR });
    await installed.store.grant({ workspaceOrgId: ORG, feature: 'connections', actorUserId: OPERATOR });
    await installed.store.grant({
      workspaceOrgId: ORG,
      feature: 'repository-providers',
      actorUserId: OPERATOR,
    });

    expect(await installed.store.of(ORG)).toEqual([
      'connections',
      'repository-providers',
      'workspaces',
    ]);
  });

  it('records who granted it and why', async () => {
    const row = await installed.store.grant({
      workspaceOrgId: ORG,
      feature: 'connections',
      actorUserId: OPERATOR,
      note: 'paid through 2027',
    });
    expect(row).toMatchObject({
      workspaceOrgId: ORG,
      feature: 'connections',
      grantedBy: OPERATOR,
      note: 'paid through 2027',
    });
    expect(row.grantedAt).toMatch(/^\d{4}-/);
  });

  it('granting the same feature again re-stamps the one row rather than adding another', async () => {
    await installed.store.grant({
      workspaceOrgId: ORG,
      feature: 'connections',
      actorUserId: OPERATOR,
      note: 'trial',
    });
    const again = await installed.store.grant({
      workspaceOrgId: ORG,
      feature: 'connections',
      actorUserId: SECOND_OPERATOR,
    });

    expect(again).toMatchObject({ grantedBy: SECOND_OPERATOR, note: null });
    expect(await installed.db.select().from(workspaceEntitlements)).toHaveLength(1);
    expect(await installed.store.of(ORG)).toEqual(['connections']);
  });

  it('revoking takes one feature back and leaves the others standing', async () => {
    await installed.store.grant({ workspaceOrgId: ORG, feature: 'connections', actorUserId: OPERATOR });
    await installed.store.grant({ workspaceOrgId: ORG, feature: 'workspaces', actorUserId: OPERATOR });

    expect(await installed.store.revoke(ORG, 'connections')).toBe(true);
    expect(await installed.store.of(ORG)).toEqual(['workspaces']);
  });

  it('revoking what a workspace never held changes nothing and says so', async () => {
    expect(await installed.store.revoke(ORG, 'connections')).toBe(false);
    expect(await installed.store.of(ORG)).toEqual([]);
  });

  it('lists every workspace the deployment knows, granted or not', async () => {
    await installed.store.grant({ workspaceOrgId: ORG, feature: 'connections', actorUserId: OPERATOR });
    // A workspace with a connected repository and no grant is exactly the one
    // an operator opens the console to grant to.
    await connectRepo(OTHER, 'northwind/api');

    expect(await installed.store.workspaces()).toEqual([
      { workspaceOrgId: ORG, features: ['connections'] },
      { workspaceOrgId: OTHER, features: [] },
    ]);
  });
});
