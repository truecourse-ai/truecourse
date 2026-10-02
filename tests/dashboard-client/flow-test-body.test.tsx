/**
 * A flow proven by a Playwright test, as the flow page reads it: the flow's
 * own header and milestones, then the test's verdict, its run's pictures, and
 * its steps green or red, with the spec and the seed as the other reading.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { GuardFlowDetail as GuardFlowDetailData } from '@truecourse/shared';
import { GuardFlowDetail } from '@/components/guard/GuardFlowDetail';

const EVIDENCE = '.truecourse/guard/evidence/run-1/edit-expense';

const DETAIL: GuardFlowDetailData = {
  flowId: 'edit-expense',
  title: 'Edit expense',
  goal: 'A person corrects an expense.',
  status: 'fail',
  bucket: 'guarded',
  epic: false,
  manual: false,
  composedOf: [],
  milestones: [],
  surfaces: [],
  gaps: [],
  interfaceIds: [],
  findings: [],
  errors: [],
  dismissed: false,
  generatedAt: null,
  runId: null,
  ranAt: null,
  test: {
    status: 'failing',
    summary: 'Editing opens a dialog, not a page.',
    disagreement: { documented: 'Editing opens a separate page.', observed: 'Editing opens an in-page dialog.' },
    spec: { file: '.truecourse/scenarios/tests/edit-expense.spec.ts', content: "const test = flowTest(seed)\n" },
    seed: { file: '.truecourse/scenarios/tests/edit-expense.seed.ts', content: 'export async function seed() {}\n' },
    run: {
      ranAt: '2026-10-02T12:00:00.000Z',
      durationMs: 900,
      steps: [
        { order: 1, title: 'The details page opens', outcome: 'passed', durationMs: 100 },
        { order: 2, title: 'Edit opens a separate page', outcome: 'failed', durationMs: 800, error: 'expect(page).toHaveURL failed' },
        { order: 3, title: 'Saving announces the change', outcome: 'not-reached' },
      ],
      error: 'expect(page).toHaveURL failed',
      evidencePath: EVIDENCE,
    },
  },
};

const realFetch = window.fetch;

beforeEach(() => {
  window.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.origin);
    const body = url.pathname.endsWith('/guard/evidence/visuals')
      ? {
          visuals: [
            { file: 'step-1.png', kind: 'screenshot', step: 1 },
            { file: 'step-2.png', kind: 'screenshot', step: 2 },
            { file: 'session.webm', kind: 'video' },
          ],
        }
      : {};
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof window.fetch;
});

afterEach(() => {
  window.fetch = realFetch;
});

function renderDetail(detail: GuardFlowDetailData = DETAIL) {
  return render(
    <MemoryRouter>
      <GuardFlowDetail repoId="r" detail={detail} onOpenSpec={() => {}} onOpenInterface={() => {}} />
    </MemoryRouter>,
  );
}

describe('a flow proven by a Playwright test', () => {
  it('says what the documents promise against what the product did', () => {
    renderDetail();
    const verdict = screen.getByRole('region', { name: 'Test verdict' });
    expect(within(verdict).getByText('Failing')).toBeInTheDocument();
    expect(within(verdict).getByText('1 passed · 1 failed · 1 not reached')).toBeInTheDocument();
    expect(within(verdict).getByText('Editing opens a separate page.')).toBeInTheDocument();
    expect(within(verdict).getByText('Editing opens an in-page dialog.')).toBeInTheDocument();
  });

  it('lists the steps green or red, the seed first and the failing step open', () => {
    renderDetail();
    const steps = screen.getByRole('region', { name: 'Steps' });
    expect(within(steps).getAllByRole('listitem').map((item) => item.getAttribute('aria-label'))).toEqual([
      'Starting data',
      'Step 1: The details page opens, passed',
      'Step 2: Edit opens a separate page, failed',
      'Step 3: Saving announces the change, not reached',
    ]);
    // The failing step's record is already open: what its assertion said.
    expect(within(steps).getByText('expect(page).toHaveURL failed')).toBeInTheDocument();
  });

  it("draws the run's pictures, the video leading", async () => {
    renderDetail();
    const strip = await screen.findByRole('region', { name: 'Run filmstrip' });
    expect(within(strip).getAllByRole('img').length).toBeGreaterThanOrEqual(2);
    expect(
      (window.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.some(([input]) =>
        String(input).includes(`evidencePath=${encodeURIComponent(EVIDENCE)}`),
      ),
    ).toBe(true);
  });

  it('reads as its files on the mode switch: the spec, then its seed', async () => {
    renderDetail();
    await userEvent.click(screen.getByRole('button', { name: 'TS' }));
    expect(screen.getByLabelText('.truecourse/scenarios/tests/edit-expense.spec.ts')).toHaveTextContent('flowTest(seed)');
    expect(screen.getByLabelText('.truecourse/scenarios/tests/edit-expense.seed.ts')).toHaveTextContent('export async function seed');
  });

  it('says what a blocked flow waits on, and shows no steps', () => {
    renderDetail({
      ...DETAIL,
      status: 'blocked-on',
      bucket: 'blocked',
      test: {
        status: 'blocked',
        summary: 'No key.',
        blockedBy: 'Conversion needs a CurrencyBeacon API key this product does not have.',
        blockedOn: 'CurrencyBeacon API key',
      },
    });
    const verdict = screen.getByRole('region', { name: 'Test verdict' });
    expect(within(verdict).getByText('Blocked')).toBeInTheDocument();
    expect(within(verdict).getByText('Conversion needs a CurrencyBeacon API key this product does not have.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Steps' })).toBeNull();
  });
});
