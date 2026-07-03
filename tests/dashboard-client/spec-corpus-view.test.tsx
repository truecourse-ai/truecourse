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
import { render, screen, waitFor, renderHook, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SpecCorpusView, useSpecCorpus, overlapKey, type SpecCorpusState } from '../../apps/dashboard/client/src/components/spec/SpecCorpusView';
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
  corpusCommit: null,
  scan: vi.fn(),
  refetch: vi.fn(),
  apply: vi.fn(),
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

// ---------------------------------------------------------------------------
// EE PR-scoping: the Spec tab keys to the viewed PR's head SHA. Reads carry the
// ref; decision mutations carry `?pr=&ref=`; a code-only PR (base fallback) is
// labelled; before the gate runs (no head SHA) decisions are disabled.
// ---------------------------------------------------------------------------

describe('useSpecCorpus (PR ref threading)', () => {
  let calls: string[];
  beforeEach(() => {
    calls = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(String(url));
        return json({ ...RESP, corpusCommit: 'base-sha' });
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('threads ref into the corpus fetch and re-fetches on ref change', async () => {
    const { result, rerender } = renderHook(({ ref }) => useSpecCorpus('r1', true, ref), {
      initialProps: { ref: 'head-1' as string | undefined },
    });
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(calls.some((u) => u.includes('/spec/corpus?ref=head-1'))).toBe(true);
    expect(result.current.corpusCommit).toBe('base-sha');
    calls.length = 0;
    rerender({ ref: 'head-2' });
    await waitFor(() => expect(calls.some((u) => u.includes('/spec/corpus?ref=head-2'))).toBe(true));
  });

  it('omits ref in repo view (byte-identical URL)', async () => {
    const { result } = renderHook(() => useSpecCorpus('r1', true, undefined));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(calls.some((u) => u.endsWith('/spec/corpus'))).toBe(true);
    expect(calls.every((u) => !u.includes('ref='))).toBe(true);
  });

  it('refetch re-reads at the current ref', async () => {
    const { result } = renderHook(() => useSpecCorpus('r1', true, 'head-9'));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    calls.length = 0;
    await act(async () => {
      await result.current.refetch();
    });
    expect(calls.some((u) => u.includes('/spec/corpus?ref=head-9'))).toBe(true);
  });
});

describe('SpecCorpusView (PR-scoped decisions)', () => {
  let calls: { url: string; method?: string }[];
  beforeEach(() => {
    calls = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, opts?: RequestInit) => {
        calls.push({ url: String(url), method: opts?.method });
        return json(RESP);
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('scopes a decision mutation to pr+ref in PR view', async () => {
    const user = userEvent.setup();
    render(<SpecCorpusView repoId="r1" corpus={state()} activeKey={null} onOpen={vi.fn()} prNumber={7} prRef="head-abc" />);
    await user.click(screen.getAllByRole('button', { name: 'skip' })[0]);
    await waitFor(() => expect(calls.some((c) => c.url.includes('/spec/excludes'))).toBe(true));
    expect(calls.find((c) => c.url.includes('/spec/excludes'))?.url).toContain('?pr=7&ref=head-abc');
  });

  it('omits pr+ref in repo view', async () => {
    const user = userEvent.setup();
    render(<SpecCorpusView repoId="r1" corpus={state()} activeKey={null} onOpen={vi.fn()} />);
    await user.click(screen.getAllByRole('button', { name: 'skip' })[0]);
    await waitFor(() => expect(calls.some((c) => c.url.includes('/spec/excludes'))).toBe(true));
    const url = calls.find((c) => c.url.includes('/spec/excludes'))?.url ?? '';
    expect(url).not.toContain('pr=');
    expect(url).not.toContain('ref=');
  });

  it('labels the base-corpus fallback when the PR changed no docs', () => {
    render(
      <SpecCorpusView
        repoId="r1"
        corpus={state({ data: { ...RESP, corpusCommit: 'base-sha' } })}
        activeKey={null}
        onOpen={vi.fn()}
        prNumber={7}
        prRef="head-abc"
      />,
    );
    expect(screen.getByText(/Showing the base spec/)).toBeInTheDocument();
  });

  it('hides the fallback label when the corpus matches the PR head', () => {
    render(
      <SpecCorpusView
        repoId="r1"
        corpus={state({ data: { ...RESP, corpusCommit: 'head-abc' } })}
        activeKey={null}
        onOpen={vi.fn()}
        prNumber={7}
        prRef="head-abc"
      />,
    );
    expect(screen.queryByText(/Showing the base spec/)).not.toBeInTheDocument();
  });

  it('disables decision actions (with a hint) before the PR gate runs', async () => {
    const user = userEvent.setup();
    render(<SpecCorpusView repoId="r1" corpus={state()} activeKey={null} onOpen={vi.fn()} prNumber={7} prRef={undefined} />);
    const skip = screen.getAllByRole('button', { name: 'skip' })[0];
    expect(skip).toBeDisabled();
    expect(screen.getAllByText('Available after the PR gate runs.').length).toBeGreaterThan(0);
    await user.click(skip);
    expect(calls.length).toBe(0);
  });
});

describe('SpecOverlapDetail (PR-scoped resolution)', () => {
  let calls: { url: string; method?: string }[];
  beforeEach(() => {
    calls = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, opts?: RequestInit) => {
        const u = String(url);
        calls.push({ url: u, method: opts?.method });
        if (u.includes('/spec/relations') && opts?.method === 'POST') {
          // PR scope re-curates + returns the full corpus; repo scope returns { relations }.
          return u.includes('pr=') ? json({ ...RESP, corpusCommit: 'head-1' }) : json({ relations: [] });
        }
        return json({ ref: 'docs/x.md', content: 'body' });
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('scopes the resolution to pr+ref and applies the returned corpus', async () => {
    const onResolved = vi.fn();
    const user = userEvent.setup();
    render(
      <SpecOverlapDetail repoId="r1" area="booking/appointments" docA="docs/v1.md" docB="docs/v2.md" data={RESP} prNumber={4} prRef="head-1" onResolved={onResolved} />,
    );
    await user.click(screen.getByRole('button', { name: 'Prefer newer' }));
    await waitFor(() => expect(onResolved).toHaveBeenCalled());
    expect(calls.find((c) => c.url.includes('/spec/relations') && c.method === 'POST')?.url).toContain('?pr=4&ref=head-1');
    // Full corpus returned → onResolved receives it (apply path, no stale refetch).
    expect(onResolved.mock.calls[0][0]).toMatchObject({ corpus: expect.anything() });
  });

  it('repo view: no pr+ref, onResolved called with no corpus (refetch path)', async () => {
    const onResolved = vi.fn();
    const user = userEvent.setup();
    render(
      <SpecOverlapDetail repoId="r1" area="booking/appointments" docA="docs/v1.md" docB="docs/v2.md" data={RESP} onResolved={onResolved} />,
    );
    await user.click(screen.getByRole('button', { name: 'Prefer newer' }));
    await waitFor(() => expect(onResolved).toHaveBeenCalled());
    const url = calls.find((c) => c.url.includes('/spec/relations') && c.method === 'POST')?.url ?? '';
    expect(url).not.toContain('pr=');
    expect(onResolved.mock.calls[0][0]).toBeUndefined();
  });

  it('disables resolution actions (with a hint) before the PR gate runs', () => {
    render(
      <SpecOverlapDetail repoId="r1" area="booking/appointments" docA="docs/v1.md" docB="docs/v2.md" data={RESP} prNumber={4} prRef={undefined} onResolved={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Prefer newer' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Use newer only' })).toBeDisabled();
    expect(screen.getAllByText('Available after the PR gate runs.').length).toBeGreaterThan(0);
  });
});
