/**
 * Corpus Spec tab (spec-scan redesign), client side:
 *  - SpecCorpusView = the LEFT NAV (areas → docs + overlaps); selecting a row
 *    calls onOpen(key) so the page opens it in the right pane (?spec=).
 *  - SpecDocViewer = right-pane markdown for a doc.
 *  - SpecOverlapDetail = right-pane resolution; recording a relation calls
 *    postSpecRelation then onResolved.
 * Backend stubbed at the fetch boundary.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SpecCorpusView, overlapKey, type SpecCorpusState } from '../../apps/dashboard/client/src/components/spec/SpecCorpusView';
import { SpecDocViewer } from '../../apps/dashboard/client/src/components/spec/SpecDocViewer';
import { SpecOverlapDetail } from '../../apps/dashboard/client/src/components/spec/SpecOverlapDetail';
import type { SpecCorpusResponse } from '../../apps/dashboard/client/src/lib/api';

const RESP: SpecCorpusResponse = {
  corpus: {
    version: 3,
    generatedAt: '2026-01-01T00:00:00Z',
    docs: [
      { ref: 'docs/v1.md', kind: 'prd', lastTouched: '2026-01-01T00:00:00Z', areaTags: ['booking/appointments'] },
      { ref: 'docs/v2.md', kind: 'prd', lastTouched: '2026-02-01T00:00:00Z', areaTags: ['booking/appointments'] },
      { ref: 'docs/auth.md', kind: 'adr', lastTouched: '2026-03-01T00:00:00Z', areaTags: ['booking/auth'] },
    ],
    areas: [
      {
        id: 'booking/appointments',
        product: 'booking',
        concern: 'appointments',
        docRefs: ['docs/v1.md', 'docs/v2.md'],
        overlaps: [
          {
            docs: ['docs/v1.md', 'docs/v2.md'],
            note: '24h vs 48h cancellation',
            sections: [
              { doc: 'docs/v1.md', heading: 'Cancellation' },
              { doc: 'docs/v2.md', heading: 'Cancellation policy' },
            ],
          },
        ],
      },
      { id: 'booking/auth', product: 'booking', concern: 'auth', docRefs: ['docs/auth.md'], overlaps: [] },
    ],
    relations: [],
  },
  userRelations: [],
};

const state = (over: Partial<SpecCorpusState> = {}): SpecCorpusState => ({
  data: RESP,
  hydrating: false,
  scanning: false,
  error: null,
  scan: vi.fn(),
  refetch: vi.fn(),
  noChangesNotice: false,
  dismissNoChanges: vi.fn(),
  ...over,
});

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

describe('SpecCorpusView (left nav)', () => {
  it('lists docs once (flat) with area-tag badges + a Conflicts section', () => {
    render(<SpecCorpusView corpus={state()} activeKey={null} onOpen={vi.fn()} />);
    expect(screen.getByText('Documents')).toBeInTheDocument();
    expect(screen.getByText('Conflicts')).toBeInTheDocument();
    // doc shown ONCE; its area tag is a badge (single-product → concern only)
    expect(screen.getAllByText('v1.md')).toHaveLength(1);
    expect(screen.getAllByText('appointments').length).toBeGreaterThan(0);
    expect(screen.getByText('v1.md ↔ v2.md')).toBeInTheDocument();
  });

  it('opens a doc by its ref (preview on click, pin on double-click)', async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<SpecCorpusView corpus={state()} activeKey={null} onOpen={onOpen} />);
    await user.click(screen.getByText('v1.md'));
    expect(onOpen).toHaveBeenCalledWith('docs/v1.md', false);
    await user.dblClick(screen.getByText('v1.md'));
    expect(onOpen).toHaveBeenCalledWith('docs/v1.md', true);
  });

  it('filters BOTH documents and conflicts by tag', async () => {
    const user = userEvent.setup();
    render(<SpecCorpusView corpus={state()} activeKey={null} onOpen={vi.fn()} />);
    // All docs + the appointments conflict visible initially.
    expect(screen.getByText('v1.md')).toBeInTheDocument();
    expect(screen.getByText('auth.md')).toBeInTheDocument();
    expect(screen.getByText('v1.md ↔ v2.md')).toBeInTheDocument();
    // Filter to `auth` → only the auth doc remains; the appointments conflict is filtered out.
    await user.click(screen.getByRole('button', { name: 'auth' }));
    expect(screen.getByText('auth.md')).toBeInTheDocument();
    expect(screen.queryByText('v1.md')).not.toBeInTheDocument();
    expect(screen.queryByText('v1.md ↔ v2.md')).not.toBeInTheDocument();
    // Clear → all back.
    await user.click(screen.getByRole('button', { name: 'clear' }));
    expect(screen.getByText('v1.md')).toBeInTheDocument();
    expect(screen.getByText('v1.md ↔ v2.md')).toBeInTheDocument();
  });

  it('opens an overlap with its overlap key', async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<SpecCorpusView corpus={state()} activeKey={null} onOpen={onOpen} />);
    await user.click(screen.getByText('v1.md ↔ v2.md'));
    expect(onOpen).toHaveBeenCalledWith(overlapKey('booking/appointments', 'docs/v1.md', 'docs/v2.md'), false);
  });

  it('shows the empty state when there is no corpus', () => {
    render(<SpecCorpusView corpus={state({ data: null })} activeKey={null} onOpen={vi.fn()} />);
    expect(screen.getByText('No corpus yet')).toBeInTheDocument();
  });

  it('shows the "no spec changes" notice after a no-op rescan', () => {
    render(<SpecCorpusView corpus={state({ noChangesNotice: true })} activeKey={null} onOpen={vi.fn()} />);
    expect(screen.getByText('No spec changes')).toBeInTheDocument();
  });

  it('hides the notice when there were changes', () => {
    render(<SpecCorpusView corpus={state({ noChangesNotice: false })} activeKey={null} onOpen={vi.fn()} />);
    expect(screen.queryByText('No spec changes')).not.toBeInTheDocument();
  });
});

describe('SpecDocViewer (right pane)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ ref: 'docs/v2.md', content: '# v2\n48h window.' })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('renders the doc markdown', async () => {
    render(<SpecDocViewer repoId="r1" docRef="docs/v2.md" />);
    expect(await screen.findByText('48h window.')).toBeInTheDocument();
  });
});

describe('SpecOverlapDetail (right pane)', () => {
  let lastPost: { type: string; older: string; newer: string } | null;
  let lastDelete: { older: string; newer: string } | null;
  beforeEach(() => {
    lastPost = null;
    lastDelete = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, opts?: RequestInit) => {
        if (String(url).includes('/spec/relations') && opts?.method === 'POST') {
          lastPost = JSON.parse(String(opts.body));
          return json({ relations: [lastPost] });
        }
        if (String(url).includes('/spec/relations') && opts?.method === 'DELETE') {
          lastDelete = JSON.parse(String(opts.body));
          return json({ relations: [] });
        }
        return json({ ref: 'docs/x.md', content: 'body' });
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  const RESOLVED: SpecCorpusResponse = {
    ...RESP,
    userRelations: [{ type: 'precedence', older: 'docs/v1.md', newer: 'docs/v2.md', scope: 'booking/appointments', detectedFrom: 'manual' }],
  };

  const renderDetail = (onResolved = vi.fn()) =>
    render(
      <SpecOverlapDetail repoId="r1" area="booking/appointments" docA="docs/v1.md" docB="docs/v2.md" data={RESP} onResolved={onResolved} />,
    );

  it('"Prefer newer" records precedence with the newer doc winning', async () => {
    const onResolved = vi.fn();
    const user = userEvent.setup();
    renderDetail(onResolved); // v2.md is newer (later lastTouched)
    expect(screen.getByText('24h vs 48h cancellation')).toBeInTheDocument(); // plain-text note
    await user.click(screen.getByRole('button', { name: 'Prefer newer' }));
    await waitFor(() => expect(onResolved).toHaveBeenCalled());
    expect(lastPost).toMatchObject({ type: 'precedence', older: 'docs/v1.md', newer: 'docs/v2.md' });
  });

  it('"Use older only" lets the OLDER doc win (one click, no toggle)', async () => {
    const user = userEvent.setup();
    renderDetail();
    await user.click(screen.getByRole('button', { name: 'Use older only' }));
    await waitFor(() => expect(lastPost).not.toBeNull());
    expect(lastPost).toMatchObject({ type: 'replace', older: 'docs/v2.md', newer: 'docs/v1.md' });
  });

  it('a resolved conflict is actionable — Revoke removes the user relation', async () => {
    const onResolved = vi.fn();
    const user = userEvent.setup();
    render(
      <SpecOverlapDetail repoId="r1" area="booking/appointments" docA="docs/v1.md" docB="docs/v2.md" data={RESOLVED} onResolved={onResolved} />,
    );
    expect(screen.getByText(/Resolved →/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(onResolved).toHaveBeenCalled());
    expect(lastDelete).toMatchObject({ older: 'docs/v1.md', newer: 'docs/v2.md' });
  });

  it('a resolved conflict is actionable — Change re-opens the buttons', async () => {
    const user = userEvent.setup();
    render(
      <SpecOverlapDetail repoId="r1" area="booking/appointments" docA="docs/v1.md" docB="docs/v2.md" data={RESOLVED} onResolved={vi.fn()} />,
    );
    expect(screen.queryByRole('button', { name: 'Prefer newer' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Change' }));
    expect(screen.getByRole('button', { name: 'Prefer newer' })).toBeInTheDocument();
  });
});
