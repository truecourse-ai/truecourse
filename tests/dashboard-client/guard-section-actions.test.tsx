/**
 * Capability gating for the Guard header actions (GuardSectionActions).
 *
 * The local Generate/Run buttons spawn guard jobs against a working tree on the
 * server's own disk, so they exist only under the OSS `local-filesystem`
 * capability. Hosted repos (no `local-filesystem`) are self-driving — scenarios
 * generate automatically off a conflict-free scan and runs happen on the job
 * queue — so they show no manual Generate/Run button, whether or not the EE
 * `guard` subsystem is up. Fetch is stubbed the house way (URL-routed
 * `vi.stubGlobal('fetch', …)`) only to prove the hidden hosted action issues no
 * request; capabilities come from AppProvider's test-only `initial` snapshot.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Capability } from '@truecourse/shared';
import { AppProvider } from '@/contexts/CapabilityContext';
import { GuardSectionActions } from '@/components/guard/GuardSectionActions';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** URL-routed fetch stub — records every call so a hidden action can be proven inert. */
function stubFetch() {
  const calls: { url: string; method: string; body?: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body as string | undefined });
      return json({});
    }),
  );
  return calls;
}

function renderActions(
  capabilities: Capability[],
  props: Partial<Parameters<typeof GuardSectionActions>[0]> = {},
) {
  const onClick = vi.fn();
  render(
    <AppProvider
      initial={{
        edition: capabilities.includes('local-filesystem') ? 'community' : 'enterprise',
        capabilities,
      }}
    >
      <GuardSectionActions kind="generate" onClick={onClick} busy={false} otherBusy={false} {...props} />
    </AppProvider>,
  );
  return { onClick };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GuardSectionActions — OSS (local-filesystem)', () => {
  it('renders the local Generate wired to the page trigger (no EE fetch)', async () => {
    const calls = stubFetch();
    const { onClick } = renderActions(['local-filesystem']);

    await userEvent.click(screen.getByRole('button', { name: /generat/i }));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(calls.some((c) => c.url.includes('/api/ee/'))).toBe(false);
  });

  it('renders the local Run on the drifts tab', () => {
    stubFetch();
    renderActions(['local-filesystem'], { kind: 'run' });
    expect(screen.getByRole('button', { name: /^run/i })).toBeInTheDocument();
  });
});

describe('GuardSectionActions — hosted (no local-filesystem)', () => {
  it('renders no Generate affordance when the guard subsystem is down', () => {
    stubFetch();
    renderActions([]);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders no Run affordance when the guard subsystem is down', () => {
    stubFetch();
    renderActions([], { kind: 'run' });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  // The hosted Generate button was retired — hosted repos self-drive (auto-generate
  // off a conflict-free scan), so even with the `guard` subsystem up there is no
  // manual trigger, and nothing is POSTed.
  it('renders no Generate button even with the guard capability, and issues no request', () => {
    const calls = stubFetch();
    renderActions(['workspace', 'jobs', 'guard']);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(calls.some((c) => c.url.includes('/api/ee/guard/generate'))).toBe(false);
  });

  it('renders no Run button even with the guard capability', () => {
    stubFetch();
    renderActions(['workspace', 'jobs', 'guard'], { kind: 'run' });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
