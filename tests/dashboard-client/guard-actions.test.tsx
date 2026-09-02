/**
 * Guard UI-triggered actions: the Generate trigger (one POST that enqueues the
 * job — no estimate round-trip, no modal — and a toast naming each refusal's
 * remedy), the deterministic Run trigger, the in-flight disabled state,
 * the action-button staleness dots (the ONLY staleness dots — the rail carries
 * none, per the BL-Drift-matching dot policy pinned in guard-view tests), and the
 * completion → refetch mechanism (the reload key the page bumps on a
 * `spec:complete` guard event). Fetch is stubbed the house way (URL-routed
 * `vi.stubGlobal('fetch', …)`); the Generate/Run buttons + modal are mounted in a
 * harness that mirrors RepoPage's page-level wiring.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';

// The toast is the only place a refused start is spoken to the user, so it is
// asserted rather than swallowed.
const { toastMock } = vi.hoisted(() => ({ toastMock: { success: vi.fn(), error: vi.fn() } }));
vi.mock('sonner', () => ({ toast: toastMock }));

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GuardScenarioInventory } from '@truecourse/shared';
import { useGuardGenerate } from '@/hooks/useGuardGenerate';
import { useGuardRun } from '@/hooks/useGuardRun';
import { useGuardScenarios } from '@/hooks/useGuardScenarios';
import { GuardHeaderActions } from '@/components/guard/GuardHeaderActions';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** A URL-routed fetch stub; `opts.generateResult`/`generateStatus` shape the start answer; `opts.onGenerate`
 *  lets a test gate the generate POST (e.g. hang it to observe the in-flight state). */
function stubFetch(
  opts: {
    onGenerate?: () => Promise<void>;
    /** The generate route's body; with `generateStatus` a refusal instead of the 202. */
    generateResult?: unknown;
    generateStatus?: number;
  } = {},
) {
  const calls: { url: string; method: string; body?: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      calls.push({ url: u, method, body: init?.body as string | undefined });
      if (u.includes('/guard/generate')) {
        if (opts.onGenerate) await opts.onGenerate();
        return json(opts.generateResult ?? { jobId: 'job_1' }, opts.generateStatus ?? 202);
      }
      if (u.includes('/guard/run')) return json({ status: 'ok', summary: { total: 3, pass: 3, fail: 0, stale: 0, orphaned: 0, error: 0 } });
      return json({});
    }),
  );
  return calls;
}

function Harness() {
  const gen = useGuardGenerate('r');
  const run = useGuardRun('r');
  return (
    <>
      <GuardHeaderActions kind="generate" onClick={gen.begin} busy={gen.busy} otherBusy={run.running} />
      <GuardHeaderActions kind="run" onClick={run.run} busy={run.running} otherBusy={gen.busy} />
    </>
  );
}

// `/generat/i` matches both the idle "Generate" and the in-flight "Generating…".
const genButton = () => screen.getByRole('button', { name: /generat/i });
const runButton = () => screen.getByRole('button', { name: /^run/i });

afterEach(() => {
  vi.unstubAllGlobals();
  toastMock.success.mockClear();
  toastMock.error.mockClear();
});

describe('Guard Generate — the enqueue', () => {
  it('POSTs the start route with no estimate round-trip, and says the job started', async () => {
    const calls = stubFetch();
    render(<Harness />);
    await userEvent.click(genButton());

    await waitFor(() => expect(calls.some((c) => c.url.includes('/guard/generate') && c.method === 'POST')).toBe(true));
    // The route enqueues, so nothing is asked first: no estimate, no modal.
    expect(calls.some((c) => c.url.includes('/guard/estimate'))).toBe(false);
    expect(screen.queryByRole('button', { name: 'Proceed' })).not.toBeInTheDocument();
    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
    expect(toastMock.success.mock.calls[0][0]).toBe('Scenario generation started');
  });

  it('disables both guard buttons while the start request is in flight', async () => {
    let release!: () => void;
    const pending = new Promise<void>((r) => { release = r; });
    stubFetch({ onGenerate: () => pending });
    render(<Harness />);
    await userEvent.click(genButton());

    await waitFor(() => expect(genButton()).toBeDisabled());
    expect(runButton()).toBeDisabled();

    release();
    await waitFor(() => expect(genButton()).not.toBeDisabled());
  });

  it('tells the unconfigured workspace and the busy repository apart by the body code', async () => {
    stubFetch({ generateStatus: 409, generateResult: { error: 'llm-not-configured', message: 'no provider' } });
    render(<Harness />);
    await userEvent.click(genButton());
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(toastMock.error.mock.calls[0][0]).toMatch(/No LLM provider configured/);

    toastMock.error.mockClear();
    stubFetch({ generateStatus: 409, generateResult: { error: 'A guard job is already running for this repo.' } });
    await userEvent.click(genButton());
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(toastMock.error.mock.calls[0][0]).toBe('A guard job is already running for this repo.');
  });

  it('surfaces the open-conflict gate with its full report', async () => {
    stubFetch({
      generateStatus: 422,
      generateResult: { error: '1 open spec conflict must be resolved before guard generate.\n  booking' },
    });
    render(<Harness />);
    await userEvent.click(genButton());

    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(toastMock.error.mock.calls[0][0]).toBe('Generate blocked by open spec conflicts');
    expect(toastMock.error.mock.calls[0][1]).toMatchObject({
      description: expect.stringContaining('1 open spec conflict'),
    });
    expect(toastMock.success).not.toHaveBeenCalled();
  });
});

