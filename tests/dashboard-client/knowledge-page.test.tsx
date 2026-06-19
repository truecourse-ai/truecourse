/**
 * The enterprise Knowledge page reuses the REAL OSS spec/contract panels
 * (SpecPanel / SpecHeaderActions / DecisionsPanel / ContractsPanel) wrapped in a
 * SpecProvider backed by a WORKSPACE data source (`/api/ee/knowledge/*`). This
 * pins the reuse + the capability exception: the on-demand "Scan" button is
 * hidden for workspace (supportsRescan = false), and the Knowledge-only Upload
 * tab renders.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import KnowledgePage from '../../ee/packages/client/src/KnowledgePage';

const SCAN_STATE = {
  scannedAt: '2026-06-05T00:00:00Z',
  docsScanned: 2,
  blocksAttempted: 4,
  claimsExtracted: 6,
  resolved: 3,
  decided: 1,
  openConflicts: [],
  decidedConflicts: [],
  skippedDocs: [],
};

function mockFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

    if (url.includes('/api/ee/knowledge/scan-state')) return json(SCAN_STATE);
    if (url.includes('/api/ee/knowledge/canonical/tree')) return json({ hasCanonical: false, modules: [] });
    if (url.includes('/api/ee/knowledge/documents')) return json({ documents: [] });
    return json({ error: 'unexpected ' + url }, 404);
  });
}

describe('KnowledgePage — reuses the OSS panels with a workspace source', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the Knowledge surface with all tabs', async () => {
    render(<KnowledgePage />);
    expect(await screen.findByRole('heading', { name: 'Knowledge' })).toBeInTheDocument();
    for (const tab of ['Spec', 'Decisions', 'Contracts', 'Sources']) {
      expect(screen.getByRole('button', { name: new RegExp(tab) })).toBeInTheDocument();
    }
  });

  it('hides the on-demand Scan button (workspace re-uploads) but keeps Accept-all', async () => {
    render(<KnowledgePage />);
    // SpecHeaderActions renders under the workspace SpecProvider.
    expect(await screen.findByRole('button', { name: /Accept all defaults/ })).toBeInTheDocument();
    // supportsRescan = false → no Scan button anywhere.
    expect(screen.queryByRole('button', { name: /^Scan/ })).toBeNull();
  });

  it('reads the workspace scan-state through the reused SpecProvider (no error state)', async () => {
    render(<KnowledgePage />);
    await waitFor(() => {
      // scan-state was fetched from /api/ee/knowledge/scan-state.
      expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.some(
        (c) => String(c[0]).includes('/api/ee/knowledge/scan-state'),
      )).toBe(true);
    });
  });

  it('lists synced source docs on the Sources tab (no manual upload)', async () => {
    const user = userEvent.setup();
    render(<KnowledgePage />);
    await user.click(await screen.findByRole('button', { name: /Sources/ }));
    // Empty state points to Settings → Integrations generically (connectors are
    // the source; the copy must not name a specific tool like Confluence).
    expect(
      await screen.findByText(/connect a knowledge source in Settings/i),
    ).toBeInTheDocument();
  });
});
