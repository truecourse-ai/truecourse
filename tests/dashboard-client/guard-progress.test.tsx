import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { GuardFlowListItem, GuardFlowProgress } from '@truecourse/shared';
import { GuardProgressSummary } from '@/components/guard/GuardProgressSummary';
import { TestsTab } from '@/preview/repo/TestsTab';
import type { Repo } from '@/preview/data/types';

const state = vi.hoisted(() => ({ flows: [] as unknown[] }));
vi.mock('@/preview/vendor/hooks/useGuardFlows', () => ({ useGuardFlows: () => ({ view: { flows: state.flows }, loading: false }) }));
vi.mock('@/preview/vendor/hooks/useGuardDecisions', () => ({ useGuardDecisions: () => ({ dismissedFlowIds: new Set() }) }));
vi.mock('@/preview/repo/tab-jump', () => ({ useGuardTabJump: () => {} }));
vi.mock('@/preview/repo/use-guard-refresh', () => ({ useGuardRefresh: () => 0 }));
const progress: GuardFlowProgress = { execution: 'passed', scenarios: 1, passed: 1, coverage: 'partial', verified: 1, total: 2, unit: 'cases', category: 'behavior', generation: 'incomplete' };
const flow = (title: string, p: GuardFlowProgress): GuardFlowListItem => ({ flowId: title, title, goal: title, status: p.coverage === 'complete' ? 'guarded' : 'blocked-on', bucket: p.coverage === 'complete' ? 'guarded' : 'partial', epic: false, composedOf: [], manual: false, milestoneCount: 1, sectionCount: 1, docs: [], surfaces: [], drivers: ['web'], findings: 0, toolDefects: 0, errors: 0, progress: p });

describe('execution and coverage presentation', () => {
  it('shows a passing execution beside partial coverage and its generation state', () => {
    render(<GuardProgressSummary progress={progress} />);
    expect(screen.getByText('Execution: Passed')).toBeInTheDocument();
    expect(screen.getByText('Coverage: Partial · 1/2 cases')).toBeInTheDocument();
    expect(screen.getByText('Incomplete generation')).toBeInTheDocument();
  });
  it('restores compact status labels and filters without mistaking partial passing tests for complete flows', async () => {
    state.flows = [flow('Search', { ...progress, coverage: 'complete', verified: 2, generation: 'ready' }), flow('Delete', { ...progress, coverage: 'complete', verified: 2, generation: 'ready' }), flow('Create', progress), flow('Validation', progress), flow('SQLite layout', { ...progress, scenarios: 0, passed: 0, execution: 'not-generated', verified: 0, coverage: 'unverified', category: 'system', generation: 'unsupported' })];
    render(<MemoryRouter><TestsTab repo={{ id: 'repo' } as Repo} /></MemoryRouter>);
    const table = screen.getByRole('table', { name: 'Tests' });
    expect(within(table).getAllByText('Succeeded')).toHaveLength(2);
    expect(within(table).getAllByText('Blocked')).toHaveLength(3);
    expect(within(table).queryByText('1/1 scenarios passed')).not.toBeInTheDocument();
    expect(within(table).queryByRole('columnheader', { name: 'Execution' })).not.toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole('group', { name: 'Filter tests by status' })).getByRole('button', { name: /Succeeded/ }));
    expect(within(table).queryByText('Validation')).not.toBeInTheDocument();
    expect(within(table).getByText('Search')).toBeInTheDocument();
  });
});
