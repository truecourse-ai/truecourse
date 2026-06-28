/**
 * SpecCorpusView — the curated-corpus Spec tab. Renders areas + their overlaps,
 * resolves an open overlap inline by recording a doc→doc relation (POST
 * /spec/relations), then re-reads the corpus so the overlap shows resolved.
 * Backend is stubbed at the fetch boundary (the component calls /spec/corpus,
 * /spec/doc, /spec/relations through api.ts).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SpecCorpusView } from '../../apps/dashboard/client/src/components/spec/SpecCorpusView';

const AREA = {
  id: 'booking/appointments',
  product: 'booking',
  concern: 'appointments',
  docRefs: ['docs/v1.md', 'docs/v2.md'],
  overlaps: [{ docs: ['docs/v1.md', 'docs/v2.md'], note: '24h vs 48h cancellation' }],
};
const corpus = (userRelations: unknown[]) => ({
  corpus: {
    version: 3,
    generatedAt: '2026-01-01T00:00:00Z',
    docs: [
      { ref: 'docs/v1.md', kind: 'prd', lastTouched: '2026-01-01T00:00:00Z', areaTags: ['booking/appointments'] },
      { ref: 'docs/v2.md', kind: 'prd', lastTouched: '2026-02-01T00:00:00Z', areaTags: ['booking/appointments'] },
    ],
    areas: [AREA],
    relations: [],
  },
  userRelations,
});

let resolved: boolean;
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  resolved = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, opts?: RequestInit) => {
      const u = String(url);
      if (u.includes('/spec/relations') && opts?.method === 'POST') {
        resolved = true;
        return json({ relations: [{ type: 'precedence', older: 'docs/v1.md', newer: 'docs/v2.md', scope: 'booking/appointments', detectedFrom: 'manual' }] });
      }
      if (u.includes('/spec/doc')) return json({ ref: 'docs/v2.md', content: '# v2\n48h window.' });
      if (u.includes('/spec/corpus')) {
        return json(corpus(resolved ? [{ type: 'precedence', older: 'docs/v1.md', newer: 'docs/v2.md', scope: 'booking/appointments', detectedFrom: 'manual' }] : []));
      }
      return new Response('{}', { status: 404 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('SpecCorpusView', () => {
  it('renders areas + an open overlap with resolution buttons', async () => {
    render(<SpecCorpusView repoId="r1" />);
    expect(await screen.findByText('booking/appointments')).toBeInTheDocument();
    expect(screen.getByText('v1.md')).toBeInTheDocument();
    expect(screen.getByText('24h vs 48h cancellation')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Precedence' })).toBeInTheDocument();
  });

  it('resolves an overlap into a relation, then shows it resolved', async () => {
    const user = userEvent.setup();
    render(<SpecCorpusView repoId="r1" />);
    await user.click(await screen.findByRole('button', { name: 'Precedence' }));
    await waitFor(() => expect(screen.getByText(/Resolved →/)).toBeInTheDocument());
    expect(screen.getByText(/Precedence/)).toBeInTheDocument();
  });

  it('shows the Scan empty state when no corpus exists', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
    render(<SpecCorpusView repoId="r1" />);
    expect(await screen.findByText('No corpus yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Scan/ })).toBeInTheDocument();
  });
});
