/**
 * ViewModeContext owns the diff toggle (mirrored to ?view=diff),
 * historical-analysis selection, and graph path highlight — the view
 * "slice" state lifted out of RepoGraphPage. Uses BrowserRouter +
 * history so the window.location-based URL writes behave as in
 * production (see open-tabs-context.test.tsx for the rationale).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { ViewModeProvider, useViewMode } from '@/contexts/ViewModeContext';

function Probe() {
  const v = useViewMode();
  return (
    <div>
      <span data-testid="diff">{v.isDiffMode ? 'on' : 'off'}</span>
      <span data-testid="analysis">{v.selectedAnalysisId ?? '∅'}</span>
      <span data-testid="path">{v.selectedPath ?? '∅'}</span>
      <span data-testid="search">{window.location.search}</span>
      <button onClick={() => v.setIsDiffMode(true)}>diff-on</button>
      <button onClick={() => v.setIsDiffMode(false)}>diff-off</button>
      <button onClick={() => v.setSelectedAnalysisId('an1')}>pick-an1</button>
      <button onClick={() => v.setSelectedPath('src/x.ts')}>pick-path</button>
    </div>
  );
}

function renderAt(initialUrl = '/repos/abc') {
  window.history.replaceState({}, '', initialUrl);
  return render(
    <BrowserRouter>
      <ViewModeProvider>
        <Probe />
      </ViewModeProvider>
    </BrowserRouter>,
  );
}

describe('ViewModeContext — diff mode', () => {
  it('reads initial diff mode from ?view=diff', () => {
    renderAt('/repos/abc?view=diff');
    expect(screen.getByTestId('diff')).toHaveTextContent('on');
  });

  it('defaults diff mode off', () => {
    renderAt('/repos/abc');
    expect(screen.getByTestId('diff')).toHaveTextContent('off');
  });

  it('setIsDiffMode(true) writes ?view=diff', async () => {
    const user = userEvent.setup();
    renderAt();
    await user.click(screen.getByText('diff-on'));
    expect(screen.getByTestId('diff')).toHaveTextContent('on');
    expect(screen.getByTestId('search').textContent ?? '').toContain('view=diff');
  });

  it('setIsDiffMode(false) clears ?view', async () => {
    const user = userEvent.setup();
    renderAt('/repos/abc?view=diff');
    await user.click(screen.getByText('diff-off'));
    expect(screen.getByTestId('diff')).toHaveTextContent('off');
    expect(screen.getByTestId('search').textContent ?? '').not.toContain('view=diff');
  });
});

describe('ViewModeContext — selection state', () => {
  it('tracks selected analysis id', async () => {
    const user = userEvent.setup();
    renderAt();
    expect(screen.getByTestId('analysis')).toHaveTextContent('∅');
    await user.click(screen.getByText('pick-an1'));
    expect(screen.getByTestId('analysis')).toHaveTextContent('an1');
  });

  it('tracks selected path highlight', async () => {
    const user = userEvent.setup();
    renderAt();
    await user.click(screen.getByText('pick-path'));
    expect(screen.getByTestId('path')).toHaveTextContent('src/x.ts');
  });
});

describe('ViewModeContext — guard', () => {
  it('throws if useViewMode is used outside the provider', () => {
    function Bare() {
      useViewMode();
      return null;
    }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      render(
        <BrowserRouter>
          <Bare />
        </BrowserRouter>,
      ),
    ).toThrow(/useViewMode must be used inside/);
    spy.mockRestore();
  });
});
