/**
 * The DEPENDENCIES tab — every class of starting state the program under test
 * needs, and what this machine provides for each.
 *
 * The house shape: the shared list on the LEFT (name, class, and whether an
 * instance is registered), the chosen one's detail on the RIGHT under the shared
 * guard TAB STRIP — single-click previews, double-click pins, `?gext` mirrors the
 * active one, exactly as Flows / Coverage / Interfaces do. What the detail
 * owes a reader, in order: the rolled-up requirement with the flow that
 * contributed each part (a real jump), when the dependency applies, what it holds
 * back today, and THE FORM — rendered by the registration's own shape, one masked
 * field per declared secret, and never a paragraph telling anyone which file to
 * edit by hand. Detection evidence stays a collapsible; the committed catalog
 * entry is the second reading behind the JSON switch, and the gitignored overlay
 * is never shown raw.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render as rtlRender, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { ReactElement } from 'react';
import { GuardDependenciesPane } from '@/components/guard/GuardDependenciesPane';
import type { GuardDependenciesView, GuardDependencyRow } from '@/types/guard-dependencies';

/** The query string as the pane leaves it — the tab model's addressability. */
function LocationProbe() {
  return <span data-testid="search">{useLocation().search}</span>;
}

/** The pane reads the URL: a row is addressable as `?gext=<name>`. */
const render = (ui: ReactElement, entry = '/repos/r?section=guard&tab=externals') =>
  rtlRender(
    <MemoryRouter initialEntries={[entry]}>
      {ui}
      <LocationProbe />
    </MemoryRouter>,
  );

const search = () => screen.getByTestId('search').textContent ?? '';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const BASE: GuardDependenciesView = {
  catalogPath: '/repo/.truecourse/scenarios/dependencies.json',
  localPath: '/repo/.truecourse/scenarios/dependencies.local.json',
  recipePath: '/repo/.truecourse/scenarios/recipe.json',
  invalidReason: null,
  detectionAvailable: true,
  dependencies: [],
  unknownLocalNames: [],
};

/** The env shape: two declared variables, one of them a secret already stored. */
const ACCOUNT: GuardDependencyRow = {
  name: 'anthropic',
  class: 'supplied',
  summary: 'an Anthropic account the LLM rules run against',
  when: 'only when the LLM transport is the provider API',
  requirement: 'a key with model access; a base URL that answers',
  needs: [
    { flowId: 'run-llm-rules', title: 'A user runs the LLM rules', need: 'a key with model access' },
    { flowId: 'switch-transport', need: 'a base URL that answers' },
  ],
  state: 'incomplete',
  registration: {
    kind: 'env',
    vars: [
      { name: 'ANTHROPIC_BASE_URL', description: 'the base URL the program reads', secret: false },
      { name: 'ANTHROPIC_API_KEY', description: 'the credential the program reads', secret: true },
    ],
  },
  fields: [
    {
      field: 'ANTHROPIC_BASE_URL',
      resolved: false,
      reason: 'no value registered for `ANTHROPIC_BASE_URL`',
      secret: false,
      description: 'the base URL the program reads',
    },
    { field: 'ANTHROPIC_API_KEY', resolved: true, secret: true, description: 'the credential the program reads' },
  ],
  blocks: [
    { flowId: 'run-llm-rules', title: 'A user runs the LLM rules', kind: 'test-blocked' },
    { flowId: 'grade-a-repo', title: 'A user grades a repo', kind: 'not-authored' },
  ],
  usedBy: 2,
  service: {
    service: 'anthropic',
    services: ['anthropic'],
    detected: true,
    declaredInRecipe: false,
    category: 'ai',
    detectedVia: 'sdk',
    baseUrlEnv: null,
    baseUrlEnvSource: null,
    baseUrl: null,
    endpoints: {},
    tokenSet: false,
    headers: [],
    evidence: [
      { service: 'anthropic', filePath: 'packages/llm-api/src/model.ts', importSource: '@ai-sdk/anthropic' },
    ],
    undeclaredLocalEnv: [],
  },
  inCatalog: true,
};

/**
 * The same entry with BOTH variables registered on this machine. What the server
 * hands back is what a reader may see: the readable variable as it was registered,
 * and the credential as the MASK the server made of it — never its characters.
 */
const ACCOUNT_REGISTERED: GuardDependencyRow = {
  ...ACCOUNT,
  state: 'provided',
  fields: [
    {
      field: 'ANTHROPIC_BASE_URL',
      resolved: true,
      secret: false,
      description: 'the base URL the program reads',
      value: 'https://llm.internal',
    },
    {
      field: 'ANTHROPIC_API_KEY',
      resolved: true,
      secret: true,
      description: 'the credential the program reads',
      value: '•••••••••••• (stored locally, masked)',
    },
  ],
};

/**
 * The same entry when the recipe ALSO declares it as an external service: it
 * carries both halves at once — the declared variables, and the account the
 * declaration holds (base URL, token, headers).
 */
const ACCOUNT_DECLARED: GuardDependencyRow = {
  ...ACCOUNT,
  service: {
    ...ACCOUNT.service!,
    declaredInRecipe: true,
    baseUrlEnv: 'ANTHROPIC_BASE_URL',
    baseUrlEnvSource: 'recipe',
  },
};

