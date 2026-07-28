/**
 * The EXTERNAL APIs tab (item 62) — the page a user opens to hand guard a real or
 * sandbox account for a third party.
 *
 * Covers what the cards must say (state badge, blocked-test count, the
 * per-requirement reasons of an `incomplete`, detection evidence, a declared but
 * undetected service), the honest empty states (`detectionAvailable: false` is "we
 * have not looked", never "there are none"), the warning strips (overlay entries
 * the recipe never declares), and the write: the PUT body is the SECRECY split —
 * a pasted key travels as `{ value }` (gitignored overlay), a shell variable as
 * `{ valueFromEnv }` (committed name) — with a 422 refusal surfaced inline and a
 * stored secret never rendered back.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GuardExternalsPane } from '@/components/guard/GuardExternalsPane';
import type { GuardExternalsView } from '@/types/guard-externals';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const BASE: GuardExternalsView = {
  recipePath: '/repo/.truecourse/scenarios/recipe.json',
  localPath: '/repo/.truecourse/scenarios/externals.local.json',
  recipeValid: true,
  invalidReason: null,
  hasApiBlock: true,
  detectionAvailable: true,
  services: [],
  unknownLocalServices: [],
};

const STRIPE: GuardExternalsView['services'][number] = {
  service: 'stripe',
  detected: true,
  declared: true,
  state: 'incomplete',
  category: 'payment',
  baseUrlEnv: 'STRIPE_BASE_URL',
  baseUrlEnvSource: 'recipe',
  baseUrlEnvs: [],
  baseUrl: null,
  endpoints: {},
  mode: 'sandbox',
  description: 'test-mode account',
  requirements: [
    {
      kind: 'base-url',
      envVar: 'STRIPE_BASE_URL',
      resolved: false,
      reason: 'no base URL provided — add one to api.externals or externals.local.json',
      secret: false,
    },
    { kind: 'env', envVar: 'STRIPE_API_KEY', resolved: true, source: 'local', secret: true },
  ],
  blockedFlows: 3,
  evidence: [{ filePath: 'src/billing/charge.ts', importSource: 'stripe' }],
  undeclaredLocalEnv: [],
};

const OPEN_METEO: GuardExternalsView['services'][number] = {
  service: 'open-meteo',
  detected: true,
  declared: false,
  state: 'unprovided',
  category: 'other',
  baseUrlEnv: 'OPEN_METEO_BASE_URL',
  baseUrlEnvSource: 'detected',
  baseUrlEnvs: [{ envVar: 'OPEN_METEO_BASE_URL', confidence: 'name-heuristic' }],
  baseUrl: null,
  endpoints: {},
  requirements: [],
  blockedFlows: 1,
  evidence: [{ filePath: 'src/weather.ts', importSource: 'https://api.open-meteo.com' }],
  undeclaredLocalEnv: [],
};

/**
 * The item-63 shape: ONE vendor detected from bare HTTP calls to TWO of its hosts,
 * so it carries two override variables, each with the URL the app falls back to.
 */
const TWO_HOST: GuardExternalsView['services'][number] = {
  ...OPEN_METEO,
  category: undefined,
  detectedVia: 'http',
  baseUrlEnv: 'GEOCODING_BASE_URL',
  baseUrlEnvs: [
    {
      envVar: 'GEOCODING_BASE_URL',
      defaultUrl: 'https://geocoding-api.open-meteo.com',
      confidence: 'literal-fallback',
    },
    { envVar: 'FORECAST_BASE_URL', defaultUrl: 'https://api.open-meteo.com', confidence: 'literal-fallback' },
  ],
  evidence: [{ filePath: 'src/config.ts', url: 'https://api.open-meteo.com' }],
};

