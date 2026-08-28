/**
 * The directory picker is a local-only, capability-gated dialog for the
 * "Add Repository" flow. RepoSelector shows a Browse button only when the
 * `local-filesystem` capability is on; the dialog lists server-enumerated
 * subdirectories and fills the manual input on confirm.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppProvider } from '@/contexts/CapabilityContext';
import { RepoSelector } from '@/components/repo/RepoSelector';
import { DirectoryPicker } from '@/components/repo/DirectoryPicker';

const HOME = {
  path: '/home/user',
  parent: null,
  entries: [
    { name: 'proj', path: '/home/user/proj', isRepo: true },
    { name: 'docs', path: '/home/user/docs', isRepo: false },
  ],
};
const CHILD = {
  path: '/home/user/proj',
  parent: '/home/user',
  entries: [{ name: 'src', path: '/home/user/proj/src', isRepo: false }],
};

function stubBrowseFetch() {
  const fetchMock = vi.fn(async (url: string) => {
    const p = new URL(url, 'http://localhost').searchParams.get('path');
    const body = p === '/home/user/proj' ? CHILD : HOME;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('RepoSelector Browse gating', () => {
  beforeEach(() => stubBrowseFetch());

  it('shows a Browse button when local-filesystem is enabled', () => {
    render(
      <AppProvider initial={{ edition: 'community', capabilities: ['local-filesystem'] }}>
        <RepoSelector onAdd={vi.fn()} />
      </AppProvider>,
    );
    expect(screen.getByRole('button', { name: /Browse/ })).toBeInTheDocument();
  });

  it('hides the Browse button when the capability is absent', () => {
    render(
      <AppProvider initial={{ edition: 'community', capabilities: [] }}>
        <RepoSelector onAdd={vi.fn()} />
      </AppProvider>,
    );
    expect(screen.queryByRole('button', { name: /Browse/ })).toBeNull();
    expect(screen.getByPlaceholderText('Paste repository path...')).toBeInTheDocument();
  });
});

describe('DirectoryPicker', () => {
  it('lists the home directory subdirectories on open', async () => {
    const fetchMock = stubBrowseFetch();
    render(<DirectoryPicker open onOpenChange={vi.fn()} onSelect={vi.fn()} />);

    expect(await screen.findByText('proj')).toBeInTheDocument();
    expect(screen.getByText('docs')).toBeInTheDocument();

    // Seeds with the home default → no `path` query param on the first call.
    const firstUrl = fetchMock.mock.calls[0][0] as string;
    expect(new URL(firstUrl, 'http://localhost').searchParams.get('path')).toBeNull();
  });

  it('navigates into an entry on click; Up is disabled at the root', async () => {
    stubBrowseFetch();
    const user = userEvent.setup();
    render(<DirectoryPicker open onOpenChange={vi.fn()} onSelect={vi.fn()} />);

    await screen.findByText('proj');
    expect(screen.getByRole('button', { name: /Up/ })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'proj' }));

    expect(await screen.findByText('src')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Up/ })).toBeEnabled();
  });
});

describe('DirectoryPicker confirm flow', () => {
  beforeEach(() => stubBrowseFetch());

  it('"Use this folder" confirms the current path and fills the RepoSelector input', async () => {
    const user = userEvent.setup();
    render(
      <AppProvider initial={{ edition: 'community', capabilities: ['local-filesystem'] }}>
        <RepoSelector onAdd={vi.fn()} />
      </AppProvider>,
    );

    await user.click(screen.getByRole('button', { name: /Browse/ }));
    await screen.findByText('proj');
    await user.click(screen.getByRole('button', { name: /Use this folder/ }));

    expect(screen.getByPlaceholderText('Paste repository path...')).toHaveValue('/home/user');
    expect(screen.queryByText('proj')).toBeNull();
  });
});
