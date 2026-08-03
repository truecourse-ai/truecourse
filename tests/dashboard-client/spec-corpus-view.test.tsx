/**
 * Corpus Spec tab (spec-scan redesign), client side:
 *  - SpecCorpusView = the LEFT NAV (areas → docs + overlaps); selecting a row
 *    calls onOpen(key) so the page opens it in the right pane (?spec=).
 *  - SpecDocViewer = right-pane markdown for a doc.
 *  - SpecOverlapDetail = right-pane resolution; recording a section verdict
 *    calls postSpecConflictResolution then onResolved.
 * Backend stubbed at the fetch boundary.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useState, type ComponentProps } from 'react';
import { render, screen, waitFor, renderHook, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SpecCorpusView, useSpecCorpus, overlapKey, type SpecCorpusState } from '../../apps/dashboard/client/src/components/spec/SpecCorpusView';
import { SpecScanButton } from '../../apps/dashboard/client/src/components/spec/SpecScanButton';
import { SpecDocViewer } from '../../apps/dashboard/client/src/components/spec/SpecDocViewer';
import { SpecOverlapDetail } from '../../apps/dashboard/client/src/components/spec/SpecOverlapDetail';
import { DocMarkdown } from '../../apps/dashboard/client/src/components/spec/DocMarkdown';
import type { SpecCorpusResponse, SpecOverlapReview } from '../../apps/dashboard/client/src/lib/api';

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
  },
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
  applyConflictResolutions: vi.fn(),
  ...over,
});

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

/** RESP with a verify-judge review attached to the appointments overlap. */
const withReview = (review: SpecOverlapReview): SpecCorpusResponse => ({
  ...RESP,
  corpus: {
    ...RESP.corpus,
    areas: RESP.corpus.areas.map((ar) =>
      ar.overlaps.length ? { ...ar, overlaps: ar.overlaps.map((o) => ({ ...o, review })) } : ar,
    ),
  },
});

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
      },
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

  it('renders a corpus carrying a legacy `relations` field without displaying it or crashing', () => {
    // Corpora scanned before relation-detection was removed may still carry a
    // `relations` array. The view must ignore it entirely — render normally, no
    // relation surface.
    const legacy = {
      ...RESP,
      corpus: {
        ...RESP.corpus,
        relations: [
          { type: 'replace', older: 'docs/v1.md', newer: 'docs/v2.md', scope: 'booking/appointments', detectedFrom: 'manual' },
        ],
      },
    } as unknown as SpecCorpusResponse;
    render(<SpecCorpusView corpus={state({ data: legacy })} activeKey={null} onOpen={vi.fn()} />);
    // The corpus still renders its docs + conflicts.
    expect(screen.getByText('Documents')).toBeInTheDocument();
    expect(screen.getByText('docs/v1.md ↔ docs/v2.md')).toBeInTheDocument();
    // Nothing from the legacy relation leaks into the UI.
    expect(screen.queryByText(/replace/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/relation/i)).not.toBeInTheDocument();
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
    // The Not-included section starts collapsed — expand it to reach the row.
    await user.click(await screen.findByText('Not included'));
    await screen.findByText('docs/notes.md'); // the relevance-dropped doc
    await user.click(screen.getByRole('button', { name: 'include' }));

    // Moves to Force-included with the pending hint (not kept until a rescan);
    // the Not included section empties away.
    await screen.findByText('Force-included');
    expect(screen.getByText('pending rescan')).toBeInTheDocument();
    expect(screen.queryByText('Not included')).not.toBeInTheDocument();

    await waitFor(() => expect(screen.getByRole('button', { name: 'remove' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'remove' }));

    // Back in Not included (freshly remounted → collapsed again), no pending
    // residue, still no refetch.
    await waitFor(() => expect(screen.queryByText('Force-included')).not.toBeInTheDocument());
    await user.click(screen.getByText('Not included'));
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

// Default collapse states, decided ONCE when the corpus data first becomes
// available (sections mount only after the async load): "Not included" starts
// collapsed; "Conflicts" starts collapsed only when nothing is open (the shared
// derivation's classification). A section CONTAINING the active selection starts
// expanded regardless — a deep link never lands on a hidden row. Manual toggles
// always win afterwards.
describe('SpecCorpusView — section default collapse states', () => {
  const WITH_SKIPPED: SpecCorpusResponse = {
    ...RESP,
    corpus: { ...RESP.corpus, skippedDocs: [{ ref: 'docs/notes.md', reason: 'low relevance' }] },
  };
  // Every flagged conflict verdict-resolved at load.
  const ALL_RESOLVED: SpecCorpusResponse = {
    ...RESP,
    conflictResolutions: [
      { docA: 'docs/v1.md', anchorA: 'Cancellation', docB: 'docs/v2.md', anchorB: 'Cancellation policy', verdict: 'a' },
    ],
  };

  it('"Not included" starts collapsed; expanding reveals the rows', async () => {
    const user = userEvent.setup();
    render(<SpecCorpusView repoId="r1" corpus={state({ data: WITH_SKIPPED })} activeKey={null} onOpen={vi.fn()} />);
    expect(screen.getByText('Not included')).toBeInTheDocument();
    expect(screen.queryByText('docs/notes.md')).not.toBeInTheDocument();
    await user.click(screen.getByText('Not included'));
    expect(screen.getByText('docs/notes.md')).toBeInTheDocument();
  });

  it('"Conflicts" starts collapsed when every conflict is resolved at load', async () => {
    const user = userEvent.setup();
    render(<SpecCorpusView repoId="r1" corpus={state({ data: ALL_RESOLVED })} activeKey={null} onOpen={vi.fn()} />);
    expect(screen.getByText('Conflicts')).toBeInTheDocument();
    expect(screen.queryByText('docs/v1.md ↔ docs/v2.md')).not.toBeInTheDocument();
    // The manual toggle still works — expanding shows the resolved row.
    await user.click(screen.getByText('Conflicts'));
    expect(screen.getByText('docs/v1.md ↔ docs/v2.md')).toBeInTheDocument();
    expect(screen.getByText('Resolved')).toBeInTheDocument();
  });

  it('"Conflicts" starts OPEN when an open conflict exists at load', () => {
    render(<SpecCorpusView repoId="r1" corpus={state()} activeKey={null} onOpen={vi.fn()} />);
    expect(screen.getByText('docs/v1.md ↔ docs/v2.md')).toBeInTheDocument();
  });

  it('deep link to a skipped doc → "Not included" starts EXPANDED with the row highlighted', () => {
    render(
      <SpecCorpusView repoId="r1" corpus={state({ data: WITH_SKIPPED })} activeKey="docs/notes.md" onOpen={vi.fn()} />,
    );
    // The active row is visible without any manual expand…
    const row = screen.getByTitle(/docs\/notes\.md/);
    expect(row).toBeInTheDocument();
    // …and carries the active highlight (the same match the containment check uses).
    expect(row.className).toContain('bg-primary/10');
  });

  it('deep link to a resolved conflict → "Conflicts" starts EXPANDED despite the all-resolved default', () => {
    render(
      <SpecCorpusView
        repoId="r1"
        corpus={state({ data: ALL_RESOLVED })}
        activeKey={overlapKey('booking/appointments', 'docs/v1.md', 'docs/v2.md')}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText('docs/v1.md ↔ docs/v2.md')).toBeInTheDocument();
    expect(screen.getByText('Resolved')).toBeInTheDocument();
  });

  it('a manual expand of "Not included" survives a data refetch', async () => {
    // Holds the corpus data in state, mirroring useSpecCorpus: a refetch replaces
    // the data object while SpecCorpusView stays mounted — the section's manual
    // toggle must survive (initialize-once, never re-forced).
    function RefetchHarness() {
      const [data, setData] = useState<SpecCorpusResponse>(WITH_SKIPPED);
      return (
        <>
          <button type="button" onClick={() => setData({ ...WITH_SKIPPED, corpus: { ...WITH_SKIPPED.corpus } })}>
            simulate-refetch
          </button>
          <SpecCorpusView repoId="r1" corpus={state({ data })} activeKey={null} onOpen={vi.fn()} />
        </>
      );
    }
    const user = userEvent.setup();
    render(<RefetchHarness />);
    await user.click(screen.getByText('Not included')); // manual expand
    expect(screen.getByText('docs/notes.md')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'simulate-refetch' }));
    // New data object, same mounted section — still expanded.
    expect(screen.getByText('docs/notes.md')).toBeInTheDocument();
  });
});

describe('SpecCorpusView — conflict verdicts', () => {
  const verdict = (v: 'a' | 'b' | 'dismissed') => ({
    docA: 'docs/v1.md',
    anchorA: 'Cancellation',
    docB: 'docs/v2.md',
    anchorB: 'Cancellation policy',
    verdict: v,
  });

  it('a pick-a-side verdict shows only the "Resolved" status badge on the conflict row', async () => {
    const data: SpecCorpusResponse = { ...RESP, conflictResolutions: [verdict('a')] };
    render(<SpecCorpusView repoId="r1" corpus={state({ data })} activeKey={null} onOpen={vi.fn()} />);
    // All conflicts resolved → the section starts collapsed; expand to see the badge.
    await userEvent.setup().click(screen.getByText('Conflicts'));
    expect(screen.getByText('docs/v1.md ↔ docs/v2.md')).toBeInTheDocument();
    expect(screen.getByText('Resolved')).toBeInTheDocument();
    // The verdict itself ("<winner> is right") is detail-only — not on the list row.
    expect(screen.queryByText(/is right/)).not.toBeInTheDocument();
  });

  it('a dismissal shows only the "Resolved" status badge on the conflict row', async () => {
    const data: SpecCorpusResponse = { ...RESP, conflictResolutions: [verdict('dismissed')] };
    render(<SpecCorpusView repoId="r1" corpus={state({ data })} activeKey={null} onOpen={vi.fn()} />);
    await userEvent.setup().click(screen.getByText('Conflicts'));
    expect(screen.getByText('Resolved')).toBeInTheDocument();
    expect(screen.queryByText('dismissed')).not.toBeInTheDocument();
  });

  it('a conflict row stays quiet — no conflict message and no verified chip, reviewed or not', () => {
    const data = withReview({
      explanation: 'Both docs specify a cancellation window and they disagree.',
      recommendation: { action: 'pick-a', rationale: 'v1 is the current source of truth.' },
    });
    render(<SpecCorpusView repoId="r1" corpus={state({ data })} activeKey={null} onOpen={vi.fn()} />);
    // The message lives in the detail pane; the row shows neither the explanation
    // nor the detector note, and no verified affordance.
    expect(screen.queryByText('Both docs specify a cancellation window and they disagree.')).not.toBeInTheDocument();
    expect(screen.queryByText('24h vs 48h cancellation')).not.toBeInTheDocument();
    expect(screen.queryByText('verified')).not.toBeInTheDocument();
  });

  it('renders NO orphaned-verdict block — a stranded verdict is pruned by the scan', () => {
    // A verdict matching no flagged conflict is removed from decisions.json by the
    // scan that wrote the corpus (curate()), so the view has nothing to surface: no
    // housekeeping list, no count line, no remove action.
    const orphan = { docA: 'docs/gone.md', anchorA: 'X', docB: 'docs/moved.md', anchorB: 'Y', verdict: 'a' as const };
    const data: SpecCorpusResponse = { ...RESP, conflictResolutions: [orphan] };
    render(<SpecCorpusView repoId="r1" corpus={state({ data })} activeKey={null} onOpen={vi.fn()} onDecision={vi.fn()} />);
    expect(screen.queryByText(/no longer match a conflict/)).not.toBeInTheDocument();
    expect(screen.queryByText('docs/gone.md ↔ docs/moved.md')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'remove' })).not.toBeInTheDocument();
  });
});

