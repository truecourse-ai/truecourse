/**
 * DriftViewContext owns the BL-Drift panes (corpus Spec tab viewer,
 * contracts viewer, verify drift tabs) lifted from RepoGraphPage. The
 * spec/contracts viewers mirror their active path to the URL
 * (?spec / ?contract), so the harness renders under a BrowserRouter and
 * resets the URL per test.
 *
 * Key behaviours pinned here:
 *   - spec/contracts viewers use the transient/pinned tab model and
 *     mirror the active path to the URL;
 *   - reconcileDriftTabs prunes open drift tabs to still-valid ids
 *     (and clears everything when passed null).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { DriftViewProvider, useDriftView } from '@/contexts/DriftViewContext';

let api: ReturnType<typeof useDriftView>;
function Probe() {
  api = useDriftView();
  const d = api;
  return (
    <div>
      <span data-testid="spec">{d.activeSpecPath ?? '∅'}</span>
      <span data-testid="specTabs">{d.openSpecTabs.map((f) => `${f.path}${f.pinned ? '*' : ''}`).join(',')}</span>
      <span data-testid="contracts">{d.activeContractsPath ?? '∅'}</span>
      <span data-testid="contractTabs">{d.openContractsFiles.map((f) => f.path).join(',')}</span>
      <span data-testid="drift">{d.activeDriftId ?? '∅'}</span>
      <span data-testid="driftTabs">{d.openDriftTabs.map((t) => t.id).join(',')}</span>

      <button onClick={() => d.handleOpenSpec('spec/a.md', true)}>open-spec-a</button>
      <button onClick={() => d.handleOpenContracts('contracts/x.ts', false)}>open-contract-x</button>
      <button onClick={() => d.handleOpenContracts('contracts/y.ts', false)}>open-contract-y</button>
      <button onClick={() => d.handleOpenDrift('d1', true)}>open-d1</button>
      <button onClick={() => d.handleOpenDrift('d2', true)}>open-d2</button>
      <button onClick={() => d.handleCloseDrift('d1')}>close-d1</button>
    </div>
  );
}

function renderProvider() {
  window.history.replaceState({}, '', '/repos/abc');
  return render(
    <BrowserRouter>
      <DriftViewProvider>
        <Probe />
      </DriftViewProvider>
    </BrowserRouter>,
  );
}

describe('DriftViewContext — viewer tabs', () => {
  it('contracts viewer replaces the transient tab', async () => {
    const user = userEvent.setup();
    renderProvider();
    await user.click(screen.getByText('open-contract-x')); // [x]
    await user.click(screen.getByText('open-contract-y')); // x replaced → [y]
    expect(screen.getByTestId('contractTabs')).toHaveTextContent(/^contracts\/y\.ts$/);
    expect(screen.getByTestId('contracts')).toHaveTextContent('contracts/y.ts');
  });

  it('spec pinned tab is kept', async () => {
    const user = userEvent.setup();
    renderProvider();
    await user.click(screen.getByText('open-spec-a'));
    expect(screen.getByTestId('specTabs')).toHaveTextContent('spec/a.md*');
    expect(screen.getByTestId('spec')).toHaveTextContent('spec/a.md');
  });
});

describe('DriftViewContext — verify drift tabs', () => {
  it('opens, activates, and closes drift tabs with fallback', async () => {
    const user = userEvent.setup();
    renderProvider();
    await user.click(screen.getByText('open-d1')); // [d1], active d1
    await user.click(screen.getByText('open-d2')); // [d1, d2], active d2
    expect(screen.getByTestId('driftTabs')).toHaveTextContent('d1,d2');
    expect(screen.getByTestId('drift')).toHaveTextContent('d2');
    await user.click(screen.getByText('close-d1')); // active d2 unaffected
    expect(screen.getByTestId('driftTabs')).toHaveTextContent(/^d2$/);
    expect(screen.getByTestId('drift')).toHaveTextContent('d2');
  });

  it('reconcileDriftTabs prunes tabs to valid ids', async () => {
    const user = userEvent.setup();
    renderProvider();
    await user.click(screen.getByText('open-d1'));
    await user.click(screen.getByText('open-d2'));
    act(() => api.reconcileDriftTabs(new Set(['d2'])));
    expect(screen.getByTestId('driftTabs')).toHaveTextContent(/^d2$/);
    // active was d2 → still valid
    expect(screen.getByTestId('drift')).toHaveTextContent('d2');
  });

  it('reconcileDriftTabs(null) clears everything', async () => {
    const user = userEvent.setup();
    renderProvider();
    await user.click(screen.getByText('open-d1'));
    act(() => api.reconcileDriftTabs(null));
    expect(screen.getByTestId('driftTabs')).toHaveTextContent('');
    expect(screen.getByTestId('drift')).toHaveTextContent('∅');
  });
});

describe('DriftViewContext — URL sync', () => {
  it('mirrors the open spec / contracts file to the URL', async () => {
    const user = userEvent.setup();
    renderProvider();
    await user.click(screen.getByText('open-spec-a'));
    expect(new URLSearchParams(window.location.search).get('spec')).toBe('spec/a.md');
    await user.click(screen.getByText('open-contract-x'));
    expect(new URLSearchParams(window.location.search).get('contract')).toBe('contracts/x.ts');
  });

  it('restores the active spec file from the URL on mount', () => {
    window.history.replaceState({}, '', '/repos/abc?spec=spec/from-url.md');
    render(
      <BrowserRouter>
        <DriftViewProvider>
          <Probe />
        </DriftViewProvider>
      </BrowserRouter>,
    );
    expect(screen.getByTestId('spec')).toHaveTextContent('spec/from-url.md');
    expect(screen.getByTestId('specTabs')).toHaveTextContent('spec/from-url.md*');
  });

  it('mirrors the selected drift to ?drift and clears it when reconciled away', async () => {
    const user = userEvent.setup();
    renderProvider();
    await user.click(screen.getByText('open-d1'));
    expect(new URLSearchParams(window.location.search).get('drift')).toBe('d1');
    // A re-run that no longer contains d1 prunes the selection + the URL param.
    act(() => api.reconcileDriftTabs(new Set(['d2'])));
    expect(new URLSearchParams(window.location.search).get('drift')).toBeNull();
  });

  it('restores the selected drift from the URL on mount', () => {
    window.history.replaceState({}, '', '/repos/abc?drift=d-from-url');
    render(
      <BrowserRouter>
        <DriftViewProvider>
          <Probe />
        </DriftViewProvider>
      </BrowserRouter>,
    );
    expect(screen.getByTestId('drift')).toHaveTextContent('d-from-url');
    expect(screen.getByTestId('driftTabs')).toHaveTextContent('d-from-url');
  });
});

describe('DriftViewContext — guard', () => {
  it('throws if useDriftView is used outside the provider', () => {
    function Bare() {
      useDriftView();
      return null;
    }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Bare />)).toThrow(/useDriftView must be used inside/);
    spy.mockRestore();
  });
});
