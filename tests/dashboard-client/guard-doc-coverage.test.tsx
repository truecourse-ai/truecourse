/**
 * GuardDocCoverage rendering behaviors (user feedback 2026-07-07): standalone
 * `<a id>` anchor lines never render as visible text; in-document cross-reference
 * links select+scroll the target section instead of opening a new tab (external
 * links still open a tab); the status filter toggles between blur (dim in place)
 * and hide (collapse out of the DOM), with the selected section always revealed.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { GuardDocCoverage as GuardDocCoverageData, GuardSectionCoverage, GuardSectionCoverageStatus } from '@truecourse/shared';
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

// Two standalone pre-heading anchors, one inline heading anchor, a hash link, an
// unresolvable hash link, and an external link.
const MD = [
  '# Overview',
  'Jump to [intro](#intro), [deep](#deep), [bad](#nope), or [ext](https://example.com).',
  '',
  '<a id="intro"></a>',
  '## Introduction',
  'Intro body.',
  '',
  '<a id="deep"></a>',
  '## Deep Section',
  'Deep body.',
].join('\n');

const SECTIONS = [sec('Overview', 1, 'pass'), sec('Introduction', 2, 'fail'), sec('Deep Section', 2, 'unguarded')];

function coverage(): GuardDocCoverageData {
  return {
    doc: 'docs/SPEC.md',
    markdown: true,
    sections: SECTIONS,
    orphanedSections: [],
    totals: {
      pass: 1, fail: 1, error: 0, stale: 0, orphaned: 0, guarded: 0, api: 0, web: 0, tui: 0,
      'blocked-on': 0, untestable: 0, 'no-claim': 0, unguarded: 1,
    },
    runId: 'run1',
    ranAt: '2026-07-07T00:00:00Z',
    generatedAt: '2026-07-07T00:00:00Z',
  };
}

function renderCoverage(props: Partial<React.ComponentProps<typeof GuardDocCoverage>> = {}) {
  const onSelectSection = props.onSelectSection ?? vi.fn();
  const utils = render(
    <GuardDocCoverage
      content={MD}
      coverage={coverage()}
      activeFilter={null}
      selectedAnchor={null}
      onSelectSection={onSelectSection}
      {...props}
    />,
  );
  return { ...utils, onSelectSection };
}

describe('GuardDocCoverage — anchor-tag artifact', () => {
  it('does not render standalone `<a id>` anchor lines as visible text', () => {
    const { container } = renderCoverage();
    // The heading renders; the raw anchor tag text does not appear anywhere.
    expect(screen.getByRole('heading', { name: 'Introduction' })).toBeInTheDocument();
    expect(container.textContent).not.toContain('<a id=');
    expect(container.textContent).not.toContain('a id="intro"');
  });
});

describe('GuardDocCoverage — in-document link navigation', () => {
  it('selects the target section for a `#anchor` link and prevents the new tab', () => {
    const { onSelectSection } = renderCoverage();
    const link = screen.getByRole('link', { name: 'intro' });
    // dispatchEvent returns false when the default (new-tab nav) was prevented.
    const notPrevented = fireEvent.click(link);
    expect(notPrevented).toBe(false);
    expect(onSelectSection).toHaveBeenCalledWith('introduction');
  });

  it('resolves a pre-heading anchor link to the section it precedes', () => {
    const { onSelectSection } = renderCoverage();
    fireEvent.click(screen.getByRole('link', { name: 'deep' }));
    expect(onSelectSection).toHaveBeenCalledWith('deep-section');
  });

  it('leaves external links to open a new tab (not intercepted)', () => {
    const { onSelectSection } = renderCoverage();
    const ext = screen.getByRole('link', { name: 'ext' });
    expect(ext).toHaveAttribute('target', '_blank');
    const notPrevented = fireEvent.click(ext);
    expect(notPrevented).toBe(true);
    expect(onSelectSection).not.toHaveBeenCalled();
  });

  it('no-ops gracefully on an unresolvable in-doc target (prevents the tab, selects nothing)', () => {
    const { onSelectSection } = renderCoverage();
    const notPrevented = fireEvent.click(screen.getByRole('link', { name: 'bad' }));
    expect(notPrevented).toBe(false);
    expect(onSelectSection).not.toHaveBeenCalled();
  });
});

describe('GuardDocCoverage — filter blur vs hide', () => {
  const anchorEl = (container: HTMLElement, anchor: string) =>
    container.querySelector(`[data-anchor="${anchor}"]`) as HTMLElement | null;

  it('blur mode dims non-matching sections but keeps them in the DOM', () => {
    const { container } = renderCoverage({ activeFilter: 'fail', filterMode: 'blur' });
    // Introduction (fail) matches; Overview (pass) is dimmed, still present.
    expect(anchorEl(container, 'overview')?.className).toContain('opacity-40');
    expect(anchorEl(container, 'introduction')?.className).not.toContain('opacity-40');
    expect(screen.getByRole('heading', { name: 'Overview' })).toBeInTheDocument();
  });

  it('hide mode removes non-matching sections from the DOM', () => {
    const { container } = renderCoverage({ activeFilter: 'fail', filterMode: 'hide' });
    expect(anchorEl(container, 'introduction')).not.toBeNull();
    expect(screen.queryByRole('heading', { name: 'Overview' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Deep Section' })).not.toBeInTheDocument();
  });

  it('keeps the selected section visible in hide mode even when it does not match the filter', () => {
    // Overview is `pass`, filter is `fail`, but it is the selection → stays shown.
    renderCoverage({ activeFilter: 'fail', filterMode: 'hide', selectedAnchor: 'overview' });
    expect(screen.getByRole('heading', { name: 'Overview' })).toBeInTheDocument();
  });
});
