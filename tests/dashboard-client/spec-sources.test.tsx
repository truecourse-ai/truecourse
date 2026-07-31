/**
 * Web spec sources, client side — llms.txt documentation sites registered as
 * spec docs (`truecourse spec source`), as the Spec corpus surface presents them
 * in the app's master–detail shape.
 *
 * Master: a Sources group in the corpus tree, one previewable row per site, with
 * "+" on its header. Detail: the right pane — a source's pages (each one click
 * from its markdown), the links the fetch passed over, refresh/remove; or the
 * focused add view, whose preview→fetch two-step never writes before the confirm.
 * Plus the display mapping that makes a fetched page readable everywhere its raw
 * snapshot ref would otherwise show.
 *
 * Backend stubbed at the fetch boundary — no network, ever.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { GuardStaleness } from '@truecourse/shared';
import { AppProvider } from '@/contexts/CapabilityContext';
import { SpecCorpusView, type SpecCorpusState } from '@/components/spec/SpecCorpusView';
import { SpecDocViewer } from '@/components/spec/SpecDocViewer';
import { GuardCoveragePage } from '@/components/guard/GuardCoveragePage';
import { useGuardCoverageTabs } from '@/hooks/useGuardCoverageTabs';
import type { SpecCorpusResponse, SpecSourceDetailView, SpecSourceView } from '@/lib/api';

const SOURCE_ID = 'docs.strapi.io';
const REF_PREFIX = `.truecourse/specs/sources/${SOURCE_ID}`;
const INSTALL_REF = `${REF_PREFIX}/cms/installation.md`;
const REST_REF = `${REF_PREFIX}/cms/api/rest.md`;

const STRAPI: SpecSourceView = {
  id: SOURCE_ID,
  title: 'Strapi Docs',
  llmsTxtUrl: 'https://docs.strapi.io/llms.txt',
  fetchedAt: '2026-07-29T10:15:00.000Z',
  docCount: 2,
  skipped: [
    { url: 'https://github.com/strapi/strapi', reason: 'external-origin' },
    { url: 'https://docs.strapi.io/cloud/deployment', reason: 'not-markdown', detail: 'content-type: text/html' },
  ],
};

/** The same source with the pages it snapshotted — what the detail pane reads. */
const STRAPI_DETAIL: SpecSourceDetailView = {
  ...STRAPI,
  docs: [
    {
      ref: INSTALL_REF,
      path: 'cms/installation.md',
      title: 'Installation',
      url: 'https://docs.strapi.io/cms/installation.md',
    },
    {
      ref: REST_REF,
      path: 'cms/api/rest.md',
      title: 'REST API',
      url: 'https://docs.strapi.io/cms/api/rest.md',
    },
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

const STALENESS: GuardStaleness = {
  generateStale: false,
  runStale: false,
  hasCorpus: true,
  hasScenarios: false,
  hasGenerated: false,
  hasRun: false,
};

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

const isList = (call: Call): boolean => call.url.endsWith('/spec/sources') && call.method === 'GET';
const isDetail = (call: Call): boolean =>
  call.url.endsWith(`/spec/sources/${SOURCE_ID}`) && call.method === 'GET';

/** The default backend: the registry (list + detail), and nothing else. */
const registry = (sources: SpecSourceView[], detail = STRAPI_DETAIL) => (call: Call) => {
  if (isList(call)) return json({ sources });
  if (isDetail(call)) return json({ source: detail });
  return undefined;
};

/** Surfaces the live query string so URL-synced selection can be asserted. */
function LocationProbe() {
  const loc = useLocation();
  return <span data-testid="search">{loc.search}</span>;
}

/**
 * The exact wiring RepoPage uses for Guard's Coverage tab: the corpus tree as the
 * sidebar and the coverage page as the main pane, sharing ONE tab reducer — which
 * is what makes a source row in the tree open its detail in the pane.
 */
function Surface({ corpus = state() }: { corpus?: SpecCorpusState }) {
  const tabs = useGuardCoverageTabs('r1');
  return (
    <>
      <SpecCorpusView repoId="r1" corpus={corpus} activeKey={tabs.activeId} onOpen={tabs.open} />
      <GuardCoveragePage repoId="r1" corpus={corpus} staleness={STALENESS} staleLoaded tabs={tabs} />
      <LocationProbe />
    </>
  );
}

function renderSurface(corpus?: SpecCorpusState, entries = ['/repos/r1?section=guard&tab=coverage']) {
  return render(
    <MemoryRouter initialEntries={entries}>
      <Surface corpus={corpus} />
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Sources in the corpus tree', () => {
  it('lists each registered source as a row with its page count', async () => {
    stubFetch(registry([STRAPI]));
    render(<SpecCorpusView repoId="r1" corpus={state()} activeKey={null} onOpen={vi.fn()} />);

    expect(await screen.findByText('Strapi Docs')).toBeInTheDocument();
    expect(screen.getByText(/2 pages/)).toBeInTheDocument();
    expect(screen.getByText(/2 skipped/)).toBeInTheDocument();
    // The group sits in the tree with the docs, not pinned to the bottom.
    expect(screen.getByText('Sources')).toBeInTheDocument();
  });

  it('opens a source by its selection key on a single click', async () => {
    stubFetch(registry([STRAPI]));
    const onOpen = vi.fn();
    render(<SpecCorpusView repoId="r1" corpus={state()} activeKey={null} onOpen={onOpen} />);

    await userEvent.click(await screen.findByText('Strapi Docs'));
    expect(onOpen).toHaveBeenCalledWith(`source::${SOURCE_ID}`, false);
  });

  it('shows the shared empty state and the add button when nothing is registered', async () => {
    stubFetch(registry([]));
    render(<SpecCorpusView repoId="r1" corpus={state()} activeKey={null} onOpen={vi.fn()} />);

    expect(await screen.findByText('No sources')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add source' })).toBeInTheDocument();
  });

  it('stays reachable before the first scan — registering a site is a pre-scan action', async () => {
    stubFetch(registry([STRAPI]));
    render(<SpecCorpusView repoId="r1" corpus={state({ data: null })} activeKey={null} onOpen={vi.fn()} />);

    expect(await screen.findByText('No corpus yet')).toBeInTheDocument();
    expect(screen.getByText('Strapi Docs')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add source' })).toBeInTheDocument();
  });

  it('hides the group without a local checkout — the snapshot is working-tree files', async () => {
    const calls = stubFetch(registry([STRAPI]));
    render(
      <AppProvider initial={{ edition: 'enterprise', capabilities: ['sso'] }}>
        <SpecCorpusView repoId="r1" corpus={state()} activeKey={null} onOpen={vi.fn()} />
      </AppProvider>,
    );

    expect(await screen.findByText('Documents')).toBeInTheDocument();
    expect(screen.queryByText('Sources')).not.toBeInTheDocument();
    expect(calls.some(isList)).toBe(false);
  });
});

describe('the source detail pane', () => {
  it('opens from a tree row with the site, its pages and what the fetch skipped', async () => {
    stubFetch(registry([STRAPI]));
    renderSurface();

    await userEvent.click(await screen.findByText('Strapi Docs'));

    // URL-synced selection — the deep link a teammate can be sent.
    await waitFor(() => expect(screen.getByTestId('search').textContent).toContain(`gsrc=${SOURCE_ID}`));

    // Header: where it came from, and when.
    const link = await screen.findByRole('link', { name: /llms\.txt/ });
    expect(link).toHaveAttribute('href', 'https://docs.strapi.io/llms.txt');
    expect(screen.getByText(/fetched/)).toBeInTheDocument();
    // Stats strip.
    expect(screen.getByText('pages kept')).toBeInTheDocument();
    expect(screen.getByText('skipped')).toBeInTheDocument();
    // The pages themselves.
    expect(screen.getByText('Installation')).toBeInTheDocument();
    expect(screen.getByText('cms/installation.md')).toBeInTheDocument();
    // The links no page was written for, each with its reason and its live URL.
    expect(screen.getByText(/links off this site/)).toBeInTheDocument();
    expect(screen.getByText(/page is not markdown/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'https://github.com/strapi/strapi' })).toHaveAttribute(
      'href',
      'https://github.com/strapi/strapi',
    );
  });

  it('opens a page in the doc viewer by its ref', async () => {
    stubFetch((call) => {
      if (call.url.includes('/spec/doc')) return json({ ref: INSTALL_REF, content: '# Installation' });
      return registry([STRAPI])(call);
    });
    renderSurface();

    await userEvent.click(await screen.findByText('Strapi Docs'));
    await userEvent.click(await screen.findByText('Installation'));

    await waitFor(() =>
      expect(screen.getByTestId('search').textContent).toContain(`guard=${encodeURIComponent(INSTALL_REF)}`),
    );
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Installation');
  });

  it('refreshes the site from the header and re-reads it', async () => {
    const calls = stubFetch((call) => {
      if (call.url.endsWith(`/spec/sources/${SOURCE_ID}/refresh`)) {
        return json({ results: [{ source: STRAPI, added: [], changed: [], removed: [], unchanged: 2, skipped: [] }] });
      }
      return registry([STRAPI])(call);
    });
    renderSurface();

    await userEvent.click(await screen.findByText('Strapi Docs'));
    await userEvent.click(await screen.findByRole('button', { name: /Refresh/ }));

    await waitFor(() => expect(calls.filter(isDetail)).toHaveLength(2));
    const refresh = calls.find((c) => c.url.endsWith(`/spec/sources/${SOURCE_ID}/refresh`));
    expect(refresh?.method).toBe('POST');
  });

  it('removes the site and closes its pane', async () => {
    const calls = stubFetch((call) => {
      if (call.url.endsWith(`/spec/sources/${SOURCE_ID}`) && call.method === 'DELETE') {
        return json({ removed: STRAPI });
      }
      return registry([STRAPI])(call);
    });
    renderSurface();

    await userEvent.click(await screen.findByText('Strapi Docs'));
    await userEvent.click(await screen.findByRole('button', { name: /Remove/ }));

    await waitFor(() =>
      expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith(`/spec/sources/${SOURCE_ID}`))).toBe(true),
    );
    // The selection is gone with it — no stale detail left behind.
    await waitFor(() => expect(screen.getByTestId('search').textContent).not.toContain('gsrc='));
    expect(screen.queryByText('pages kept')).not.toBeInTheDocument();
  });

  it('reports a failed action inline instead of silently leaving the pane stale', async () => {
    stubFetch((call) => {
      if (call.url.includes('/refresh')) {
        return json({ error: 'could not read https://docs.strapi.io/llms.txt: HTTP 503' }, 400);
      }
      return registry([STRAPI])(call);
    });
    renderSurface();

    await userEvent.click(await screen.findByText('Strapi Docs'));
    await userEvent.click(await screen.findByRole('button', { name: /Refresh/ }));

    expect(await screen.findByText(/HTTP 503/)).toBeInTheDocument();
  });
});

describe('the add view', () => {
  const PREVIEW = {
    llmsTxtUrl: 'https://docs.strapi.io/llms.txt',
    title: 'Strapi Docs',
    totalLinks: 214,
    fetchableLinks: 198,
    skipped: [{ url: 'https://github.com/strapi/strapi', reason: 'external-origin' }],
  };

  it('previews the site before fetching it, then adds it and lands on its detail', async () => {
    let listed: SpecSourceView[] = [];
    const calls = stubFetch((call) => {
      if (call.url.endsWith('/spec/sources/preview')) return json(PREVIEW);
      if (call.url.endsWith('/spec/sources') && call.method === 'POST') {
        listed = [STRAPI];
        return json({ source: STRAPI, written: 198, skipped: [] });
      }
      return registry(listed)(call);
    });
    renderSurface();

    await userEvent.click(await screen.findByRole('button', { name: 'Add source' }));
    await waitFor(() => expect(screen.getByTestId('search').textContent).toContain('gsrc=*new'));

    await userEvent.type(screen.getByLabelText('llms.txt URL'), 'https://docs.strapi.io/llms.txt');
    await userEvent.click(screen.getByRole('button', { name: 'Check' }));

    // The confirm gate: the page count is on screen BEFORE anything is fetched.
    expect(
      await screen.findByText(/Found “Strapi Docs” — 214 pages \(198 fetchable, 1 skipped\)/),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/spec/sources'))).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'Fetch' }));

    // The new source's detail takes the pane over.
    await waitFor(() => expect(screen.getByTestId('search').textContent).toContain(`gsrc=${SOURCE_ID}`));
    expect(await screen.findByText('pages kept')).toBeInTheDocument();
    const preview = calls.find((c) => c.url.endsWith('/spec/sources/preview'));
    expect(preview?.body).toEqual({ url: 'https://docs.strapi.io/llms.txt' });
    const add = calls.find((c) => c.method === 'POST' && c.url.endsWith('/spec/sources'));
    expect(add?.body).toEqual({ url: 'https://docs.strapi.io/llms.txt' });
  });

  it('surfaces a rejected URL inline and fetches nothing', async () => {
    const calls = stubFetch((call) => {
      if (call.url.endsWith('/spec/sources/preview')) {
        return json({ error: 'not an llms.txt URL: https://docs.strapi.io — pass the site’s llms.txt directly' }, 400);
      }
      return registry([])(call);
    });
    renderSurface();

    await userEvent.click(await screen.findByRole('button', { name: 'Add source' }));
    await userEvent.type(screen.getByLabelText('llms.txt URL'), 'https://docs.strapi.io');
    await userEvent.click(screen.getByRole('button', { name: 'Check' }));

    expect(await screen.findByText(/not an llms.txt URL/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Fetch' })).not.toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/spec/sources'))).toBe(false);
  });

  it('cancels back to the previous selection', async () => {
    stubFetch(registry([STRAPI]));
    renderSurface();

    await userEvent.click(await screen.findByText('Strapi Docs'));
    await waitFor(() => expect(screen.getByTestId('search').textContent).toContain(`gsrc=${SOURCE_ID}`));

    await userEvent.click(screen.getByRole('button', { name: 'Add source' }));
    await waitFor(() => expect(screen.getByTestId('search').textContent).toContain('gsrc=*new'));

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.getByTestId('search').textContent).toContain(`gsrc=${SOURCE_ID}`));
  });
});

