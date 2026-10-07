/**
 * The coverage view reads its active tab off the URL: a `?conflict=` deep link
 * lands on that conflict, a `?doc=` on that doc, and a link carrying both lands
 * on the conflict with the doc pinned alongside.
 */
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { conflictId } from '@truecourse/shared';
import { useGuardCoverageTabs } from '@/hooks/useGuardCoverageTabs';

const at = (search: string) =>
  renderHook(() => useGuardCoverageTabs('web'), {
    wrapper: ({ children }) => <MemoryRouter initialEntries={[`/repos/web${search}`]}>{children}</MemoryRouter>,
  }).result.current;

describe('useGuardCoverageTabs', () => {
  const id = conflictId('acme/payments', 'docs/a.md', 'docs/b.md', {
    docs: ['docs/a.md', 'docs/b.md'],
    sections: [
      { doc: 'docs/a.md', heading: 'A', sentence: 's-one' },
      { doc: 'docs/b.md', heading: 'B', sentence: 's-two' },
    ],
  });

  it('lands a ?conflict deep link on that conflict', () => {
    expect(at(`?conflict=${encodeURIComponent(id)}`).activeId).toBe(id);
  });

  it('lands a link carrying both on the conflict, with the doc pinned', () => {
    const state = at(`?doc=${encodeURIComponent('docs/a.md')}&conflict=${encodeURIComponent(id)}`);
    expect(state.activeId).toBe(id);
    expect(state.openTabs.map((t) => t.id)).toEqual(expect.arrayContaining(['docs/a.md', id]));
  });
});
