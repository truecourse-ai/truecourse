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
import { SpecScanButton } from '../../apps/dashboard/client/src/components/spec/SpecScanButton';
import { SpecDocViewer } from '../../apps/dashboard/client/src/components/spec/SpecDocViewer';
import { SpecOverlapDetail } from '../../apps/dashboard/client/src/components/spec/SpecOverlapDetail';
import { DocMarkdown } from '../../apps/dashboard/client/src/components/spec/DocMarkdown';
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
  applyDecisions: vi.fn(),
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
    expect(screen.getAllByText('docs/v1.md')).toHaveLength(1);
    expect(screen.getAllByText('appointments').length).toBeGreaterThan(0);
    expect(screen.getByText('docs/v1.md ↔ docs/v2.md')).toBeInTheDocument();
  });

  it('distinguishes same-named docs by full repo-relative path (rows + conflict), never a bare basename', () => {
    // A corpus with two README.md's in different dirs — basenames alone would be
    // indistinguishable and the conflict would read "README.md ↔ README.md".
    const collision: SpecCorpusResponse = {
      corpus: {
        version: 3,
        generatedAt: '2026-01-01T00:00:00Z',
        docs: [
          { ref: 'a/README.md', kind: 'prd', lastTouched: '2026-01-01T00:00:00Z', areaTags: ['core/setup'] },
          { ref: 'b/README.md', kind: 'prd', lastTouched: '2026-02-01T00:00:00Z', areaTags: ['core/setup'] },
        ],
        areas: [
          {
            id: 'core/setup',
            product: 'core',
            concern: 'setup',
            docRefs: ['a/README.md', 'b/README.md'],
            overlaps: [{ docs: ['a/README.md', 'b/README.md'], note: 'both claim setup', sections: [] }],
          },
        ],
        relations: [],
      },
      userRelations: [],
    };
    render(<SpecCorpusView corpus={state({ data: collision })} activeKey={null} onOpen={vi.fn()} />);
    // Each README is labelled by its full path, so the two rows are distinct.
    expect(screen.getByText('a/README.md')).toBeInTheDocument();
    expect(screen.getByText('b/README.md')).toBeInTheDocument();
    // The conflict names both full paths, not "README.md ↔ README.md".
    expect(screen.getByText('a/README.md ↔ b/README.md')).toBeInTheDocument();
    // Never a bare basename anywhere.
    expect(screen.queryByText('README.md')).not.toBeInTheDocument();
  });

  it('opens a doc by its ref (preview on click, pin on double-click)', async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<SpecCorpusView corpus={state()} activeKey={null} onOpen={onOpen} />);
    await user.click(screen.getByText('docs/v1.md'));
    expect(onOpen).toHaveBeenCalledWith('docs/v1.md', false);
    await user.dblClick(screen.getByText('docs/v1.md'));
    expect(onOpen).toHaveBeenCalledWith('docs/v1.md', true);
  });

  it('filters BOTH documents and conflicts by tag', async () => {
    const user = userEvent.setup();
    render(<SpecCorpusView corpus={state()} activeKey={null} onOpen={vi.fn()} />);
    // All docs + the appointments conflict visible initially.
    expect(screen.getByText('docs/v1.md')).toBeInTheDocument();
    expect(screen.getByText('docs/auth.md')).toBeInTheDocument();
    expect(screen.getByText('docs/v1.md ↔ docs/v2.md')).toBeInTheDocument();
    // Filter to `auth` → only the auth doc remains; the appointments conflict is filtered out.
    await user.click(screen.getByRole('button', { name: 'auth' }));
    expect(screen.getByText('docs/auth.md')).toBeInTheDocument();
    expect(screen.queryByText('docs/v1.md')).not.toBeInTheDocument();
    expect(screen.queryByText('docs/v1.md ↔ docs/v2.md')).not.toBeInTheDocument();
    // Clear → all back.
    await user.click(screen.getByRole('button', { name: 'clear' }));
    expect(screen.getByText('docs/v1.md')).toBeInTheDocument();
    expect(screen.getByText('docs/v1.md ↔ docs/v2.md')).toBeInTheDocument();
  });

  it('opens an overlap with its overlap key', async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<SpecCorpusView corpus={state()} activeKey={null} onOpen={onOpen} />);
    await user.click(screen.getByText('docs/v1.md ↔ docs/v2.md'));
    expect(onOpen).toHaveBeenCalledWith(overlapKey('booking/appointments', 'docs/v1.md', 'docs/v2.md'), false);
  });

  it('shows the empty state when there is no corpus', () => {
    render(<SpecCorpusView corpus={state({ data: null })} activeKey={null} onOpen={vi.fn()} />);
    expect(screen.getByText('No corpus yet')).toBeInTheDocument();
  });

  // A corpus the scan re-curated so the (now relation-covered) overlap was dropped,
  // yet the user relation persists in decisions. The resolved conflict must stay
  // visible instead of vanishing.
  const noOverlapResp: SpecCorpusResponse = {
    corpus: { ...RESP.corpus, areas: RESP.corpus.areas.map((a) => ({ ...a, overlaps: [] })) },
    userRelations: [
      { type: 'precedence', older: 'docs/v1.md', newer: 'docs/v2.md', scope: 'booking/appointments', detectedFrom: 'manual' },
    ],
  };

  it('synthesizes a resolved conflict for a user relation the corpus no longer flags', () => {
    render(<SpecCorpusView corpus={state({ data: noOverlapResp })} activeKey={null} onOpen={vi.fn()} />);
    expect(screen.getByText('Conflicts')).toBeInTheDocument();
    expect(screen.getByText('docs/v1.md ↔ docs/v2.md')).toBeInTheDocument();
    // The badge names the relation type + winner (v2.md is newer).
    expect(screen.getByText('resolved — precedence: docs/v2.md wins')).toBeInTheDocument();
  });

  it('opens a synthesized resolved entry with its overlap key (no open overlap needed)', async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<SpecCorpusView corpus={state({ data: noOverlapResp })} activeKey={null} onOpen={onOpen} />);
    await user.click(screen.getByText('docs/v1.md ↔ docs/v2.md'));
    expect(onOpen).toHaveBeenCalledWith(overlapKey('booking/appointments', 'docs/v1.md', 'docs/v2.md'), false);
  });

  it('does not double-render a pair that has both an open overlap and a covering relation', () => {
    // RESP already carries an OPEN overlap for (v1,v2); a covering user relation
    // must NOT add a second synthesized row — one row, legacy "resolved" badge.
    const covered: SpecCorpusResponse = {
      ...RESP,
      userRelations: [
        { type: 'precedence', older: 'docs/v1.md', newer: 'docs/v2.md', scope: 'booking/appointments', detectedFrom: 'manual' },
      ],
    };
    render(<SpecCorpusView corpus={state({ data: covered })} activeKey={null} onOpen={vi.fn()} />);
    expect(screen.getAllByText('docs/v1.md ↔ docs/v2.md')).toHaveLength(1);
    expect(screen.getByText('resolved')).toBeInTheDocument();
    expect(screen.queryByText(/resolved — /)).not.toBeInTheDocument();
  });
});