/**
 * ONE class of starting state standing for FOUR third parties: the api transport
 * reaches the model through whichever provider it is configured for, and a single
 * credential registration answers for all of them. Each folded service's detection
 * evidence reads here — it has no row of its own to read it on.
 */
const MULTI_PROVIDER: GuardDependencyRow = {
  ...ACCOUNT,
  name: 'llm-api-credentials',
  service: {
    ...ACCOUNT.service!,
    services: ['anthropic', 'openai', 'aws-bedrock', 'githubcopilot'],
    // Three SDK imports and one plain HTTP call: no single answer, so none is given.
    detectedVia: undefined,
    evidence: [
      { service: 'anthropic', filePath: 'packages/llm-api/src/model.ts', importSource: '@ai-sdk/anthropic' },
      { service: 'openai', filePath: 'packages/llm-api/src/model.ts', importSource: '@ai-sdk/openai' },
    ],
  },
};

/**
 * The env shape with a variable the program has a DEFAULT for: offered so a machine
 * that needs a different origin can say so, never demanded — the entry is provided
 * with it blank.
 */
const LLM_CREDENTIALS: GuardDependencyRow = {
  name: 'llm-api-credentials',
  class: 'supplied',
  summary: 'a provider API account the CLI can reach the model through directly',
  requirement: 'a key whose live provider probe succeeds',
  needs: [],
  state: 'provided',
  registration: {
    kind: 'env',
    vars: [
      { name: 'api-key', description: 'an API key for that provider', secret: true },
      {
        name: 'base-url',
        description: 'the provider API base URL — omit for the provider default',
        secret: false,
        optional: true,
      },
    ],
  },
  fields: [
    { field: 'api-key', resolved: true, secret: true, description: 'an API key for that provider' },
    {
      field: 'base-url',
      resolved: false,
      secret: false,
      description: 'the provider API base URL — omit for the provider default',
    },
  ],
  blocks: [],
  usedBy: 1,
  inCatalog: true,
};

/** The path shape: a real project the engine must never fabricate. */
const PROJECT: GuardDependencyRow = {
  name: 'supplied-project',
  class: 'supplied',
  summary: 'a real codebase to analyze',
  requirement: 'a TypeScript project with at least one violation',
  needs: [{ flowId: 'analyze-a-repo', title: 'A user analyzes a repository', need: 'a TypeScript project' }],
  state: 'unprovided',
  registration: { kind: 'path', description: 'a checkout of a real project' },
  fields: [{ field: 'path', resolved: false, reason: 'no path registered', secret: false }],
  blocks: [],
  usedBy: 1,
  inCatalog: true,
};

/**
 * The path shape with a path registered that this machine no longer has: the entry
 * is unregistered, and the field still holds what somebody typed — the typo is
 * visible, which is the only way it gets corrected.
 */
const PROJECT_MOVED: GuardDependencyRow = {
  ...PROJECT,
  fields: [
    {
      field: 'path',
      resolved: false,
      reason: 'the registered path does not exist on this machine: /Users/dev/moved-away',
      secret: false,
      value: '/Users/dev/moved-away',
    },
  ],
};

/** The config-dir shape: an authenticated state, copied into the sandbox HOME. */
const CLAUDE_HOME: GuardDependencyRow = {
  name: 'claude-config',
  class: 'supplied',
  summary: 'an authenticated Claude Code config directory',
  requirement: 'a logged-in `.claude` directory',
  needs: [],
  state: 'provided',
  registration: {
    kind: 'config-dir',
    homePath: '.claude',
    description: 'the config dir of a logged-in Claude Code',
  },
  fields: [{ field: 'path', resolved: true, secret: false }],
  hostPath: '/Users/dev/.claude',
  blocks: [],
  usedBy: 3,
  inCatalog: true,
};

/**
 * The same login AFTER its entry moved from a copied config directory to a token:
 * the overlay still holds yesterday's path, which nothing reads any more, so the
 * row is unregistered and the form is the token one.
 */
const CLAUDE_TOKEN_STALE: GuardDependencyRow = {
  name: 'claude-login',
  class: 'supplied',
  summary: 'an authenticated Claude Code installation',
  requirement: 'a long-lived token from `claude setup-token`',
  needs: [],
  state: 'unprovided',
  registration: {
    kind: 'env',
    vars: [
      {
        name: 'CLAUDE_CODE_OAUTH_TOKEN',
        description: 'a long-lived token from `claude setup-token`',
        secret: true,
      },
    ],
  },
  fields: [
    {
      field: 'CLAUDE_CODE_OAUTH_TOKEN',
      resolved: false,
      reason: 'no value registered for `CLAUDE_CODE_OAUTH_TOKEN`',
      secret: true,
      description: 'a long-lived token from `claude setup-token`',
    },
  ],
  staleInstance:
    'the registered instance is a path, but this dependency is now registered as ' +
    '`CLAUDE_CODE_OAUTH_TOKEN` — the path is ignored',
  blocks: [],
  usedBy: 1,
  inCatalog: true,
};

