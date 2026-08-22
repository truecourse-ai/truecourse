// PREVIEW (UI mock, fake data): delete when the one-product dashboard lands. See docs/ONE_PRODUCT_PLAN.md §3.5.

/**
 * The one-product preview renders, at every address it offers.
 *
 * This is a SMOKE test, deliberately: the preview is a UI mock over fake data,
 * so what is worth asserting is that each route mounts without throwing and
 * lands on the thing that route is for, not how any of it looks. Each case
 * names one heading only that route produces (the Activity tab has no heading
 * of its own, so it names the run its surface opens on instead).
 *
 * The repo tabs are compositions of the CURRENT dashboard's components, copied
 * under `src/preview/vendor` from `origin/sm/agentic-pipeline-plan`, so every
 * tab case names something one of THOSE draws, never a heading the preview
 * writes itself, and every one of them is async: the rows arrive through the
 * preview fetch shim.
 *
 * `PreviewApp` carries no router: it is mounted as a DESCENDANT route set, the
 * way `App.tsx` mounts it at `/preview/*`, so the test can supply a
 * MemoryRouter and drive it by address.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import PreviewApp from '@/preview/PreviewApp';

// jsdom implements no layout, so an element has no scrollTo (the shared setup
// polyfills scrollIntoView for the same reason). The Activity surface pins its
// transcript to the bottom in an effect, which is that call.
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = (() => {}) as Element['scrollTo'];
}

// The preview's fetch shim answers only at a preview address (it must never
// hijack the real dashboard's requests), and a MemoryRouter leaves the document
// address alone — so put the address there too, the way the browser would.
function renderAt(path: string) {
  window.history.replaceState({}, '', path);
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/preview/*" element={<PreviewApp />} />
      </Routes>
    </MemoryRouter>,
  );
}

const ROUTES: { path: string; heading: RegExp }[] = [
  { path: '/preview', heading: /^Acme Payments$/ },
  { path: '/preview/repos/orders-api/settings', heading: /Gate policy/i },
  { path: '/preview/settings', heading: /^Settings$/ },
  { path: '/preview/settings/plan', heading: /^Current plan$/ },
  { path: '/preview/notifications', heading: /^Notifications$/ },
  { path: '/preview/admin', heading: /^Admin$/ },
];

describe('one-product preview', () => {
  for (const route of ROUTES) {
    it(`renders ${route.path}`, () => {
      renderAt(route.path);
      expect(screen.getAllByRole('heading', { name: route.heading }).length).toBeGreaterThan(0);
    });
  }

  it('sees a pull request through its runs and its coverage version', async () => {
    renderAt('/preview/repos/orders-api/runs');
    // No pull request page: the run history is searched by PR number, and each run names its PR.
    expect(await screen.findByRole('textbox', { name: 'Search runs' })).toBeInTheDocument();
    expect(screen.getAllByText('#482').length).toBeGreaterThan(0);
  });

  it('opens coverage on a pull request version with its change markers', async () => {
    renderAt('/preview/repos/orders-api/corpus?version=v-oa-pr486-a19c204');
    expect((await screen.findAllByText('#486')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('edited')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('added').length).toBeGreaterThan(0);
  });

  it('renders /preview/repos/orders-api/coverage', async () => {
    renderAt('/preview/repos/orders-api/coverage');
    // The overview only: GuardCoverageOverview draws the composition bars.
    expect(await screen.findByText('Coverage overview')).toBeInTheDocument();
    expect((await screen.findAllByLabelText('Statements')).length).toBeGreaterThan(0);
  });

  it('renders /preview/repos/orders-api/corpus', async () => {
    renderAt('/preview/repos/orders-api/corpus');
    // The corpus table: the documents arrive async through the preview SpecSource.
    expect((await screen.findAllByText(/lifecycle\.md/)).length).toBeGreaterThan(0);
  });

  it('opens a document as its own page from the corpus table', async () => {
    renderAt('/preview/repos/orders-api/corpus/doc/docs%2Fpayments%2Frefunds.md');
    expect((await screen.findAllByRole('link', { name: 'Corpus' })).length).toBeGreaterThan(1);
    expect((await screen.findAllByText('Refunding a partially captured order')).length).toBeGreaterThan(0);
  });

  // The five guard tabs render the vendored components (the agentic branch's, the
  // current dashboard design) over the preview fetch shim, so each one's rows
  // arrive async. Each case names one thing only that tab's component draws.

  it('opens a test as its own page from the tests table', async () => {
    renderAt('/preview/repos/orders-api/tests/checkout-card-declined');
    // The breadcrumb's Tests link beside the menu's.
    expect((await screen.findAllByRole('link', { name: 'Tests' })).length).toBeGreaterThan(1);
    expect((await screen.findAllByText('Checkout, card declined')).length).toBeGreaterThan(0);
  });

  it('renders /preview/repos/orders-api/tests', async () => {
    renderAt('/preview/repos/orders-api/tests');
    // GuardFlowsPanel: one row per flow, titled by the flow it guards, over the
    // status and driver chip bars only this panel carries.
    expect((await screen.findAllByText('Checkout, card declined')).length).toBeGreaterThan(0);
    expect((await screen.findAllByRole('group', { name: 'Filter by driver' })).length).toBeGreaterThan(0);
  });

  it('renders /preview/repos/orders-api/interfaces', async () => {
    renderAt('/preview/repos/orders-api/interfaces');
    // GuardInterfacesPanel: rows keyed by the interface id the catalog derives,
    // grouped under the PLACE that owns them (the resource registry's title).
    expect((await screen.findAllByText('cli/orders-create')).length).toBeGreaterThan(0);
    expect((await screen.findAllByRole('group', { name: 'Filter interfaces by surface' })).length).toBeGreaterThan(0);
  });

  it('opens a run as its own page from the runs table', async () => {
    renderAt('/preview/repos/orders-api/runs/run-oa-8f3c1a2');
    expect((await screen.findAllByRole('link', { name: 'Runs' })).length).toBeGreaterThan(1);
    expect((await screen.findAllByText('Create an order with an expired card is refused')).length).toBeGreaterThan(0);
  });

  it('renders /preview/repos/orders-api/runs', async () => {
    renderAt('/preview/repos/orders-api/runs');
    // GuardRunSummary: the run picker, one row per recorded run.
    expect((await screen.findAllByText('8f3c1a2')).length).toBeGreaterThan(0);
    expect(await screen.findByRole('textbox', { name: 'Search runs' })).toBeInTheDocument();
  });

  it('renders /preview/repos/orders-api/sources', async () => {
    renderAt('/preview/repos/orders-api/sources');
    // The sites table: one row per registered llms.txt site.
    expect((await screen.findAllByText('Stripe API reference')).length).toBeGreaterThan(0);
  });

  it('opens a site as its own page from the sources table', async () => {
    renderAt('/preview/repos/orders-api/sources/stripe');
    expect((await screen.findAllByRole('link', { name: 'Sources' })).length).toBeGreaterThan(1);
    expect((await screen.findAllByText('Stripe API reference')).length).toBeGreaterThan(0);
  });

  it('renders /preview/repos/orders-api/dependencies', async () => {
    renderAt('/preview/repos/orders-api/dependencies');
    // GuardDependenciesPane: one row per class of starting state, supplied ones
    // last, each named by its catalog entry rather than by its service.
    expect((await screen.findAllByText('Postmark sandbox')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('A product in the catalog')).length).toBeGreaterThan(0);
  });

  it('opens a flow from ?flow= on the tests tab', async () => {
    renderAt('/preview/repos/orders-api/tests?flow=refund-partial-capture');
    // GuardFlowDetail + GuardTestView: the merged detail, its failing step's
    // expectation and the actual the run recorded.
    expect((await screen.findAllByText(/409 Conflict/)).length).toBeGreaterThan(0);
  });

  it("carries a cross-tab jump's destination into the address", async () => {
    // The vendored components jump by writing `?section=guard&tab=<id>` beside
    // the selection; the preview reads its tab out of the PATH, so the jump is
    // translated (src/preview/repo/tab-jump.ts) and lands on the Tests tab with
    // the flow the jump named already open.
    renderAt('/preview/repos/orders-api/coverage?section=guard&tab=guardflows&flow=refund-partial-capture');
    // The named flow's own page (the Tests breadcrumb beside the menu entry) and
    // its failing step, neither of which the Coverage tab draws.
    expect((await screen.findAllByText(/409 Conflict/)).length).toBeGreaterThan(0);
    expect((await screen.findAllByRole('link', { name: 'Tests' })).length).toBeGreaterThan(1);
    // The corpus sidebar the address arrived on is gone.
    expect(screen.queryByText('Coverage overview')).toBeNull();
  });

  it('opens an interface from ?interface= on the interfaces tab', async () => {
    renderAt('/preview/repos/orders-api/interfaces?interface=api/post-refunds');
    // GuardInterfaceDiagram + GuardInterfaceContract: the sequence and the
    // contract slot, which no other surface draws.
    expect((await screen.findAllByText('Sequence')).length).toBeGreaterThan(0);
  });

  it('renders /preview/knowledge as the enterprise page, two levels', async () => {
    renderAt('/preview/knowledge');
    expect((await screen.findAllByText('Refund policy (company-wide)')).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Sources' })).toBeInTheDocument();
  });

  it('opens a workspace document as its own page', async () => {
    renderAt('/preview/knowledge/doc/confluence%2FPAY%2Frefund-policy');
    // The Spec breadcrumb beside the Knowledge menu's Spec entry.
    expect((await screen.findAllByRole('link', { name: 'Spec' })).length).toBeGreaterThan(1);
    expect((await screen.findAllByText(/Refund policy/)).length).toBeGreaterThan(0);
  });

  it('renders /preview/repos/orders-api/activity', () => {
    renderAt('/preview/repos/orders-api/activity');
    // The Activity surface is the copied sessions view: it opens on the newest
    // agentic run and carries no heading element of its own.
    expect(screen.getAllByText('spec scan').length).toBeGreaterThan(0);
  });

  it('keeps the workspace shell around every route', () => {
    renderAt('/preview/notifications');
    expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Knowledge' })).toBeInTheDocument();
    // There is no pull request page anywhere: a PR is seen through Runs and Coverage.
    expect(screen.queryByRole('link', { name: 'Pull requests' })).toBeNull();
  });
});
