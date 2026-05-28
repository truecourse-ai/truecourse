/**
 * The OSS server always reports the community edition with no
 * capabilities. The enterprise build (under ee/) will replace this
 * router, but the response shape — { edition, capabilities } — is
 * the contract the client depends on either way, so this test pins
 * that shape down.
 */

import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

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
  it('returns community edition with no capabilities (OSS)', async () => {
    const app = createApp({ serveStatic: false });
    const res = await request(app).get('/api/capabilities');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      edition: 'community',
      capabilities: [],
    });
  });
});
