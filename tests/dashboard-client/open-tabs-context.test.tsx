/**
 * OpenTabsContext owns the Files / Flows / Databases viewer tabs that
 * used to live in RepoGraphPage. It consumes NavigationContext for tab
 * switching, so the harness wraps it in <NavigationProvider> under a
 * MemoryRouter. A probe surfaces the tab lists, active ids, the active
 * left tab (from navigation), and the URL so each behaviour can be
 * asserted.
 *
 * Behaviours pinned here (previously buried in the god component):
 *   - open replaces the single transient tab but appends pinned ones;
 *   - opening a viewer flips the left rail to its tab + writes the URL;
 *   - show*View are mutually exclusive (one detail pane at a time);
 *   - closing the active tab falls back to the last remaining one;
 *   - handleLeftTabChange reopens the last item of an empty viewer;
 *   - syncFlowNames replaces placeholder names once the list loads.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter, useLocation } from 'react-router-dom';
import { NavigationProvider, useNavigation } from '@/contexts/NavigationContext';
import { OpenTabsProvider, useOpenTabs } from '@/contexts/OpenTabsContext';

// These contexts build URLs from `window.location.href` (the original
// component's pattern) and rely on navigate() updating it — which only
// happens under BrowserRouter (the History API), not MemoryRouter. So
// these tests use BrowserRouter and seed the URL via history, exactly
// matching how the code runs in production.

function Probe() {
  const t = useOpenTabs();
  const { leftTab } = useNavigation();
  const loc = useLocation();
  return (
    <div>
      <span data-testid="files">{t.openFiles.map((f) => `${f.path}${f.pinned ? '*' : ''}`).join(',')}</span>
      <span data-testid="activeFile">{t.activeFilePath ?? '∅'}</span>
      <span data-testid="flows">{t.openFlows.map((f) => `${f.id}:${f.name}`).join(',')}</span>
      <span data-testid="activeFlow">{t.activeFlowId ?? '∅'}</span>
      <span data-testid="dbs">{t.openDatabases.map((d) => d.id).join(',')}</span>
      <span data-testid="activeDb">{t.activeDbId ?? '∅'}</span>
      <span data-testid="tab">{leftTab}</span>
      <span data-testid="search">{loc.search}</span>

      <button onClick={() => t.handleOpenFile('a.ts', false)}>open-a-transient</button>
      <button onClick={() => t.handleOpenFile('b.ts', false)}>open-b-transient</button>
      <button onClick={() => t.handleOpenFile('c.ts', true)}>open-c-pinned</button>
      <button onClick={() => t.handleCloseFile('a.ts')}>close-a</button>
      <button onClick={() => t.handleOpenFlow('f1', 'Flow One', true)}>open-f1</button>
      <button onClick={() => t.handleOpenDatabase('d1', 'DB One', true)}>open-d1</button>
      <button onClick={() => t.showFlowView('f1')}>show-f1</button>
      <button onClick={() => t.handleLeftTabChange('files')}>tab-files</button>
      <button onClick={() => t.handleLeftTabChange('home')}>tab-home</button>
      <button onClick={() => t.syncFlowNames([{ id: 'f1', name: 'Renamed' }])}>sync-names</button>
    </div>
  );
}

function renderAt(initialUrl = '/repos/abc') {
  window.history.replaceState({}, '', initialUrl);
  return render(
    <BrowserRouter>
      <NavigationProvider>
        <OpenTabsProvider>
          <Probe />
        </OpenTabsProvider>
      </NavigationProvider>
    </BrowserRouter>,
  );
}

describe('OpenTabsContext — files', () => {
  it('opening a file activates it, flips to Files tab, and writes ?file', async () => {
    const user = userEvent.setup();
    renderAt();
    await user.click(screen.getByText('open-c-pinned'));
    expect(screen.getByTestId('activeFile')).toHaveTextContent('c.ts');
    expect(screen.getByTestId('tab')).toHaveTextContent('files');
    expect(screen.getByTestId('search').textContent ?? '').toContain('file=c.ts');
  });

  it('a transient tab is replaced by the next transient open; pinned tabs accumulate', async () => {
    const user = userEvent.setup();
    renderAt();
    await user.click(screen.getByText('open-a-transient')); // [a]
    await user.click(screen.getByText('open-b-transient')); // a replaced → [b]
    expect(screen.getByTestId('files')).toHaveTextContent(/^b\.ts$/);
    await user.click(screen.getByText('open-c-pinned')); // [b, c*]
    expect(screen.getByTestId('files')).toHaveTextContent('b.ts,c.ts*');
  });

  it('closing the active file falls back to the last remaining tab', async () => {
    const user = userEvent.setup();
    renderAt();
    await user.click(screen.getByText('open-c-pinned')); // [c*], active c
    await user.click(screen.getByText('open-a-transient')); // [c*, a], active a
    await user.click(screen.getByText('close-a'));
    expect(screen.getByTestId('files')).toHaveTextContent(/^c\.ts\*$/);
    expect(screen.getByTestId('activeFile')).toHaveTextContent('c.ts');
  });
});

describe('OpenTabsContext — mutual exclusivity & restore', () => {
  it('showFlowView clears any active file/db', async () => {
    const user = userEvent.setup();
    renderAt();
    await user.click(screen.getByText('open-c-pinned')); // active file c
    await user.click(screen.getByText('open-f1')); // opens + shows flow f1
    await user.click(screen.getByText('show-f1'));
    expect(screen.getByTestId('activeFlow')).toHaveTextContent('f1');
    expect(screen.getByTestId('activeFile')).toHaveTextContent('∅');
  });

  it('handleLeftTabChange reopens the last file when entering an empty Files tab', async () => {
    const user = userEvent.setup();
    renderAt();
    await user.click(screen.getByText('open-c-pinned')); // [c*], active c, tab files
    await user.click(screen.getByText('tab-home')); // home clears ?file → active null
    expect(screen.getByTestId('activeFile')).toHaveTextContent('∅');
    await user.click(screen.getByText('tab-files')); // re-enter empty Files
    expect(screen.getByTestId('activeFile')).toHaveTextContent('c.ts');
  });
});

describe('OpenTabsContext — flows & databases', () => {
  it('opening a flow activates it and flips to Flows tab', async () => {
    const user = userEvent.setup();
    renderAt();
    await user.click(screen.getByText('open-f1'));
    expect(screen.getByTestId('activeFlow')).toHaveTextContent('f1');
    expect(screen.getByTestId('tab')).toHaveTextContent('flows');
    expect(screen.getByTestId('search').textContent ?? '').toContain('flow=f1');
  });

  it('opening a database activates it and flips to Databases tab', async () => {
    const user = userEvent.setup();
    renderAt();
    await user.click(screen.getByText('open-d1'));
    expect(screen.getByTestId('activeDb')).toHaveTextContent('d1');
    expect(screen.getByTestId('tab')).toHaveTextContent('databases');
  });

  it('syncFlowNames replaces the placeholder name once the list loads', async () => {
    const user = userEvent.setup();
    renderAt('/repos/abc?flow=f1'); // URL restore → open flow named 'Flow'
    expect(screen.getByTestId('flows')).toHaveTextContent('f1:Flow');
    await user.click(screen.getByText('sync-names'));
    expect(screen.getByTestId('flows')).toHaveTextContent('f1:Renamed');
  });
});

describe('OpenTabsContext — initial URL + guard', () => {
  it('restores an open file from ?file', () => {
    renderAt('/repos/abc?file=x.ts');
    expect(screen.getByTestId('files')).toHaveTextContent('x.ts*');
    expect(screen.getByTestId('activeFile')).toHaveTextContent('x.ts');
  });

  it('throws if useOpenTabs is used outside the provider', () => {
    function Bare() {
      useOpenTabs();
      return null;
    }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      render(
        <BrowserRouter>
          <NavigationProvider>
            <Bare />
          </NavigationProvider>
        </BrowserRouter>,
      ),
    ).toThrow(/useOpenTabs must be used inside/);
    spy.mockRestore();
  });
});
