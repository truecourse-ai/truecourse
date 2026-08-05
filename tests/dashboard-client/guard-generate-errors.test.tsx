/**
 * The generate Overview's "What failed" block — the ONE call site of
 * `groupErrorsByPattern`.
 *
 * The grouping helper existed, was unit-tested, and was imported by nothing: the
 * Overview consumed only the COUNT of errors, through the "N flows will retry next
 * generate" line. So a generate that wrote zero tests across 93 flows because one
 * external service was declared half-way said, on screen, "93 flows will retry" —
 * a promise the next (identically refused) run could not keep, with the 49 recorded
 * errors nowhere to be seen. These tests pin the block that shows them, and the
 * retry line that must stand down when the run was refused.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { GuardGenerateError, GuardGenerateReport } from '@truecourse/shared';
import { GuardScenariosOverview } from '@/components/guard/GuardScenariosOverview';

const REFUSAL = 'external service hit-pay is only partly configured: no key was resolved.';

const report = (over: Partial<GuardGenerateReport> = {}): GuardGenerateReport => ({
  generatedAt: '2026-07-30T10:00:00.000Z',
  status: 'ok',
  sectionsTotal: 12,
  sectionsChanged: 12,
  skippedUnchanged: 0,
  noChanges: false,
  written: [],
  coverageGaps: [],
  birthFindings: [],
  errors: [],
  extractionFailures: [],
  orphaned: [],
  flows: {
    total: 93,
    settled: 0,
    unsettled: 93,
    skipped: 0,
    dismissed: 0,
    orphaned: 0,
    subsumed: 0,
    noFlowClaims: 0,
    unsettledAreas: [],
  },
  ...over,
});

const renderOverview = (r: GuardGenerateReport) =>
  render(
    <GuardScenariosOverview
      recipe={null}
      report={r}
      flows={[]}
      filter="all"
      onFilter={vi.fn()}
      loading={false}
      error={null}
    />,
  );

/** N authoring errors on N distinct sections, all with the same message shape. */
const authoringErrors = (n: number): GuardGenerateError[] =>
  Array.from({ length: n }, (_, i) => ({
    doc: 'docs/api.md',
    anchor: `api/section-${i}`,
    kind: 'authoring' as const,
    message: 'authoring (api) the model returned an unparseable envelope',
  }));

describe('the generate Overview — what failed', () => {
  it('groups near-identical errors into ONE line that counts the sections it hit', () => {
    renderOverview(report({ errors: authoringErrors(49) }));
    const list = screen.getByRole('list', { name: 'Generate errors' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByText('49 sections')).toBeInTheDocument();
    expect(within(rows[0]).getByText(/unparseable envelope/)).toBeInTheDocument();
  });

  it('renders nothing when the run recorded no errors', () => {
    renderOverview(report());
    expect(screen.queryByRole('list', { name: 'Generate errors' })).not.toBeInTheDocument();
  });

  it('leads with a REFUSAL, names it as one, and says re-running will not help', () => {
    renderOverview(
      report({
        errors: [
          ...authoringErrors(2),
          { doc: '(guard run)', anchor: '(refused)', kind: 'refusal', message: REFUSAL },
        ],
        refusal: { status: 'missing-external-env', message: REFUSAL, flowIds: ['a', 'b'] },
      }),
    );
    const rows = within(screen.getByRole('list', { name: 'Generate errors' })).getAllByRole('listitem');
    // The refusal is not the most NUMEROUS error; it is the reason there was nothing else.
    expect(within(rows[0]).getByText('run refused')).toBeInTheDocument();
    expect(within(rows[0]).getByText(/hit-pay/)).toBeInTheDocument();
    expect(screen.getByText(/declined before anything was built or executed/)).toBeInTheDocument();
  });

  it('keeps the "will retry next generate" line for ordinary authoring errors', () => {
    renderOverview(report({ errors: authoringErrors(1) }));
    expect(screen.getByText(/93 flows will retry next generate/)).toBeInTheDocument();
  });

  it('drops that line when the run was REFUSED — the next run is declined identically', () => {
    renderOverview(
      report({
        errors: [{ doc: '(guard run)', anchor: '(refused)', kind: 'refusal', message: REFUSAL }],
        refusal: { status: 'missing-external-env', message: REFUSAL, flowIds: [] },
      }),
    );
    expect(screen.queryByText(/will retry next generate/)).not.toBeInTheDocument();
  });
});

/**
 * The unadjudicated block. A generate whose fidelity or triage stage lost EVERY
 * call ships its corpus anyway (plan item 88 — the stages judge content birth has
 * already validated, so their loss costs annotation, not correctness). That is
 * only defensible if the screen SAYS so: an unreviewed test must never read as a
 * reviewed one.
 */
describe('the generate Overview — unadjudicated stages', () => {
  it('says which tests shipped with no verdict behind them', () => {
    renderOverview(
      report({
        unadjudicated: [
          { stage: 'guard.fidelity', affected: 41 },
          { stage: 'guard.triage', affected: 7 },
        ],
      }),
    );
    const list = screen.getByRole('list', { name: 'Unadjudicated stages' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText(/41/)).toBeInTheDocument();
    expect(within(rows[0]).getByText(/never reviewed/i)).toBeInTheDocument();
    expect(within(rows[1]).getByText(/7/)).toBeInTheDocument();
    expect(within(rows[1]).getByText(/untriaged/i)).toBeInTheDocument();
  });

  it('renders nothing when every verdict landed', () => {
    renderOverview(report({}));
    expect(screen.queryByRole('list', { name: 'Unadjudicated stages' })).not.toBeInTheDocument();
  });
});