/** A class with nothing to register: the runner materializes it. */
const SEEDED: GuardDependencyRow = {
  name: 'seeded-tasks',
  class: 'seedable',
  summary: 'rows the list flow reads',
  requirement: 'rows the list flow reads',
  needs: [],
  obtain: 'the runner seeds three tasks before the steps run',
  state: null,
  fields: [],
  blocks: [],
  usedBy: 0,
  inCatalog: true,
};

/** A service the recipe declares, with no catalog entry of its own. */
const STRIPE: GuardDependencyRow = {
  name: 'stripe',
  class: 'supplied',
  summary: 'an account for the stripe API this repo calls',
  requirement: 'an account for stripe, and the variables the program reads it through',
  needs: [],
  state: 'unprovided',
  fields: [
    { field: 'STRIPE_BASE_URL', resolved: false, reason: 'no base URL provided', secret: false },
    { field: 'STRIPE_KEY', resolved: false, reason: 'no value registered for STRIPE_KEY', secret: true },
  ],
  blocks: [],
  usedBy: 0,
  service: {
    service: 'stripe',
    services: ['stripe'],
    detected: true,
    declaredInRecipe: true,
    category: 'payment',
    detectedVia: 'sdk',
    baseUrlEnv: 'STRIPE_BASE_URL',
    baseUrlEnvSource: 'recipe',
    baseUrl: null,
    mode: 'sandbox',
    endpoints: {},
    tokenSet: false,
    headers: [],
    evidence: [{ service: 'stripe', filePath: 'src/billing/charge.ts', importSource: 'stripe' }],
    undeclaredLocalEnv: [],
  },
  inCatalog: false,
};

/**
 * The same service with an account already registered on this machine: a token
 * stored (never echoed), one readable header and one whose NAME reads as a
 * credential — so the server withheld its value and the form must not pretend to
 * have it.
 */
const STRIPE_REGISTERED: GuardDependencyRow = {
  ...STRIPE,
  state: 'provided',
  service: {
    ...STRIPE.service!,
    baseUrl: 'https://api.stripe.test',
    tokenSet: true,
    headers: [
      { name: 'X-Api-Key', secret: true },
      { name: 'X-Tenant', secret: false, value: 'acme' },
    ],
  },
};

/** A service the program SPAWNS rather than calls — a different demand entirely. */
const CLAUDE_BINARY: GuardDependencyRow = {
  ...STRIPE,
  name: 'claude',
  summary: 'the Claude Code CLI the program spawns',
  requirement: 'the `claude` executable on PATH',
  service: {
    ...STRIPE.service!,
    service: 'claude',
    services: ['claude'],
    detectedVia: 'binary',
    baseUrlEnv: null,
    baseUrlEnvSource: null,
    evidence: [{ service: 'claude', filePath: 'packages/core/src/llm/claude.ts' }],
  },
};

/** GET answers `view`; PUT answers `afterWrite` (or `view`), recording its body. */
function stubFetch(
  view: GuardDependenciesView,
  afterWrite?: GuardDependenciesView | { status: number; error: string },
) {
  const puts: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/guard/dependencies') && init?.method === 'PUT') {
        puts.push(JSON.parse(String(init.body)));
        if (afterWrite && 'status' in afterWrite) return json({ error: afterWrite.error }, afterWrite.status);
        return json(afterWrite ?? view);
      }
      if (u.includes('/guard/dependencies')) return json(view);
      if (u.includes('/guard/dependency/raw')) {
        return json({
          id: 'anthropic',
          file: '.truecourse/scenarios/dependencies.json',
          content: '{\n  "name": "anthropic",\n  "class": "supplied"\n}',
        });
      }
      return json({});
    }),
  );
  return puts;
}

afterEach(() => vi.unstubAllGlobals());

