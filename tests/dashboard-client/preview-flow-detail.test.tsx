/**
 * A flow's header: ONE status word, and the flow's facts beneath its title as
 * plain rows — no collapsible, and no second verdict competing with the word
 * above it.
 */

import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { GuardFlowDetail as GuardFlowDetailData } from '@truecourse/shared';
import { GuardFlowDetail } from '@/components/guard/GuardFlowDetail';

const DETAIL: GuardFlowDetailData = {
  flowId: 'write-then-read',
  title: 'Writes a file and reads it back',
  goal: 'round-trip a file',
  status: 'blocked-on',
  bucket: 'blocked',
  epic: false,
  manual: false,
  composedOf: [],
  milestones: [],
  surfaces: [],
  gaps: [],
  interfaceIds: [],
  findings: [],
  errors: [],
  generatedAt: null,
  runId: null,
  ranAt: null,
  progress: {
    execution: 'not-run',
    scenarios: 0,
    passed: 0,
    coverage: 'unverified',
    verified: 0,
    total: 3,
    unit: 'cases',
    category: 'behavior',
    generation: 'incomplete',
  },
};

function renderDetail(detail: GuardFlowDetailData = DETAIL) {
  return render(
    <MemoryRouter>
      <GuardFlowDetail repoId="r" detail={detail} onOpenSpec={() => {}} onOpenInterface={() => {}} />
    </MemoryRouter>,
  );
}

describe('the milestone chain', () => {
  it('lists a milestone’s single case under its claim', () => {
    renderDetail({
      ...DETAIL,
      milestones: [
        {
          order: 1,
          doc: 'docs/conversion.md',
          anchor: 'conversion-behaviors',
          claimTitle: 'Conversion behaviors',
          headingText: 'Conversion behaviors',
          live: true,
          drifted: false,
          cases: [{ id: 'missing-key', claim: 'A missing key converts to an empty string.' }],
        },
      ],
    });

    const chain = screen.getByRole('list', { name: 'Milestones' });
    expect(within(chain).getByText('Conversion behaviors')).toBeInTheDocument();
    expect(within(chain).getByText('A missing key converts to an empty string.')).toBeInTheDocument();
  });
});

describe('the flow detail header', () => {
  it('states no progress of its own: the body says what ran and what is missing', () => {
    const { container } = renderDetail();
    // Execution / Coverage / Generation each restated something the body
    // already carries — the verdict, the milestone list, the blocked block —
    // in a third vocabulary, so the header states the flow and nothing else.
    expect(container.querySelector('dl')).toBeNull();
    expect(screen.queryByText('Execution')).toBeNull();
    expect(screen.queryByText('Generation')).toBeNull();
  });

  it('hides nothing behind a collapsible', () => {
    const { container } = renderDetail();
    expect(container.querySelector('details')).toBeNull();
    expect(screen.queryByText('Execution and coverage details')).toBeNull();
  });

  it('keeps ONE status word in the header', () => {
    renderDetail();
    const title = screen.getByRole('heading', { name: 'Writes a file and reads it back' });
    const header = within(title.parentElement!);
    expect(header.getAllByText('Blocked')).toHaveLength(1);
    expect(header.queryByText('Blocked 0')).toBeNull();
  });
});
