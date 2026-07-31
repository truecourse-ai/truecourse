/**
 * Web spec sources, client side — llms.txt documentation sites registered as
 * spec docs (`truecourse spec source`), as the dedicated SOURCES PAGE presents
 * them.
 *
 * The page owns the full width: one row per site (title, llms.txt link, what the
 * last fetch produced, Refresh + Remove), a row's detail opening inside it
 * (stats, every fetched page, the links passed over with reasons), and the add
 * flow — URL → Check → preview → Fetch — which never writes before the confirm.
 * With nothing registered the page IS the add flow, under ONE empty state.
 *
 * Plus the two things the corpus surface keeps: the display mapping that makes a
 * fetched page readable wherever its raw snapshot ref would otherwise show, and
 * the pre-scan pointer at this page. The corpus tree itself no longer manages
 * sources at all.
 *
 * Backend stubbed at the fetch boundary — no network, ever.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { GuardStaleness } from '@truecourse/shared';
import { AppProvider } from '@/contexts/CapabilityContext';
import { LeftSidebar } from '@/components/layout/LeftSidebar';
import { SpecCorpusView, type SpecCorpusState } from '@/components/spec/SpecCorpusView';
import { SpecDocViewer } from '@/components/spec/SpecDocViewer';
import { SpecSourcesPage } from '@/components/spec/SpecSourcesPage';
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

/** The same source with the pages it snapshotted — what a row's detail reads. */
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
const isAdd = (call: Call): boolean => call.url.endsWith('/spec/sources') && call.method === 'POST';

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

const SOURCES_URL = '/repos/r1?section=guard&tab=sources';

function renderPage(entries = [SOURCES_URL]) {
  return render(
    <MemoryRouter initialEntries={entries}>
      <SpecSourcesPage repoId="r1" />
      <LocationProbe />
    </MemoryRouter>,
  );
}

/**
 * The Sources page and the Coverage pane in one tree, sharing the URL — the
 * wiring RepoPage gives them, and what makes a fetched page's row jump into the
 * doc viewer on the other tab.
 */
