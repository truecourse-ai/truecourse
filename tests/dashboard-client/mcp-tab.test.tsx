/**
 * Settings › MCP.
 *
 * The tab shows what `/api/capabilities` answered and nothing it made up: the
 * MCP URL and the Claude Code command that adds it, each copyable; the custom
 * connector line only on a hosted server, where the Claude app can reach it;
 * and on a hosted server without MCP sign-in, one line and no URL. It is the
 * last section, so with the enterprise edition it sits under Connections.
 */

import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { CapabilitiesResponse } from '@truecourse/shared';

vi.mock('@/lib/socket', () => {
  const socket = { connected: false, on: vi.fn(), off: vi.fn(), emit: vi.fn(), connect: vi.fn() };
  return {
    connectSocket: () => socket,
    getSocket: () => socket,
    disconnectSocket: vi.fn(),
    joinRepoRoom: vi.fn(),
    leaveRepoRoom: vi.fn(),
  };
});

import DashboardApp from '@/dashboard/DashboardApp';
import { AppProvider } from '@/contexts/CapabilityContext';
import { McpTab } from '@/dashboard/pages/McpTab';
import { registerSettingsTab } from '@/dashboard/shell/registry';

// An edition with document Connections, registered the way the real one is.
registerSettingsTab({ id: 'connections', label: 'Connections', render: () => null });

const HOSTED_URL = 'https://truecourse.example.com/mcp';
const DOCS_URL = 'https://docs.truecourse.dev/settings/mcp';
const realFetch = window.fetch;

function renderTab(capabilities: CapabilitiesResponse) {
  render(
    <AppProvider initial={capabilities}>
      <McpTab />
    </AppProvider>,
  );
}

/** The docs link: labelled, external, in a new tab. */
function docs(): HTMLElement {
  const link = screen.getByRole('link', { name: 'Read the MCP docs' });
  expect(link).toHaveAttribute('target', '_blank');
  expect(link.querySelector('svg')).not.toBeNull();
  return link;
}

afterEach(() => {
  vi.restoreAllMocks();
  window.fetch = realFetch;
});

describe('Settings › MCP', () => {
  it('gives a hosted server its URL, the command, and the custom connector line', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    renderTab({ mode: 'hosted', mcp: { available: true, url: HOSTED_URL } });

    const command = `claude mcp add --transport http truecourse ${HOSTED_URL}`;
    expect(screen.getByText(HOSTED_URL)).toBeInTheDocument();
    expect(screen.getByText(command)).toBeInTheDocument();
    expect(
      screen.getByText('Or add this URL in the Claude app › Settings › Connectors › Add custom connector.'),
    ).toBeInTheDocument();
    expect(docs()).toHaveAttribute('href', DOCS_URL);

    await user.click(screen.getByRole('button', { name: 'Copy MCP URL' }));
    expect(writeText).toHaveBeenLastCalledWith(HOSTED_URL);
    await user.click(screen.getByRole('button', { name: 'Copy Claude Code' }));
    expect(writeText).toHaveBeenLastCalledWith(command);
    expect(screen.getByText('Copied')).toBeInTheDocument();
  });

  it('gives a local server its own /mcp and no custom connector line', () => {
    renderTab({ mode: 'local', mcp: { available: true, url: 'http://localhost:3001/mcp' } });

    expect(screen.getByText('http://localhost:3001/mcp')).toBeInTheDocument();
    expect(
      screen.getByText('claude mcp add --transport http truecourse http://localhost:3001/mcp'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/custom connector/)).toBeNull();
  });

  it('says MCP sign-in is not configured, with no URL or command, when there is none', () => {
    renderTab({ mode: 'hosted', mcp: { available: false } });

    expect(screen.getByText('MCP sign-in is not configured on this server.')).toBeInTheDocument();
    expect(screen.queryByText(/claude mcp add/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Copy/ })).toBeNull();
    expect(docs()).toHaveAttribute('href', DOCS_URL);
  });

  it('is the last section of Settings, under Connections, at /settings/mcp', async () => {
    window.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'not found' }), { status: 404 }),
    ) as unknown as typeof window.fetch;
    window.history.replaceState({}, '', '/settings/mcp');
    render(
      <MemoryRouter initialEntries={['/settings/mcp']}>
        <AppProvider initial={{ mode: 'hosted', mcp: { available: true, url: HOSTED_URL } }}>
          <Routes>
            <Route path="/*" element={<DashboardApp />} />
          </Routes>
        </AppProvider>
      </MemoryRouter>,
    );

    const sections = await screen.findByRole('navigation', { name: 'Settings sections' });
    const labels = within(sections).getAllByRole('link').map((a) => a.textContent);
    expect(labels.slice(-2)).toEqual(['Connections', 'MCP']);
    expect(within(sections).getByRole('link', { name: 'MCP' })).toHaveAttribute('href', '/settings/mcp');
    expect(await screen.findByText(HOSTED_URL)).toBeInTheDocument();
  });
});