describe('SpecScanButton — staleness dot (decisions OR doc edits)', () => {
  it('carries the amber dot when decisions are pending', () => {
    render(<SpecScanButton hasCorpus scanning={false} decisionsPending docsChanged={false} onClick={() => {}} />);
    expect(screen.getByRole('button', { name: /rescan/i })).toBeInTheDocument();
    expect(screen.getByLabelText('rescan pending')).toBeInTheDocument();
  });

  it('carries the dot when a kept doc changed since the last scan (docsChanged)', () => {
    render(<SpecScanButton hasCorpus scanning={false} decisionsPending={false} docsChanged onClick={() => {}} />);
    expect(screen.getByLabelText('rescan pending')).toBeInTheDocument();
  });

  it('shows no dot when nothing is pending or changed', () => {
    render(<SpecScanButton hasCorpus scanning={false} decisionsPending={false} docsChanged={false} onClick={() => {}} />);
    expect(screen.queryByLabelText('rescan pending')).not.toBeInTheDocument();
  });

  it('hides the dot while scanning', () => {
    render(<SpecScanButton hasCorpus scanning decisionsPending docsChanged onClick={() => {}} />);
    expect(screen.queryByLabelText('rescan pending')).not.toBeInTheDocument();
  });

  it('reads "Scan" with no corpus, "Rescan" with one', () => {
    const { rerender } = render(
      <SpecScanButton hasCorpus={false} scanning={false} decisionsPending={false} docsChanged={false} onClick={() => {}} />,
    );
    expect(screen.getByRole('button', { name: /^scan/i })).toBeInTheDocument();
    rerender(<SpecScanButton hasCorpus scanning={false} decisionsPending={false} docsChanged={false} onClick={() => {}} />);
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

  // The common README shape: an H1 title on line 1 means there is NO content
  // before the first heading, so a preamble pointer must band the opening
  // heading's own section (H1 line + intro paragraph up to the next heading).
  const H1_LEAD = '# taskline\n\nA CLI task tracker. C# is supported.\n\n## Install\n\nRun the installer.';

  it('bands the opening H1 section (title + intro) for a preamble marker when the doc has no pre-heading content', () => {
    const { container } = render(<DocMarkdown source={H1_LEAD} highlightPreamble />);
    const band = container.querySelector('.border-amber-500');
    expect(band).not.toBeNull();
    // The disputed intro paragraph — the whole point of the fix — is inside the band.
    expect(band?.textContent).toContain('A CLI task tracker. C# is supported.');
    // The H1 title line is part of the lead and stays inside the band.
    expect(band?.textContent).toContain('taskline');
    // The band stops at the next heading — the Install section is not swept in.
    expect(band?.textContent).not.toContain('Run the installer.');
  });

  it('still bands a real preamble block (content before any heading) — original shape unchanged', () => {
    const { container } = render(<DocMarkdown source={SRC} highlightPreamble />);
    const band = container.querySelector('.border-amber-500');
    expect(band?.textContent).toContain('Intro tagline: C# is supported.');
    expect(band?.textContent).not.toContain('Body under the heading.');
  });

  it('bands some visible region (no crash) for the empty-lead edge — H1 immediately followed by H2', () => {
    const { container } = render(
      <DocMarkdown source={'# Title\n## Install\n\nRun the installer.'} highlightPreamble />,
    );
    const band = container.querySelector('.border-amber-500');
    expect(band).not.toBeNull();
    // The empty lead falls back to the H1 line itself, never zero highlight.
    expect(band?.textContent).toContain('Title');
    expect(band?.textContent).not.toContain('Run the installer.');
  });

  it('leaves heading-pointer highlights unchanged even when the doc opens with an H1', () => {
    const { container } = render(<DocMarkdown source={H1_LEAD} highlight={['Install']} />);
    const band = container.querySelector('.border-amber-500');
    expect(band).not.toBeNull();
    expect(band?.textContent).toContain('Run the installer.');
    // No preamble marker ⇒ the opening H1 lead is not banded.
    expect(band?.textContent).not.toContain('A CLI task tracker');
  });
});

describe('SpecOverlapDetail (right pane) — section verdicts', () => {
  let lastPost: Record<string, unknown> | null;
  let lastDelete: Record<string, unknown> | null;
  beforeEach(() => {
    lastPost = null;
    lastDelete = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, opts?: RequestInit) => {
        const u = String(url);
        if (u.includes('/spec/conflict-resolution') && opts?.method === 'POST') {
          lastPost = JSON.parse(String(opts.body));
          return json({ conflictResolutions: [{ ...lastPost, resolvedAt: '2026-07-10T00:00:00Z' }] });
        }
        if (u.includes('/spec/conflict-resolution') && opts?.method === 'DELETE') {
          lastDelete = JSON.parse(String(opts.body));
          return json({ conflictResolutions: [] });
        }
        // The doc columns' markdown fetch.
        return json({ ref: 'docs/x.md', content: 'body' });
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  const renderDetail = (props: Partial<ComponentProps<typeof SpecOverlapDetail>> = {}) =>
    render(
      <SpecOverlapDetail
        repoId="r1"
        area="booking/appointments"
        docA="docs/v1.md"
        docB="docs/v2.md"
        data={RESP}
        onResolved={vi.fn()}
        {...props}
      />,
    );

  it('renders the three verdicts — "<docA> is right" / "<docB> is right" / dismiss — and NO relation buttons', () => {
    renderDetail();
    expect(screen.getByRole('button', { name: 'docs/v1.md is right' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'docs/v2.md is right' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Not a real conflict' })).toBeInTheDocument();
    // The old doc-relation buttons are gone from this view.
    expect(screen.queryByRole('button', { name: 'Prefer newer' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use newer only' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Keep both' })).not.toBeInTheDocument();
    // No in-app editor — a one-line hint points at the fix-the-doc-and-rescan path.
    expect(screen.getByText(/Or fix the doc itself and rescan/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Edit section')).not.toBeInTheDocument();
  });

  it('a pick-a-side verdict POSTs the resolution and renders resolved-in-place with Undo', async () => {
    const onConflictChange = vi.fn();
    const onDecision = vi.fn();
    const user = userEvent.setup();
    renderDetail({ onConflictChange, onDecision });
    expect(screen.getByText('24h vs 48h cancellation')).toBeInTheDocument(); // plain-text note
    await user.click(screen.getByRole('button', { name: 'docs/v1.md is right' }));
    // POST carries the pair + section anchors + verdict 'a' (docA wins).
    await waitFor(() => expect(lastPost).not.toBeNull());
    expect(lastPost).toMatchObject({
      docA: 'docs/v1.md',
      anchorA: 'Cancellation',
      docB: 'docs/v2.md',
      anchorB: 'Cancellation policy',
      verdict: 'a',
    });
    // Resolved-in-place (optimistic) with the winner + an Undo; the verdict buttons are gone.
    const banner = screen.getByTestId('conflict-verdict');
    expect(within(banner).getByText(/Resolved —/)).toBeInTheDocument();
    expect(within(banner).getAllByText('docs/v1.md').length).toBeGreaterThan(0); // docA won (verdict 'a')
    expect(within(banner).queryByText('docs/v2.md')).toBeNull();
    expect(within(banner).getByRole('button', { name: /Undo/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'docs/v2.md is right' })).not.toBeInTheDocument();
    // The parent is synced (verdict list) and the Rescan dot is signalled.
    expect(onConflictChange).toHaveBeenCalledWith([expect.objectContaining({ verdict: 'a' })]);
    expect(onDecision).toHaveBeenCalled();
  });

  it('a dismissal POSTs verdict "dismissed" and renders "Dismissed — not a real conflict"', async () => {
    const user = userEvent.setup();
    renderDetail();
    await user.click(screen.getByRole('button', { name: 'Not a real conflict' }));
    await waitFor(() => expect(lastPost).not.toBeNull());
    expect(lastPost).toMatchObject({ verdict: 'dismissed' });
    expect(screen.getByText('Dismissed — not a real conflict')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Undo/ })).toBeInTheDocument();
  });

  it('Undo DELETEs the verdict and restores the action buttons', async () => {
    const user = userEvent.setup();
    renderDetail();
    await user.click(screen.getByRole('button', { name: 'docs/v1.md is right' }));
    await screen.findByRole('button', { name: /Undo/ });
    await user.click(screen.getByRole('button', { name: /Undo/ }));
    await waitFor(() => expect(lastDelete).not.toBeNull());
    expect(lastDelete).toMatchObject({ docA: 'docs/v1.md', anchorA: 'Cancellation', docB: 'docs/v2.md' });
    // The verdict buttons are back.
    expect(screen.getByRole('button', { name: 'docs/v1.md is right' })).toBeInTheDocument();
  });

  it('renders resolved-in-place from data (derived, no click) when a verdict already covers the pair', () => {
    const resolved: SpecCorpusResponse = {
      ...RESP,
      conflictResolutions: [
        { docA: 'docs/v1.md', anchorA: 'Cancellation', docB: 'docs/v2.md', anchorB: 'Cancellation policy', verdict: 'b' },
      ],
    };
    renderDetail({ data: resolved });
    // verdict 'b' → docB wins.
    const banner = screen.getByTestId('conflict-verdict');
    expect(within(banner).getByText(/Resolved —/)).toBeInTheDocument();
    expect(within(banner).getAllByText('docs/v2.md').length).toBeGreaterThan(0); // docB won (verdict 'b')
    expect(within(banner).queryByText('docs/v1.md')).toBeNull();
    expect(screen.queryByRole('button', { name: 'docs/v1.md is right' })).not.toBeInTheDocument();
  });
});

// The verify judge's assessment (issue: reviewed conflicts). The detail pane
// leads with it: reasoning and recommendation TOGETHER in one card above the doc
// panes, the "Apply recommendation" shortcut wired inside it running the SAME
// verdict action as the manual controls. `fix-doc` gets no apply button — only
// the copyable fix text. Absent `review` renders byte-identically to before.
describe('SpecOverlapDetail (right pane) — reviewed conflicts', () => {
  let lastPost: Record<string, unknown> | null;
  beforeEach(() => {
    lastPost = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, opts?: RequestInit) => {
        const u = String(url);
        if (u.includes('/spec/conflict-resolution') && opts?.method === 'POST') {
          lastPost = JSON.parse(String(opts.body));
          return json({ conflictResolutions: [{ ...lastPost, resolvedAt: '2026-07-10T00:00:00Z' }] });
        }
        return json({ ref: 'docs/x.md', content: 'body' });
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  const renderDetail = (data: SpecCorpusResponse, props: Partial<ComponentProps<typeof SpecOverlapDetail>> = {}) =>
    render(
      <SpecOverlapDetail
        repoId="r1"
        area="booking/appointments"
        docA="docs/v1.md"
        docB="docs/v2.md"
        data={data}
        onResolved={vi.fn()}
        {...props}
      />,
    );

  it('renders the reasoning + the recommendation label and rationale inside ONE assessment card', () => {
    renderDetail(
      withReview({
        explanation: 'The two docs disagree on the cancellation window (24h vs 48h).',
        recommendation: { action: 'pick-a', rationale: 'v1 is the newer, authoritative policy.' },
      }),
    );
    expect(screen.queryByText('Resolution brief')).not.toBeInTheDocument();
    // The assessment REPLACES the detector note — never both.
    expect(screen.queryByText('24h vs 48h cancellation')).not.toBeInTheDocument();
    // Reasoning, recommendation caption, action label and rationale all live in
    // the ONE card — never split across the pane.
    const card = screen.getByTestId('conflict-assessment');
    expect(within(card).getByText('The two docs disagree on the cancellation window (24h vs 48h).')).toBeInTheDocument();
    expect(within(card).getByText('Recommendation')).toBeInTheDocument();
    expect(within(card).getByText('docs/v1.md is right')).toBeInTheDocument();
    expect(within(card).getByText('v1 is the newer, authoritative policy.')).toBeInTheDocument();
  });

  it('the assessment LEADS — it renders above the ruling actions and the doc panes', () => {
    renderDetail(
      withReview({
        explanation: 'They disagree on the window.',
        recommendation: { action: 'pick-a', rationale: 'v1 wins.' },
      }),
    );
    const card = screen.getByTestId('conflict-assessment');
    const after = (el: Element): boolean =>
      Boolean(card.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
    // Your ruling sits WITH the assessment, under it.
    expect(after(screen.getByRole('button', { name: 'docs/v1.md is right' }))).toBe(true);
    expect(after(screen.getByRole('button', { name: 'Not a real conflict' }))).toBe(true);
    // The evidence — the two doc columns, each headed by its Newer/Older badge —
    // comes after the assessment, never before it.
    expect(after(screen.getByText('Newer'))).toBe(true);
    expect(after(screen.getByText('Older'))).toBe(true);
  });

  it('the Apply recommendation button routes through the SAME verdict mutation as the manual control', async () => {
    const onConflictChange = vi.fn();
    const user = userEvent.setup();
    // pick-a backs the overlap's first doc (docs/v1.md) → verdict 'a' (docA wins).
    renderDetail(
      withReview({
        explanation: 'They disagree on the window.',
        recommendation: { action: 'pick-a', rationale: 'v1 wins.' },
      }),
      { onConflictChange },
    );
    // The shortcut is wired INSIDE the assessment card, beside the reasoning.
    const card = screen.getByTestId('conflict-assessment');
    await user.click(within(card).getByRole('button', { name: 'Apply recommendation' }));
    // The identical POST the manual "docs/v1.md is right" button would send.
    await waitFor(() => expect(lastPost).not.toBeNull());
    expect(lastPost).toMatchObject({
      docA: 'docs/v1.md',
      anchorA: 'Cancellation',
      docB: 'docs/v2.md',
      anchorB: 'Cancellation policy',
      verdict: 'a',
    });
    // Same post-resolution path as a manual verdict: the pair resolves in place.
    expect(onConflictChange).toHaveBeenCalledWith([expect.objectContaining({ verdict: 'a' })]);
    expect(screen.getByTestId('conflict-verdict')).toBeInTheDocument();
  });

  it('maps pick-b to the second doc regardless of the props doc order', async () => {
    const user = userEvent.setup();
    // Props swapped (docA=v2, docB=v1); pick-b still backs the overlap's 2nd doc (v2).
    renderDetail(
      withReview({
        explanation: 'They disagree.',
        recommendation: { action: 'pick-b', rationale: 'v2 wins.' },
      }),
      { docA: 'docs/v2.md', docB: 'docs/v1.md' },
    );
    await user.click(screen.getByRole('button', { name: 'Apply recommendation' }));
    await waitFor(() => expect(lastPost).not.toBeNull());
    // overlap.docs[1] is docs/v2.md, which is docA here → verdict 'a'.
    expect(lastPost).toMatchObject({ docA: 'docs/v2.md', docB: 'docs/v1.md', verdict: 'a' });
  });

  it('a fix-doc recommendation shows the copyable fix text and NO apply button', () => {
    renderDetail(
      withReview({
        explanation: 'The window differs; the docs should be reconciled by hand.',
        recommendation: { action: 'fix-doc', rationale: 'Neither wins outright.', fix: 'Change 24h to 48h in docs/v1.md.' },
      }),
    );
    // The fix text rides inside the assessment card; a fix-doc offers no shortcut.
    const card = screen.getByTestId('conflict-assessment');
    expect(within(card).getByText('Suggested fix')).toBeInTheDocument();
    expect(within(card).getByText('Change 24h to 48h in docs/v1.md.')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: /Copy/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply recommendation' })).not.toBeInTheDocument();
  });

  it('an already-resolved reviewed conflict shows the assessment but no apply shortcut', () => {
    const data = withReview({
      explanation: 'They disagree.',
      recommendation: { action: 'pick-a', rationale: 'v1 wins.' },
    });
    const resolved: SpecCorpusResponse = {
      ...data,
      conflictResolutions: [
        { docA: 'docs/v1.md', anchorA: 'Cancellation', docB: 'docs/v2.md', anchorB: 'Cancellation policy', verdict: 'b' },
      ],
    };
    renderDetail(resolved);
    const card = screen.getByTestId('conflict-assessment');
    expect(within(card).getByText('They disagree.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply recommendation' })).not.toBeInTheDocument();
  });

  it('an unreviewed conflict renders no assessment, recommendation, or apply button (regression)', () => {
    renderDetail(RESP);
    expect(screen.queryByTestId('conflict-assessment')).not.toBeInTheDocument();
    expect(screen.queryByText('Resolution brief')).not.toBeInTheDocument();
    expect(screen.queryByText('Recommendation')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply recommendation' })).not.toBeInTheDocument();
    // The plain-text detector note still renders exactly as before.
    expect(screen.getByText('24h vs 48h cancellation')).toBeInTheDocument();
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

describe('SpecOverlapDetail (PR-scoped verdict)', () => {
  let calls: { url: string; method?: string }[];
  beforeEach(() => {
    calls = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, opts?: RequestInit) => {
        const u = String(url);
        calls.push({ url: u, method: opts?.method });
        if (u.includes('/spec/conflict-resolution') && opts?.method === 'POST') {
          // PR scope re-curates + returns the full corpus; repo scope returns the ack.
          return u.includes('pr=') ? json({ ...RESP, corpusCommit: 'head-1' }) : json({ conflictResolutions: [] });
        }
        return json({ ref: 'docs/x.md', content: 'body' });
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('scopes the verdict to pr+ref and applies the returned corpus', async () => {
    const onResolved = vi.fn();
    const user = userEvent.setup();
    render(
      <SpecOverlapDetail repoId="r1" area="booking/appointments" docA="docs/v1.md" docB="docs/v2.md" data={RESP} prNumber={4} prRef="head-1" onResolved={onResolved} />,
    );
    await user.click(screen.getByRole('button', { name: 'docs/v1.md is right' }));
    await waitFor(() => expect(onResolved).toHaveBeenCalled());
    expect(calls.find((c) => c.url.includes('/spec/conflict-resolution') && c.method === 'POST')?.url).toContain('?pr=4&ref=head-1');
    // Full corpus returned → onResolved receives it (apply path).
    expect(onResolved.mock.calls[0][0]).toMatchObject({ corpus: expect.anything() });
  });

  it('repo view: no pr+ref, the ack routes through onConflictChange (not onResolved corpus)', async () => {
    const onResolved = vi.fn();
    const onConflictChange = vi.fn();
    const user = userEvent.setup();
    render(
      <SpecOverlapDetail
        repoId="r1"
        area="booking/appointments"
        docA="docs/v1.md"
        docB="docs/v2.md"
        data={RESP}
        onResolved={onResolved}
        onConflictChange={onConflictChange}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'docs/v1.md is right' }));
    await waitFor(() => expect(onConflictChange).toHaveBeenCalled());
    const url = calls.find((c) => c.url.includes('/spec/conflict-resolution') && c.method === 'POST')?.url ?? '';
    expect(url).not.toContain('pr=');
    expect(onResolved).not.toHaveBeenCalled();
  });

  it('disables the verdict actions (with a hint) before the PR gate runs', () => {
    render(
      <SpecOverlapDetail repoId="r1" area="booking/appointments" docA="docs/v1.md" docB="docs/v2.md" data={RESP} prNumber={4} prRef={undefined} onResolved={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'docs/v1.md is right' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Not a real conflict' })).toBeDisabled();
    expect(screen.getAllByText('Available after the PR gate runs.').length).toBeGreaterThan(0);
  });
});