describe('web-source docs in the tree', () => {
  it('labels a fetched page "<site> / <page>" with a web badge, never its snapshot ref', async () => {
    stubFetch(registry([STRAPI]));
    render(<SpecCorpusView repoId="r1" corpus={state()} activeKey={null} onOpen={vi.fn()} />);

    expect(await screen.findByText('Strapi Docs / cms/installation.md')).toBeInTheDocument();
    expect(screen.queryByText(INSTALL_REF)).not.toBeInTheDocument();
    // Repo-local docs are untouched.
    expect(screen.getByText('docs/booking.md')).toBeInTheDocument();
    expect(screen.getAllByText('web').length).toBeGreaterThan(0);
  });

  it('maps a dropped page the same way in "Not included"', async () => {
    stubFetch(registry([STRAPI]));
    render(<SpecCorpusView repoId="r1" corpus={state()} activeKey={null} onOpen={vi.fn()} />);

    const section = await screen.findByRole('button', { name: /Not included/ });
    await userEvent.click(section);
    expect(screen.getByText('Strapi Docs / cms/api/rest.md')).toBeInTheDocument();
    expect(screen.queryByText(REST_REF)).not.toBeInTheDocument();
  });

  it('opens the page by its REF — the label is display only', async () => {
    stubFetch(registry([STRAPI]));
    const onOpen = vi.fn();
    render(<SpecCorpusView repoId="r1" corpus={state()} activeKey={null} onOpen={onOpen} />);

    await userEvent.click(await screen.findByText('Strapi Docs / cms/installation.md'));
    expect(onOpen).toHaveBeenCalledWith(INSTALL_REF, false);
  });
});

describe('the coverage pane (the doc viewer an OSS repo actually opens)', () => {
  const RUN_STALENESS: GuardStaleness = { ...STALENESS, hasCorpus: true };

  function Pane() {
    const tabs = useGuardCoverageTabs('r1');
    return <GuardCoveragePage repoId="r1" corpus={state()} staleness={RUN_STALENESS} staleLoaded tabs={tabs} />;
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
