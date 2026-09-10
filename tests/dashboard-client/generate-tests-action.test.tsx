import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { Repo, JobChain } from '@/preview/data/types';

const mocks = vi.hoisted(() => ({
  jobs: [] as JobChain[],
  jobsReady: true,
  listeners: new Map<string, Set<(payload: unknown) => void>>(),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('sonner', () => ({ toast: mocks.toast }));
vi.mock('@/preview/shell/preview-state', () => ({ usePreviewState: () => mocks }));
vi.mock('@/lib/socket', () => ({
  connectSocket: () => ({
    on: (event: string, handler: (payload: unknown) => void) => {
      const handlers = mocks.listeners.get(event) ?? new Set();
      handlers.add(handler);
      mocks.listeners.set(event, handlers);
    },
    off: (event: string, handler: (payload: unknown) => void) => mocks.listeners.get(event)?.delete(handler),
  }),
}));

import { GenerateTestsAction } from '@/preview/repo/GenerateTestsAction';

const repo = { id: 'expense-tracker', fullName: 'owner/expense-tracker', real: true } as Repo;
function serve(options: { status?: number; error?: string; pending?: Promise<void> } = {}) {
  const calls: { method: string }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_input: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? 'GET' });
    await options.pending;
    return new Response(JSON.stringify(options.error ? { error: options.error } : { jobId: 'generate-1' }), {
      status: options.status ?? 202,
    });
  }));
  return { calls };
}
function page() {
  return <MemoryRouter><GenerateTestsAction repo={repo} /></MemoryRouter>;
}

beforeEach(() => {
  mocks.jobs = [];
  mocks.jobsReady = true;
  mocks.listeners.clear();
  mocks.toast.success.mockClear();
  mocks.toast.error.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe('the Tests generation action', () => {
  it('disables duplicate starts during the request and follows active repository progress', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const { calls } = serve({ pending });
    const rendered = render(page());
    await userEvent.click(await screen.findByRole('button', { name: 'Generate tests' }));
    expect(screen.getByRole('button', { name: 'Starting generation…' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Starting generation…' }));
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    mocks.jobs = [{ id: 'live', title: 'Scenario generation', repoFullName: repo.fullName,
      steps: [{ key: 'worker', label: 'Authoring tests', state: 'active' }] }];
    await act(async () => release());
    rendered.rerender(page());
    expect(await screen.findByRole('button', { name: 'Run in progress' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Authoring tests');
    mocks.jobs = [];
    rendered.rerender(page());
    expect(screen.getByRole('button', { name: 'Generate tests' })).toBeEnabled();
  });

  it('waits for the initial job snapshot and ignores jobs belonging to other repositories', async () => {
    serve();
    mocks.jobsReady = false;
    const rendered = render(page());
    expect(await screen.findByRole('button', { name: 'Generate tests' })).toBeDisabled();
    mocks.jobsReady = true;
    mocks.jobs = [{ id: 'other', title: 'Other run', repoFullName: 'owner/other', steps: [] }];
    rendered.rerender(page());
    expect(screen.getByRole('button', { name: 'Generate tests' })).toBeEnabled();
  });

  it.each([
    [409, 'llm-not-configured', /No LLM provider configured/],
    [409, 'busy', /already running/],
    [422, 'Resolve the open spec conflict', /blocked by open spec conflicts/],
    [500, 'Job queue unavailable', /Generate failed/],
  ] as const)('shows a refused retry (%s) and permits another attempt', async (status, error, message) => {
    serve({ status, error });
    render(page());
    await userEvent.click(await screen.findByRole('button', { name: 'Generate tests' }));
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(expect.stringMatching(message), ...(
      status === 422 || status === 500 ? [expect.objectContaining({ description: error })] : []
    )));
    expect(screen.getByRole('button', { name: 'Generate tests' })).toBeEnabled();
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });

});
