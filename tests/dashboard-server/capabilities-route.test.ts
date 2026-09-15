/**
 * /api/capabilities is the client's feature-gate discovery endpoint. There is
 * one product now, so `edition` is the constant `'community'` and the
 * capability list is the community set — no env sniffing, no plugin registry.
 *
 * The response shape is `{ edition, mode, capabilities }`; `edition` and
 * `capabilities` are pinned here, `mode` in `local-mode.test.ts` beside it.
 */

import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { COMMUNITY_CAPABILITIES } from '@truecourse/shared';

import { createTestApp } from '../helpers/test-app';

describe('GET /api/capabilities', () => {
  it("reports edition 'community' regardless of the environment", async () => {
    // WORKOS_* + TRUECOURSE_EDITION used to flip this to 'enterprise'. Which
    // edition a bundle is, is decided when it is built, so the value must not move.
    vi.stubEnv('TRUECOURSE_EDITION', 'enterprise');
    vi.stubEnv('WORKOS_API_KEY', 'sk_test_dummy');
    vi.stubEnv('WORKOS_CLIENT_ID', 'client_test_dummy');

    const app = createTestApp();
    const res = await request(app).get('/api/capabilities');

    expect(res.status).toBe(200);
    expect(res.body.edition).toBe('community');
    vi.unstubAllEnvs();
  });

  it('reports the community capability set', async () => {
    const app = createTestApp();
    const res = await request(app).get('/api/capabilities');

    expect(res.status).toBe(200);
    expect(res.body.capabilities).toEqual([...COMMUNITY_CAPABILITIES]);
  });
});
