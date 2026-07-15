/**
 * Workspace-inheritance badge, repo Spec views (EE repo-inheritance plan, item 4).
 * A hosted repo corpus folds in the workspace Knowledge docs, each carrying
 * `layer: 'workspace'`; those render a "workspace" badge in the repo's Spec tab:
 *   - SpecCorpusView: on the inherited kept-doc row + on a conflict row where a
 *     workspace doc is one side. A repo-local doc / OSS corpus (no `layer`) shows none.
 *   - SpecOverlapDetail: beside the workspace side in the conflict header.
 * Backend stubbed at the fetch boundary (the house pattern); a separate file so the
 * existing spec-corpus-view suite stays untouched.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { SpecCorpusView, type SpecCorpusState } from '../../apps/dashboard/client/src/components/spec/SpecCorpusView';
import { SpecOverlapDetail } from '../../apps/dashboard/client/src/components/spec/SpecOverlapDetail';
import type { SpecCorpusResponse } from '../../apps/dashboard/client/src/lib/api';

// A hosted repo corpus: a repo-local doc and a workspace-inherited doc
// (`layer: 'workspace'`) that conflict within one area — the cross-layer case.
const MIXED: SpecCorpusResponse = {
  corpus: {
    version: 3,
    generatedAt: '2026-01-01T00:00:00Z',
    docs: [
      { ref: 'docs/local.md', kind: 'prd', lastTouched: '2026-01-01T00:00:00Z', areaTags: ['booking/appointments'] },
      {
        ref: 'knowledge/confluence/1.md',
        kind: 'confluence',
        lastTouched: '2026-02-01T00:00:00Z',
        areaTags: ['booking/appointments'],
        layer: 'workspace',
        title: 'Workspace ADR',
      },
    ],
    areas: [
      {
        id: 'booking/appointments',
        product: 'booking',
        concern: 'appointments',
        docRefs: ['docs/local.md', 'knowledge/confluence/1.md'],
        overlaps: [
          {
            docs: ['docs/local.md', 'knowledge/confluence/1.md'],
            note: 'repo vs workspace disagree',
            sections: [
              { doc: 'docs/local.md', heading: 'Policy' },
              { doc: 'knowledge/confluence/1.md', heading: 'Policy' },
            ],
          },
        ],
      },
    ],
  },
};

// A repo-local corpus with no workspace layer at all (the OSS / repo-local shape).
const LOCAL_ONLY: SpecCorpusResponse = {
  corpus: {
    version: 3,
    generatedAt: '2026-01-01T00:00:00Z',
    docs: [
      { ref: 'docs/a.md', kind: 'prd', lastTouched: '2026-01-01T00:00:00Z', areaTags: ['booking/appointments'] },
      { ref: 'docs/b.md', kind: 'prd', lastTouched: '2026-02-01T00:00:00Z', areaTags: ['booking/appointments'] },
    ],
    areas: [
      {
        id: 'booking/appointments',
        product: 'booking',
        concern: 'appointments',
        docRefs: ['docs/a.md', 'docs/b.md'],
        overlaps: [{ docs: ['docs/a.md', 'docs/b.md'], note: 'x', sections: [] }],
      },
    ],
  },
};

const state = (data: SpecCorpusResponse): SpecCorpusState => ({
  data,
  hydrating: false,
  scanning: false,
  error: null,
  corpusCommit: null,
  scan: vi.fn(),
  refetch: vi.fn(),
  apply: vi.fn(),
  applyDecisions: vi.fn(),
  applyConflictResolutions: vi.fn(),
});

describe('SpecCorpusView — workspace badge', () => {
  it('badges the inherited kept-doc row + the cross-layer conflict row; leaves the repo-local row unbadged', () => {
    render(<SpecCorpusView repoId="r1" corpus={state(MIXED)} activeKey={null} onOpen={vi.fn()} />);

    // The inherited doc's kept row carries the badge…
    const wsRow = screen.getByText('Workspace ADR').closest('[role="button"]')!;
    expect(within(wsRow as HTMLElement).getByText('workspace')).toBeInTheDocument();
    // …the repo-local doc's row does not.
    const localRow = screen.getByText('docs/local.md').closest('[role="button"]')!;
    expect(within(localRow as HTMLElement).queryByText('workspace')).not.toBeInTheDocument();

    // The conflict row (workspace doc on one side) also carries the badge.
    const conflictRow = screen.getByText('docs/local.md ↔ Workspace ADR').closest('button')!;
    expect(within(conflictRow).getByText('workspace')).toBeInTheDocument();
  });

  it('renders NO workspace badge for a repo-local / OSS corpus (no layer field)', () => {
    render(<SpecCorpusView repoId="r1" corpus={state(LOCAL_ONLY)} activeKey={null} onOpen={vi.fn()} />);
    // The docs still render — only the badge is absent.
    expect(screen.getByText('docs/a.md')).toBeInTheDocument();
    expect(screen.getByText('docs/a.md ↔ docs/b.md')).toBeInTheDocument();
    expect(screen.queryByText('workspace')).not.toBeInTheDocument();
  });
});

describe('SpecOverlapDetail — workspace badge', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ref: 'x', content: 'body' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('badges the workspace side of the conflict header, not the repo-local side', () => {
    render(
      <SpecOverlapDetail
        repoId="r1"
        area="booking/appointments"
        docA="docs/local.md"
        docB="knowledge/confluence/1.md"
        data={MIXED}
        onResolved={vi.fn()}
      />,
    );
    // The header names both sides; the workspace side (docB, by its ledger title)
    // gets exactly one badge while the repo-local side (docA) does not. ("Workspace
    // ADR" itself appears twice — the header + the doc column — hence getAllByText.)
    expect(screen.getAllByText('Workspace ADR').length).toBeGreaterThan(0);
    expect(screen.getAllByText('workspace')).toHaveLength(1);
  });
});
