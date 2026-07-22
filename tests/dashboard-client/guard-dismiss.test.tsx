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
import { guardFindingKey, type GuardBirthFinding, type GuardGenerateReport } from '@truecourse/shared';
import { GuardFindingDetail } from '@/components/guard/GuardFindingDetail';
import { GuardScenariosPanel } from '@/components/guard/GuardScenariosPanel';
import {
  buildFindingRows,
  buildListRows,
  dismissedKeySet,
  dismissedFindingKeySet,
  type GuardFindingRowData,
} from '@/lib/guard-list-rows';

const HASH = 'cafebabecafebabe';
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
  // The SERVER-stamped per-finding identity (stamp-on-read) — the client only
  // ever compares/parses what it received, it never derives.
  findingKey: guardFindingKey('docs/cli.md', 'version', HASH),
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
  const onUndismissClaim = vi.fn(async () => {});
  render(
    <GuardFindingDetail
      repoId="r"
      row={row(over)}
      onClose={() => {}}
      onOpenSpec={() => {}}
      onDismiss={onDismiss}
      onUndismiss={onUndismiss}
      onUndismissClaim={onUndismissClaim}
    />,
  );
  return { onDismiss, onUndismiss, onUndismissClaim };
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

describe('GuardFindingDetail — dismiss (per-finding identity)', () => {
  it('dismisses on the per-finding identity {doc, anchor, scenarioHash} from the SERVED key', async () => {
    const user = userEvent.setup();
    const { onDismiss } = renderDetail();
    await user.click(screen.getByRole('button', { name: 'Dismiss finding' }));
    expect(onDismiss).toHaveBeenCalledWith({
      doc: 'docs/cli.md',
      anchor: 'version',
      scenarioHash: HASH,
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
    renderDetail({ dismissed: true, dismissedVia: 'finding' });
    expect(screen.getByRole('button', { name: 'Un-dismiss' })).toBeInTheDocument();
    expect(screen.getByText(/takes effect next generate/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dismiss finding' })).not.toBeInTheDocument();
  });

  it('Un-dismiss routes by HOW the row was dismissed: finding entries → the new identity', async () => {
    const user = userEvent.setup();
    const { onUndismiss, onUndismissClaim } = renderDetail({ dismissed: true, dismissedVia: 'finding' });
    await user.click(screen.getByRole('button', { name: 'Un-dismiss' }));
    expect(onUndismiss).toHaveBeenCalledWith({ doc: 'docs/cli.md', anchor: 'version', scenarioHash: HASH });
    expect(onUndismissClaim).not.toHaveBeenCalled();
  });

  it('Un-dismiss routes a LEGACY claim dismissal through the retained legacy identity', async () => {
    const user = userEvent.setup();
    const { onUndismiss, onUndismissClaim } = renderDetail({ dismissed: true, dismissedVia: 'claim' });
    await user.click(screen.getByRole('button', { name: 'Un-dismiss' }));
    expect(onUndismissClaim).toHaveBeenCalledWith({
      doc: 'docs/cli.md',
      anchor: 'version',
      title: 'the --version flag prints the semver',
    });
    expect(onUndismiss).not.toHaveBeenCalled();
  });

  it('a CLAIM-LESS finding with a served key gains the dismiss button (§1a)', async () => {
    const user = userEvent.setup();
    const { onDismiss } = renderDetail({ finding: { ...FINDING, claim: undefined } });
    await user.click(screen.getByRole('button', { name: 'Dismiss finding' }));
    expect(onDismiss).toHaveBeenCalledWith({ doc: 'docs/cli.md', anchor: 'version', scenarioHash: HASH });
  });

  it('offers no dismiss action for a finding the server could not key (no findingKey)', () => {
    renderDetail({ finding: { ...FINDING, findingKey: undefined, yaml: undefined } });
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

  it('a LEGACY claim entry still strikes through every sibling row of the claim (retained semantics)', () => {
    const sibling: GuardBirthFinding = { ...FINDING, title: 'a sibling candidate', findingKey: guardFindingKey(FINDING.doc, FINDING.anchor, '0123456789abcdef') };
    const report = { ...REPORT, birthFindings: [FINDING, sibling] };
    const keys = dismissedKeySet([{ doc: FINDING.doc, anchor: FINDING.anchor, title: FINDING.claim! }]);
    const rows = buildFindingRows(report, [], keys, new Set());
    expect(rows.map((r) => r.dismissed)).toEqual([true, true]);
    expect(rows.map((r) => r.dismissedVia)).toEqual(['claim', 'claim']);
  });

  it('a NEW finding entry strikes through exactly the rows whose RECEIVED findingKey matches', () => {
    const sibling: GuardBirthFinding = { ...FINDING, title: 'a sibling candidate', findingKey: guardFindingKey(FINDING.doc, FINDING.anchor, '0123456789abcdef') };
    const report = { ...REPORT, birthFindings: [FINDING, sibling] };
    const findingKeys = dismissedFindingKeySet([
      { doc: FINDING.doc, anchor: FINDING.anchor, scenarioHash: HASH },
    ]);
    const rows = buildFindingRows(report, [], new Set(), findingKeys);
    expect(rows.map((r) => r.dismissed)).toEqual([true, false]);
    expect(rows[0].dismissedVia).toBe('finding');
  });

  it('the panel strikes through a dismissed finding row with a "dismissed" chip', () => {
    const findingKeys = dismissedFindingKeySet([
      { doc: FINDING.doc, anchor: FINDING.anchor, scenarioHash: HASH },
    ]);
    const rows = buildListRows([], buildFindingRows(REPORT, [], new Set(), findingKeys));
    render(
      <GuardScenariosPanel rows={rows} loading={false} error={null} activeId={null} onOpen={() => {}} />,
    );
    const title = screen.getByText(FINDING.title);
    expect(title.className).toContain('line-through');
    expect(screen.getByText('dismissed')).toBeInTheDocument();
  });
});
