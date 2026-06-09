/**
 * The Integrations settings page renders a connector LIST; each "Configure"
 * opens the shared right-side Drawer (same component repos use) with a
 * field-metadata-driven credential form + a Test button. Adding a connector
 * needs no page change — the server describes its fields.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import IntegrationsPage from '../../ee/packages/client/src/IntegrationsPage';

const CONNECTORS = {
  connectors: [
    {
      kind: 'confluence',
      name: 'Confluence',
      description: 'Sync a Confluence Cloud space as workspace Knowledge.',
      fields: [
        { key: 'baseUrl', label: 'Site base URL', type: 'text' },
        { key: 'spaceKey', label: 'Space key', type: 'text' },
        { key: 'accountEmail', label: 'Account email', type: 'email' },
        { key: 'apiToken', label: 'API token', type: 'password', secret: true },
      ],
      connection: null,
    },
  ],
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify(CONNECTORS), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    ),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('IntegrationsPage', () => {
  it('lists connectors with a Configure button (no per-connector form on the page)', async () => {
    render(<IntegrationsPage />);
    expect(await screen.findByText('Confluence')).toBeInTheDocument();
    expect(screen.getByText('Not connected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Configure' })).toBeInTheDocument();
  });

  it('Configure opens the drawer with the field form + Test button', async () => {
    const user = userEvent.setup();
    render(<IntegrationsPage />);
    await user.click(await screen.findByRole('button', { name: 'Configure' }));

    expect(await screen.findByText('Configure Confluence')).toBeInTheDocument();
    expect(screen.getByText('Site base URL')).toBeInTheDocument();
    expect(screen.getByText('API token')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Test connection/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Save/ })).toBeInTheDocument();
  });
});