/** GET answers `view`; PUT answers `afterWrite` (or `view`), recording its body. */
function stubFetch(view: GuardExternalsView, afterWrite?: GuardExternalsView | { status: number; error: string }) {
  const puts: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/guard/externals') && init?.method === 'PUT') {
        puts.push(JSON.parse(String(init.body)));
        if (afterWrite && 'status' in afterWrite) return json({ error: afterWrite.error }, afterWrite.status);
        return json(afterWrite ?? view);
      }
      if (u.includes('/guard/externals')) return json(view);
      return json({});
    }),
  );
  return puts;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GuardExternalsPane — reading', () => {
  it('renders a card per service with state, blocked tests, and the unmet requirements', async () => {
    stubFetch({ ...BASE, services: [STRIPE, OPEN_METEO] });

    render(<GuardExternalsPane repoId="r" />);

    expect(await screen.findByText('stripe')).toBeInTheDocument();
    expect(screen.getByText('incomplete')).toBeInTheDocument();
    expect(screen.getByText('payment')).toBeInTheDocument();
    expect(screen.getByText('3 blocked tests')).toBeInTheDocument();
    // The reason comes from the engine and is rendered verbatim.
    expect(screen.getByText(/no base URL provided/)).toBeInTheDocument();
    // A resolved secret reads as stored, never as its characters.
    expect(screen.getByText(/STRIPE_API_KEY=•••• stored locally/)).toBeInTheDocument();
    // Detected but undeclared: it configures nothing yet.
    expect(screen.getByText('open-meteo')).toBeInTheDocument();
    expect(screen.getByText(/Detected but not declared/)).toBeInTheDocument();
  });

  it('hides detection evidence behind a toggle', async () => {
    stubFetch({ ...BASE, services: [STRIPE] });
    const user = userEvent.setup();

    render(<GuardExternalsPane repoId="r" />);

    await screen.findByText('stripe');
    expect(screen.queryByText('src/billing/charge.ts')).not.toBeInTheDocument();
    await user.click(screen.getByText(/Detection evidence \(1\)/));
    expect(screen.getByText('src/billing/charge.ts')).toBeInTheDocument();
  });

  // Item 63: an HTTP-detected service has no import to point at — its evidence is the
  // URL literal, and the line must say REQUESTS rather than claim an import.
  it('renders URL evidence for a service detected from a bare HTTP call', async () => {
    stubFetch({ ...BASE, services: [TWO_HOST] });
    const user = userEvent.setup();

    render(<GuardExternalsPane repoId="r" />);

    await screen.findByText('open-meteo');
    await user.click(screen.getByText(/Detection evidence \(1\)/));
    expect(screen.getByText('https://api.open-meteo.com')).toBeInTheDocument();
    expect(screen.getByText(/requests/)).toBeInTheDocument();
  });

  it('says detection has not run rather than claiming the repo has no third parties', async () => {
    stubFetch({ ...BASE, detectionAvailable: false });

    render(<GuardExternalsPane repoId="r" />);

    expect(await screen.findByText(/No generate report yet/)).toBeInTheDocument();
    expect(screen.getByText(/No external services known yet/)).toBeInTheDocument();
    // Manual declaration is still offered.
    expect(screen.getByRole('button', { name: /Add service/ })).toBeInTheDocument();
  });

  it('warns about a declared-but-undetected service and orphan overlay entries', async () => {
    stubFetch({
      ...BASE,
      unknownLocalServices: ['twilio'],
      services: [{ ...STRIPE, detected: false, undeclaredLocalEnv: ['STRIPE_EXTRA'] }],
    });

    render(<GuardExternalsPane repoId="r" />);

    expect(await screen.findByText(/Declared by hand/)).toBeInTheDocument();
    expect(screen.getByText(/twilio/)).toBeInTheDocument();
    expect(screen.getByText(/STRIPE_EXTRA/)).toBeInTheDocument();
  });

  it('says the recipe needs an api block before an account can be saved', async () => {
    stubFetch({ ...BASE, hasApiBlock: false });

    render(<GuardExternalsPane repoId="r" />);

    expect(await screen.findByText(/no `api` block/)).toBeInTheDocument();
  });
});

