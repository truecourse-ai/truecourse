/**
 * A finding's "Open in Coverage" link names the dispute's conflict under the
 * param the coverage view reads, so the minter and the reader stay one pair.
 * Where two sections hold several conflicts, a finding reads, links, records
 * and withdraws the verdict of its own conflict by its passages.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { buildCorpusConflicts, passageKey } from '@truecourse/shared';
import { FindingCard, FindingResolveProvider } from '@/components/sessions/conversation-pieces';
import { useGuardCoverageTabs } from '@/hooks/useGuardCoverageTabs';

const DOC_A = 'context/site-docs-acme/refunds.md';
const DOC_B = 'context/site-docs-acme/payouts.md';

const CORPUS = {
  version: 3,
  generatedAt: '',
  docs: [
    { ref: DOC_A, kind: 'prd', lastTouched: '', areaTags: ['acme/payments'] },
    { ref: DOC_B, kind: 'prd', lastTouched: '', areaTags: ['acme/payments'] },
  ],
  areas: [
    {
      id: 'acme/payments',
      product: 'acme',
      concern: 'payments',
      docRefs: [DOC_A, DOC_B],
      overlaps: [
        {
          docs: [DOC_A, DOC_B],
          note: 'who owns the refund window',
          sections: [
            { doc: DOC_A, heading: 'Refunds', quote: 'two business days' },
            { doc: DOC_B, heading: 'Refund window', quote: 'five business days' },
          ],
        },
      ],
    },
  ],
  relations: [],
  skippedDocs: [],
};

const FINDING = {
  claim: 'Refunds settle in two days, or five.',
  quotes: [
    { doc: DOC_A, heading: 'Refunds', quote: 'two business days' },
    { doc: DOC_B, heading: 'Refund window', quote: 'five business days' },
  ],
  dispute: {
    docA: DOC_A,
    anchorA: 'Refunds',
    quoteA: 'two business days',
    docB: DOC_B,
    anchorB: 'Refund window',
    quoteB: 'five business days',
  },
};

const realFetch = window.fetch;
afterEach(() => {
  window.fetch = realFetch;
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('a finding with a matched dispute', () => {
  it('links to the conflict the coverage view reads back as the active tab', async () => {
    window.fetch = vi.fn(async () =>
      json({ corpus: CORPUS, manualIncludes: [], manualExcludes: [], conflictResolutions: [] }),
    ) as unknown as typeof window.fetch;
    const [conflict] = buildCorpusConflicts(CORPUS, {});

    render(
      <MemoryRouter>
        <FindingResolveProvider repoId="web" active>
          <FindingCard finding={FINDING as never} />
        </FindingResolveProvider>
      </MemoryRouter>,
    );
    // The link exists before the corpus answers; the conflict id lands once it has.
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /open in coverage/i }).getAttribute('href')).toContain(
        `conflict=${encodeURIComponent(conflict!.id)}`,
      ),
    );
    const href = screen.getByRole('link', { name: /open in coverage/i }).getAttribute('href') ?? '';

    const { result } = renderHook(() => useGuardCoverageTabs('web'), {
      wrapper: ({ children }) => <MemoryRouter initialEntries={[`/repos/web${href}`]}>{children}</MemoryRouter>,
    });
    expect(result.current.activeId).toBe(conflict!.id);
  });
});

describe('a finding among several conflicts between the same two sections', () => {
  const at = (doc: string, heading: string, quote: string) => ({ doc, heading, quote, passage: passageKey(quote) });
  const days = [at(DOC_A, 'Refunds', 'two business days'), at(DOC_B, 'Refund window', 'five business days')];
  const fee = [at(DOC_A, 'Refunds', 'a fee of one dollar'), at(DOC_B, 'Refund window', 'free of charge')];
  const corpus = {
    ...CORPUS,
    areas: [
      {
        ...CORPUS.areas[0]!,
        overlaps: [
          { docs: [DOC_A, DOC_B], note: 'refund window', sections: days },
          { docs: [DOC_A, DOC_B], note: 'refund fee', sections: fee },
        ],
      },
    ],
  };
  const feeFinding = {
    claim: 'A refund costs a dollar, or nothing.',
    quotes: fee,
    dispute: {
      docA: DOC_A,
      anchorA: 'Refunds',
      quoteA: fee[0]!.quote,
      passageA: fee[0]!.passage,
      docB: DOC_B,
      anchorB: 'Refund window',
      quoteB: fee[1]!.quote,
      passageB: fee[1]!.passage,
    },
  };
  const verdictOn = (sections: typeof days, verdict: 'a' | 'b') => ({
    docA: DOC_A,
    anchorA: 'Refunds',
    passageA: sections[0]!.passage,
    docB: DOC_B,
    anchorB: 'Refund window',
    passageB: sections[1]!.passage,
    verdict,
    resolvedAt: '',
  });

  function serve(conflictResolutions: unknown[]): Array<{ method: string; body: unknown }> {
    const writes: Array<{ method: string; body: unknown }> = [];
    window.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET') return json({ corpus, manualIncludes: [], manualExcludes: [], conflictResolutions });
      writes.push({ method, body: JSON.parse(String(init?.body)) });
      return json({ conflictResolutions: [] });
    }) as unknown as typeof window.fetch;
    return writes;
  }

  function renderCard(): void {
    render(
      <MemoryRouter>
        <FindingResolveProvider repoId="web" active>
          <FindingCard finding={feeFinding as never} />
        </FindingResolveProvider>
      </MemoryRouter>,
    );
  }

  it('is not resolved by the verdict on another point, links to its own conflict, and records its own passages', async () => {
    const writes = serve([verdictOn(days, 'a')]);
    const own = buildCorpusConflicts(corpus, {}).find((c) => c.note === 'refund fee')!;
    renderCard();
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /open in coverage/i }).getAttribute('href')).toContain(
        `conflict=${encodeURIComponent(own.id)}`,
      ),
    );
    expect(screen.queryByText(/Resolved:/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /not a real conflict/i }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toEqual({
      method: 'POST',
      body: expect.objectContaining({ passageA: fee[0]!.passage, passageB: fee[1]!.passage, verdict: 'dismissed' }),
    });
  });

  it('shows its own verdict, and withdraws it by its passages', async () => {
    const writes = serve([verdictOn(days, 'a'), verdictOn(fee, 'b')]);
    renderCard();
    await screen.findByText(/Resolved:/);
    fireEvent.click(screen.getByRole('button', { name: /undo/i }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toEqual({
      method: 'DELETE',
      body: { docA: DOC_A, anchorA: 'Refunds', passageA: fee[0]!.passage, docB: DOC_B, anchorB: 'Refund window', passageB: fee[1]!.passage },
    });
  });
});
