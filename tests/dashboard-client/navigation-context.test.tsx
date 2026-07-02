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
      <button onClick={() => setSection('verification')}>to-drift</button>
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

  it('reads ?section=verification and defaults its tab to verify', () => {
    renderAt('/repos/abc?section=verification');
    expect(screen.getByTestId('section')).toHaveTextContent('verification');
    expect(screen.getByTestId('tab')).toHaveTextContent('verify');
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
    // `files` belongs to analysis, not drift → expect the drift default.
    renderAt('/repos/abc?section=verification&tab=files');
    expect(screen.getByTestId('section')).toHaveTextContent('verification');
    expect(screen.getByTestId('tab')).toHaveTextContent('verify');
  });
});

describe('NavigationContext — setters write the URL', () => {
  it('setSection(verification) switches section, resets tab, sets ?section=verification&tab=verify', async () => {
    const user = userEvent.setup();
    renderAt('/repos/abc');
    await user.click(screen.getByText('to-drift'));

    expect(screen.getByTestId('section')).toHaveTextContent('verification');
    expect(screen.getByTestId('tab')).toHaveTextContent('verify');
    const search = screen.getByTestId('search').textContent ?? '';
    expect(search).toContain('section=verification');
    expect(search).toContain('tab=verify');
  });

  it('setSection(codequality) clears ?section and lands on home (no ?tab)', async () => {
    const user = userEvent.setup();
    renderAt('/repos/abc?section=verification');
    await user.click(screen.getByText('to-analysis'));

    expect(screen.getByTestId('section')).toHaveTextContent('codequality');
    expect(screen.getByTestId('tab')).toHaveTextContent('home');
    const search = screen.getByTestId('search').textContent ?? '';
    expect(search).not.toContain('section=verification');
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
