/**
 * A contradiction INSIDE one document, as the two surfaces that resolve a
 * conflict render it. Both sides are the same doc, so each is named by its
 * passage, the recommendation names the passage it picks, and a verdict is
 * recorded against the passage the reader chose.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { buildCorpusConflicts } from '@truecourse/shared';
import { SpecOverlapDetail } from '@/components/spec/SpecOverlapDetail';
import { SpecSourceProvider, type SpecSource } from '@/components/spec/spec-source';
import { FindingCard, FindingResolveProvider } from '@/components/sessions/conversation-pieces';
import type { SpecCorpusResponse } from '@/lib/api';

const DOC = 'context/site-x/design.md';
const PRESS = { doc: DOC, heading: 'Buttons', quote: 'A press translates the button down 1px.' };
const SCALE = { doc: DOC, heading: 'Motion', quote: 'A press scales the button to 0.97.' };

const overlap = {
  docs: [DOC, DOC] as [string, string],
  note: 'A press is a translate under Buttons and a scale under Motion.',
  sections: [PRESS, SCALE],
  areas: ['core/design'],
  review: {
    explanation: 'Buttons says translate, Motion says scale.',
    recommendation: { action: 'pick-b' as const, rationale: 'Motion is newer.', confidence: 'medium' as const },
  },
};

const CORPUS = {
  version: 3,
  generatedAt: '',
  docs: [{ ref: DOC, title: 'Design', kind: 'prd', lastTouched: '', areaTags: ['core/design'] }],
  areas: [{ id: 'core/design', product: 'core', concern: 'design', docRefs: [DOC], overlaps: [overlap] }],
  skippedDocs: [],
};

const data = { corpus: CORPUS, manualIncludes: [], manualExcludes: [], conflictResolutions: [] } as unknown as SpecCorpusResponse;

function source(post: SpecSource['postConflictResolution']): SpecSource {
  return {
    supportsScan: false,
    getCorpus: async () => data,
    getDoc: async (ref) => ({ ref, content: '# Design\n\n## Buttons\n\nx\n\n## Motion\n\ny\n' }),
    listSkipped: async () => ({ docs: [], total: 0 }),
    addInclude: async () => ({}) as never,
    removeInclude: async () => ({}) as never,
    addExclude: async () => ({}) as never,
    removeExclude: async () => ({}) as never,
    postConflictResolution: post,
    deleteConflictResolution: async () => ({ conflictResolutions: [] }),
    scan: async () => {},
  };
}

describe('the conflict pane, for a conflict inside one doc', () => {
  it('names each side by its passage, recommends the second, and records a verdict against the passage chosen', async () => {
    const post = vi.fn(async () => ({ conflictResolutions: [] }));
    const [conflict] = buildCorpusConflicts(CORPUS, {});
    render(
      <SpecSourceProvider source={source(post)}>
        <SpecOverlapDetail repoId="" area="core/design" docA={DOC} docB={DOC} conflict={conflict as never} data={data} onResolved={() => {}} />
      </SpecSourceProvider>,
    );
    const detail = screen.getByTestId('overlap-detail');
    expect(detail).toHaveTextContent('Design · Buttons↔Design · Motion');
    expect(screen.getByTestId('conflict-assessment')).toHaveTextContent('Design · Motion is right');
    // Newer or older means nothing between two passages of one doc.
    expect(detail).not.toHaveTextContent(/Newer|Older/);

    await userEvent.setup().click(screen.getByRole('button', { name: /Design · Buttons\s*is right/ }));
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ docA: DOC, anchorA: 'Buttons', docB: DOC, anchorB: 'Motion', verdict: 'a' }),
    );
  });
});

describe('the finding card, for a conflict inside one doc', () => {
  it('offers each passage by name and marks the one recommended', async () => {
    const realFetch = window.fetch;
    window.fetch = vi.fn(async () =>
      new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } }),
    ) as unknown as typeof window.fetch;
    try {
      render(
        <MemoryRouter>
          <FindingResolveProvider repoId="web" active>
            <FindingCard
              finding={{
                claim: overlap.note,
                quotes: [PRESS, SCALE],
                recommendation: { doc: DOC, side: 'b', rationale: 'Motion is newer.' },
                dispute: { docA: DOC, anchorA: 'Buttons', quoteA: PRESS.quote, docB: DOC, anchorB: 'Motion', quoteB: SCALE.quote },
              }}
            />
          </FindingResolveProvider>
        </MemoryRouter>,
      );
      const second = await screen.findByRole('button', { name: /Follow design\.md · Motion/ });
      const first = screen.getByRole('button', { name: /Follow design\.md · Buttons/ });
      expect(second.querySelector('svg')).not.toBeNull();
      expect(first.querySelector('svg')).toBeNull();
      await waitFor(() => expect(screen.getByText('A press scales the button to 0.97.')).toBeInTheDocument());
    } finally {
      window.fetch = realFetch;
    }
  });
});
