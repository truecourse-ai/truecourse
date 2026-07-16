/**
 * Guard UI-triggered actions: the Generate estimate-gate flow (GET estimate → the
 * reused LlmEstimateModal with the CLI-identical numbers → POST with the confirmed
 * flag), the deterministic Run trigger (no modal), the in-flight disabled state,
 * the action-button staleness dots (the ONLY staleness dots — the rail carries
 * none, per the BL-Drift-matching dot policy pinned in guard-view tests), and the
 * completion → refetch mechanism (the reload key the page bumps on a
 * `spec:complete` guard event). Fetch is stubbed the house way (URL-routed
 * `vi.stubGlobal('fetch', …)`); the Generate/Run buttons + modal are mounted in a
 * harness that mirrors RepoPage's page-level wiring.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GuardScenarioInventory } from '@truecourse/shared';
import { useGuardGenerate } from '@/hooks/useGuardGenerate';
import { useGuardRun } from '@/hooks/useGuardRun';
import { useGuardScenarios } from '@/hooks/useGuardScenarios';
import { GuardHeaderActions } from '@/components/guard/GuardHeaderActions';
import { LlmEstimateModal } from '@/components/spec/LlmEstimateModal';
import type { LlmEstimateData } from '@/hooks/useSocket';

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

const STAGED: LlmEstimateData = {
  totalEstimatedTokens: 42000,
  tiers: [],
  stages: [
    { stage: 'guardExtract', label: 'Extracting claims', model: 'sonnet', calls: 3, estimatedTokens: 12000, estimatedCostUsd: 0.12 },
    { stage: 'guardAuthor', label: 'Authoring scenarios', model: 'opus', calls: 5, estimatedTokens: 30000, callsRange: { low: 2, high: 8 }, estimatedCostUsd: 0.88 },
  ],
  subjectLabel: '4 of 12 sections changed',
  estimatedCostUsd: 1.0,
  costSource: 'bundled',
};

const EMPTY: LlmEstimateData = { totalEstimatedTokens: 0, tiers: [], stages: [] };

/** A URL-routed fetch stub; `opts.estimate` chooses the estimate; `opts.onGenerate`
 *  lets a test gate the generate POST (e.g. hang it to observe the in-flight state). */
function stubFetch(opts: { estimate?: LlmEstimateData; onGenerate?: () => Promise<void> } = {}) {
  const calls: { url: string; method: string; body?: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      calls.push({ url: u, method, body: init?.body as string | undefined });
      if (u.includes('/guard/estimate')) return json({ estimate: opts.estimate ?? STAGED });
      if (u.includes('/guard/generate')) {
        if (opts.onGenerate) await opts.onGenerate();
        return json({ status: 'ok', noChanges: false, written: 2, birthFindings: 0 });
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
      {gen.modalOpen && gen.estimate && (
        <LlmEstimateModal estimate={gen.estimate} onConfirm={gen.confirm} onCancel={gen.cancel} />
      )}
    </>
  );
}

// `/generat/i` matches both the idle "Generate" and the in-flight "Generating…".
const genButton = () => screen.getByRole('button', { name: /generat/i });
const runButton = () => screen.getByRole('button', { name: /^run/i });

afterEach(() => vi.unstubAllGlobals());

describe('Guard Generate — estimate gate', () => {
  it('opens the estimate modal with the CLI-identical numbers', async () => {
    stubFetch({ estimate: STAGED });
    render(<Harness />);
    await userEvent.click(genButton());

    // The staged modal: subject, per-stage table, and the ceiling cost.
    await screen.findByText('4 of 12 sections changed', { exact: false });
    expect(screen.getByText('Extracting claims')).toBeInTheDocument();
    expect(screen.getByText('Authoring scenarios')).toBeInTheDocument();
    expect(screen.getByText('$0.12')).toBeInTheDocument();
    expect(screen.getByText('$0.88')).toBeInTheDocument();
    // The author stage's call RANGE renders low–high.
    expect(screen.getByText('2–8')).toBeInTheDocument();
  });

  it('confirming triggers the generate with confirmed=true and closes the modal', async () => {
    const calls = stubFetch({ estimate: STAGED });
    render(<Harness />);
    await userEvent.click(genButton());
    await screen.findByRole('button', { name: 'Proceed' });

    await userEvent.click(screen.getByRole('button', { name: 'Proceed' }));

    await waitFor(() => {
      const post = calls.find((c) => c.url.includes('/guard/generate') && c.method === 'POST');
      expect(post).toBeTruthy();
      expect(JSON.parse(post!.body ?? '{}')).toEqual({ confirmed: true });
    });
    // Modal closed after confirming.
    expect(screen.queryByRole('button', { name: 'Proceed' })).not.toBeInTheDocument();
  });

  it('skips the modal and triggers directly when nothing changed (no stages)', async () => {
    const calls = stubFetch({ estimate: EMPTY });
    render(<Harness />);
    await userEvent.click(genButton());

    await waitFor(() => expect(calls.some((c) => c.url.includes('/guard/generate') && c.method === 'POST')).toBe(true));
    // No modal was ever shown.
    expect(screen.queryByRole('button', { name: 'Proceed' })).not.toBeInTheDocument();
    const post = calls.find((c) => c.url.includes('/guard/generate'));
    expect(JSON.parse(post!.body ?? '{}')).toEqual({ confirmed: true });
  });

  it('disables both guard buttons while a generate is in flight', async () => {
    let release!: () => void;
    const pending = new Promise<void>((r) => { release = r; });
    stubFetch({ estimate: EMPTY, onGenerate: () => pending });
    render(<Harness />);
    await userEvent.click(genButton());

    // begin() → estimate (empty) → trigger → the POST hangs → busy true.
    await waitFor(() => expect(genButton()).toBeDisabled());
    expect(runButton()).toBeDisabled();

    release();
    await waitFor(() => expect(genButton()).not.toBeDisabled());
  });
});

// A mode-aware estimate stub: the `?mode=` query picks which estimate to return,
// echoing the mode + whether the choice is available (item 5).
function stubFetchModes(byMode: Record<string, LlmEstimateData>, canChooseMode = true) {
  const calls: { url: string; method: string; body?: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      calls.push({ url: u, method, body: init?.body as string | undefined });
      if (u.includes('/guard/estimate')) {
        const mode = new URL(u, 'http://x').searchParams.get('mode') ?? 'economical';
        return json({ estimate: byMode[mode], mode, canChooseMode });
      }
      if (u.includes('/guard/generate')) return json({ status: 'ok', noChanges: false, written: 2, birthFindings: 0 });
      return json({});
    }),
  );
  return calls;
}

