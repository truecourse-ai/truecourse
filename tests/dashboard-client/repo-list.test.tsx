/**
 * Home-page repo cards render the repo's most-recent lifecycle event as a
 * verb + date (matching the former "Analyzed <date>" styling; only the words
 * change). Covers the verb per kind, the exact date format, and the null case
 * (falls back to the "Not analyzed yet" presentation).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RepoList } from '@/components/repo/RepoList';
import type { LatestEventKind, RepoResponse } from '@/lib/api';

const AT = '2026-05-01T15:30:00.000Z';

// The exact format the card uses — computed here so the assertion is timezone-safe.
function formatted(at: string): string {
  return new Date(at).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function repo(overrides: Partial<RepoResponse>): RepoResponse {
  return { id: 'r1', name: 'my-repo', path: '/tmp/my-repo', ...overrides };
}

function renderList(repos: RepoResponse[]) {
  return render(
    <MemoryRouter>
      <RepoList repos={repos} onDelete={vi.fn()} />
    </MemoryRouter>,
  );
}

const VERBS: Array<[LatestEventKind, string]> = [
  ['analyzed', 'Analyzed'],
  ['scanned', 'Scanned'],
  ['generated', 'Generated'],
  ['guarded', 'Guarded'],
];

describe('RepoList — latest-event footer', () => {
  it.each(VERBS)('renders the %s event as "%s <date>"', (kind, verb) => {
    renderList([repo({ latestEvent: { kind, at: AT } })]);
    expect(screen.getByText(`${verb} ${formatted(AT)}`)).toBeInTheDocument();
  });

  it('shows the "Not analyzed yet" presentation when latestEvent is null', () => {
    renderList([repo({ latestEvent: null })]);
    expect(screen.getByText('Not analyzed yet')).toBeInTheDocument();
  });

  it('shows the "Not analyzed yet" presentation when latestEvent is absent', () => {
    renderList([repo({})]);
    expect(screen.getByText('Not analyzed yet')).toBeInTheDocument();
  });
});
