/**
 * Coverage click-latency guard (user feedback 2026-07-07): selecting a section
 * must repaint only the affected chunks, never re-parse all ~310. DocMarkdown is
 * mocked with a render counter so we can prove a selection change triggers ZERO
 * additional markdown parses — the memoized per-chunk component skips unrelated
 * sections, and the parse is memoized on chunk text so even the toggled chunk is
 * reused. The control (changing the doc content) shows the counter does fire.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import type { GuardDocCoverage as GuardDocCoverageData, GuardSectionCoverage, GuardSectionCoverageStatus } from '@truecourse/shared';

const state = vi.hoisted(() => ({ sources: [] as string[] }));
vi.mock('@/components/spec/DocMarkdown', () => ({
  DocMarkdown: ({ source }: { source: string }) => {
    state.sources.push(source);
    return <div data-testid="md">{source.slice(0, 12)}</div>;
  },
}));

import { GuardDocCoverage } from '@/components/guard/GuardDocCoverage';

function sec(headingText: string, level: number, status: GuardSectionCoverageStatus): GuardSectionCoverage {
  return {
    anchor: headingText.toLowerCase().replace(/\s+/g, '-'),
    headingText,
    level,
    fingerprint: 'sha256:x',
    status,
    scenarioIds: [],
    scenarios: [],
  };
}

const MD = [
  '# Alpha', 'a body', '',
  '## Bravo', 'b body', '',
  '## Charlie', 'c body', '',
  '## Delta', 'd body',
].join('\n');

const SECTIONS = [
  sec('Alpha', 1, 'pass'),
  sec('Bravo', 2, 'fail'),
  sec('Charlie', 2, 'stale'),
  sec('Delta', 2, 'unguarded'),
];

function cov(): GuardDocCoverageData {
  return {
    doc: 'docs/SPEC.md',
    markdown: true,
    sections: SECTIONS,
    orphanedSections: [],
    totals: {
      pass: 1, fail: 1, error: 0, stale: 1, orphaned: 0, guarded: 0, api: 0, web: 0, tui: 0,
      'blocked-on': 0, untestable: 0, 'no-claim': 0, unguarded: 1,
    },
    runId: 'run1',
    ranAt: '2026-07-07T00:00:00Z',
    generatedAt: '2026-07-07T00:00:00Z',
  };
}

const view = (selectedAnchor: string | null, content = MD) => (
  <GuardDocCoverage
    content={content}
    coverage={cov()}
    activeFilter={null}
    selectedAnchor={selectedAnchor}
    onSelectSection={() => {}}
  />
);

beforeEach(() => {
  state.sources.length = 0;
});

describe('GuardDocCoverage — click does not re-parse the whole doc', () => {
  it('parses each chunk once on mount', () => {
    render(view(null));
    // One DocMarkdown per block (4 headings, no preamble).
    expect(state.sources).toHaveLength(4);
  });

  it('selecting a section re-parses NOTHING (memoized chunks + memoized parse)', () => {
    const { rerender } = render(view(null));
    expect(state.sources).toHaveLength(4);
    state.sources.length = 0;

    // Select Bravo — only its chunk's `selected` flips; no chunk re-parses.
    rerender(view('bravo'));
    expect(state.sources).toHaveLength(0);

    // Move the selection to Charlie — still zero re-parses.
    rerender(view('charlie'));
    expect(state.sources).toHaveLength(0);
  });

  it('control: changing the doc content does re-parse the chunks', () => {
    const { rerender } = render(view(null));
    state.sources.length = 0;
    rerender(view(null, `${MD}\n\n## Echo\ne body`));
    // The new/last chunks re-parse; the counter is not inert.
    expect(state.sources.length).toBeGreaterThan(0);
  });
});
