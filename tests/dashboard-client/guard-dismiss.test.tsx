/**
 * GuardFindingDetail — judge-on-one-screen (item 19) + dismiss (item 20): the
 * detail renders the failed candidate's authored YAML inline, renders the full
 * evidence transcript expanded (fetched on mount, the same viewer the run-failure
 * detail uses — no toggle), and offers a Dismiss / Un-dismiss action that sits in
 * the binding's action row next to "View in spec" and writes decisions.json. As tab
 * content it renders no close X of its own (the tab strip owns the close). Fetches
 * are stubbed the house way; the component mounts bare (no router needed).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GuardBirthFinding, GuardGenerateReport } from '@truecourse/shared';
import { GuardFindingDetail } from '@/components/guard/GuardFindingDetail';
import { GuardScenariosPanel } from '@/components/guard/GuardScenariosPanel';
import {
  buildFindingRows,
  buildListRows,
  dismissedKeySet,
  type GuardFindingRowData,
} from '@/lib/guard-list-rows';

const FINDING: GuardBirthFinding = {
  doc: 'docs/cli.md',
  anchor: 'version',
  title: 'the version scenario',
  step: 2,
  expected: 'exit code 0',
  actual: 'exit code 7',
  evidencePath: '.truecourse/guard/evidence/run1/version.1',
  yaml: 'guard: 1\nid: version.1\ntitle: the version scenario\nsteps:\n  - run: ["--version"]\n',
  claim: 'the --version flag prints the semver',
};

function row(over: Partial<GuardFindingRowData> = {}): GuardFindingRowData {
  return {
    id: 'finding:version:0',
    title: FINDING.title,
    doc: FINDING.doc,
    anchor: FINDING.anchor,
    headingText: 'Version',
    index: 0,
    finding: FINDING,
    heldCount: 0,
    dismissed: false,
    ...over,
  };
}

function renderDetail(over: Partial<GuardFindingRowData> = {}) {
  const onDismiss = vi.fn(async () => {});
  const onUndismiss = vi.fn(async () => {});
  render(
    <GuardFindingDetail
      repoId="r"
      row={row(over)}
      onClose={() => {}}
      onOpenSpec={() => {}}
      onDismiss={onDismiss}
      onUndismiss={onUndismiss}
    />,
  );
  return { onDismiss, onUndismiss };
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes('/guard/finding-evidence')) return new Response('FULL-BIRTH-TRANSCRIPT-XYZ', { status: 200 });
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('GuardFindingDetail — YAML + evidence (item 19)', () => {
  it('renders the authored scenario YAML inline', () => {
    renderDetail();
    const src = screen.getByLabelText('scenario source');
    expect(src.textContent).toContain('id: version.1');
    expect(src.textContent).toContain('--version');
  });

  it('renders the full evidence transcript expanded on mount — no View/Hide toggle', async () => {
    renderDetail();
    // No evidence toggle button — the transcript loads on mount and shows expanded.
    expect(screen.queryByRole('button', { name: /evidence/i })).not.toBeInTheDocument();
    expect(await screen.findByText('FULL-BIRTH-TRANSCRIPT-XYZ')).toBeInTheDocument();
    // The finding-evidence route was hit with the finding's evidencePath.
    const calledUrl = String((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(calledUrl).toContain('/guard/finding-evidence');
    expect(calledUrl).toContain(encodeURIComponent('.truecourse/guard/evidence/run1/version.1'));
  });

  it('renders no close X of its own — the tab strip owns the close', () => {
    renderDetail();
    expect(screen.queryByLabelText('Close finding')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Close/ })).not.toBeInTheDocument();
  });
});

describe('GuardFindingDetail — dismiss (item 20)', () => {
  it('dismisses on the extracted claim identity, not the scenario title', async () => {
    const user = userEvent.setup();
    const { onDismiss } = renderDetail();
    await user.click(screen.getByRole('button', { name: 'Dismiss finding' }));
    expect(onDismiss).toHaveBeenCalledWith({
      doc: 'docs/cli.md',
      anchor: 'version',
      title: 'the --version flag prints the semver',
    });
  });

  it('sits in ONE action row next to "View in spec" (same container)', () => {
    renderDetail();
    const viewInSpec = screen.getByRole('button', { name: 'View in spec' });
    const dismiss = screen.getByRole('button', { name: 'Dismiss finding' });
    // Same parent row — no stray stacked button.
    expect(dismiss.parentElement).toBe(viewInSpec.parentElement);
  });

  it('a dismissed finding shows Un-dismiss + the "takes effect next generate" note, struck through', () => {
    renderDetail({ dismissed: true });
    expect(screen.getByRole('button', { name: 'Un-dismiss' })).toBeInTheDocument();
    expect(screen.getByText(/takes effect next generate/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dismiss finding' })).not.toBeInTheDocument();
  });

  it('offers no dismiss action for an old-report finding with no claim', () => {
    renderDetail({ finding: { ...FINDING, claim: undefined } });
    expect(screen.queryByRole('button', { name: 'Dismiss finding' })).not.toBeInTheDocument();
  });
});

describe('finding rows — dismissed marking from decisions', () => {
  const REPORT: GuardGenerateReport = {
    generatedAt: '2026-07-08T00:00:00.000Z',
    status: 'ok',
    sectionsTotal: 1,
    sectionsChanged: 1,
    skippedUnchanged: 0,
    noChanges: false,
    written: [],
    coverageGaps: [],
    birthFindings: [FINDING],
    errors: [],
    extractionFailures: [],
    orphaned: [],
  };

  it('buildFindingRows marks a row dismissed when its claim identity is in decisions', () => {
    const keys = dismissedKeySet([{ doc: FINDING.doc, anchor: FINDING.anchor, title: FINDING.claim! }]);
    expect(buildFindingRows(REPORT, [], new Set())[0].dismissed).toBe(false);
    expect(buildFindingRows(REPORT, [], keys)[0].dismissed).toBe(true);
  });

  it('the panel strikes through a dismissed finding row with a "dismissed" chip', () => {
    const keys = dismissedKeySet([{ doc: FINDING.doc, anchor: FINDING.anchor, title: FINDING.claim! }]);
    const rows = buildListRows([], buildFindingRows(REPORT, [], keys));
    render(
      <GuardScenariosPanel rows={rows} loading={false} error={null} activeId={null} onOpen={() => {}} />,
    );
    const title = screen.getByText(FINDING.title);
    expect(title.className).toContain('line-through');
    expect(screen.getByText('dismissed')).toBeInTheDocument();
  });
});
