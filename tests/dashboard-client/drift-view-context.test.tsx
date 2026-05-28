/**
 * DriftViewContext owns the BL-Drift panes (spec conflict, canonical
 * viewer, contracts viewer, verify drift tabs) lifted from
 * RepoGraphPage. Pure local state — no router — so tests render the
 * provider directly.
 *
 * Key behaviours pinned here:
 *   - the right pane is single-slot: selecting a conflict clears the
 *     active canonical file and vice-versa;
 *   - canonical/contracts viewers use the transient/pinned tab model;
 *   - reconcileDriftTabs prunes open drift tabs to still-valid ids
 *     (and clears everything when passed null).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DriftViewProvider, useDriftView } from '@/contexts/DriftViewContext';

let api: ReturnType<typeof useDriftView>;
function Probe() {
  api = useDriftView();
  const d = api;
  return (
    <div>
      <span data-testid="conflict">{d.activeSpecConflictId ?? '∅'}</span>
      <span data-testid="canonical">{d.activeCanonicalPath ?? '∅'}</span>
      <span data-testid="canonTabs">{d.openCanonicalFiles.map((f) => `${f.path}${f.pinned ? '*' : ''}`).join(',')}</span>
      <span data-testid="contracts">{d.activeContractsPath ?? '∅'}</span>
      <span data-testid="contractTabs">{d.openContractsFiles.map((f) => f.path).join(',')}</span>
      <span data-testid="drift">{d.activeDriftId ?? '∅'}</span>
      <span data-testid="driftTabs">{d.openDriftTabs.map((t) => t.id).join(',')}</span>

      <button onClick={() => d.handleSelectSpecConflict('c1')}>select-c1</button>
      <button onClick={() => d.handleOpenCanonical('spec/a.md', true)}>open-canon-a</button>
      <button onClick={() => d.handleOpenContracts('contracts/x.ts', false)}>open-contract-x</button>
      <button onClick={() => d.handleOpenContracts('contracts/y.ts', false)}>open-contract-y</button>
      <button onClick={() => d.handleOpenDrift('d1', true)}>open-d1</button>
      <button onClick={() => d.handleOpenDrift('d2', true)}>open-d2</button>
      <button onClick={() => d.handleCloseDrift('d1')}>close-d1</button>
    </div>
  );
}

function renderProvider() {
  return render(
    <DriftViewProvider>
      <Probe />
    </DriftViewProvider>,
  );
}

describe('DriftViewContext — single-slot right pane', () => {
  it('selecting a conflict clears the active canonical file', async () => {
    const user = userEvent.setup();
    renderProvider();
    await user.click(screen.getByText('open-canon-a'));
    expect(screen.getByTestId('canonical')).toHaveTextContent('spec/a.md');
    await user.click(screen.getByText('select-c1'));
    expect(screen.getByTestId('conflict')).toHaveTextContent('c1');
    expect(screen.getByTestId('canonical')).toHaveTextContent('∅');
  });

  it('opening a canonical file clears the active conflict', async () => {
    const user = userEvent.setup();
    renderProvider();
    await user.click(screen.getByText('select-c1'));
    expect(screen.getByTestId('conflict')).toHaveTextContent('c1');
    await user.click(screen.getByText('open-canon-a'));
    expect(screen.getByTestId('canonical')).toHaveTextContent('spec/a.md');
    expect(screen.getByTestId('conflict')).toHaveTextContent('∅');
  });
});

describe('DriftViewContext — viewer tabs', () => {
  it('contracts viewer replaces the transient tab', async () => {
    const user = userEvent.setup();
    renderProvider();
    await user.click(screen.getByText('open-contract-x')); // [x]
    await user.click(screen.getByText('open-contract-y')); // x replaced → [y]
    expect(screen.getByTestId('contractTabs')).toHaveTextContent(/^contracts\/y\.ts$/);
    expect(screen.getByTestId('contracts')).toHaveTextContent('contracts/y.ts');
  });

  it('canonical pinned tab is kept', async () => {
    const user = userEvent.setup();
    renderProvider();
    await user.click(screen.getByText('open-canon-a'));
    expect(screen.getByTestId('canonTabs')).toHaveTextContent('spec/a.md*');
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
