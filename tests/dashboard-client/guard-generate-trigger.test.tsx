/**
 * The generate trigger: it ENQUEUES, and every refusal names its own remedy.
 * The Pipeline tab's generation row is what offers it (see
 * preview-pipeline-tab.test.tsx); this is the trigger itself.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('sonner', () => ({ toast: mocks.toast }));

import { useGuardGenerate } from '@/hooks/useGuardGenerate';

function Harness() {
  const generate = useGuardGenerate('expense-tracker');
  return (
    <button type="button" disabled={generate.busy} onClick={generate.begin}>
      {generate.busy ? 'Starting' : 'Generate'}
    </button>
  );
}

function serve(options: { status?: number; error?: string; pending?: Promise<void> } = {}) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${String(input)}`);
      await options.pending;
      return new Response(JSON.stringify(options.error ? { error: options.error } : { jobId: 'generate-1' }), {
        status: options.status ?? 202,
      });
    }),
  );
  return calls;
}

beforeEach(() => {
  mocks.toast.success.mockClear();
  mocks.toast.error.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe('the generate trigger', () => {
  it('enqueues once and says so', async () => {
    const calls = serve();
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(
      'Scenario generation started',
      expect.objectContaining({ description: expect.any(String) }),
    ));
    expect(calls.filter((c) => c.startsWith('POST'))).toHaveLength(1);
  });

  it('refuses a second start while the first is in flight', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const calls = serve({ pending });
    render(<Harness />);

    await userEvent.click(screen.getByRole('button', { name: 'Generate' }));
    expect(screen.getByRole('button', { name: 'Starting' })).toBeDisabled();
    release();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Generate' })).toBeEnabled());
    expect(calls.filter((c) => c.startsWith('POST'))).toHaveLength(1);
  });

  it.each([
    [409, 'llm-not-configured', /No LLM provider configured/],
    [409, 'busy', /already running/],
    [502, 'probe failed', /Provider check failed/],
    [422, 'Resolve the open spec conflict', /blocked by open spec conflicts/],
    [500, 'Job queue unavailable', /Generate failed/],
  ] as const)('names the remedy for a %s refusal', async (status, error, message) => {
    serve({ status, error });
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(
      expect.stringMatching(message),
      ...(status === 409 ? [] : [expect.objectContaining({ description: expect.any(String) })]),
    ));
    expect(mocks.toast.success).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Generate' })).toBeEnabled();
  });
});
