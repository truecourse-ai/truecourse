/**
 * /api/capabilities is the client's feature-gate discovery endpoint. There is
 * one product now, so `edition` is the constant `'community'` and the
 * capability list is the community set — no env sniffing, no plugin registry.
 *
 * The response shape { edition, capabilities } is the contract the client
 * depends on, so both fields are pinned here.
 */

import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { COMMUNITY_CAPABILITIES } from '@truecourse/shared';

vi.mock('../../apps/dashboard/server/src/socket/handlers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../apps/dashboard/server/src/socket/handlers')>();
  class NoopTracker {
    start() {}
    done() {}
    error() {}
    detail() {}
  }
  return {
    ...actual,
    emitAnalysisProgress: vi.fn(),
    emitAnalysisComplete: vi.fn(),
    emitViolationsReady: vi.fn(),
    emitFilesChanged: vi.fn(),
    emitAnalysisCanceled: vi.fn(),
    createSocketTracker: () => new NoopTracker(),
    createSocketLlmEstimateHandler: () => () => Promise.resolve(true),
    createSocketStashConfirmHandler: () => () => Promise.resolve('stash'),
  };
});

import { createApp } from '../../apps/dashboard/server/src/app';

describe('GET /api/capabilities', () => {
  it("reports edition 'community' regardless of the environment", async () => {
    // WORKOS_* + TRUECOURSE_EDITION used to flip this to 'enterprise'. WorkOS is
    // now always configured, and the client's enterprise branch loads a dead
    // client chunk, so the value must not move.
    vi.stubEnv('TRUECOURSE_EDITION', 'enterprise');
    vi.stubEnv('WORKOS_API_KEY', 'sk_test_dummy');
    vi.stubEnv('WORKOS_CLIENT_ID', 'client_test_dummy');

    const app = createApp({ serveStatic: false, authVerifier: null });
    const res = await request(app).get('/api/capabilities');

    expect(res.status).toBe(200);
    expect(res.body.edition).toBe('community');
    vi.unstubAllEnvs();
  });

  it('reports the community capability set', async () => {
    const app = createApp({ serveStatic: false, authVerifier: null });
    const res = await request(app).get('/api/capabilities');

    expect(res.status).toBe(200);
    expect(res.body.capabilities).toEqual([...COMMUNITY_CAPABILITIES]);
  });
});