describe('GuardExternalsPane — writing', () => {
  it('sends a pasted key as an overlay value and the base URL as a declaration', async () => {
    const puts = stubFetch({ ...BASE, services: [OPEN_METEO] });
    const user = userEvent.setup();

    render(<GuardExternalsPane repoId="r" />);

    await user.click(await screen.findByRole('button', { name: 'Provide account' }));
    // The detector's guess pre-fills the env var, flagged as a suggestion.
    expect(screen.getByLabelText('Base URL env var')).toHaveValue('OPEN_METEO_BASE_URL');
    expect(screen.getByText(/Pre-filled from the code/)).toBeInTheDocument();

    await user.type(screen.getByLabelText('Base URL'), 'https://api.open-meteo.test');
    await user.click(screen.getByRole('button', { name: 'sandbox' }));
    await user.click(screen.getByRole('button', { name: /Add env var/ }));
    await user.type(screen.getByLabelText('Env var name'), 'OPEN_METEO_KEY');
    await user.type(screen.getByLabelText(/Value for OPEN_METEO_KEY/), 'sk_test_9999');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({
      externals: {
        'open-meteo': {
          baseUrlEnv: 'OPEN_METEO_BASE_URL',
          baseUrl: 'https://api.open-meteo.test',
          mode: 'sandbox',
          env: { OPEN_METEO_KEY: { value: 'sk_test_9999' } },
        },
      },
    });
  });

  it('sends a shell variable as a committed NAME, never as a value', async () => {
    const puts = stubFetch({ ...BASE, services: [OPEN_METEO] });
    const user = userEvent.setup();

    render(<GuardExternalsPane repoId="r" />);

    await user.click(await screen.findByRole('button', { name: 'Provide account' }));
    await user.click(screen.getByRole('button', { name: /Add env var/ }));
    await user.type(screen.getByLabelText('Env var name'), 'OPEN_METEO_KEY');
    await user.click(screen.getByRole('button', { name: 'from shell env' }));
    await user.type(screen.getByLabelText(/Value for OPEN_METEO_KEY/), 'MY_OPEN_METEO_KEY');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toMatchObject({
      externals: {
        'open-meteo': { env: { OPEN_METEO_KEY: { valueFromEnv: 'MY_OPEN_METEO_KEY' } } },
      },
    });
  });

  // Items 63/64: a vendor reached through two hosts needs BOTH variables pointed at
  // the account. The form field can only hold the first, so the rest arrive as
  // pre-filled ENDPOINT rows — an origin is not a secret, and declaring it as an
  // endpoint is what makes the runner proxy it.
  it('pre-fills the extra base-URL variables of an HTTP-detected service', async () => {
    const puts = stubFetch({ ...BASE, services: [TWO_HOST] });
    const user = userEvent.setup();

    render(<GuardExternalsPane repoId="r" />);

    // The card names the variables the primary field cannot show.
    expect(await screen.findByText('FORECAST_BASE_URL')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Provide account' }));
    expect(screen.getByLabelText('Base URL env var')).toHaveValue('GEOCODING_BASE_URL');
    expect(screen.getByLabelText('Endpoint env var')).toHaveValue('FORECAST_BASE_URL');
    expect(screen.getByLabelText(/URL for FORECAST_BASE_URL/)).toHaveValue('https://api.open-meteo.com');

    await user.type(screen.getByLabelText('Base URL'), 'https://stub.test');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({
      externals: {
        'open-meteo': {
          baseUrlEnv: 'GEOCODING_BASE_URL',
          baseUrl: 'https://stub.test',
          endpoints: { FORECAST_BASE_URL: 'https://api.open-meteo.com' },
        },
      },
    });
  });

  // The declared endpoints of a provided service round-trip through the form.
  it('edits a declared endpoint in place and can drop it', async () => {
    const puts = stubFetch({
      ...BASE,
      services: [
        {
          ...OPEN_METEO,
          declared: true,
          state: 'provided',
          baseUrl: 'https://api.open-meteo.test',
          endpoints: { FORECAST_BASE_URL: 'https://forecast.open-meteo.test' },
        },
      ],
    });
    const user = userEvent.setup();

    render(<GuardExternalsPane repoId="r" />);
    await user.click(await screen.findByRole('button', { name: /Edit/ }));
    expect(screen.getByLabelText(/URL for FORECAST_BASE_URL/)).toHaveValue(
      'https://forecast.open-meteo.test',
    );

    await user.click(screen.getByRole('button', { name: 'Remove FORECAST_BASE_URL' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].externals['open-meteo'].endpoints).toEqual({ FORECAST_BASE_URL: null });
  });

  it('declares a service manually and removes one', async () => {
    const puts = stubFetch({ ...BASE, services: [STRIPE] });
    const user = userEvent.setup();

    render(<GuardExternalsPane repoId="r" />);

    await user.click(await screen.findByRole('button', { name: /Add service/ }));
    await user.type(screen.getByLabelText('Service'), 'twilio');
    await user.type(screen.getByLabelText('Base URL env var'), 'TWILIO_BASE_URL');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({ externals: { twilio: { baseUrlEnv: 'TWILIO_BASE_URL' } } });

    await user.click(screen.getByRole('button', { name: /Remove/ }));
    await waitFor(() => expect(puts).toHaveLength(2));
    expect(puts[1]).toEqual({ externals: { stripe: null } });
  });

  it('refuses to send a declaration with no base-URL env var', async () => {
    const puts = stubFetch({ ...BASE, services: [{ ...OPEN_METEO, baseUrlEnv: null, baseUrlEnvSource: null }] });
    const user = userEvent.setup();

    render(<GuardExternalsPane repoId="r" />);

    await user.click(await screen.findByRole('button', { name: 'Provide account' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/base-URL env var is required/)).toBeInTheDocument();
    expect(puts).toHaveLength(0);
  });

  it('surfaces a 422 refusal inline, with the engine wording', async () => {
    stubFetch({ ...BASE, services: [OPEN_METEO] }, {
      status: 422,
      error: 'recipe.json has no `api` block — external services configure the api driver.',
    });
    const user = userEvent.setup();

    render(<GuardExternalsPane repoId="r" />);

    await user.click(await screen.findByRole('button', { name: 'Provide account' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const card = await screen.findByText(/external services configure the api driver/);
    expect(card).toBeInTheDocument();
    // The form stays open on a refusal so the user can fix it.
    expect(within(document.body).getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });
});