describe('Guard Run — deterministic trigger', () => {
  it('triggers the run without an estimate modal', async () => {
    const calls = stubFetch();
    render(<Harness />);
    await userEvent.click(runButton());

    await waitFor(() => expect(calls.some((c) => c.url.includes('/guard/run') && c.method === 'POST')).toBe(true));
    // No estimate fetch, no modal for a run.
    expect(calls.some((c) => c.url.includes('/guard/estimate'))).toBe(false);
    expect(screen.queryByRole('button', { name: 'Proceed' })).not.toBeInTheDocument();
  });
});

describe('Guard action buttons — staleness dots (the only staleness dots)', () => {
  it('Generate carries the amber dot when the corpus changed since the last generate', () => {
    render(<GuardHeaderActions kind="generate" onClick={() => {}} busy={false} otherBusy={false} stale />);
    expect(screen.getByLabelText('changes not yet generated')).toBeInTheDocument();
  });

  it('Run carries the amber dot when scenarios changed since the last run', () => {
    render(<GuardHeaderActions kind="run" onClick={() => {}} busy={false} otherBusy={false} stale />);
    expect(screen.getByLabelText('changes not yet run')).toBeInTheDocument();
  });

  it('hides the dot while the action runs', () => {
    render(<GuardHeaderActions kind="generate" onClick={() => {}} busy otherBusy={false} stale />);
    expect(screen.queryByLabelText('changes not yet generated')).not.toBeInTheDocument();
  });

  it('shows no dot when nothing is stale', () => {
    render(<GuardHeaderActions kind="run" onClick={() => {}} busy={false} otherBusy={false} />);
    expect(screen.queryByLabelText('changes not yet run')).not.toBeInTheDocument();
  });
});

describe('Guard action buttons — one shared variant', () => {
  it('renders Generate and Run in the same outline variant as Scan/Rescan (not primary/black)', () => {
    stubFetch();
    render(<Harness />);
    for (const btn of [genButton(), runButton()]) {
      // Outline variant signature — the same look as the Spec Scan/Rescan button…
      expect(btn.className).toContain('bg-background');
      // …never the primary/black default that Generate used to render.
      expect(btn.className).not.toContain('bg-primary');
    }
  });
});

describe('Guard completion → refetch (reload key)', () => {
  const INVENTORY: GuardScenarioInventory = {
    recipe: null,
    scenarios: [{ id: 'a1', title: 'alpha claim', doc: 'docs/auth.md', anchor: 'auth/alpha', file: 'core/a1.yaml', handWritten: false }],
  };

  /** The page-level data hook RepoPage hoists for the Scenarios panel + pane. */
  function InventoryProbe({ reloadKey }: { reloadKey: number }) {
    const { rows } = useGuardScenarios('r', true, reloadKey);
    return <div>{rows.map((r) => r.title).join(',')}</div>;
  }

  it('refetches the scenarios inventory when the reload key changes', async () => {
    const calls: { url: string; method: string }[] = [];
    // Route the inventory + latest that the hoisted scenarios hook reads.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const u = String(url);
        calls.push({ url: u, method: 'GET' });
        if (u.includes('/guard/scenarios')) return json(INVENTORY);
        if (u.includes('/guard/latest')) return json({ scenarios: [], run: { runId: 'x' } });
        return json({});
      }),
    );

    const { rerender } = render(<InventoryProbe reloadKey={0} />);
    await screen.findByText('alpha claim');
    const before = calls.filter((c) => c.url.includes('/guard/scenarios')).length;

    // A guard completion bumps the reload key → the inventory refetches.
    rerender(<InventoryProbe reloadKey={1} />);
    await waitFor(() =>
      expect(calls.filter((c) => c.url.includes('/guard/scenarios')).length).toBeGreaterThan(before),
    );
  });
});
