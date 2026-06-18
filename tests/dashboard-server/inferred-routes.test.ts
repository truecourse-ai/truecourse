import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { type Express } from 'express';
import { saveSpec, resetSpecStore } from '@truecourse/core/lib/spec-store';
import { readContractFile, resetContractStore } from '@truecourse/core/lib/contract-store';
import { resetInferredActionStore } from '@truecourse/core/lib/inferred-action-store';
import { createApp } from '../../apps/dashboard/server/src/app';
import {
  setupTestFixture,
  teardownTestFixture,
  type TestFixture,
} from '../helpers/test-db';

/**
 * The shared Inferred-tab route (`/api/repos/:id/inferred[/dismiss|/promote]`)
 * is edition-agnostic — it drives the file stores here (OSS transport) and the
 * Postgres stores in hosted EE, behind the same core `inferred-decisions` seam.
 * These tests pin the HTTP shape + status codes over the file transport; the
 * Pg transport is covered by `tests/ee-data-store`.
 */
describe('inferred routes (shared OSS/EE, file transport)', () => {
  let app: Express;
  let fixture: TestFixture;

  // Seed the raw inferred set (what `truecourse infer` would persist) + the
  // backing `_inferred/` `.tc` that promote reads from.
  async function seed() {
    await saveSpec({ repoKey: fixture.repoPath, commitSha: '' }, 'inferredDecisions', [
      { kind: 'Entity', identity: 'Order', reason: 'inferred', contractPath: 'data/order.tc' },
      { kind: 'Enum', identity: 'Role', reason: 'inferred', contractPath: 'data/role.tc' },
    ]);
    const tc = path.join(fixture.repoPath, '.truecourse', 'contracts', '_inferred', 'data', 'order.tc');
    fs.mkdirSync(path.dirname(tc), { recursive: true });
    fs.writeFileSync(tc, 'Entity Order { ... }');
  }

  const list = (slug: string) => request(app).get(`/api/repos/${slug}/inferred`);

  beforeEach(async () => {
    resetSpecStore();
    resetContractStore();
    resetInferredActionStore();
    fixture = await setupTestFixture();
    app = createApp({ serveStatic: false });
  });

  afterEach(async () => {
    resetInferredActionStore();
    await teardownTestFixture(fixture.project.slug);
  });

  it('GET lists the persisted inferred decisions', async () => {
    await seed();
    const res = await list(fixture.project.slug).expect(200);
    expect(res.body.decisions.map((d: { identity: string }) => d.identity).sort()).toEqual([
      'Order',
      'Role',
    ]);
  });

  it('dismiss records the overlay action and filters the item out', async () => {
    await seed();
    await request(app)
      .post(`/api/repos/${fixture.project.slug}/inferred/dismiss`)
      .send({ kind: 'Enum', identity: 'Role' })
      .expect(200);

    const res = await list(fixture.project.slug).expect(200);
    expect(res.body.decisions.map((d: { identity: string }) => d.identity)).toEqual(['Order']);
  });

  it('promote writes the .tc into authored contracts and filters the item out', async () => {
    await seed();
    await request(app)
      .post(`/api/repos/${fixture.project.slug}/inferred/promote`)
      .send({ kind: 'Entity', identity: 'Order' })
      .expect(200);

    expect(await readContractFile(fixture.repoPath, 'contracts', 'data/order.tc')).toBe(
      'Entity Order { ... }',
    );
    const res = await list(fixture.project.slug).expect(200);
    expect(res.body.decisions.map((d: { identity: string }) => d.identity)).toEqual(['Role']);
  });

  it('rejects a body missing kind/identity with 400', async () => {
    await seed();
    await request(app)
      .post(`/api/repos/${fixture.project.slug}/inferred/dismiss`)
      .send({ kind: 'Entity' })
      .expect(400);
  });

  it('promote returns 404 for an unknown decision', async () => {
    await seed();
    await request(app)
      .post(`/api/repos/${fixture.project.slug}/inferred/promote`)
      .send({ kind: 'Entity', identity: 'Nope' })
      .expect(404);
  });

  it('lists dismissed decisions and restores them', async () => {
    await seed();
    await request(app)
      .post(`/api/repos/${fixture.project.slug}/inferred/dismiss`)
      .send({ kind: 'Enum', identity: 'Role' })
      .expect(200);

    let res = await request(app).get(`/api/repos/${fixture.project.slug}/inferred/dismissed`).expect(200);
    expect(res.body.decisions.map((d: { identity: string }) => d.identity)).toEqual(['Role']);

    await request(app)
      .post(`/api/repos/${fixture.project.slug}/inferred/restore`)
      .send({ kind: 'Enum', identity: 'Role' })
      .expect(200);

    res = await request(app).get(`/api/repos/${fixture.project.slug}/inferred/dismissed`).expect(200);
    expect(res.body.decisions).toEqual([]);
    const active = await list(fixture.project.slug).expect(200);
    expect(active.body.decisions.map((d: { identity: string }) => d.identity).sort()).toEqual(['Order', 'Role']);
  });

  it('promote returns 409 when the inferred .tc is missing', async () => {
    await seed(); // 'Role' has a contractPath but no `_inferred/data/role.tc` seeded
    await request(app)
      .post(`/api/repos/${fixture.project.slug}/inferred/promote`)
      .send({ kind: 'Enum', identity: 'Role' })
      .expect(409);
  });
});
