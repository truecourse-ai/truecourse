import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { GuardFlowListItem, GuardFlowProgress } from '@truecourse/shared';
import type { Repo } from '@/dashboard/data/types';

const state = vi.hoisted(() => ({ flows: [] as unknown[] }));
vi.mock('@/dashboard/shell/dashboard-state', () => ({
  useDashboardState: () => ({ showBlocked: true, repos: [{ id: 'repo', fullName: 'acme/repo' } as Repo] }),
}));
vi.mock('@/lib/api', () => ({ getGuardFlows: async () => ({ flows: state.flows }) }));
vi.mock('@/lib/socket', () => ({ connectSocket: () => ({ on: () => {}, off: () => {} }) }));

import FlowsPage from '@/dashboard/pages/FlowsPage';

const progress: GuardFlowProgress = { execution: 'passed', scenarios: 1, passed: 1, coverage: 'partial', verified: 1, total: 2, generation: 'incomplete' };
const flow = (title: string, p: GuardFlowProgress): GuardFlowListItem => ({ flowId: title, title, goal: title, status: p.coverage === 'complete' ? 'guarded' : 'blocked-on', bucket: p.coverage === 'complete' ? 'guarded' : 'partial', epic: false, composedOf: [], manual: false, milestoneCount: 1, docs: [], surfaces: [], drivers: ['web'], findings: 0, toolDefects: 0, errors: 0, progress: p });

describe('execution and coverage presentation', () => {
  it('restores compact status labels and filters without mistaking partial passing tests for complete flows', async () => {
    state.flows = [flow('Search', { ...progress, coverage: 'complete', verified: 2, generation: 'ready' }), flow('Delete', { ...progress, coverage: 'complete', verified: 2, generation: 'ready' }), flow('Create', progress), flow('Validation', progress), flow('SQLite layout', { ...progress, scenarios: 0, passed: 0, execution: 'not-generated', verified: 0, coverage: 'unverified', category: 'system', generation: 'unsupported' })];
    render(<MemoryRouter><FlowsPage /></MemoryRouter>);
    const user = userEvent.setup();
    // One table per status: the two complete flows succeeded, and the three
    // that are partial or ungenerated are blocked however many tests passed.
    const succeeded = await screen.findByRole('table', { name: 'Succeeded flows' });
    expect(within(succeeded).getAllByRole('row').slice(1)).toHaveLength(2);
    expect(screen.getByRole('region', { name: 'Blocked' })).toHaveTextContent(/Blocked\s*3/);
    expect(screen.queryByText('1/1 scenarios passed')).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Execution' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add filter' }));
    await user.click(await screen.findByRole('option', { name: /Status/ }));
    await user.click(await screen.findByRole('option', { name: /Succeeded/ }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Blocked' })).not.toBeInTheDocument());
    expect(within(screen.getByRole('table', { name: 'Succeeded flows' })).getByText('Search')).toBeInTheDocument();
  });
});