function CrossTabSurface() {
  const tabs = useGuardCoverageTabs('r1');
  return (
    <>
      <SpecSourcesPage repoId="r1" />
      <GuardCoveragePage repoId="r1" corpus={state()} staleness={STALENESS} staleLoaded tabs={tabs} />
      <LocationProbe />
    </>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the Sources page — the registered sites', () => {
  it('renders one row per site with its llms.txt, what the fetch produced, and when', async () => {
    stubFetch(registry([STRAPI]));
    renderPage();

    expect(await screen.findByText('Strapi Docs')).toBeInTheDocument();
    expect(screen.getByText('2 pages kept')).toBeInTheDocument();
    expect(screen.getByText('2 skipped')).toBeInTheDocument();
    expect(screen.getByText(/fetched/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /llms\.txt/ })).toHaveAttribute(
      'href',
      'https://docs.strapi.io/llms.txt',
    );
    // Both site-level actions are on the row itself.
    expect(screen.getByRole('button', { name: /Refresh/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Remove/ })).toBeInTheDocument();
  });

  it('opens the detail inside the row on a single click, URL-synced', async () => {
    stubFetch(registry([STRAPI]));
    renderPage();

    // The page list is a list until a row is opened — no page bodies up front.
    expect(await screen.findByText('Strapi Docs')).toBeInTheDocument();
    expect(screen.queryByText('Installation')).not.toBeInTheDocument();

    await userEvent.click(screen.getByText('Strapi Docs'));

    // The deep link a teammate can be sent.
    await waitFor(() => expect(screen.getByTestId('search').textContent).toContain(`gsrc=${SOURCE_ID}`));

    // Stats, the pages themselves, and the links no page was written for.
    expect(await screen.findByText('Pages (2)')).toBeInTheDocument();
    expect(screen.getByText('Skipped (2)')).toBeInTheDocument();
    expect(screen.getByText('Installation')).toBeInTheDocument();
    expect(screen.getByText('cms/installation.md')).toBeInTheDocument();
    expect(screen.getByText(/links off this site/)).toBeInTheDocument();
    expect(screen.getByText(/page is not markdown/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'https://github.com/strapi/strapi' })).toHaveAttribute(
      'href',
      'https://github.com/strapi/strapi',
    );
  });

  it('lands on the row a `?gsrc=` deep link names', async () => {
    stubFetch(registry([STRAPI]));
    renderPage([`${SOURCES_URL}&gsrc=${SOURCE_ID}`]);

    expect(await screen.findByText('Installation')).toBeInTheDocument();
  });

  it('closes the detail when the open row is clicked again', async () => {
    stubFetch(registry([STRAPI]));
    renderPage();

    await userEvent.click(await screen.findByText('Strapi Docs'));
    expect(await screen.findByText('Installation')).toBeInTheDocument();

    await userEvent.click(screen.getByText('Strapi Docs'));
    await waitFor(() => expect(screen.queryByText('Installation')).not.toBeInTheDocument());
    expect(screen.getByTestId('search').textContent).not.toContain('gsrc=');
  });

  it('opens a fetched page in the Coverage doc viewer, on the tab that owns docs', async () => {
    stubFetch((call) => {
      if (call.url.includes('/spec/doc')) return json({ ref: INSTALL_REF, content: '# Installation' });
      return registry([STRAPI])(call);
    });
    render(
      <MemoryRouter initialEntries={[SOURCES_URL]}>
        <CrossTabSurface />
      </MemoryRouter>,
    );

    await userEvent.click(await screen.findByText('Strapi Docs'));
    await userEvent.click(await screen.findByText('Installation'));

    const search = () => screen.getByTestId('search').textContent ?? '';
    await waitFor(() => expect(search()).toContain(`guard=${encodeURIComponent(INSTALL_REF)}`));
    // The jump lands the Coverage tab and drops the sources selection behind it.
    expect(search()).toContain('tab=coverage');
    expect(search()).not.toContain('gsrc=');
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Installation');
  });

  it('refreshes a site from its row and re-reads both the row and its detail', async () => {
    const calls = stubFetch((call) => {
      if (call.url.endsWith(`/spec/sources/${SOURCE_ID}/refresh`)) {
        return json({ results: [{ source: STRAPI, added: [], changed: [], removed: [], unchanged: 2, skipped: [] }] });
      }
      return registry([STRAPI])(call);
    });
    renderPage();

    await userEvent.click(await screen.findByText('Strapi Docs'));
    await screen.findByText('Pages (2)');
    await userEvent.click(screen.getByRole('button', { name: /Refresh/ }));

    const refresh = calls.find((c) => c.url.endsWith(`/spec/sources/${SOURCE_ID}/refresh`));
    expect(refresh?.method).toBe('POST');
    // The open detail re-reads, and so does the row's own listing.
    await waitFor(() => expect(calls.filter(isDetail).length).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(calls.filter(isList).length).toBeGreaterThanOrEqual(2));
  });

  it('removes a site, clearing its selection and its row', async () => {
    let listed = [STRAPI];
    const calls = stubFetch((call) => {
      if (call.url.endsWith(`/spec/sources/${SOURCE_ID}`) && call.method === 'DELETE') {
        listed = [];
        return json({ removed: STRAPI });
      }
      return registry(listed)(call);
    });
    renderPage();

    await userEvent.click(await screen.findByText('Strapi Docs'));
    await screen.findByText('Pages (2)');
    await userEvent.click(screen.getByRole('button', { name: /Remove/ }));

    await waitFor(() =>
      expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith(`/spec/sources/${SOURCE_ID}`))).toBe(true),
    );
    // Nothing stale is left behind: no row, no selection, and the page falls back
    // to its one empty state.
    await waitFor(() => expect(screen.queryByText('Strapi Docs')).not.toBeInTheDocument());
    expect(screen.getByTestId('search').textContent).not.toContain('gsrc=');
    expect(await screen.findByText('No documentation sites')).toBeInTheDocument();
  });

  it('reports a failed action on the row instead of silently leaving it stale', async () => {
    stubFetch((call) => {
      if (call.url.includes('/refresh')) {
        return json({ error: 'could not read https://docs.strapi.io/llms.txt: HTTP 503' }, 400);
      }
      return registry([STRAPI])(call);
    });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: /Refresh/ }));

    expect(await screen.findByText(/HTTP 503/)).toBeInTheDocument();
    expect(screen.getByText('Strapi Docs')).toBeInTheDocument();
  });
});

