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
      <button onClick={() => setSection('drift')}>to-drift</button>
      <button onClick={() => setSection('analysis')}>to-analysis</button>
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
  it('defaults to analysis/home with no params', () => {
    renderAt('/repos/abc');
    expect(screen.getByTestId('section')).toHaveTextContent('analysis');
    expect(screen.getByTestId('tab')).toHaveTextContent('home');
  });

  it('reads ?section=drift and defaults its tab to spec', () => {
    renderAt('/repos/abc?section=drift');
    expect(screen.getByTestId('section')).toHaveTextContent('drift');
    expect(screen.getByTestId('tab')).toHaveTextContent('spec');
  });

  it('reads an explicit ?tab', () => {
    renderAt('/repos/abc?tab=files');
    expect(screen.getByTestId('tab')).toHaveTextContent('files');
  });

  it('honours the legacy ?tab=violations alias', () => {
    renderAt('/repos/abc?tab=violations');
    expect(screen.getByTestId('tab')).toHaveTextContent('graphs');
  });

  it('honours the legacy ?tab=analytics alias', () => {
    renderAt('/repos/abc?tab=analytics');
    expect(screen.getByTestId('tab')).toHaveTextContent('home');
  });

  it('infers the flows tab from a ?flow deep link', () => {
    renderAt('/repos/abc?flow=f1');
    expect(screen.getByTestId('tab')).toHaveTextContent('flows');
  });

  it('snaps an out-of-section tab back to the section default', () => {
    // `files` belongs to analysis, not drift → expect the drift default.
    renderAt('/repos/abc?section=drift&tab=files');
    expect(screen.getByTestId('section')).toHaveTextContent('drift');
    expect(screen.getByTestId('tab')).toHaveTextContent('spec');
  });
});

describe('NavigationContext — setters write the URL', () => {
  it('setSection(drift) switches section, resets tab, sets ?section=drift&tab=spec', async () => {
    const user = userEvent.setup();
    renderAt('/repos/abc');
    await user.click(screen.getByText('to-drift'));

    expect(screen.getByTestId('section')).toHaveTextContent('drift');
    expect(screen.getByTestId('tab')).toHaveTextContent('spec');
    const search = screen.getByTestId('search').textContent ?? '';
    expect(search).toContain('section=drift');
    expect(search).toContain('tab=spec');
  });

  it('setSection(analysis) clears ?section and lands on home (no ?tab)', async () => {
    const user = userEvent.setup();
    renderAt('/repos/abc?section=drift');
    await user.click(screen.getByText('to-analysis'));

    expect(screen.getByTestId('section')).toHaveTextContent('analysis');
    expect(screen.getByTestId('tab')).toHaveTextContent('home');
    const search = screen.getByTestId('search').textContent ?? '';
    expect(search).not.toContain('section=drift');
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
