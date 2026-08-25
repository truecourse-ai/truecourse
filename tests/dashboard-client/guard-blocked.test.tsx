/**
 * Spec Guard "generation blocked on open conflicts" — what the RUNS tab says.
 *
 * When birth generation ends `open-conflicts` there are no scenarios and no runs,
 * so the Runs tab's no-run state must not read "nobody has run guard yet": it says
 * what is actually true, and routes to the one place a conflict is resolved (the
 * Coverage tab, URL `section=guard&tab=coverage`).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
import { GuardDriftsView } from '@/components/guard/GuardDriftsView';

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const notFound = () => new Response(JSON.stringify({ error: 'nope' }), { status: 404 });

afterEach(() => vi.unstubAllGlobals());

describe('GuardDriftsView — blocked-on-conflicts no-run note', () => {
  function stubNoRun() {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const u = String(url);
        if (u.includes('/guard/latest')) return notFound();
        if (u.includes('/guard/history')) return json({ runs: [] });
        return json({});
      }),
    );
  }

  function LocationProbe() {
    const [params] = useSearchParams();
    return <div data-testid="qs">{params.toString()}</div>;
  }

  function renderView(blocked: boolean) {
    return render(
      <MemoryRouter initialEntries={['/repos/r?section=guard&tab=guarddrifts']}>
        <GuardDriftsView repoId="r" blockedOnConflicts={blocked} />
        <LocationProbe />
      </MemoryRouter>,
    );
  }

  it('shows the blocked note instead of "No guard run yet" and routes to Coverage', async () => {
    const user = userEvent.setup();
    stubNoRun();
    renderView(true);
    expect(await screen.findByText('Blocked by open spec conflicts')).toBeInTheDocument();
    expect(screen.queryByText('No guard run yet')).not.toBeInTheDocument();
    // No CLI command in the EE blocked note.
    expect(screen.queryByText('truecourse guard run')).not.toBeInTheDocument();
    await user.click(screen.getByText('Resolve them on the Coverage tab'));
    const qs = new URLSearchParams(screen.getByTestId('qs').textContent ?? '');
    expect(qs.get('section')).toBe('guard');
    expect(qs.get('tab')).toBe('coverage');
  });

  it('falls back to the normal "No guard run yet" empty state when not blocked', async () => {
    stubNoRun();
    renderView(false);
    expect(await screen.findByText('No guard run yet')).toBeInTheDocument();
    expect(screen.queryByText('Blocked by open spec conflicts')).not.toBeInTheDocument();
  });
});
