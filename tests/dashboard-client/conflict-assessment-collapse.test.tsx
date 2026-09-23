/**
 * The conflict pane's ASSESSMENT folds.
 *
 * A judge's explanation, its rationale and a suggested edit can fill the pane
 * on their own, leaving no room for the two documents the reader is there to
 * compare. The assessment is read once and then in the way, so its label is a
 * toggle: folded, the pane gives the documents the space, and the
 * recommendation stays on the closed header so what was decided is still
 * legible.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SpecOverlapDetail } from '@/components/spec/SpecOverlapDetail';
import type { SpecCorpusResponse } from '@/lib/api';

const DOC_A = 'context/site-x/adr-0002.md';
const DOC_B = 'context/site-x/adr-002.md';

const overlap = {
  docs: [DOC_A, DOC_B] as [string, string],
  note: 'Both claim the number two.',
  sections: [],
  areas: ['core/architecture'],
  review: {
    explanation: 'Two different accepted decisions carry the same ADR index.',
    recommendation: {
      action: 'fix-doc' as const,
      rationale: 'Neither number is wrong on its merits.',
      fix: 'Renumber one of the two families so no two accepted ADRs share an index.',
      confidence: 'medium' as const,
    },
  },
};

const data = {
  corpus: {
    docs: [
      { ref: DOC_A, title: 'ADR 0002', areaTags: ['core/architecture'] },
      { ref: DOC_B, title: 'ADR-002', areaTags: ['core/architecture'] },
    ],
    areas: [{ id: 'core/architecture', product: 'core', concern: 'architecture', overlaps: [overlap] }],
    skippedDocs: [],
  },
  decisions: { conflictResolutions: [] },
} as unknown as SpecCorpusResponse;

const conflict = {
  id: 'c1',
  docs: [DOC_A, DOC_B] as [string, string],
  area: 'core/architecture',
  overlap,
} as never;

function renderPane() {
  return render(
    <SpecOverlapDetail
      repoId=""
      area="core/architecture"
      docA={DOC_A}
      docB={DOC_B}
      conflict={conflict}
      data={data}
      onResolved={() => {}}
    />,
  );
}

describe('the conflict assessment folds', () => {
  it('opens showing the explanation and the suggested fix', () => {
    renderPane();
    expect(screen.getByText(/Two different accepted decisions/)).toBeVisible();
    expect(screen.getByText(/Renumber one of the two families/)).toBeVisible();
    expect(screen.getByRole('button', { name: /Assessment/ })).toHaveAttribute('aria-expanded', 'true');
  });

  it('folds away on a click, and says what was recommended while folded', async () => {
    const user = userEvent.setup();
    renderPane();
    await user.click(screen.getByRole('button', { name: /Assessment/ }));

    const toggle = screen.getByRole('button', { name: /Assessment/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // The explanation and the edit are out of the way…
    expect(screen.getByText(/Two different accepted decisions/)).not.toBeVisible();
    expect(screen.getByText(/Renumber one of the two families/)).not.toBeVisible();
    // …and the ruling rides on the header that is left.
    expect(toggle).toHaveTextContent(/Fix the doc/i);
  });

  it('opens again on a second click', async () => {
    const user = userEvent.setup();
    renderPane();
    const toggle = () => screen.getByRole('button', { name: /Assessment/ });
    await user.click(toggle());
    await user.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/Two different accepted decisions/)).toBeVisible();
  });
});
