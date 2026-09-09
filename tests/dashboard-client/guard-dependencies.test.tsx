import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import * as api from '@/preview/vendor/lib/api';
import { useGuardDependencies } from '@/preview/vendor/hooks/useGuardDependencies';
import { DependenciesTab } from '@/preview/repo/DependenciesTab';
import type { GuardDependenciesView, GuardDependencyRow } from '@/preview/vendor/types/guard-dependencies';
import type { Repo } from '@/preview/data/types';

vi.mock('@/preview/vendor/lib/api', () => ({
  getGuardDependencies: vi.fn(),
  saveGuardDependency: vi.fn(),
  ApiError: class extends Error {},
}));
vi.mock('@/preview/repo/tab-jump', () => ({ useGuardTabJump: () => {} }));
vi.mock('@/preview/repo/use-guard-refresh', () => ({ useGuardRefresh: () => 0 }));

const row = (name: string, klass: GuardDependencyRow['class']): GuardDependencyRow => ({
  name, class: klass, summary: name, requirement: '', needs: [],
  state: klass === 'supplied' ? 'unprovided' : null, fields: [], blocks: [], usedBy: 0, inCatalog: true,
});
const internal = [row('expense', 'step-creatable'), row('sample-data', 'seedable')];
const view = (dependencies: GuardDependencyRow[], detectionAvailable = true): GuardDependenciesView => ({
  dependencies, detectionAvailable, catalogPath: '', localPath: '', recipePath: '', invalidReason: null, unknownLocalNames: [],
});

beforeEach(() => vi.clearAllMocks());

describe('user-facing dependencies', () => {
  it('keeps internal resources hidden after reads, registration saves and refreshes without changing the catalog', async () => {
    const original = view([...internal, row('mail-service', 'supplied')]);
    const saved = view([...internal, { ...row('mail-service', 'supplied'), state: 'provided' }]);
    vi.mocked(api.getGuardDependencies).mockResolvedValueOnce(original).mockResolvedValue(saved);
    vi.mocked(api.saveGuardDependency).mockResolvedValue(saved);
    const { result } = renderHook(() => useGuardDependencies('repo'));
    await waitFor(() => expect(result.current.view?.dependencies.map((d) => d.name)).toEqual(['mail-service']));
    await act(async () => { expect(await result.current.save('mail-service', { token: 'test-token' })).toBeNull(); });
    expect(result.current.view?.dependencies).toHaveLength(1);
    expect(result.current.view?.dependencies[0]?.state).toBe('provided');
    await act(async () => { await result.current.refetch(); });
    expect(result.current.view?.dependencies.map((d) => d.name)).toEqual(['mail-service']);
    expect(original.dependencies).toHaveLength(3);
    expect(saved.dependencies).toHaveLength(3);
  });

  it('shows no configuration needed for a prepared repo with only internal resources', async () => {
    vi.mocked(api.getGuardDependencies).mockResolvedValue(view(internal));
    render(<MemoryRouter><DependenciesTab repo={{ id: 'repo' } as Repo} /></MemoryRouter>);
    expect(await screen.findByText('No dependencies to configure.')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.queryByText('expense')).not.toBeInTheDocument();
    expect(screen.queryByText('sample-data')).not.toBeInTheDocument();
  });

  it('does not present an unscanned repo as having no dependencies', async () => {
    vi.mocked(api.getGuardDependencies).mockResolvedValue(view([], false));
    render(<MemoryRouter><DependenciesTab repo={{ id: 'repo' } as Repo} /></MemoryRouter>);
    expect(await screen.findByText('Run setup to discover dependencies.')).toBeInTheDocument();
    expect(screen.queryByText('No dependencies to configure.')).not.toBeInTheDocument();
  });
});
