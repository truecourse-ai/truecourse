/**
 * A flow's header: ONE status word, and the flow's facts beneath its title as
 * plain rows — no collapsible, and no second verdict competing with the word
 * above it.
 */

import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { GuardFlowDetail as GuardFlowDetailData } from '@/preview/vendor/shared';
import { GuardFlowDetail } from '@/preview/vendor/components/guard/GuardFlowDetail';

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

/** The label/value pairs under the title, in render order. */
function facts(container: HTMLElement): [string, string][] {
  const list = container.querySelector('dl')!;
  return [...list.querySelectorAll('div')].map((row) => [
    within(row as HTMLElement).getByRole('term').textContent ?? '',
    within(row as HTMLElement).getByRole('definition').textContent ?? '',
  ]);
}

describe('the flow detail header', () => {
  it('reads its facts as plain rows, one per line', () => {
    const { container } = renderDetail();
    expect(facts(container)).toEqual([
      ['Execution', 'Not run'],
      ['Coverage', '0 of 3 cases verified'],
      ['Generation', 'Incomplete'],
    ]);
  });

  it('hides nothing behind a collapsible', () => {
    const { container } = renderDetail();
    expect(container.querySelector('details')).toBeNull();
    expect(screen.queryByText('Execution and coverage details')).toBeNull();
  });

  it('keeps ONE status word in the header, above the facts', () => {
    renderDetail();
    const title = screen.getByRole('heading', { name: 'Writes a file and reads it back' });
    const header = within(title.parentElement!);
    expect(header.getAllByText('Blocked')).toHaveLength(1);
    // The facts never wear a status word of their own.
    expect(header.queryByText('Not run')).toBeInTheDocument();
    expect(header.queryByText('Blocked 0')).toBeNull();
  });

  it('says a coverage nothing recorded rather than a count it does not have', () => {
    const { container } = renderDetail({
      ...DETAIL,
      progress: { ...DETAIL.progress!, coverage: 'unknown', execution: 'passed', generation: 'ready' },
    });
    expect(facts(container)).toEqual([
      ['Execution', 'Passed'],
      ['Coverage', 'Not recorded'],
      ['Generation', 'Ready'],
    ]);
  });
});
