/**
 * `/api/capabilities` says HOW THIS SERVER RUNS, and nothing else.
 *
 * It is public, so it cannot answer for a caller — and what a caller may use is
 * a fact about their workspace, not about the deployment. That moved to the
 * authenticated answer (`/api/auth/me`, pinned in `auth-workspace.test.ts` and
 * `local-mode.test.ts`), which is what keeps the two from disagreeing. The one
 * thing left here is the mode, which the client needs before it has a session;
 * `local-mode.test.ts` beside this pins that it follows the environment.
 */

import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

import { createTestApp } from '../helpers/test-app';

describe('GET /api/capabilities', () => {
  it('answers the mode alone, whatever the environment says about editions', async () => {
    // WORKOS_* + TRUECOURSE_EDITION used to flip an `edition` field here. There
    // is no such field: which features a workspace may use is the workspace's
    // own answer, and no environment variable is it.
    vi.stubEnv('TRUECOURSE_EDITION', 'enterprise');
    vi.stubEnv('WORKOS_API_KEY', 'sk_test_dummy');
    vi.stubEnv('WORKOS_CLIENT_ID', 'client_test_dummy');

    const app = createTestApp();
    const res = await request(app).get('/api/capabilities');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ mode: 'hosted' });
    vi.unstubAllEnvs();
  });
});
