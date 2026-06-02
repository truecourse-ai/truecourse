/**
 * GraphViewContext owns the architecture graph's depth/scope/focus
 * state that used to live in RepoGraphPage, with ?mode/?scopeService/
 * ?scopeModule as the source of truth. These tests pin the URL
 * round-tripping and the depth→scope rules that were previously buried
 * in the god component:
 *
 *   - initial depth/scope read from the URL (incl. the functions↔methods
 *     term mapping);
 *   - setDepthLevel's per-level URL writes (services strips scope,
 *     modules keeps service / drops module, methods restores both);
 *   - setScoped* writes;
 *   - locateNode setting depth + scope + focus in one navigation, with
 *     focus deferred across a depth change.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import {
  GraphViewProvider,
  useGraphView,
} from '@/contexts/GraphViewContext';

function Probe() {
  const g = useGraphView();
  const loc = useLocation();
  return (
    <div>
      <span data-testid="depth">{g.depthLevel}</span>
      <span data-testid="svc">{g.scopedServiceId ?? '∅'}</span>
      <span data-testid="mod">{g.scopedModuleId ?? '∅'}</span>
      <span data-testid="focus">{g.focusRequest?.nodeId ?? '∅'}</span>
      <span data-testid="search">{loc.search}</span>
      <button onClick={() => g.setDepthLevel('services')}>d-services</button>
      <button onClick={() => g.setDepthLevel('modules')}>d-modules</button>
      <button onClick={() => g.setDepthLevel('methods')}>d-methods</button>
      <button onClick={() => g.setScopedServiceId('svcA')}>scope-svcA</button>
      <button onClick={() => g.locateNode('n1', 'modules', { serviceId: 'svcB' })}>
        locate-deep
      </button>
      <button onClick={() => g.locateNode('n2')}>locate-same</button>
    </div>
  );
}

function renderAt(initialUrl: string) {
  return render(
    <MemoryRouter initialEntries={[initialUrl]}>
      <GraphViewProvider>
        <Probe />
      </GraphViewProvider>
    </MemoryRouter>,
  );
}

describe('GraphViewContext — initial state from URL', () => {
  it('defaults to services depth, no scope', () => {
    renderAt('/repos/abc');
    expect(screen.getByTestId('depth')).toHaveTextContent('services');
    expect(screen.getByTestId('svc')).toHaveTextContent('∅');
    expect(screen.getByTestId('mod')).toHaveTextContent('∅');
  });

  it('maps ?mode=functions → methods depth and reads scope params', () => {
    renderAt('/repos/abc?mode=functions&scopeService=s1&scopeModule=m1');
    expect(screen.getByTestId('depth')).toHaveTextContent('methods');
    expect(screen.getByTestId('svc')).toHaveTextContent('s1');
    expect(screen.getByTestId('mod')).toHaveTextContent('m1');
  });

  it('maps ?mode=modules → modules depth', () => {
    renderAt('/repos/abc?mode=modules');
    expect(screen.getByTestId('depth')).toHaveTextContent('modules');
  });
});

describe('GraphViewContext — setDepthLevel URL rules', () => {
  it('services strips mode + both scope params', async () => {
    const user = userEvent.setup();
    renderAt('/repos/abc?mode=functions&scopeService=s1&scopeModule=m1');
    await user.click(screen.getByText('d-services'));
    const s = screen.getByTestId('search').textContent ?? '';
    expect(s).not.toContain('mode=');
    expect(s).not.toContain('scopeService=');
    expect(s).not.toContain('scopeModule=');
  });

  it('modules sets mode=modules, keeps scopeService, drops scopeModule', async () => {
    const user = userEvent.setup();
    renderAt('/repos/abc?mode=functions&scopeService=s1&scopeModule=m1');
    await user.click(screen.getByText('d-modules'));
    const s = screen.getByTestId('search').textContent ?? '';
    expect(s).toContain('mode=modules');
    expect(s).toContain('scopeService=s1');
    expect(s).not.toContain('scopeModule=');
  });

  it('methods sets mode=functions; scope is NOT restored after a services round-trip', async () => {
    const user = userEvent.setup();
    // Carried-over behaviour from the original component: setDepthLevel
    // tries to restore scope "from memory", but the URL-sync effect
    // clears in-memory scope the moment we visit `services` (which
    // strips the scope params). So a services round-trip loses the
    // scope — this asserts the real, ported behaviour, not the
    // aspirational "keep in memory" comment. (Latent quirk, left as-is
    // to keep the extraction behaviour-preserving.)
    renderAt('/repos/abc?mode=functions&scopeService=s1&scopeModule=m1');
    await user.click(screen.getByText('d-services'));
    await user.click(screen.getByText('d-methods'));
    const s = screen.getByTestId('search').textContent ?? '';
    expect(s).toContain('mode=functions');
    expect(s).not.toContain('scopeService=');
    expect(s).not.toContain('scopeModule=');
  });

  it('methods keeps scope when reached directly (no services round-trip)', async () => {
    const user = userEvent.setup();
    // From modules with a service scoped, going to methods preserves the
    // service scope (in-memory value survives because we never hit
    // services to clear it).
    renderAt('/repos/abc?mode=modules&scopeService=s1');
    await user.click(screen.getByText('d-methods'));
    const s = screen.getByTestId('search').textContent ?? '';
    expect(s).toContain('mode=functions');
    expect(s).toContain('scopeService=s1');
  });
});

describe('GraphViewContext — scope setter + locateNode', () => {
  it('setScopedServiceId writes ?scopeService', async () => {
    const user = userEvent.setup();
    renderAt('/repos/abc');
    await user.click(screen.getByText('scope-svcA'));
    expect(screen.getByTestId('svc')).toHaveTextContent('svcA');
    expect(screen.getByTestId('search').textContent ?? '').toContain(
      'scopeService=svcA',
    );
  });

  it('locateNode at the same depth focuses immediately', async () => {
    const user = userEvent.setup();
    renderAt('/repos/abc'); // services depth; locate-same passes no depth
    await user.click(screen.getByText('locate-same'));
    expect(screen.getByTestId('focus')).toHaveTextContent('n2');
  });

  it('locateNode across a depth change sets depth+scope now, focus after a delay', () => {
    vi.useFakeTimers();
    try {
      renderAt('/repos/abc'); // start at services
      // Can't use userEvent with fake timers easily; click directly.
      act(() => {
        screen.getByText('locate-deep').click();
      });
      // Depth + scope + URL update synchronously…
      expect(screen.getByTestId('depth')).toHaveTextContent('modules');
      expect(screen.getByTestId('svc')).toHaveTextContent('svcB');
      const s = screen.getByTestId('search').textContent ?? '';
      expect(s).toContain('mode=modules');
      expect(s).toContain('scopeService=svcB');
      // …but focus is deferred until the canvas remounts at the new depth.
      expect(screen.getByTestId('focus')).toHaveTextContent('∅');
      act(() => {
        vi.advanceTimersByTime(600);
      });
      expect(screen.getByTestId('focus')).toHaveTextContent('n1');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('GraphViewContext — guard', () => {
  it('throws if useGraphView is used outside the provider', () => {
    function Bare() {
      useGraphView();
      return null;
    }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      render(
        <MemoryRouter>
          <Bare />
        </MemoryRouter>,
      ),
    ).toThrow(/useGraphView must be used inside/);
    spy.mockRestore();
  });
});
