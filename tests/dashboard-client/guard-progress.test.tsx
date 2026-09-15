import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { GuardFlowListItem, GuardFlowProgress } from '@truecourse/shared';
import type { Repo } from '@/dashboard/data/types';

const state = vi.hoisted(() => ({ flows: [] as unknown[] }));
vi.mock('@/dashboard/shell/dashboard-state', () => ({
  useDashboardState: () => ({ repos: [{ id: 'repo', fullName: 'acme/repo' } as Repo] }),
}));
vi.mock('@/lib/api', () => ({ getGuardFlows: async () => ({ flows: state.flows }) }));
vi.mock('@/lib/socket', () => ({ connectSocket: () => ({ on: () => {}, off: () => {} }) }));

import FlowsPage from '@/dashboard/pages/FlowsPage';

const progress: GuardFlowProgress = { execution: 'passed', scenarios: 1, passed: 1, coverage: 'partial', verified: 1, total: 2, unit: 'cases', category: 'behavior', generation: 'incomplete' };
const flow = (title: string, p: GuardFlowProgress): GuardFlowListItem => ({ flowId: title, title, goal: title, status: p.coverage === 'complete' ? 'guarded' : 'blocked-on', bucket: p.coverage === 'complete' ? 'guarded' : 'partial', epic: false, composedOf: [], manual: false, milestoneCount: 1, sectionCount: 1, docs: [], surfaces: [], drivers: ['web'], findings: 0, toolDefects: 0, errors: 0, progress: p });

describe('execution and coverage presentation', () => {
  it('restores compact status labels and filters without mistaking partial passing tests for complete flows', async () => {
    state.flows = [flow('Search', { ...progress, coverage: 'complete', verified: 2, generation: 'ready' }), flow('Delete', { ...progress, coverage: 'complete', verified: 2, generation: 'ready' }), flow('Create', progress), flow('Validation', progress), flow('SQLite layout', { ...progress, scenarios: 0, passed: 0, execution: 'not-generated', verified: 0, coverage: 'unverified', category: 'system', generation: 'unsupported' })];
    render(<MemoryRouter><FlowsPage /></MemoryRouter>);
    const user = userEvent.setup();
    const table = screen.getByRole('table', { name: 'Flows' });
    await waitFor(() => expect(within(table).getAllByText('Succeeded')).toHaveLength(2));
    expect(within(table).getAllByText('Blocked')).toHaveLength(3);
    expect(within(table).queryByText('1/1 scenarios passed')).not.toBeInTheDocument();
    expect(within(table).queryByRole('columnheader', { name: 'Execution' })).not.toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add filter' }));
    await user.click(await screen.findByRole('option', { name: /Status/ }));
    await user.click(await screen.findByRole('option', { name: /Succeeded/ }));
    await waitFor(() => expect(within(table).queryByText('Validation')).not.toBeInTheDocument());
    expect(within(table).getByText('Search')).toBeInTheDocument();
  });
});
