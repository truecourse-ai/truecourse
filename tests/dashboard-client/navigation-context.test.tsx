/**
 * NavigationContext owns the section + active-tab state that used to
 * live inline in RepoGraphPage, with the URL as the source of truth.
 * These tests pin down the behaviours that were previously buried in
 * that 2000-line component:
 *
 *   - initial section/tab resolved from the URL (incl. legacy ?tab
 *     aliases and the file/flow deep-link shortcuts);
 *   - setSection resets to the section default and rewrites the URL;
 *   - setLeftTab writes / clears the ?tab param;
 *   - section + tab are kept coherent (a drift tab requested under the
 *     analysis section snaps back to the section default).
 *
 * Each test mounts the provider under a MemoryRouter at a chosen URL.
 * A LocationProbe surfaces the live query string so URL writes can be
 * asserted without spying on history.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import {
  NavigationProvider,
  useNavigation,
} from '@/contexts/NavigationContext';

function Probe() {
  const { section, leftTab, setSection, setLeftTab } = useNavigation();
  const loc = useLocation();
  return (
    <div>
      <span data-testid="section">{section}</span>
      <span data-testid="tab">{leftTab}</span>
      <span data-testid="search">{loc.search}</span>
      <button onClick={() => setSection('guard')}>to-guard</button>
      <button onClick={() => setSection('codequality')}>to-analysis</button>
      <button onClick={() => setLeftTab('files')}>tab-files</button>
      <button onClick={() => setLeftTab('home')}>tab-home</button>
    </div>
  );
}

function renderAt(initialUrl: string) {
  return render(
    <MemoryRouter initialEntries={[initialUrl]}>
      <NavigationProvider>
        <Probe />
      </NavigationProvider>
    </MemoryRouter>,
  );
}

describe('NavigationContext — initial state from URL', () => {
  it('defaults to codequality/home with no params', () => {
    renderAt('/repos/abc');
    expect(screen.getByTestId('section')).toHaveTextContent('codequality');
    expect(screen.getByTestId('tab')).toHaveTextContent('home');
  });

  it('reads an explicit ?tab', () => {
    renderAt('/repos/abc?tab=files');
    expect(screen.getByTestId('tab')).toHaveTextContent('files');
  });

  // The legacy ?tab=violations/?tab=analytics aliases were retired so the EE Code
  // Quality decomposition could use those clean ids — they now resolve to themselves.
  it('resolves ?tab=violations to the violations tab', () => {
    renderAt('/repos/abc?tab=violations');
    expect(screen.getByTestId('tab')).toHaveTextContent('violations');
  });

  it('resolves ?tab=analytics to the analytics tab', () => {
    renderAt('/repos/abc?tab=analytics');
    expect(screen.getByTestId('tab')).toHaveTextContent('analytics');
  });

  it('infers the flows tab from a ?flow deep link', () => {
    renderAt('/repos/abc?flow=f1');
    expect(screen.getByTestId('tab')).toHaveTextContent('flows');
  });

  it('snaps an out-of-section tab back to the section default', () => {
    // `files` belongs to analysis, not guard → expect the guard default.
    renderAt('/repos/abc?section=guard&tab=files');
    expect(screen.getByTestId('section')).toHaveTextContent('guard');
    expect(screen.getByTestId('tab')).toHaveTextContent('coverage');
  });
});

describe('NavigationContext — guard section routing', () => {
  it('infers the guard section from a guard tab param (no explicit ?section)', () => {
    renderAt('/repos/abc?tab=coverage');
    expect(screen.getByTestId('section')).toHaveTextContent('guard');
    expect(screen.getByTestId('tab')).toHaveTextContent('coverage');
  });

  it('routes ?tab=guarddrifts to the guard section', () => {
    renderAt('/repos/abc?tab=guarddrifts');
    expect(screen.getByTestId('section')).toHaveTextContent('guard');
    expect(screen.getByTestId('tab')).toHaveTextContent('guarddrifts');
  });

  it('reads ?section=guard and defaults its tab to coverage', () => {
    renderAt('/repos/abc?section=guard');
    expect(screen.getByTestId('section')).toHaveTextContent('guard');
    expect(screen.getByTestId('tab')).toHaveTextContent('coverage');
  });

  it('a ?guard=<doc> deep link opens guard/coverage', () => {
    renderAt('/repos/abc?guard=docs%2FSPEC.md&gsec=intro');
    expect(screen.getByTestId('section')).toHaveTextContent('guard');
    expect(screen.getByTestId('tab')).toHaveTextContent('coverage');
  });

  it('a ?gconf=<overlap> conflict deep link opens guard/coverage', () => {
    renderAt('/repos/abc?gconf=overlap%3A%3Acore%2Fauth%3A%3Aa.md%3A%3Ab.md');
    expect(screen.getByTestId('section')).toHaveTextContent('guard');
    expect(screen.getByTestId('tab')).toHaveTextContent('coverage');
  });

  // The retired TEST addresses are not addresses any more: a test has no id the URL
  // knows, so nothing here resolves one. An old link the app itself wrote
  // (`?section=guard&tab=guardflows&gtest=…`) still lands on the Flows tab — its
  // own params say so — with nothing selected; a bare test param implies nothing.
  for (const url of ['?gtest=task-lifecycle.cli.1', '?gscn=a1', '?tab=tests']) {
    it(`the retired ${url} implies no guard tab at all`, () => {
      renderAt(`/repos/abc${url}`);
      expect(screen.getByTestId('section')).toHaveTextContent('codequality');
      expect(screen.getByTestId('tab')).not.toHaveTextContent('guardflows');
    });
  }

  it('an old test link that names the Flows tab still lands there, with nothing selected', () => {
    renderAt('/repos/abc?section=guard&tab=guardflows&gtest=task-lifecycle.cli.1');
    expect(screen.getByTestId('section')).toHaveTextContent('guard');
    expect(screen.getByTestId('tab')).toHaveTextContent('guardflows');
  });

  it('a ?gflow=<flow> deep link opens guard/flows', () => {
    renderAt('/repos/abc?gflow=task-lifecycle');
    expect(screen.getByTestId('section')).toHaveTextContent('guard');
    expect(screen.getByTestId('tab')).toHaveTextContent('guardflows');
  });

  it('a ?gfind=<finding> deep link opens guard/flows (findings live with their flow)', () => {
    renderAt('/repos/abc?gfind=finding%3Atasks%2Fcompleting-tasks%3A0');
    expect(screen.getByTestId('section')).toHaveTextContent('guard');
    expect(screen.getByTestId('tab')).toHaveTextContent('guardflows');
  });

  it('a ?ginterface=<interface> deep link opens guard/interfaces', () => {
    renderAt('/repos/abc?ginterface=cli%2Ftasks-add');
    expect(screen.getByTestId('section')).toHaveTextContent('guard');
    expect(screen.getByTestId('tab')).toHaveTextContent('interfaces');
  });

  // The param was `?gjourney=` before the INTERFACE rename (2026-08-10); a
  // bookmark from then still has to land on the tab it named.
  it('a retired ?gjourney=<interface> deep link opens guard/interfaces too', () => {
    renderAt('/repos/abc?gjourney=cli%2Ftasks-add');
    expect(screen.getByTestId('section')).toHaveTextContent('guard');
    expect(screen.getByTestId('tab')).toHaveTextContent('interfaces');
  });

  // The retired Guard Spec tab (merged into Coverage) — old links must still land.
  it('maps the retired ?tab=guardspec to guard/coverage', () => {
    renderAt('/repos/abc?tab=guardspec');
    expect(screen.getByTestId('section')).toHaveTextContent('guard');
    expect(screen.getByTestId('tab')).toHaveTextContent('coverage');
  });

  // Legacy URLs from the retired GuardView segmented host must still resolve.
  it('maps the legacy ?tab=guard to guard/coverage', () => {
    renderAt('/repos/abc?tab=guard');
    expect(screen.getByTestId('section')).toHaveTextContent('guard');
    expect(screen.getByTestId('tab')).toHaveTextContent('coverage');
  });

  it('maps the legacy ?tab=guard&gview=drifts to the guard drifts tab', () => {
    renderAt('/repos/abc?tab=guard&gview=drifts');
    expect(screen.getByTestId('section')).toHaveTextContent('guard');
    expect(screen.getByTestId('tab')).toHaveTextContent('guarddrifts');
  });

  // The Generate/Report tab folded into the Flows tab (its "last generate" strip),
  // so both the legacy `?gview=report` chain and the retired `?tab=guardreport`
  // land there — as does the retired `?tab=scenarios`.
  it('maps the legacy ?tab=guard&gview=report to the guard flows tab', () => {
    renderAt('/repos/abc?tab=guard&gview=report');
    expect(screen.getByTestId('section')).toHaveTextContent('guard');
    expect(screen.getByTestId('tab')).toHaveTextContent('guardflows');
  });

  it('maps the retired ?tab=guardreport to the guard flows tab', () => {
    renderAt('/repos/abc?tab=guardreport');
    expect(screen.getByTestId('section')).toHaveTextContent('guard');
    expect(screen.getByTestId('tab')).toHaveTextContent('guardflows');
  });

  it('maps the retired ?tab=scenarios to the guard flows tab', () => {
    renderAt('/repos/abc?tab=scenarios');
    expect(screen.getByTestId('section')).toHaveTextContent('guard');
    expect(screen.getByTestId('tab')).toHaveTextContent('guardflows');
  });
});

describe('NavigationContext — setters write the URL', () => {
  it('setSection(guard) switches section, resets tab, sets ?section=guard&tab=coverage', async () => {
    const user = userEvent.setup();
    renderAt('/repos/abc');
    await user.click(screen.getByText('to-guard'));

    expect(screen.getByTestId('section')).toHaveTextContent('guard');
    expect(screen.getByTestId('tab')).toHaveTextContent('coverage');
    const search = screen.getByTestId('search').textContent ?? '';
    expect(search).toContain('section=guard');
    expect(search).toContain('tab=coverage');
  });

  it('setSection(codequality) clears the guard ?section and lands on home (no ?tab)', async () => {
    const user = userEvent.setup();
    renderAt('/repos/abc?section=guard');
    await user.click(screen.getByText('to-analysis'));

    expect(screen.getByTestId('section')).toHaveTextContent('codequality');
    expect(screen.getByTestId('tab')).toHaveTextContent('home');
    const search = screen.getByTestId('search').textContent ?? '';
    expect(search).not.toContain('section=guard');
    expect(search).not.toContain('tab=');
  });

  it('setLeftTab(files) writes ?tab=files', async () => {
    const user = userEvent.setup();
    renderAt('/repos/abc');
    await user.click(screen.getByText('tab-files'));

    expect(screen.getByTestId('tab')).toHaveTextContent('files');
    expect(screen.getByTestId('search').textContent ?? '').toContain('tab=files');
  });

  it('setLeftTab(home) strips the ?tab param', async () => {
    const user = userEvent.setup();
    renderAt('/repos/abc?tab=files');
    await user.click(screen.getByText('tab-home'));

    expect(screen.getByTestId('tab')).toHaveTextContent('home');
    expect(screen.getByTestId('search').textContent ?? '').not.toContain('tab=');
  });
});

describe('NavigationContext — guard', () => {
  it('throws if useNavigation is used outside the provider', () => {
    function Bare() {
      useNavigation();
      return null;
    }
    // Swallow the expected React error boundary console noise.
    const spy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    expect(() =>
      render(
        <MemoryRouter>
          <Bare />
        </MemoryRouter>,
      ),
    ).toThrow(/useNavigation must be used inside/);
    spy.mockRestore();
  });
});
