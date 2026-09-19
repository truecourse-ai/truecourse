/**
 * The public server-facts context: how this server runs, and nothing else.
 *
 * `GET /api/capabilities` is read before there is a session, because the
 * sign-in screen itself differs in local mode. It answers the mode alone — what
 * a WORKSPACE may use moved to the authenticated answer, and is read through
 * `useEntitlement` (see `entitlements.test.tsx` beside this).
 *
 * The three jobs left: the `initial` snapshot bypasses the fetch, the fetched
 * answer is adopted, and a refused fetch fails closed to `hosted`, which is the
 * mode that assumes nothing about the machine the browser is on.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AppProvider, useCapabilityContext, useServerMode } from '@/contexts/CapabilityContext';

function ModeProbe() {
  return <span data-testid="mode">{useServerMode()}</span>;
}
function LoadingProbe() {
  return (
    <span data-testid="loading">
      {useCapabilityContext().isLoading ? 'yes' : 'no'}
    </span>
  );
}

describe('AppProvider (initial snapshot, no fetch)', () => {
  it('exposes the supplied mode and is not loading', () => {
    render(
      <AppProvider initial={{ mode: 'local' }}>
        <ModeProbe />
        <LoadingProbe />
      </AppProvider>,
    );
    expect(screen.getByTestId('mode')).toHaveTextContent('local');
    expect(screen.getByTestId('loading')).toHaveTextContent('no');
  });
});

describe('AppProvider (real fetch)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to hosted + isLoading=true on first render', () => {
    // Never-resolving fetch keeps us in the loading state.
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    render(
      <AppProvider>
        <ModeProbe />
        <LoadingProbe />
      </AppProvider>,
    );
    expect(screen.getByTestId('mode')).toHaveTextContent('hosted');
    expect(screen.getByTestId('loading')).toHaveTextContent('yes');
  });

  it('adopts the server response after the fetch resolves', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ mode: 'local' }),
      text: async () => '',
    });
    render(
      <AppProvider>
        <ModeProbe />
        <LoadingProbe />
      </AppProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('no'));
    expect(screen.getByTestId('mode')).toHaveTextContent('local');
  });

  it('fails closed to hosted if the fetch errors', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));
    render(
      <AppProvider>
        <ModeProbe />
        <LoadingProbe />
      </AppProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('no'));
    expect(screen.getByTestId('mode')).toHaveTextContent('hosted');
  });
});
