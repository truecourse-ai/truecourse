/**
 * Capability gating for the Guard header actions (GuardSectionActions).
 *
 * The local Generate/Run buttons spawn guard jobs against a working tree on the
 * server's own disk, so they exist only under the OSS `local-filesystem`
 * capability. Hosted (no `local-filesystem`) replaces Generate with the
 * job-backed enqueue (`POST /api/ee/guard/generate`, the IntegrationsPage sync
 * idiom: 202 → the jobs popup takes over; 409/404/400 → the server's error
 * message in a toast) — and only when the EE `guard` capability is up. With
 * neither capability the actions degrade to hidden, never broken. Fetch is
 * stubbed the house way (URL-routed `vi.stubGlobal('fetch', …)`); capabilities
 * come from AppProvider's test-only `initial` snapshot.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import type { Capability } from '@truecourse/shared';
import { AppProvider } from '@/contexts/CapabilityContext';
import { GuardSectionActions } from '@/components/guard/GuardSectionActions';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** URL-routed fetch stub for the hosted enqueue route. */
function stubFetch(opts: { status?: number; body?: unknown; onGenerate?: () => Promise<void> } = {}) {
  const calls: { url: string; method: string; body?: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, method: init?.method ?? 'GET', body: init?.body as string | undefined });
      if (u.includes('/api/ee/guard/generate')) {
        if (opts.onGenerate) await opts.onGenerate();
        return json(opts.body ?? { jobId: 'job-1' }, opts.status ?? 202);
      }
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
      <GuardSectionActions
        kind="generate"
        onClick={onClick}
        busy={false}
        otherBusy={false}
        repoFullName="acme/api"
        {...props}
      />
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

describe('GuardSectionActions — hosted, guard subsystem down (neither capability)', () => {
  it('renders no Generate affordance at all', () => {
    stubFetch();
    renderActions([]);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders no Run affordance at all', () => {
    stubFetch();
    renderActions([], { kind: 'run' });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('GuardSectionActions — hosted with the guard capability', () => {
  it('Generate enqueues the job with the repo fullName instead of the local trigger', async () => {
    const calls = stubFetch();
    const success = vi.spyOn(toast, 'success');
    const { onClick } = renderActions(['workspace', 'jobs', 'guard']);

    await userEvent.click(screen.getByRole('button', { name: /generat/i }));

    await waitFor(() => {
      const post = calls.find((c) => c.url.includes('/api/ee/guard/generate') && c.method === 'POST');
      expect(post).toBeTruthy();
      expect(JSON.parse(post!.body ?? '{}')).toEqual({ repoFullName: 'acme/api' });
    });
    // The local estimate-gate flow was never invoked.
    expect(onClick).not.toHaveBeenCalled();
    // 202 → the jobs popup takes over; the button just confirms the enqueue.
    await waitFor(() => expect(success).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: /generat/i })).not.toBeDisabled();
  });

  it('offers no hosted Run (runs happen on the job queue after generation)', () => {
    stubFetch();
    renderActions(['workspace', 'jobs', 'guard'], { kind: 'run' });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('disables the button while the enqueue POST is in flight', async () => {
    let release!: () => void;
    const pending = new Promise<void>((r) => { release = r; });
    stubFetch({ onGenerate: () => pending });
    renderActions(['guard']);

    await userEvent.click(screen.getByRole('button', { name: /generat/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /generat/i })).toBeDisabled());

    release();
    await waitFor(() => expect(screen.getByRole('button', { name: /generat/i })).not.toBeDisabled());
  });

  it('surfaces the server message on 409 (already running / not scanned / no LLM)', async () => {
    stubFetch({ status: 409, body: { error: 'Guard generation is already running for this repository.' } });
    const error = vi.spyOn(toast, 'error');
    renderActions(['guard']);

    await userEvent.click(screen.getByRole('button', { name: /generat/i }));

    await waitFor(() => expect(error).toHaveBeenCalled());
    const [, opts] = error.mock.calls[0] as [string, { description?: string }];
    expect(opts?.description).toBe('Guard generation is already running for this repository.');
  });

  it('surfaces an error on 404 (repo not connected)', async () => {
    stubFetch({ status: 404, body: { error: 'repo not connected' } });
    const error = vi.spyOn(toast, 'error');
    renderActions(['guard']);

    await userEvent.click(screen.getByRole('button', { name: /generat/i }));

    await waitFor(() => expect(error).toHaveBeenCalled());
    const [, opts] = error.mock.calls[0] as [string, { description?: string }];
    expect(opts?.description).toBe('repo not connected');
  });
});
