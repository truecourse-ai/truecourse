/**
 * The repository's Pull requests tab: the gate's list, one row per pull request
 * wearing the check its NEWEST head got, Open before Closed.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import * as api from '@/lib/api';
import { PullsTab } from '@/preview/repo/PullsTab';
import type { PullRequestRow } from '@/preview/data/pull-requests';
import type { Repo } from '@/preview/data/types';

vi.mock('@/lib/api', () => ({ fetchApi: vi.fn() }));

const repo = { id: 'acme-web', fullName: 'acme/web' } as Repo;

const run = (over: Partial<PullRequestRow>): PullRequestRow => ({
  id: `r${over.prNumber}-${over.headSha ?? 'a'}`,
  prNumber: 1,
  headSha: 'abcdef1234567890',
  conclusion: 'success',
  addedCount: 0,
  resolvedCount: 0,
  createdAt: '2026-09-10T10:00:00.000Z',
  prState: 'open',
  title: null,
  ...over,
});

const rows = () => within(screen.getByRole('table', { name: 'Pull requests' })).getAllByRole('row');

function renderTab() {
  return render(
    <MemoryRouter>
      <PullsTab repo={repo} />
    </MemoryRouter>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe('the repository’s pull requests', () => {
  it('reads the repository’s own gate runs and shows the newest head per pull request', async () => {
    vi.mocked(api.fetchApi).mockResolvedValue({
      runs: [
        run({ prNumber: 7, headSha: 'old00000', conclusion: 'success', createdAt: '2026-09-09T10:00:00.000Z' }),
        run({ prNumber: 7, headSha: 'new11111', conclusion: 'failure', addedCount: 2, title: 'Refund window' }),
      ],
    } as unknown as never);
    renderTab();

    expect(await screen.findByText('Refund window')).toBeInTheDocument();
    expect(api.fetchApi).toHaveBeenCalledWith('/api/ee/github/repos/acme/web/runs');
    // One row per pull request, and the verdict is the newest head's.
    expect(rows()).toHaveLength(2);
    const row7 = rows()[1]!;
    expect(within(row7).getByText('#7')).toBeInTheDocument();
    expect(within(row7).getByText('Blocked')).toBeInTheDocument();
    expect(within(row7).getByText('new11111')).toBeInTheDocument();
  });

  it('lands on Open, and a closed pull request is the other reading', async () => {
    vi.mocked(api.fetchApi).mockResolvedValue({
      runs: [
        run({ prNumber: 1, title: 'Still open' }),
        run({ prNumber: 2, title: 'Merged one', prState: 'merged' }),
      ],
    } as unknown as never);
    renderTab();

    expect(await screen.findByText('Still open')).toBeInTheDocument();
    expect(screen.queryByText('Merged one')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /closed/i }));
    expect(screen.getByText('Merged one')).toBeInTheDocument();
    expect(screen.queryByText('Still open')).not.toBeInTheDocument();
  });

  it('links the row to the pull request where it lives', async () => {
    vi.mocked(api.fetchApi).mockResolvedValue({ runs: [run({ prNumber: 42 })] } as unknown as never);
    renderTab();

    const link = await screen.findByRole('link', { name: /#42/ });
    expect(link).toHaveAttribute('href', 'https://github.com/acme/web/pull/42');
  });

  it('says a repository whose pull requests were never checked has none', async () => {
    vi.mocked(api.fetchApi).mockResolvedValue({ runs: [] } as unknown as never);
    renderTab();
    expect(
      await screen.findByText('No open pull request has been checked yet.'),
    ).toBeInTheDocument();
  });
});
