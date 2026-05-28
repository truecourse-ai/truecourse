/**
 * Covers the four jobs of the capability context:
 *   1. Defaults to community with no capabilities while the initial
 *      fetch is in flight (no enterprise UI may flash on first paint).
 *   2. After the fetch resolves, exposes the reported edition +
 *      capability set through the hooks.
 *   3. Fails closed — a network/server error keeps the community
 *      defaults rather than guessing.
 *   4. RequiresCapability gates children correctly (including the
 *      optional fallback).
 *
 * Tests use the `initial` prop to bypass the real fetch where the
 * behaviour under test doesn't depend on it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import {
  AppProvider,
  RequiresCapability,
  useCapability,
  useCapabilityContext,
  useEdition,
} from '@/contexts/CapabilityContext';

// Lightweight inspector components that render the hook output as
// text so each assertion is a single `getByTestId(...).textContent`.
function EditionProbe() {
  return <span data-testid="edition">{useEdition()}</span>;
}
function CapProbe({ cap }: { cap: string }) {
  return (
    <span data-testid={`cap-${cap}`}>
      {useCapability(cap) ? 'on' : 'off'}
    </span>
  );
}
function LoadingProbe() {
  return (
    <span data-testid="loading">
      {useCapabilityContext().isLoading ? 'yes' : 'no'}
    </span>
  );
}

describe('AppProvider (initial snapshot, no fetch)', () => {
  it('exposes the supplied edition and capabilities', () => {
    render(
      <AppProvider initial={{ edition: 'enterprise', capabilities: ['sso', 'pr-gates'] }}>
        <EditionProbe />
        <CapProbe cap="sso" />
        <CapProbe cap="pr-gates" />
        <CapProbe cap="integrations.slack" />
        <LoadingProbe />
      </AppProvider>,
    );
    expect(screen.getByTestId('edition')).toHaveTextContent('enterprise');
    expect(screen.getByTestId('cap-sso')).toHaveTextContent('on');
    expect(screen.getByTestId('cap-pr-gates')).toHaveTextContent('on');
    expect(screen.getByTestId('cap-integrations.slack')).toHaveTextContent('off');
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

  it('defaults to community + isLoading=true on first render', () => {
    // Never-resolving fetch keeps us in the loading state.
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    render(
      <AppProvider>
        <EditionProbe />
        <CapProbe cap="sso" />
        <LoadingProbe />
      </AppProvider>,
    );
    expect(screen.getByTestId('edition')).toHaveTextContent('community');
    expect(screen.getByTestId('cap-sso')).toHaveTextContent('off');
    expect(screen.getByTestId('loading')).toHaveTextContent('yes');
  });

  it('adopts the server response after the fetch resolves', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ edition: 'enterprise', capabilities: ['sso'] }),
      text: async () => '',
    });
    render(
      <AppProvider>
        <EditionProbe />
        <CapProbe cap="sso" />
        <LoadingProbe />
      </AppProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('loading')).toHaveTextContent('no'),
    );
    expect(screen.getByTestId('edition')).toHaveTextContent('enterprise');
    expect(screen.getByTestId('cap-sso')).toHaveTextContent('on');
  });

  it('fails closed: keeps community defaults if the fetch errors', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('boom'),
    );
    render(
      <AppProvider>
        <EditionProbe />
        <CapProbe cap="sso" />
        <LoadingProbe />
      </AppProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('loading')).toHaveTextContent('no'),
    );
    expect(screen.getByTestId('edition')).toHaveTextContent('community');
    expect(screen.getByTestId('cap-sso')).toHaveTextContent('off');
  });
});

describe('<RequiresCapability>', () => {
  it('renders children when the capability is on', () => {
    render(
      <AppProvider initial={{ edition: 'enterprise', capabilities: ['sso'] }}>
        <RequiresCapability cap="sso">
          <span>secret</span>
        </RequiresCapability>
      </AppProvider>,
    );
    expect(screen.getByText('secret')).toBeInTheDocument();
  });

  it('renders nothing when the capability is missing and no fallback is given', () => {
    render(
      <AppProvider initial={{ edition: 'community', capabilities: [] }}>
        <RequiresCapability cap="sso">
          <span>secret</span>
        </RequiresCapability>
      </AppProvider>,
    );
    expect(screen.queryByText('secret')).not.toBeInTheDocument();
  });

  it('renders the fallback when the capability is missing', () => {
    render(
      <AppProvider initial={{ edition: 'community', capabilities: [] }}>
        <RequiresCapability cap="sso" fallback={<span>upgrade</span>}>
          <span>secret</span>
        </RequiresCapability>
      </AppProvider>,
    );
    expect(screen.queryByText('secret')).not.toBeInTheDocument();
    expect(screen.getByText('upgrade')).toBeInTheDocument();
  });
});
