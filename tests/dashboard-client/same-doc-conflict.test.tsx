/**
 * A contradiction INSIDE one document, as the two surfaces that resolve a
 * conflict render it. Both sides are the same doc, so each is named by its
 * place, the first sentence or the second; the recommendation names the
 * sentence it picks, and a verdict is recorded against the sentence the reader
 * chose.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { buildCorpusConflicts, sentenceKey } from '@truecourse/shared';
import { SpecConflictDetail } from '@/components/spec/SpecConflictDetail';
import { SpecSourceProvider, type SpecSource } from '@/components/spec/spec-source';
import type { SpecCorpusResponse } from '@/lib/api';

const DOC = 'context/site-x/design.md';
const PRESS = { doc: DOC, quote: 'A press translates the button down 1px.', sentence: sentenceKey('A press translates the button down 1px.') };
const SCALE = { doc: DOC, quote: 'A press scales the button to 0.97.', sentence: sentenceKey('A press scales the button to 0.97.') };

const conflict = {
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
  version: 5,
  generatedAt: '',
  docs: [{ ref: DOC, title: 'Design', kind: 'prd', lastTouched: '', areaTags: ['core/design'] }],
  areas: [{ id: 'core/design', product: 'core', concern: 'design', docRefs: [DOC], conflicts: [conflict] }],
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
  it('names each side by its place, recommends the second, and records a verdict against the sentence chosen', async () => {
    const post = vi.fn(async () => ({ conflictResolutions: [] }));
    const [conflict] = buildCorpusConflicts(CORPUS, {});
    render(
      <SpecSourceProvider source={source(post)}>
        <SpecConflictDetail repoId="" area="core/design" docA={DOC} docB={DOC} conflict={conflict as never} data={data} onResolved={() => {}} />
      </SpecSourceProvider>,
    );
    const detail = screen.getByTestId('conflict-detail');
    expect(detail).toHaveTextContent('Design · first sentence↔Design · second sentence');
    expect(screen.getByTestId('conflict-assessment')).toHaveTextContent('Design · second sentence is right');
    // Newer or older means nothing between two sentences of one doc.
    expect(detail).not.toHaveTextContent(/Newer|Older/);

    await userEvent.setup().click(screen.getByRole('button', { name: /Design · first sentence\s*is right/ }));
    expect(post).toHaveBeenCalledWith({
      docA: DOC,
      quoteA: PRESS.quote,
      sentenceA: PRESS.sentence,
      docB: DOC,
      quoteB: SCALE.quote,
      sentenceB: SCALE.sentence,
      verdict: 'a',
    });
  });
});

describe('the conflict pane, for one of several contradictions inside one doc', () => {
  const at = (quote: string) => ({ doc: DOC, quote, sentence: sentenceKey(quote) });
  const press = [at('A press translates the button down 1px.'), at('A press scales the button to 0.97.')];
  const focus = [at('Focus draws a 2px ring.'), at('Focus draws no ring.')];
  const corpus = {
    ...CORPUS,
    areas: [
      {
        ...CORPUS.areas[0]!,
        conflicts: [
          { ...conflict, note: 'press', sections: press },
          { ...conflict, note: 'focus', sections: focus },
        ],
      },
    ],
  };

  it('records its verdict, and withdraws it, by its own two sentences', async () => {
    const post = vi.fn(async () => ({ conflictResolutions: [] }));
    const del = vi.fn(async () => ({ conflictResolutions: [] }));
    const withSource = (resolutions: unknown[]) => {
      const read = { corpus, manualIncludes: [], manualExcludes: [], conflictResolutions: resolutions } as unknown as SpecCorpusResponse;
      const focusConflict = buildCorpusConflicts(read.corpus, read).find((c) => c.note === 'focus');
      return render(
        <SpecSourceProvider source={{ ...source(post), deleteConflictResolution: del }}>
          <SpecConflictDetail repoId="" area="core/design" docA={DOC} docB={DOC} conflict={focusConflict as never} data={read} onResolved={() => {}} />
        </SpecSourceProvider>,
      );
    };
    const user = userEvent.setup();
    const first = withSource([]);
    expect(screen.getByTestId('conflict-detail')).toHaveTextContent('Design · first sentence↔Design · second sentence');
    await user.click(screen.getByRole('button', { name: /first sentence\s*is right/ }));
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ sentenceA: focus[0]!.sentence, sentenceB: focus[1]!.sentence, verdict: 'a' }),
    );
    first.unmount();

    // Another contradiction's verdict on the same doc leaves this one open; its own resolves it.
    const pressVerdict = { docA: DOC, sentenceA: press[0]!.sentence, docB: DOC, sentenceB: press[1]!.sentence, verdict: 'a', resolvedAt: '' };
    const focusVerdict = { ...pressVerdict, sentenceA: focus[0]!.sentence, sentenceB: focus[1]!.sentence, verdict: 'b' };
    withSource([pressVerdict, focusVerdict]);
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() =>
      expect(del).toHaveBeenCalledWith({
        docA: DOC,
        sentenceA: focus[0]!.sentence,
        docB: DOC,
        sentenceB: focus[1]!.sentence,
      }),
    );
  });
});
