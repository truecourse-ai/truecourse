/**
 * `/api/capabilities` says HOW THIS SERVER RUNS, and nothing else.
 *
 * It is public, so it cannot answer for a caller — and what a caller may use is
 * a fact about their workspace, not about the deployment. That moved to the
 * authenticated answer (`/api/auth/me`, pinned in `auth-workspace.test.ts` and
 * `local-mode.test.ts`), which is what keeps the two from disagreeing. What is
 * left here is the mode, which the client needs before it has a session, and
 * where this server's MCP is; `local-mode.test.ts` beside this pins that the
 * mode follows the environment.
 */

import { afterEach, describe, it, expect, vi } from 'vitest';
import request from 'supertest';

import { createAuth } from '../../apps/dashboard/server/src/auth/index';
import { createTestApp } from '../helpers/test-app';
import { MemoryInviteLinkStore } from '../helpers/memory-invite-links';

const deps = { inviteLinks: new MemoryInviteLinkStore(), manyWorkspaces: false, port: 4123 };

/** A hosted server's WorkOS sign-in, with or without its MCP sign-in. */
function stubHosted(mcp: { domain: string; url: string } | null): void {
  vi.stubEnv('TRUECOURSE_MODE', 'hosted');
  vi.stubEnv('WORKOS_API_KEY', 'sk_test_dummy');
  vi.stubEnv('WORKOS_CLIENT_ID', 'client_test_dummy');
  vi.stubEnv('WORKOS_COOKIE_PASSWORD', 'x'.repeat(32));
  vi.stubEnv('WORKOS_AUTHKIT_DOMAIN', mcp?.domain ?? '');
  vi.stubEnv('TRUECOURSE_MCP_URL', mcp?.url ?? '');
}

async function capabilities(mode: 'hosted' | 'local') {
  const auth = createAuth(mode, deps);
  const app = createTestApp({ authVerifier: auth.verify, mcpAuth: auth.mcp });
  return (await request(app).get('/api/capabilities').expect(200)).body;
}

describe('GET /api/capabilities', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('answers the mode and the MCP, whatever the environment says about editions', async () => {
    // WORKOS_* + TRUECOURSE_EDITION used to flip an `edition` field here. There
    // is no such field: which features a workspace may use is the workspace's
    // own answer, and no environment variable is it.
    vi.stubEnv('TRUECOURSE_EDITION', 'enterprise');
    stubHosted(null);

    expect(await capabilities('hosted')).toEqual({ mode: 'hosted', mcp: { available: false } });
  });

  it('gives a hosted server the MCP URL its operator configured', async () => {
    stubHosted({ domain: 'https://example.authkit.app', url: 'https://truecourse.example.com/mcp' });

    expect(await capabilities('hosted')).toEqual({
      mode: 'hosted',
      mcp: { available: true, url: 'https://truecourse.example.com/mcp' },
    });
  });

  it('gives a local server its own /mcp on the port it listens on', async () => {
    vi.stubEnv('TRUECOURSE_MODE', 'local');

    expect(await capabilities('local')).toEqual({
      mode: 'local',
      mcp: { available: true, url: 'http://localhost:4123/mcp' },
    });
  });
});
