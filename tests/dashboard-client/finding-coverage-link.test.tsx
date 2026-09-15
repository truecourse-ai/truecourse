/**
 * A finding's "Open in Coverage" link names the dispute's conflict under the
 * param the coverage view reads, so the minter and the reader stay one pair.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { buildCorpusConflicts } from '@truecourse/shared';
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