// OSS batch model: skip/include records the decision and returns immediately (no
// re-curate). The row moves optimistically — in BOTH directions, since the section
// rows derive from the decision lists — with a "pending rescan" hint on rows the
// corpus hasn't materialized, and the parent is signalled to light the Rescan dot.
// One later Scan materializes the batch.
describe('SpecCorpusView — OSS batch skip (optimistic + pending, no scan round-trip)', () => {
  // A corpus with a relevance-dropped doc, for the include flow.
  const RESP_WITH_SKIPPED: SpecCorpusResponse = {
    ...RESP,
    corpus: { ...RESP.corpus, skippedDocs: [{ ref: 'docs/notes.md', reason: 'low relevance' }] },
  };

  let calls: { url: string; method: string }[];
  beforeEach(() => {
    calls = [];
    // A stateful decisions stub: POST adds, DELETE removes, and every mutation
    // returns the OSS ack (decision lists only, no corpus).
    let excludes: string[] = [];
    let includes: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, opts?: RequestInit) => {
        const u = String(url);
        const method = opts?.method ?? 'GET';
        calls.push({ url: u, method });
        if (u.includes('/spec/excludes')) {
          const { ref } = JSON.parse(String(opts?.body)) as { ref: string };
          excludes = method === 'POST' ? [...excludes, ref] : excludes.filter((r) => r !== ref);
          return json({ manualIncludes: includes, manualExcludes: excludes });
        }
        if (u.includes('/spec/includes')) {
          const { ref } = JSON.parse(String(opts?.body)) as { ref: string };
          includes = method === 'POST' ? [...includes, ref] : includes.filter((r) => r !== ref);
          return json({ manualIncludes: includes, manualExcludes: excludes });
        }
        // The corpus GET the hook makes on mount.
        return json(RESP_WITH_SKIPPED);
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  const corpusReads = () =>
    calls.filter((c) => c.method === 'GET' && c.url.includes('/spec/corpus')).length;

  // Uses the real hook so apply/applyDecisions actually update state (the mock
  // `state()` helper's vi.fn()s don't re-render).
  function Harness({ onDecision }: { onDecision?: () => void }) {
    const corpus = useSpecCorpus('r1', true);
    if (!corpus.data) return null;
    return <SpecCorpusView repoId="r1" corpus={corpus} activeKey={null} onOpen={() => {}} onDecision={onDecision} />;
  }

  it('moves the skipped doc to Force-excluded with a pending hint, no /spec/corpus/scan call', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await screen.findByText('docs/v1.md'); // corpus loaded
    await user.click(screen.getAllByRole('button', { name: 'skip' })[0]);

    // The doc jumps into Force-excluded (ONE row — not still in Documents too)
    // and carries the pending hint (the corpus still keeps it until a rescan).
    await screen.findByText('Force-excluded');
    expect(screen.getAllByText('docs/v1.md')).toHaveLength(1);
    expect(screen.getByText('pending rescan')).toBeInTheDocument();
    // No re-curate: the scan endpoint was never hit; only the decision POST.
    expect(calls.some((c) => c.url.includes('/spec/corpus/scan'))).toBe(false);
    expect(calls.some((c) => c.url.includes('/spec/excludes') && c.method === 'POST')).toBe(true);
  });

  it('skip then restore returns the doc to Documents — no refetch, no pending residue', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await screen.findByText('docs/v1.md');
    await user.click(screen.getAllByRole('button', { name: 'skip' })[0]);
    await screen.findByText('Force-excluded');

    // The write settles (busy clears) before the follow-up action.
    await waitFor(() => expect(screen.getByRole('button', { name: 'restore' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'restore' }));

    // The doc is back in Documents as a normal kept row; the excluded section
    // and the pending hint are gone.
    await waitFor(() => expect(screen.queryByText('Force-excluded')).not.toBeInTheDocument());
    expect(screen.getByText('docs/v1.md')).toBeInTheDocument();
    expect(screen.queryByText('pending rescan')).not.toBeInTheDocument();
    // Its skip action is live again (3 kept docs → 3 skip buttons).
    expect(screen.getAllByRole('button', { name: 'skip' })).toHaveLength(3);
    // The whole round-trip used only the mount read — no corpus refetch, no scan.
    expect(corpusReads()).toBe(1);
    expect(calls.some((c) => c.url.includes('/spec/corpus/scan'))).toBe(false);
  });

  it('include a skipped doc then undo returns it to Not included (mirror case)', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await screen.findByText('docs/notes.md'); // the relevance-dropped doc
    await user.click(screen.getByRole('button', { name: 'include' }));

    // Moves to Force-included with the pending hint (not kept until a rescan);
    // the Not included section empties away.
    await screen.findByText('Force-included');
    expect(screen.getByText('pending rescan')).toBeInTheDocument();
    expect(screen.queryByText('Not included')).not.toBeInTheDocument();

    await waitFor(() => expect(screen.getByRole('button', { name: 'remove' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'remove' }));

    // Back in Not included, no pending residue, still no refetch.
    await waitFor(() => expect(screen.queryByText('Force-included')).not.toBeInTheDocument());
    expect(screen.getByText('Not included')).toBeInTheDocument();
    expect(screen.getByText('docs/notes.md')).toBeInTheDocument();
    expect(screen.queryByText('pending rescan')).not.toBeInTheDocument();
    expect(corpusReads()).toBe(1);
  });

  it('fires onDecision so the parent can refresh the Rescan staleness dot', async () => {
    const onDecision = vi.fn();
    const user = userEvent.setup();
    render(<Harness onDecision={onDecision} />);
    await screen.findByText('docs/v1.md');
    await user.click(screen.getAllByRole('button', { name: 'skip' })[0]);
    await waitFor(() => expect(onDecision).toHaveBeenCalled());
  });
});

describe('SpecScanButton — decisions staleness dot', () => {
  it('carries the amber dot when decisions are pending', () => {
    render(<SpecScanButton hasCorpus scanning={false} stale onClick={() => {}} />);
    expect(screen.getByRole('button', { name: /rescan/i })).toBeInTheDocument();
    expect(screen.getByLabelText('pending decisions')).toBeInTheDocument();
  });

  it('shows no dot when nothing is pending', () => {
    render(<SpecScanButton hasCorpus scanning={false} stale={false} onClick={() => {}} />);
    expect(screen.queryByLabelText('pending decisions')).not.toBeInTheDocument();
  });

  it('hides the dot while scanning', () => {
    render(<SpecScanButton hasCorpus scanning stale onClick={() => {}} />);
    expect(screen.queryByLabelText('pending decisions')).not.toBeInTheDocument();
  });

  it('reads "Scan" with no corpus, "Rescan" with one', () => {
    const { rerender } = render(<SpecScanButton hasCorpus={false} scanning={false} stale={false} onClick={() => {}} />);
    expect(screen.getByRole('button', { name: /^scan/i })).toBeInTheDocument();
    rerender(<SpecScanButton hasCorpus scanning={false} stale={false} onClick={() => {}} />);
    expect(screen.getByRole('button', { name: /rescan/i })).toBeInTheDocument();
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

describe('DocMarkdown — raw HTML (rehype-raw + sanitize)', () => {
  it('renders a README HTML image block, not literal `<p align=` source text', () => {
    const { container } = render(
      <DocMarkdown source={'<p align="center"><img src="assets/logo.svg" alt="Logo"/></p>\n\n# Title'} />,
    );
    // The raw <img> becomes a real element (found by its alt), never leaked source.
    expect(screen.getByAltText('Logo').tagName).toBe('IMG');
    expect(container.textContent).not.toContain('<p align=');
    expect(container.textContent).not.toContain('<img');
  });

  it('renders a standalone `<a id>` anchor invisibly (no visible id or tag text)', () => {
    const { container } = render(<DocMarkdown source={'<a id="anchor-x"></a>\n\n## Heading'} />);
    // A real anchor element exists, but nothing user-visible leaks.
    expect(container.querySelector('a')).not.toBeNull();
    expect(container.textContent).not.toContain('anchor-x');
    expect(container.textContent).not.toContain('<a id=');
    expect(screen.getByRole('heading', { name: 'Heading' })).toBeInTheDocument();
  });

  it('sanitizes away a `<script>` embedded in a doc', () => {
    const { container } = render(<DocMarkdown source={'Intro text.\n\n<script>alert(1)</script>'} />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).not.toContain('alert(1)');
  });
});

describe('DocMarkdown — conflict highlight (amber band)', () => {
  const SRC = 'Intro tagline: C# is supported.\n\n# Title\n\nBody under the heading.';

  it('bands the preamble block (before the first heading) when highlightPreamble is set', () => {
    const { container } = render(<DocMarkdown source={SRC} highlightPreamble />);
    const band = container.querySelector('.border-amber-500');
    expect(band).not.toBeNull();
    expect(band?.textContent).toContain('Intro tagline: C# is supported.');
    // The band stops at the first heading — the Title section is not swept in.
    expect(band?.textContent).not.toContain('Body under the heading.');
  });

  it('bands a heading section (not the preamble) for a heading highlight', () => {
    const { container } = render(<DocMarkdown source={SRC} highlight={['Title']} />);
    const band = container.querySelector('.border-amber-500');
    expect(band).not.toBeNull();
    expect(band?.textContent).toContain('Body under the heading.');
    expect(band?.textContent).not.toContain('Intro tagline');
  });

  it('renders no band without a highlight or preamble marker', () => {
    const { container } = render(<DocMarkdown source={SRC} />);
    expect(container.querySelector('.border-amber-500')).toBeNull();
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

  // A synthesized pair: the corpus flags no overlap for it (re-curated away), but
  // the user relation persists — the detail still shows the resolution and Revoke
  // deletes it (the server re-curate then re-flags the conflict).
  const NO_OVERLAP_RESOLVED: SpecCorpusResponse = {
    corpus: { ...RESP.corpus, areas: RESP.corpus.areas.map((a) => ({ ...a, overlaps: [] })) },
    userRelations: [{ type: 'precedence', older: 'docs/v1.md', newer: 'docs/v2.md', scope: 'booking/appointments', detectedFrom: 'manual' }],
  };

  it('a synthesized resolved pair (no open overlap) still shows the resolution + revokes', async () => {
    const onResolved = vi.fn();
    const user = userEvent.setup();
    render(
      <SpecOverlapDetail repoId="r1" area="booking/appointments" docA="docs/v1.md" docB="docs/v2.md" data={NO_OVERLAP_RESOLVED} onResolved={onResolved} />,
    );
    expect(screen.getByText(/Resolved →/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(onResolved).toHaveBeenCalled());
    expect(lastDelete).toMatchObject({ older: 'docs/v1.md', newer: 'docs/v2.md' });
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

  it('carries pr+ref when re-resolving a synthesized pair (no open overlap)', async () => {
    const onResolved = vi.fn();
    const user = userEvent.setup();
    // No open overlap for the pair, but a user relation covers it (synthesized).
    const noOverlap: SpecCorpusResponse = {
      corpus: { ...RESP.corpus, areas: RESP.corpus.areas.map((a) => ({ ...a, overlaps: [] })) },
      userRelations: [{ type: 'precedence', older: 'docs/v1.md', newer: 'docs/v2.md', scope: 'booking/appointments', detectedFrom: 'manual' }],
    };
    render(
      <SpecOverlapDetail repoId="r1" area="booking/appointments" docA="docs/v1.md" docB="docs/v2.md" data={noOverlap} prNumber={4} prRef="head-1" onResolved={onResolved} />,
    );
    await user.click(screen.getByRole('button', { name: 'Change' })); // reveal the action buttons
    await user.click(screen.getByRole('button', { name: 'Use newer only' }));
    await waitFor(() => expect(onResolved).toHaveBeenCalled());
    expect(calls.find((c) => c.url.includes('/spec/relations') && c.method === 'POST')?.url).toContain('?pr=4&ref=head-1');
  });
});