describe('the add flow', () => {
  const PREVIEW = {
    llmsTxtUrl: 'https://docs.strapi.io/llms.txt',
    title: 'Strapi Docs',
    totalLinks: 214,
    fetchableLinks: 198,
    skipped: [{ url: 'https://github.com/strapi/strapi', reason: 'external-origin' }],
  };

  const CAL: SpecSourceView = {
    id: 'cal.com-docs',
    title: 'Cal.com Docs',
    llmsTxtUrl: 'https://cal.com/docs/llms.txt',
    fetchedAt: '2026-07-29T11:00:00.000Z',
    docCount: 12,
    skipped: [],
  };

  it('previews the site before fetching it, then lands on the new row', async () => {
    let listed = [CAL];
    const calls = stubFetch((call) => {
      if (call.url.endsWith('/spec/sources/preview')) return json(PREVIEW);
      if (isAdd(call)) {
        listed = [CAL, STRAPI];
        return json({ source: STRAPI, written: 198, skipped: [] });
      }
      return registry(listed)(call);
    });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Add source' }));
    await userEvent.type(screen.getByLabelText('llms.txt URL'), 'https://docs.strapi.io/llms.txt');
    await userEvent.click(screen.getByRole('button', { name: 'Check' }));

    // The confirm gate: the page count is on screen BEFORE anything is fetched.
    expect(
      await screen.findByText(/Found “Strapi Docs” — 214 pages \(198 fetchable, 1 skipped\)/),
    ).toBeInTheDocument();
    expect(calls.some(isAdd)).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'Fetch' }));

    // The new site's row appears, selected, with its detail open.
    await waitFor(() => expect(screen.getByTestId('search').textContent).toContain(`gsrc=${SOURCE_ID}`));
    expect(await screen.findByText('Pages (2)')).toBeInTheDocument();
    expect(screen.getByText('Cal.com Docs')).toBeInTheDocument();
    expect(calls.find((c) => c.url.endsWith('/spec/sources/preview'))?.body).toEqual({
      url: 'https://docs.strapi.io/llms.txt',
    });
    expect(calls.find(isAdd)?.body).toEqual({ url: 'https://docs.strapi.io/llms.txt' });
  });

  it('surfaces a rejected URL inline and fetches nothing', async () => {
    const calls = stubFetch((call) => {
      if (call.url.endsWith('/spec/sources/preview')) {
        return json({ error: 'not an llms.txt URL: https://docs.strapi.io — pass the site’s llms.txt directly' }, 400);
      }
      return registry([STRAPI])(call);
    });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Add source' }));
    await userEvent.type(screen.getByLabelText('llms.txt URL'), 'https://docs.strapi.io');
    await userEvent.click(screen.getByRole('button', { name: 'Check' }));

    expect(await screen.findByText(/not an llms.txt URL/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Fetch' })).not.toBeInTheDocument();
    expect(calls.some(isAdd)).toBe(false);
  });

  it('cancels back to the list', async () => {
    stubFetch(registry([STRAPI]));
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Add source' }));
    expect(screen.getByLabelText('llms.txt URL')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('llms.txt URL')).not.toBeInTheDocument();
    expect(screen.getByText('Strapi Docs')).toBeInTheDocument();
  });
});

describe('the empty page', () => {
  it('is ONE empty state with the add form under it — never a second one', async () => {
    stubFetch(registry([]));
    renderPage();

    expect(await screen.findByText('No documentation sites')).toBeInTheDocument();
    // The add flow is already front and center, so the header's button would be a
    // second way to the same form.
    expect(screen.getByLabelText('llms.txt URL')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add source' })).not.toBeInTheDocument();
    // EmptyState is the only h3 on the page — one empty state, not two.
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(1);
  });
});

describe('the Sources rail entry', () => {
  function renderRail(capabilities: string[]) {
    return render(
      <AppProvider initial={{ edition: 'community', capabilities: capabilities as never }}>
        <LeftSidebar section="guard" activeTab="coverage" onTabChange={() => {}}>
          <div>panel</div>
        </LeftSidebar>
      </AppProvider>,
    );
  }

  it('rides the guard rail on a local checkout', async () => {
    const { unmount } = renderRail(['local-filesystem']);
    expect(screen.getByRole('button', { name: 'Sources' })).toBeInTheDocument();
    unmount();

    // Hosted: the snapshot is working-tree files, so the page has nothing to
    // manage and its routes answer 501 — the entry never appears.
    renderRail([]);
    expect(screen.queryByRole('button', { name: 'Sources' })).toBeNull();
  });
});

describe('the corpus tree (sources moved out)', () => {
  it('no longer carries a Sources group — docs, conflicts and decisions only', async () => {
    const calls = stubFetch(registry([STRAPI]));
    render(<SpecCorpusView repoId="r1" corpus={state()} activeKey={null} onOpen={vi.fn()} />);

    expect(await screen.findByText('Documents')).toBeInTheDocument();
    expect(screen.queryByText('Sources')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add source' })).not.toBeInTheDocument();
    // And it no longer reads the registry at all.
    expect(calls.some(isList)).toBe(false);
  });

  it('points the pre-scan note at the Sources page in ONE quiet line', async () => {
    const onOpenSources = vi.fn();
    render(
      <SpecCorpusView
        repoId="r1"
        corpus={state({ data: null })}
        activeKey={null}
        onOpen={vi.fn()}
        onOpenSources={onOpenSources}
      />,
    );

    expect(screen.getByText('No corpus yet')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Add a documentation site' }));
    expect(onOpenSources).toHaveBeenCalled();
  });

  it('omits the pointer where there is no Sources page (a hosted corpus)', () => {
    render(<SpecCorpusView repoId="r1" corpus={state({ data: null })} activeKey={null} onOpen={vi.fn()} />);

    expect(screen.getByText('No corpus yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add a documentation site' })).toBeNull();
  });

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
