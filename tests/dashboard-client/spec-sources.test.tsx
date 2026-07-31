/**
 * Web spec sources, client side — llms.txt documentation sites registered as
 * spec docs (`truecourse spec source`), as the Spec corpus sidebar presents them.
 *
 * Covers the External sources block (rows + their skipped links, the honest empty
 * state, the add flow's preview→fetch two-step, refresh/remove), and the display
 * mapping that makes a fetched page readable everywhere its raw snapshot ref
 * would otherwise show: `<site> / <page>` plus a web badge in the doc tree, and
 * the source + a link to the live page in the doc viewer.
 *
 * Backend stubbed at the fetch boundary — no network, ever.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { GuardStaleness } from '@truecourse/shared';
import { SpecCorpusView, type SpecCorpusState } from '@/components/spec/SpecCorpusView';
import { SpecDocViewer } from '@/components/spec/SpecDocViewer';
import { GuardCoveragePage } from '@/components/guard/GuardCoveragePage';
import { useGuardCoverageTabs } from '@/hooks/useGuardCoverageTabs';
import type { SpecCorpusResponse, SpecSourceView } from '@/lib/api';

const SOURCE_ID = 'docs.strapi.io';
const INSTALL_REF = `.truecourse/specs/sources/${SOURCE_ID}/cms/installation.md`;
const REST_REF = `.truecourse/specs/sources/${SOURCE_ID}/cms/api/rest.md`;

const STRAPI: SpecSourceView = {
  id: SOURCE_ID,
  title: 'Strapi Docs',
  llmsTxtUrl: 'https://docs.strapi.io/llms.txt',
  fetchedAt: '2026-07-29T10:15:00.000Z',
  docCount: 214,
  skipped: [
    { url: 'https://github.com/strapi/strapi', reason: 'external-origin' },
    { url: 'https://docs.strapi.io/cloud/deployment', reason: 'not-markdown', detail: 'content-type: text/html' },
  ],
};

/** A repo corpus that already folded in two pages of the site. */
const RESP: SpecCorpusResponse = {
  corpus: {
    version: 3,
    generatedAt: '2026-07-29T12:00:00Z',
    docs: [
      { ref: 'docs/booking.md', kind: 'prd', lastTouched: '2026-01-01T00:00:00Z', areaTags: ['booking/appointments'] },
      {
        ref: INSTALL_REF,
        kind: 'guide',
        lastTouched: '2026-07-29T10:15:00Z',
        areaTags: ['cms/install'],
        origin: 'web',
        sourceId: SOURCE_ID,
        sourceTitle: 'Strapi Docs',
        url: 'https://docs.strapi.io/cms/installation.md',
      },
    ],
    areas: [],
    skippedDocs: [
      {
        ref: REST_REF,
        reason: 'not about this repo',
        origin: 'web',
        sourceId: SOURCE_ID,
        sourceTitle: 'Strapi Docs',
        url: 'https://docs.strapi.io/cms/api/rest.md',
      },
    ],
  },
};

const state = (over: Partial<SpecCorpusState> = {}): SpecCorpusState => ({
  data: RESP,
  hydrating: false,
  scanning: false,
  error: null,
  corpusCommit: null,
  scan: vi.fn(),
  refetch: vi.fn(),
  apply: vi.fn(),
  applyDecisions: vi.fn(),
  applyConflictResolutions: vi.fn(),
  ...over,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

interface Call {
  url: string;
  method: string;
  body: unknown;
}

/**
 * Stub `fetch` with a per-request handler and record what the UI asked for.
 * Unhandled requests fail loudly rather than silently resolving to `{}`.
 */
function stubFetch(handler: (call: Call) => Response | undefined): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const call: Call = {
        url: String(input),
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      };
      calls.push(call);
      const res = handler(call);
      if (!res) throw new Error(`unstubbed request: ${call.method} ${call.url}`);
      return res;
    }),
  );
  return calls;
}