/** RepoPage-style wiring: the modal gains the fast-vs-economical choice (item 5). */
function ModeHarness() {
  const gen = useGuardGenerate('r');
  return (
    <>
      <GuardHeaderActions kind="generate" onClick={gen.begin} busy={gen.busy} otherBusy={false} />
      {gen.modalOpen && gen.estimate && (
        <LlmEstimateModal
          estimate={gen.estimate}
          onConfirm={gen.confirm}
          onCancel={gen.cancel}
          modeChoice={{ mode: gen.mode, canChoose: gen.canChooseMode, onChange: gen.setMode, busy: gen.busy }}
        />
      )}
    </>
  );
}

describe('Guard Generate — fast-vs-economical choice (item 5)', () => {
  const ALPHA: LlmEstimateData = { ...STAGED, subjectLabel: 'ALPHA-SUBJECT' };
  const BETA: LlmEstimateData = { ...STAGED, subjectLabel: 'BETA-SUBJECT' };

  it('re-estimates for the picked mode and confirms with that mode', async () => {
    const calls = stubFetchModes({ economical: ALPHA, fast: BETA });
    render(<ModeHarness />);
    await userEvent.click(genButton());
    // Opens pre-selected on the remembered (economical) estimate.
    await screen.findByText('ALPHA-SUBJECT', { exact: false });

    // Pick Fast → re-fetch with ?mode=fast, the mode-scoped numbers replace them.
    await userEvent.click(screen.getByRole('button', { name: /Fast/ }));
    await screen.findByText('BETA-SUBJECT', { exact: false });
    expect(calls.some((c) => c.url.includes('mode=fast'))).toBe(true);

    // Confirm → the POST carries the chosen mode.
    await userEvent.click(screen.getByRole('button', { name: 'Proceed' }));
    await waitFor(() => {
      const post = calls.find((c) => c.url.includes('/guard/generate') && c.method === 'POST');
      expect(JSON.parse(post!.body ?? '{}')).toEqual({ confirmed: true, mode: 'fast' });
    });
  });

  it('hides the choice when unavailable (TRUECOURSE_GENERATE_BATCH override)', async () => {
    stubFetchModes({ economical: ALPHA }, false);
    render(<ModeHarness />);
    await userEvent.click(genButton());
    await screen.findByRole('button', { name: 'Proceed' });
    expect(screen.queryByRole('button', { name: /Economical/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Fast/ })).not.toBeInTheDocument();
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
    expect(screen.getByLabelText('ungenerated changes')).toBeInTheDocument();
  });

  it('Run carries the amber dot when scenarios changed since the last run', () => {
    render(<GuardHeaderActions kind="run" onClick={() => {}} busy={false} otherBusy={false} stale />);
    expect(screen.getByLabelText('unrun changes')).toBeInTheDocument();
  });

  it('hides the dot while the action runs', () => {
    render(<GuardHeaderActions kind="generate" onClick={() => {}} busy otherBusy={false} stale />);
    expect(screen.queryByLabelText('ungenerated changes')).not.toBeInTheDocument();
  });

  it('shows no dot when nothing is stale', () => {
    render(<GuardHeaderActions kind="run" onClick={() => {}} busy={false} otherBusy={false} />);
    expect(screen.queryByLabelText('unrun changes')).not.toBeInTheDocument();
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