describe('GuardDependenciesPane — the list', () => {
  it('is one row per dependency: its name, what it IS, and whether it is registered', async () => {
    stubFetch({ ...BASE, dependencies: [ACCOUNT, SEEDED, STRIPE] });
    render(<GuardDependenciesPane repoId="r" />);

    const rows = within(await screen.findByRole('list', { name: 'Dependencies' })).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('anthropic');
    expect(rows[0]).toHaveTextContent('API service');
    expect(rows[0]).toHaveTextContent('incomplete');
    // A kind with nothing to register wears NO state — there is nothing to do —
    // and no type either: it is not a thing anybody registers.
    expect(rows[1].textContent).not.toMatch(/provided|incomplete/);
    expect(rows[2]).toHaveTextContent('stripe');
  });

  /**
   * The engine's own taxonomy answers "who obtains this" — a question no reader of
   * this page asked. The row says what the thing IS instead, in words a person
   * would use for it.
   */
  it('names what a dependency IS, and never the engine’s class taxonomy', async () => {
    stubFetch({
      ...BASE,
      dependencies: [ACCOUNT, CLAUDE_BINARY, CLAUDE_HOME, PROJECT, SEEDED],
    });
    render(<GuardDependenciesPane repoId="r" />);

    const rows = within(await screen.findByRole('list', { name: 'Dependencies' })).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('API service');
    expect(rows[1]).toHaveTextContent('binary');
    expect(rows[2]).toHaveTextContent('login');
    expect(rows[3]).toHaveTextContent('project');
    // Nothing to register, so nothing to call it.
    expect(rows[4].textContent).not.toMatch(/API service|binary|login|project|credentials/);

    for (const word of ['supplied', 'seedable', 'step-creatable']) {
      expect(screen.queryByText(word), word).toBeNull();
    }
  });

  it('reads a non-service env registration as the credentials it is', async () => {
    stubFetch({
      ...BASE,
      dependencies: [{ ...ACCOUNT, name: 'llm-api-credentials', service: undefined }],
    });
    render(<GuardDependenciesPane repoId="r" />);
    const rows = within(await screen.findByRole('list', { name: 'Dependencies' })).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('credentials');
  });

  /**
   * How much RIDES on a dependency, where the reader is choosing which one to look
   * at. It is a FACT, not an alert: it reads the same whether or not an instance is
   * registered, so it wears the muted chip and never a guard to-do colour — the
   * state chip beside it is what says something needs doing. Absent at zero: "used
   * 0" is not news.
   */
  it('counts the flows that rely on a dependency — muted, and unchanged once provided', async () => {
    stubFetch({ ...BASE, dependencies: [ACCOUNT, CLAUDE_HOME, SEEDED] });
    render(<GuardDependenciesPane repoId="r" />);

    const rows = within(await screen.findByRole('list', { name: 'Dependencies' })).getAllByRole('listitem');
    const chip = within(rows[0]).getByText('used 2');
    expect(chip.className).toMatch(/muted/);
    expect(chip.className).not.toMatch(/sky|amber|orange|red|emerald/);

    // A provided dependency is relied on exactly as much as it was: the chip stays.
    expect(within(rows[1]).getByText('provided')).toBeInTheDocument();
    expect(within(rows[1]).getByText('used 3')).toBeInTheDocument();

    // Nothing relies on it, so it says nothing — and the old blocks chip is gone.
    expect(within(rows[2]).queryByText(/^used/)).toBeNull();
    expect(screen.queryByText(/^blocks \d/)).toBeNull();
  });

  it('paints a to-do BLUE — unprovided and incomplete are blocked runs, never warnings', async () => {
    stubFetch({ ...BASE, dependencies: [ACCOUNT, PROJECT, CLAUDE_HOME] });
    render(<GuardDependenciesPane repoId="r" />);

    await screen.findByText('anthropic');
    const chips = ['incomplete', 'unprovided'].map((word) => screen.getByText(word));
    for (const chip of chips) {
      expect(chip.className).toMatch(/sky/);
      expect(chip.className).not.toMatch(/amber|orange/);
    }
    expect(screen.getByText('provided').className).toMatch(/emerald/);
  });

  it('lands on the row a needs-setup CTA deep-linked to, by name or by service', async () => {
    stubFetch({ ...BASE, dependencies: [ACCOUNT, STRIPE] });
    render(<GuardDependenciesPane repoId="r" />, '/repos/r?section=guard&tab=externals&gext=stripe');
    // The DETAIL is the stripe one — the heading, not merely the row.
    expect(await screen.findByRole('heading', { level: 2 })).toHaveTextContent('stripe');
  });

  /**
   * A folded service has no row of its own, so the CTA that names it must land on
   * the row that absorbed it — otherwise the link goes nowhere.
   */
  it('lands on the row that FOLDED a service when the CTA names that service', async () => {
    stubFetch({ ...BASE, dependencies: [PROJECT, MULTI_PROVIDER] });
    render(<GuardDependenciesPane repoId="r" />, '/repos/r?section=guard&tab=externals&gext=openai');
    expect(await screen.findByRole('heading', { level: 2 })).toHaveTextContent('llm-api-credentials');
  });

  it('says nothing has LOOKED yet rather than claiming the repo depends on nothing', async () => {
    stubFetch({ ...BASE, detectionAvailable: false });
    render(<GuardDependenciesPane repoId="r" />);
    expect(await screen.findByText(/Nothing has looked yet/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// THE TAB MECHANISM — the same one every other guard pane wears (Flows,
// Coverage, Interfaces, Runs): the shared `useGuardTabs` reducer over a
// `GuardTabStrip`, single-click previewing an italic tab, double-click pinning
// it, the active one mirrored to the URL, and no Overview chip in front of them.
// ---------------------------------------------------------------------------

describe('GuardDependenciesPane — tabs and deep links', () => {
  const rows = async () =>
    within(await screen.findByRole('list', { name: 'Dependencies' })).getAllByRole('listitem');
  const closeBtn = (id: string) => screen.getByLabelText(`Close ${id}`);
  const tabLabel = (id: string, label = id) =>
    within(closeBtn(id).parentElement as HTMLElement).getByText(label);

  it('single-click previews an italic tab, mirrors ?gext and opens the detail', async () => {
    stubFetch({ ...BASE, dependencies: [ACCOUNT, PROJECT] });
    const user = userEvent.setup();
    render(<GuardDependenciesPane repoId="r" />);

    await user.click((await rows())[0]);
    expect(tabLabel('anthropic')).toHaveClass('italic');
    expect(search()).toContain('gext=anthropic');
    expect(await screen.findByRole('heading', { level: 2 })).toHaveTextContent('anthropic');
  });

  it('the next single-click takes the transient slot — one preview tab only', async () => {
    stubFetch({ ...BASE, dependencies: [ACCOUNT, PROJECT] });
    const user = userEvent.setup();
    render(<GuardDependenciesPane repoId="r" />);

    await user.click((await rows())[0]);
    await user.click((await rows())[1]);
    expect(screen.queryByLabelText('Close anthropic')).toBeNull();
    expect(tabLabel('supplied-project')).toHaveClass('italic');
    expect(search()).toContain('gext=supplied-project');
  });

  it('double-click pins, so the next preview coexists with it', async () => {
    stubFetch({ ...BASE, dependencies: [ACCOUNT, PROJECT] });
    const user = userEvent.setup();
    render(<GuardDependenciesPane repoId="r" />);

    await user.dblClick((await rows())[0]);
    expect(tabLabel('anthropic')).toHaveClass('font-medium');
    await user.click((await rows())[1]);
    expect(tabLabel('anthropic')).toHaveClass('font-medium');
    expect(tabLabel('supplied-project')).toHaveClass('italic');
  });

  it('a ?gext deep link opens the dependency as a pinned tab', async () => {
    stubFetch({ ...BASE, dependencies: [ACCOUNT, PROJECT] });
    render(<GuardDependenciesPane repoId="r" />, '/repos/r?section=guard&tab=externals&gext=anthropic');
    expect(await screen.findByRole('heading', { level: 2 })).toHaveTextContent('anthropic');
    expect(tabLabel('anthropic')).toHaveClass('font-medium');
  });

  /** A CTA names a folded SERVICE; the tab reads the entry that answers for it. */
  it('labels a folded-service tab with the dependency that absorbed it', async () => {
    stubFetch({ ...BASE, dependencies: [PROJECT, MULTI_PROVIDER] });
    render(<GuardDependenciesPane repoId="r" />, '/repos/r?section=guard&tab=externals&gext=openai');
    expect(await screen.findByRole('heading', { level: 2 })).toHaveTextContent('llm-api-credentials');
    expect(tabLabel('openai', 'llm-api-credentials')).toBeInTheDocument();
  });

  it('closing the last tab puts the pane at rest and clears ?gext', async () => {
    stubFetch({ ...BASE, dependencies: [ACCOUNT] });
    const user = userEvent.setup();
    render(<GuardDependenciesPane repoId="r" />);

    await user.click((await rows())[0]);
    await user.click(closeBtn('anthropic'));
    expect(screen.queryByLabelText('Close anthropic')).toBeNull();
    expect(await screen.findByText('Select a dependency')).toBeInTheDocument();
    expect(search()).not.toContain('gext=');
  });

  it('draws no strip at all — and no Overview chip — with nothing open', async () => {
    stubFetch({ ...BASE, dependencies: [ACCOUNT] });
    render(<GuardDependenciesPane repoId="r" />);
    await rows();
    expect(screen.getByText('Select a dependency')).toBeInTheDocument();
    expect(screen.queryByText('Overview')).toBeNull();
    expect(screen.queryByLabelText(/^Close /)).toBeNull();
  });
});

describe('GuardDependenciesPane — the detail', () => {
  const open = async (dependency: GuardDependencyRow, view = BASE) => {
    const puts = stubFetch({ ...view, dependencies: [dependency] });
    const user = userEvent.setup();
    render(<GuardDependenciesPane repoId="r" />);
    await user.click(within(await screen.findByRole('list', { name: 'Dependencies' })).getAllByRole('listitem')[0]);
    return { user, puts };
  };

  it('rolls the requirement up and attributes each part to the flow that wants it', async () => {
    stubFetch({ ...BASE, dependencies: [ACCOUNT] });
    const flows: string[] = [];
    const user = userEvent.setup();
    render(
      <GuardDependenciesPane repoId="r" onOpenFlow={(id) => flows.push(id)} />,
      '/repos/r?section=guard&tab=externals&gext=anthropic',
    );

    expect(await screen.findByText(ACCOUNT.requirement)).toBeInTheDocument();
    // The same flow appears twice — as the need's author, and in what it blocks.
    // The attribution is the first, above the block list.
    const attribution = screen.getAllByText('A user runs the LLM rules')[0];
    expect(attribution.parentElement).toHaveTextContent('a key with model access');
    await user.click(attribution);
    expect(flows).toEqual(['run-llm-rules']);
    // A need whose flow the corpus no longer titles still reads — by its id.
    expect(screen.getByText('switch-transport')).toBeInTheDocument();
  });

  it('says WHEN it applies, and what it blocks today', async () => {
    await open(ACCOUNT);
    expect(await screen.findByText('only when the LLM transport is the provider API')).toBeInTheDocument();
    expect(screen.getByText('test cannot run')).toBeInTheDocument();
    expect(screen.getByText('no test written')).toBeInTheDocument();
  });

  it('wears the same type word the row does — and never the class', async () => {
    await open(CLAUDE_HOME);
    // The detail's own header: the type sits where the class chip used to, beside
    // the state, above the name.
    const header = (await screen.findByRole('heading', { level: 2 })).parentElement!;
    expect(within(header).getByText('login')).toBeInTheDocument();
    expect(within(header).getByText('provided')).toBeInTheDocument();
    expect(screen.queryByText('supplied')).toBeNull();
  });

  it('is honest when a dependency applies always and blocks nothing', async () => {
    await open(CLAUDE_HOME);
    expect(await screen.findByText(/Always — every flow that binds it needs it/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing right now/)).toBeInTheDocument();
  });

  it('keeps detection evidence collapsed until it is asked for', async () => {
    const { user } = await open(ACCOUNT);
    const toggle = await screen.findByText('Detection evidence (1)');
    expect(screen.queryByText('packages/llm-api/src/model.ts')).not.toBeInTheDocument();
    await user.click(toggle);
    const hit = screen.getByText('packages/llm-api/src/model.ts');
    // One service, so the file needs no attribution — it could only be that one.
    expect(hit.parentElement).toHaveTextContent(
      'packages/llm-api/src/model.ts imports @ai-sdk/anthropic',
    );
  });

  /**
   * The evidence of every folded service reads on the row that absorbed them, and
   * each hit says WHICH third party it is for: the same file can import two of them,
   * and an unattributed merged list is unreadable.
   */
  it('attributes each evidence hit to its service when the row stands for several', async () => {
    const { user } = await open(MULTI_PROVIDER);
    await user.click(await screen.findByText('Detection evidence (2)'));
    const hits = screen.getAllByText('packages/llm-api/src/model.ts');
    expect(hits).toHaveLength(2);
    expect(hits[0].parentElement).toHaveTextContent('anthropic');
    expect(hits[1].parentElement).toHaveTextContent('openai');
  });

  it('offers the committed catalog entry as the second reading — and never the overlay', async () => {
    const { user } = await open(ACCOUNT);
    const modes = await screen.findByRole('group', { name: 'View mode' });
    expect(within(modes).getAllByRole('button').map((b) => b.textContent)).toEqual(['View', 'JSON']);

    await user.click(within(modes).getByRole('button', { name: 'JSON' }));
    await waitFor(() => expect(screen.getByLabelText('dependency source')).toHaveTextContent('"class": "supplied"'));
    // The stored file REPLACES the page — never two readings at once.
    expect(screen.queryByText('What it blocks')).not.toBeInTheDocument();
  });

  it('offers NO second reading for a service the catalog does not declare', async () => {
    await open(STRIPE);
    expect(await screen.findByRole('heading', { level: 2 })).toHaveTextContent('stripe');
    expect(screen.queryByRole('group', { name: 'View mode' })).not.toBeInTheDocument();
  });
});

describe('GuardDependenciesPane — the registration form', () => {
  const open = async (dependency: GuardDependencyRow) => {
    const puts = stubFetch({ ...BASE, dependencies: [dependency] });
    const user = userEvent.setup();
    render(<GuardDependenciesPane repoId="r" />, `/repos/r?section=guard&tab=externals&gext=${dependency.name}`);
    await screen.findByRole('heading', { level: 2 });
    return { user, puts };
  };

  it('renders the ENV shape as one field per declared variable, secrets masked', async () => {
    const { user, puts } = await open(ACCOUNT);

    const secret = screen.getByLabelText('ANTHROPIC_API_KEY');
    expect(secret).toHaveAttribute('type', 'password');
    // A stored secret is never echoed — the field says it is there, not what it is.
    expect(secret).toHaveValue('');
    expect(secret).toHaveAttribute('placeholder', '•••• stored locally');
    const plain = screen.getByLabelText('ANTHROPIC_BASE_URL');
    expect(plain).toHaveAttribute('type', 'text');

    await user.type(plain, 'https://api.anthropic.com');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({
      name: 'anthropic',
      env: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com' },
    });
  });

  /**
   * A registered entry must not read like an empty one. What this machine is pointed
   * at is IN the fields: the readable variable shows its value, and the credential
   * shows the mask the server made of it — in the placeholder, because the input
   * holds only what a user typed, and a mask is not something anyone typed.
   */
  it('shows what is registered: the readable value in its field, a secret as a mask', async () => {
    await open(ACCOUNT_REGISTERED);

    expect(screen.getByLabelText('ANTHROPIC_BASE_URL')).toHaveValue('https://llm.internal');
    const secret = screen.getByLabelText('ANTHROPIC_API_KEY');
    expect(secret).toHaveValue('');
    expect(secret).toHaveAttribute('placeholder', '•••••••••••• (stored locally, masked)');
  });

  /**
   * The mask is a READING. If the form ever sent it back, a save touching any other
   * field would overwrite the stored key with a row of bullets and lock the user out
   * of their own account — so the mask never enters an input's value, and an
   * untouched secret sends nothing at all.
   */
  it('never sends a mask back: an untouched secret survives the save beside it', async () => {
    const { user, puts } = await open(ACCOUNT_REGISTERED);

    const readable = screen.getByLabelText('ANTHROPIC_BASE_URL');
    await user.clear(readable);
    await user.type(readable, 'https://llm.internal/v2');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(puts).toHaveLength(1));

    expect(puts[0]).toEqual({
      name: 'anthropic',
      env: { ANTHROPIC_BASE_URL: 'https://llm.internal/v2' },
    });
    const body = JSON.stringify(puts[0]);
    expect(body).not.toContain('•');
    expect(body).not.toContain('masked');
  });

  it('pre-fills the PATH field with the registered path, including one that has moved', async () => {
    const { user, puts } = await open(PROJECT_MOVED);
    const field = screen.getByLabelText('Path');
    expect(field).toHaveValue('/Users/dev/moved-away');
    expect(screen.getByText(/the registered path does not exist on this machine/)).toBeInTheDocument();

    await user.clear(field);
    await user.type(field, '/Users/dev/code/project');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({ name: 'supplied-project', path: '/Users/dev/code/project' });
  });

  /**
   * An optional variable is a field like any other — a sample to type over and a
   * word saying it may be left alone. The word is where the decision is made, next
   * to the label, and it is muted: it lowers the demand rather than adding one.
   */
  it('marks an OPTIONAL variable optional, samples it, and stays provided while it is blank', async () => {
    await open(LLM_CREDENTIALS);

    const field = screen.getByLabelText('base-url');
    expect(field).toHaveAttribute('type', 'text');
    expect(field).toHaveValue('');
    expect(field).toHaveAttribute('placeholder', 'https://api.anthropic.com');

    const marker = screen.getByText('optional');
    expect(marker.className).toMatch(/muted/);
    expect(marker.closest('label')).toHaveTextContent('base-url');
    // A required variable wears no such marker, and an unregistered optional one is
    // never explained as a fault.
    expect(screen.getByLabelText('api-key').closest('div')).not.toHaveTextContent(/optional/);
    expect(screen.queryByText(/no value registered/)).toBeNull();

    // Blank, and the entry still reads provided — the optional half never gates.
    expect(screen.getAllByText('provided').length).toBeGreaterThan(0);
  });

  it('saves with an optional variable left empty, and sends it like any other when filled', async () => {
    const { user, puts } = await open(LLM_CREDENTIALS);

    await user.type(screen.getByLabelText('api-key'), 'sk-1');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({ name: 'llm-api-credentials', env: { 'api-key': 'sk-1' } });
    expect(screen.queryByText(/Nothing to save/)).toBeNull();

    await user.type(screen.getByLabelText('base-url'), 'https://llm.internal');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(puts).toHaveLength(2));
    expect(puts[1]).toEqual({
      name: 'llm-api-credentials',
      env: { 'base-url': 'https://llm.internal' },
    });
  });

  it('renders the PATH shape as a path field, and sends it as one', async () => {
    const { user, puts } = await open(PROJECT);
    const field = screen.getByLabelText('Path');
    expect(field).not.toHaveAttribute('type', 'password');
    expect(screen.getByText(/a checkout of a real project/)).toBeInTheDocument();
    await user.type(field, '/Users/dev/code/project');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({ name: 'supplied-project', path: '/Users/dev/code/project' });
  });

  it('renders the CONFIG-DIR shape as a directory field, pre-filled with what is registered', async () => {
    const { user, puts } = await open(CLAUDE_HOME);
    const field = screen.getByLabelText('Directory');
    // A path is not a secret: it IS the registered thing, so the form shows it.
    expect(field).toHaveValue('/Users/dev/.claude');
    expect(screen.getByText(/Copied into the sandbox HOME at \.claude/)).toBeInTheDocument();

    await user.clear(field);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({ name: 'claude-config', path: null });
  });

  /**
   * An entry may change HOW it is registered. The instance already on disk is then
   * in a shape nothing reads: the row is unregistered, the form is the CURRENT one,
   * and one quiet line says why the stored value is not filling it in — no alarm,
   * because nothing is broken.
   */
  it('says why a stored instance in the OLD shape is ignored, and shows the new field', async () => {
    const { user, puts } = await open(CLAUDE_TOKEN_STALE);
    expect(
      await screen.findByText(/the registered instance is a path, but this dependency is now/),
    ).toBeInTheDocument();
    // The form follows the registration, so the token field is there to fill in.
    const field = screen.getByLabelText('CLAUDE_CODE_OAUTH_TOKEN');
    expect(field).toHaveAttribute('type', 'password');
    // …and no path field survives from the shape it used to be.
    expect(screen.queryByLabelText('Directory')).toBeNull();

    await user.type(field, 'sk-ant-oat-1');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({
      name: 'claude-login',
      env: { CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat-1' },
    });
  });

  it('gives a SERVICE its declaration fields, and a non-service entry none of them', async () => {
    const { user, puts } = await open(STRIPE);
    expect(screen.getByLabelText('Base URL')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Base URL'), 'https://api.stripe.test');
    await user.type(screen.getByLabelText('STRIPE_KEY'), 'sk_test_1');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({
      name: 'stripe',
      baseUrlEnv: 'STRIPE_BASE_URL',
      baseUrl: 'https://api.stripe.test',
      env: { STRIPE_KEY: 'sk_test_1' },
    });
  });

  /**
   * SANDBOX vs REAL was never something the page could act on: nothing in a run
   * behaves differently for it, and asking a reader to classify their own account
   * is asking a question with no consequence.
   */
  it('asks nothing about the KIND of account — the toggle is gone', async () => {
    await open(STRIPE);
    for (const word of ['sandbox', 'real', 'Account kind']) {
      expect(screen.queryByRole('button', { name: word }), word).toBeNull();
    }
    expect(screen.queryByText('Account kind')).toBeNull();
  });

  it('registers the account’s TOKEN, masked, and never echoes a stored one', async () => {
    const { user, puts } = await open(STRIPE_REGISTERED);
    const token = screen.getByLabelText('Authorization token');
    expect(token).toHaveAttribute('type', 'password');
    // Stored, so the field says it is there and never what it is.
    expect(token).toHaveValue('');
    expect(token).toHaveAttribute('placeholder', '•••• stored locally');

    await user.type(token, 'sk_live_2');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toMatchObject({ name: 'stripe', token: 'sk_live_2' });
    // Saved values do not linger in the DOM.
    await waitFor(() => expect(screen.getByLabelText('Authorization token')).toHaveValue(''));
  });

  it('leaves a stored token alone when the field is untouched', async () => {
    const { user, puts } = await open(STRIPE_REGISTERED);
    await user.type(screen.getByLabelText('Base URL'), '/v2');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    // Blank means UNCHANGED — a stored secret is never echoed, so a blank field is
    // the state every reload starts in and cannot mean "clear it".
    expect(puts[0]).not.toHaveProperty('token');
  });

  it('adds, fills and removes CUSTOM HEADERS — masking the ones that read as secrets', async () => {
    const { user, puts } = await open(STRIPE_REGISTERED);

    // The registered pair, as the server described them: the readable one shows
    // its value, the credential-shaped one is masked and carries none.
    expect(screen.getByLabelText('Header 1 name')).toHaveValue('X-Api-Key');
    expect(screen.getByLabelText('Header 1 value')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Header 1 value')).toHaveValue('');
    expect(screen.getByLabelText('Header 2 name')).toHaveValue('X-Tenant');
    expect(screen.getByLabelText('Header 2 value')).toHaveValue('acme');
    expect(screen.getByLabelText('Header 2 value')).toHaveAttribute('type', 'text');

    // A third row, named as a credential — it masks itself as the name is typed.
    await user.click(screen.getByRole('button', { name: 'Add header' }));
    await user.type(screen.getByLabelText('Header 3 name'), 'X-Account-Secret');
    expect(screen.getByLabelText('Header 3 value')).toHaveAttribute('type', 'password');
    await user.type(screen.getByLabelText('Header 3 value'), 'shh');

    // …and the one the account no longer needs goes away.
    await user.click(screen.getByRole('button', { name: 'Remove header 2' }));

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect((puts[0] as { headers: unknown }).headers).toEqual({
      'X-Tenant': null,
      'X-Account-Secret': 'shh',
    });
  });

  /**
   * An entry with BOTH halves is saved by filling in either one. Demanding a
   * variable from a reader who came to set the token would be a wall in front of
   * the only field they touched.
   */
  it('saves an entry that is both a registration and an account from either half', async () => {
    const { user, puts } = await open(ACCOUNT_DECLARED);
    await user.type(screen.getByLabelText('Authorization token'), 'sk-ant-1');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({ name: 'anthropic', token: 'sk-ant-1' });
    expect(screen.queryByText(/Nothing to save/)).toBeNull();
  });

  it('still refuses an empty save when there is nothing filled in at all', async () => {
    const { user, puts } = await open(ACCOUNT);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/Nothing to save/)).toBeInTheDocument();
    expect(puts).toHaveLength(0);
  });

  it('shows no api-shaped fields on a non-service dependency', async () => {
    await open(PROJECT);
    expect(screen.queryByLabelText('Base URL')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Base URL variable')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Authorization token')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add header' })).not.toBeInTheDocument();
    // The api-era wording is gone with it.
    expect(screen.queryByRole('button', { name: /Edit account|Provide account/ })).not.toBeInTheDocument();
  });

  // THE form is the registration. A page that instead tells a reader to open a
  // JSON file by hand has not registered anything — and it is the pattern this
  // redesign exists to remove.
  it('never instructs the reader to edit a file by hand', async () => {
    await open(ACCOUNT);
    const page = document.body.textContent ?? '';
    expect(page).not.toMatch(/set\s+`?\w+`?\s+under/i);
    expect(page).not.toMatch(/in dependencies\.local\.json/i);
    expect(page).not.toMatch(/add one to api\.externals/i);
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('says a class with nothing to register has nothing to register', async () => {
    await open(SEEDED);
    expect(screen.getByText(SEEDED.obtain!)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  it('renders a refused write inline, in the engine’s own words', async () => {
    stubFetch({ ...BASE, dependencies: [ACCOUNT] }, { status: 422, error: 'anthropic does not declare X.' });
    const user = userEvent.setup();
    render(<GuardDependenciesPane repoId="r" />, '/repos/r?section=guard&tab=externals&gext=anthropic');
    await screen.findByRole('heading', { level: 2 });

    await user.type(screen.getByLabelText('ANTHROPIC_API_KEY'), 'sk-1');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('anthropic does not declare X.')).toBeInTheDocument();
  });
});