/** The default backend: the sources list, and nothing else. */
const sourcesOnly = (sources: SpecSourceView[]) => (call: Call) =>
  call.url.endsWith('/spec/sources') && call.method === 'GET' ? json({ sources }) : undefined;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('External sources block', () => {
  it('lists each registered source with its page count, last fetch and skipped links', async () => {
    stubFetch(sourcesOnly([STRAPI]));
    render(<SpecCorpusView repoId="r1" corpus={state()} activeKey={null} onOpen={vi.fn()} />);

    expect(await screen.findByText('Strapi Docs')).toBeInTheDocument();
    expect(screen.getByText(/214 pages/)).toBeInTheDocument();
    expect(screen.getByText(/2 skipped/)).toBeInTheDocument();

    // The row expands to what the fetch passed over, with the reason per link.
    await userEvent.click(screen.getByText('Strapi Docs'));
    expect(screen.getByText('https://docs.strapi.io/llms.txt')).toBeInTheDocument();
    expect(screen.getByText(/Skipped \(2\)/)).toBeInTheDocument();
    expect(screen.getByText(/github\.com\/strapi\/strapi — links off this site/)).toBeInTheDocument();
    expect(screen.getByText(/cloud\/deployment — page is not markdown/)).toBeInTheDocument();
  });

  it('shows the shared empty state when nothing is registered', async () => {
    stubFetch(sourcesOnly([]));
    render(<SpecCorpusView repoId="r1" corpus={state()} activeKey={null} onOpen={vi.fn()} />);

    // Collapsed by default with no sources — the block never nags a repo that
    // has none, but its header is right there.
    const header = await screen.findByRole('button', { name: /External sources/ });
    await userEvent.click(header);
    expect(await screen.findByText('No external sources')).toBeInTheDocument();
    expect(screen.getByLabelText('llms.txt URL')).toBeInTheDocument();
  });

  it('previews the site before fetching it, then adds it and re-reads the list', async () => {
    let listed: SpecSourceView[] = [];
    const calls = stubFetch((call) => {
      if (call.url.endsWith('/spec/sources') && call.method === 'GET') return json({ sources: listed });
      if (call.url.endsWith('/spec/sources/preview')) {
        return json({
          llmsTxtUrl: 'https://docs.strapi.io/llms.txt',
          title: 'Strapi Docs',
          totalLinks: 214,
          fetchableLinks: 198,
          skipped: [{ url: 'https://github.com/strapi/strapi', reason: 'external-origin' }],
        });
      }
      if (call.url.endsWith('/spec/sources') && call.method === 'POST') {
        listed = [STRAPI];
        return json({ source: STRAPI, written: 198, skipped: [] });
      }
      return undefined;
    });

    render(<SpecCorpusView repoId="r1" corpus={state()} activeKey={null} onOpen={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: /External sources/ }));

    await userEvent.type(screen.getByLabelText('llms.txt URL'), 'https://docs.strapi.io/llms.txt');
    await userEvent.click(screen.getByRole('button', { name: 'Check' }));

    // The confirm gate: the page count is shown BEFORE anything is fetched.
    expect(await screen.findByText(/Found “Strapi Docs” — 214 pages \(198 fetchable\)/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/spec/sources'))).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'Fetch' }));

    await waitFor(() => expect(screen.getByText(/214 pages/)).toBeInTheDocument());
    const preview = calls.find((c) => c.url.endsWith('/spec/sources/preview'));
    expect(preview?.body).toEqual({ url: 'https://docs.strapi.io/llms.txt' });
    const add = calls.find((c) => c.method === 'POST' && c.url.endsWith('/spec/sources'));
    expect(add?.body).toEqual({ url: 'https://docs.strapi.io/llms.txt' });
    // The input is cleared for the next site.
    expect(screen.getByLabelText('llms.txt URL')).toHaveValue('');
  });

  it('surfaces a rejected URL inline and fetches nothing', async () => {
    const calls = stubFetch((call) => {
      if (call.url.endsWith('/spec/sources') && call.method === 'GET') return json({ sources: [] });
      if (call.url.endsWith('/spec/sources/preview')) {
        return json({ error: 'not an llms.txt URL: https://docs.strapi.io — pass the site’s llms.txt directly' }, 400);
      }
      return undefined;
    });

    render(<SpecCorpusView repoId="r1" corpus={state()} activeKey={null} onOpen={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: /External sources/ }));
    await userEvent.type(screen.getByLabelText('llms.txt URL'), 'https://docs.strapi.io');
    await userEvent.click(screen.getByRole('button', { name: 'Check' }));

    expect(await screen.findByText(/not an llms.txt URL/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Fetch' })).not.toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/spec/sources'))).toBe(false);
  });

  it('refreshes one source and re-reads the list', async () => {
    const calls = stubFetch((call) => {
      if (call.url.endsWith('/spec/sources') && call.method === 'GET') return json({ sources: [STRAPI] });
      if (call.url.endsWith(`/spec/sources/${SOURCE_ID}/refresh`)) {
        return json({ results: [{ source: STRAPI, added: [], changed: [], removed: [], unchanged: 214, skipped: [] }] });
      }
      return undefined;
    });

    render(<SpecCorpusView repoId="r1" corpus={state()} activeKey={null} onOpen={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Refresh Strapi Docs' }));

    await waitFor(() =>
      expect(calls.filter((c) => c.url.endsWith('/spec/sources') && c.method === 'GET')).toHaveLength(2),
    );
    const refresh = calls.find((c) => c.url.endsWith(`/spec/sources/${SOURCE_ID}/refresh`));
    expect(refresh?.method).toBe('POST');
  });

  it('removes a source without opening its detail (the row action stops there)', async () => {
    const calls = stubFetch((call) => {
      if (call.url.endsWith('/spec/sources') && call.method === 'GET') return json({ sources: [STRAPI] });
      if (call.url.endsWith(`/spec/sources/${SOURCE_ID}`) && call.method === 'DELETE') {
        return json({ removed: STRAPI });
      }
      return undefined;
    });

    render(<SpecCorpusView repoId="r1" corpus={state()} activeKey={null} onOpen={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Remove Strapi Docs' }));

    await waitFor(() =>
      expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith(`/spec/sources/${SOURCE_ID}`))).toBe(true),
    );
    // The inline action never toggled the row open.
    expect(screen.queryByText('https://docs.strapi.io/llms.txt')).not.toBeInTheDocument();
  });

  it('stays reachable before the first scan — registering a site is a pre-scan action', async () => {
    stubFetch(sourcesOnly([STRAPI]));
    render(<SpecCorpusView repoId="r1" corpus={state({ data: null })} activeKey={null} onOpen={vi.fn()} />);

    expect(await screen.findByText('No corpus yet')).toBeInTheDocument();
    expect(screen.getByText('Strapi Docs')).toBeInTheDocument();
  });

  it('reports a failed action inline instead of silently leaving the list stale', async () => {
    stubFetch((call) => {
      if (call.url.endsWith('/spec/sources') && call.method === 'GET') return json({ sources: [STRAPI] });
      if (call.url.includes('/refresh')) return json({ error: 'could not read https://docs.strapi.io/llms.txt: HTTP 503' }, 400);
      return undefined;
    });

    render(<SpecCorpusView repoId="r1" corpus={state()} activeKey={null} onOpen={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Refresh Strapi Docs' }));

    expect(await screen.findByText(/HTTP 503/)).toBeInTheDocument();
  });
});

describe('web-source docs in the tree', () => {
  it('labels a fetched page "<site> / <page>" with a web badge, never its snapshot ref', async () => {
    stubFetch(sourcesOnly([STRAPI]));
    render(<SpecCorpusView repoId="r1" corpus={state()} activeKey={null} onOpen={vi.fn()} />);

    expect(await screen.findByText('Strapi Docs / cms/installation.md')).toBeInTheDocument();
    expect(screen.queryByText(INSTALL_REF)).not.toBeInTheDocument();
    // Repo-local docs are untouched.
    expect(screen.getByText('docs/booking.md')).toBeInTheDocument();
    expect(screen.getAllByText('web').length).toBeGreaterThan(0);
  });

  it('maps a dropped page the same way in "Not included"', async () => {
    stubFetch(sourcesOnly([STRAPI]));
    render(<SpecCorpusView repoId="r1" corpus={state()} activeKey={null} onOpen={vi.fn()} />);

    const section = await screen.findByRole('button', { name: /Not included/ });
    await userEvent.click(section);
    expect(screen.getByText('Strapi Docs / cms/api/rest.md')).toBeInTheDocument();
    expect(screen.queryByText(REST_REF)).not.toBeInTheDocument();
  });

  it('opens the page by its REF — the label is display only', async () => {
    stubFetch(sourcesOnly([STRAPI]));
    const onOpen = vi.fn();
    render(<SpecCorpusView repoId="r1" corpus={state()} activeKey={null} onOpen={onOpen} />);

    await userEvent.click(await screen.findByText('Strapi Docs / cms/installation.md'));
    expect(onOpen).toHaveBeenCalledWith(INSTALL_REF, false);
  });
});

describe('the coverage pane (the doc viewer an OSS repo actually opens)', () => {
  const STALENESS: GuardStaleness = {
    generateStale: false,
    runStale: false,
    hasCorpus: true,
    hasScenarios: false,
    hasGenerated: false,
    hasRun: false,
  };

  function Pane() {
    const tabs = useGuardCoverageTabs('r1');
    return <GuardCoveragePage repoId="r1" corpus={state()} staleness={STALENESS} staleLoaded tabs={tabs} />;
  }

  it('heads a fetched page with its source and a link to the live page', async () => {
    stubFetch((call) => {
      if (call.url.includes('/spec/doc')) return json({ ref: INSTALL_REF, content: '# Installation' });
      if (call.url.includes('/spec/sources')) return json({ sources: [STRAPI] });
      return undefined;
    });

    render(
      <MemoryRouter initialEntries={[`/repos/r1?guard=${encodeURIComponent(INSTALL_REF)}`]}>
        <Pane />
      </MemoryRouter>,
    );

    const link = await screen.findByRole('link', { name: /docs\.strapi\.io\/cms\/installation\.md/ });
    expect(link).toHaveAttribute('href', 'https://docs.strapi.io/cms/installation.md');
    // The tab reads as the page, not the snapshot path.
    expect(screen.getAllByText('Strapi Docs / cms/installation.md').length).toBeGreaterThan(0);
  });
});

describe('SpecDocViewer — a fetched page', () => {
  it('heads the doc with its source and links out to the live page', async () => {
    stubFetch((call) =>
      call.url.includes('/spec/doc') ? json({ ref: INSTALL_REF, content: '# Installation\n\nStrapi runs on Node 20.' }) : undefined,
    );

    render(
      <SpecDocViewer
        repoId="r1"
        docRef={INSTALL_REF}
        sourceTitle="Strapi Docs"
        url="https://docs.strapi.io/cms/installation.md"
      />,
    );

    expect(await screen.findByText('Strapi Docs / cms/installation.md')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Open source' });
    expect(link).toHaveAttribute('href', 'https://docs.strapi.io/cms/installation.md');
    expect(within(await screen.findByRole('heading', { level: 1 })).getByText('Installation')).toBeInTheDocument();
  });

  it('falls back to the source id when the site is no longer registered', async () => {
    stubFetch((call) => (call.url.includes('/spec/doc') ? json({ ref: INSTALL_REF, content: '# Installation' }) : undefined));

    render(<SpecDocViewer repoId="r1" docRef={INSTALL_REF} />);

    expect(await screen.findByText(`${SOURCE_ID} / cms/installation.md`)).toBeInTheDocument();
  });
});
