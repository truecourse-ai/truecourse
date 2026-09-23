/**
 * What this workspace may use, as the client reads it.
 *
 * It rides the AUTHENTICATED answer (`GET /api/auth/me`) rather than the public
 * capabilities endpoint, because it is the workspace's fact and not the
 * deployment's: the same hosted server opens Connections to one workspace and
 * keeps them closed for the next. So the entitlement hooks hang off the session
 * probe, and a tree with no session — or one whose probe has not landed yet —
 * holds nothing, which is what keeps a gated surface from flashing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { EnterpriseFeature } from '@truecourse/shared';
import { AuthProvider, useEntitlement, useEntitlements } from '@/auth/AuthContext';

const realFetch = window.fetch;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** The session the probe answers, or a refusal when null. */
function serve(me: unknown | null) {
  window.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(href, window.location.origin);
    if (pathname === '/api/auth/me') {
      return me ? json(me) : json({ error: 'Not authenticated' }, 401);
    }
    return json({ error: 'not found' }, 404);
  }) as unknown as typeof window.fetch;
}

function Probe({ feature }: { feature: EnterpriseFeature }) {
  return (
    <>
      <span data-testid="held">{useEntitlement(feature) ? 'yes' : 'no'}</span>
      <span data-testid="all">{[...useEntitlements()].join(',') || 'none'}</span>
    </>
  );
}

function renderProbe(feature: EnterpriseFeature) {
  render(
    <AuthProvider>
      <Probe feature={feature} />
    </AuthProvider>,
  );
}

const USER = { id: 'user_me', email: 'dana@acme.dev', organizationId: 'org_a' };

afterEach(() => {
  window.fetch = realFetch;
});

beforeEach(() => {
  serve(null);
});

describe('what the session says the workspace holds', () => {
  it('holds what the answer named, and nothing it did not', async () => {
    serve({ user: USER, edition: 'enterprise', entitlements: ['connections'] });
    renderProbe('connections');

    await waitFor(() => expect(screen.getByTestId('held')).toHaveTextContent('yes'));
    expect(screen.getByTestId('all')).toHaveTextContent('connections');
  });

  it('holds nothing when the answer named nothing', async () => {
    serve({ user: USER, edition: 'community', entitlements: [] });
    renderProbe('connections');

    await waitFor(() => expect(screen.getByTestId('all')).toHaveTextContent('none'));
    expect(screen.getByTestId('held')).toHaveTextContent('no');
  });

  it('holds nothing with no session at all', async () => {
    renderProbe('connections');

    await waitFor(() => expect(screen.getByTestId('all')).toHaveTextContent('none'));
    expect(screen.getByTestId('held')).toHaveTextContent('no');
  });

  it('holds nothing before the probe has answered, so a gated surface cannot flash', () => {
    window.fetch = vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof window.fetch;
    renderProbe('connections');

    expect(screen.getByTestId('held')).toHaveTextContent('no');
    expect(screen.getByTestId('all')).toHaveTextContent('none');
  });

  // A server answering the older shape still signs people in; it simply offers
  // no enterprise feature, which is the safe reading of silence.
  it('holds nothing when the answer carries no entitlements at all', async () => {
    serve({ user: USER });
    renderProbe('connections');

    await waitFor(() => expect(screen.getByTestId('all')).toHaveTextContent('none'));
  });
});
