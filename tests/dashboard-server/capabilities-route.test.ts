/**
 * /api/capabilities reports the live edition + the capabilities the
 * loaded enterprise plugin lit up. Community is the default; enterprise
 * is detected from env and loads @truecourse/ee-server through the
 * plugin seam.
 *
 * The response shape { edition, capabilities } is the contract the
 * client depends on, so both editions are pinned here.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

// EE now requires DATABASE_URL and always installs the Postgres stores. Stub the
// DB layer so register() succeeds without a real Postgres — this test only
// exercises /api/capabilities, never the stores themselves.
vi.mock('@truecourse/ee-db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@truecourse/ee-db')>();
  return {
    ...actual,
    createEeDb: async () => ({ db: {}, lockPool: {}, close: async () => {} }),
  };
});

import { createApp } from '../../apps/dashboard/server/src/app';
import {
  loadEnterprise,
  __resetEnterpriseForTests,
} from '../../apps/dashboard/server/src/ee-loader';

const EDITION_ENV = [
  'TRUECOURSE_EDITION',
  'WORKOS_API_KEY',
  'WORKOS_CLIENT_ID',
  'WORKOS_COOKIE_PASSWORD',
  'DATABASE_URL',
  'TRUECOURSE_SECRET_KEY',
] as const;
let saved: Record<string, string | undefined>;

// Fake WorkOS config + a DATABASE_URL + a TRUECOURSE_SECRET_KEY (the DB layer is
// mocked above) so the ee plugin's register() succeeds. Without these, register
// throws and — for the WorkOS/DB/secret *config* errors — the loader now FAILS
// HARD (no community fallback).
function setEnterpriseEnv() {
  process.env.TRUECOURSE_EDITION = 'enterprise';
  process.env.WORKOS_API_KEY = 'sk_test_dummy';
  process.env.WORKOS_CLIENT_ID = 'client_test_dummy';
  process.env.WORKOS_COOKIE_PASSWORD = 'x'.repeat(32);
  process.env.DATABASE_URL = 'postgres://stub';
  process.env.TRUECOURSE_SECRET_KEY = 'x'.repeat(32);
}

beforeEach(() => {
  saved = {};
  for (const k of EDITION_ENV) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  __resetEnterpriseForTests();
});

afterEach(() => {
  for (const k of EDITION_ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  __resetEnterpriseForTests();
});

describe('GET /api/capabilities', () => {
  it('returns community edition with no capabilities by default', async () => {
    const app = createApp({ serveStatic: false });
    const res = await request(app).get('/api/capabilities');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ edition: 'community', capabilities: [] });
  });

  it('stays reachable without auth even in enterprise mode (mounted before the gate)', async () => {
    setEnterpriseEnv();
    await loadEnterprise();
    const app = createApp({ serveStatic: false });
    // No session cookie — capabilities must still answer.
    const res = await request(app).get('/api/capabilities');
    expect(res.status).toBe(200);
  });

  it('FAILS HARD when enterprise is configured but DATABASE_URL is missing (no community fallback)', async () => {
    setEnterpriseEnv();
    delete process.env.DATABASE_URL; // misconfigured enterprise install
    // The loader must surface the misconfiguration, not silently degrade to a
    // broken half-community state (the bug: capabilities went empty, sidebar
    // vanished, but the app kept "running").
    await expect(loadEnterprise()).rejects.toThrow(/DATABASE_URL/);
  });

  it('FAILS HARD when enterprise is configured but TRUECOURSE_SECRET_KEY is missing (no CLI/.env LLM fallback)', async () => {
    setEnterpriseEnv();
    delete process.env.TRUECOURSE_SECRET_KEY; // no master secret for the provider store
    // Same rule as DATABASE_URL: a missing secret must fail boot, never silently
    // fall back to a CLI/.env LLM provider.
    await expect(loadEnterprise()).rejects.toThrow(/TRUECOURSE_SECRET_KEY/);
  });
});
