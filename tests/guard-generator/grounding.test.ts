/**
 * CODE-TRUTH GROUNDING IN THE AUTHORING PROMPT — the joins and the two
 * per-repo blocks they render.
 *
 * The three failures these blocks exist to stop, all measured on the `speced-api`
 * bench across three consecutive `guard generate` runs: a stub scripted against the
 * vendor's default payload the app then REJECTS (5 scenarios per run), a setup
 * signup missing the required `name` (400 before the claim ran), and two scenarios
 * that invented a route the catalog already named exactly.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  buildJourneyContractHints,
  buildOtherOperationHints,
  buildOutboundRequestHints,
  outboundOverflow,
  MAX_OTHER_OPERATIONS,
  MAX_OUTBOUND_REQUESTS,
  MAX_QUERY_PARAMS,
  MAX_RESPONSE_FIELDS,
} from '../../packages/guard-generator/src/grounding';
import { buildAuthorUserPrompt, type AuthorUserContext } from '../../packages/guard-generator/src/prompts';
import type { ApiRequestContract, DetectedExternalService, Journey, OutboundRequest } from '../../packages/shared/src';
import {
  makeTempRepo,
  rmrf,
  writeDoc,
  writeCorpus,
  writeApiRecipe,
  extractBy,
  apiWorkerTurnBy,
  runGenerate,
  journeysOf,
  apiJourney as helperApiJourney,
  withCodeTruth,
  rawApi,
  PASSING_API_STEPS,
} from './helpers.js';

const LOCATION = { filePath: '/repo/src/upstream/forecast.ts', startLine: 1, endLine: 1, startColumn: 0, endColumn: 1 };

function apiJourney(method: string, path: string): Journey {
  return {
    id: `api/${method.toLowerCase()}${path.replace(/\W+/g, '-')}`,
    type: 'api',
    title: `${method} ${path}`,
    entry: { method, path },
    steps: [{ kind: 'request', method, path }],
    fingerprint: `fp-${method}-${path}`,
  } as Journey;
}

const FORECAST: OutboundRequest = {
  urlRef: { baseExpr: 'baseUrl' },
  method: 'GET',
  pathLiteral: '/v1/forecast',
  queryParams: [
    { key: 'timezone', value: 'auto' },
    { key: 'timeformat', value: 'unixtime' },
    { key: 'temperature_unit', value: '<dynamic>' },
  ],
  responseFieldsRead: [
    { path: 'current', hint: 'object' },
    { path: 'current.time', hint: 'number' },
    { path: 'current.weather_code', hint: 'number' },
  ],
  location: LOCATION,
};

function ctx(extra: Partial<AuthorUserContext> = {}): AuthorUserContext {
  return {
    flow: { id: 'f', title: 'Flow', goal: 'goal' },
    milestones: [{ order: 1, claim: 'c', doc: 'd.md', sectionHeading: 'h', sectionText: 't', realization: [] }],
    journeyPath: [],
    areaTags: [],
    driver: 'api',
    recipeBuild: 'npm run build',
    ...extra,
  };
}

describe('buildJourneyContractHints', () => {
  const contracts: ApiRequestContract[] = [
    {
      method: 'POST',
      path: '/v1/auth/signup',
      bodyFields: [
        { name: 'email', required: true },
        { name: 'name', required: true },
        { name: 'referrer', required: false },
      ],
    },
  ];

  it('carries the contract onto the operation the plan walks', () => {
    const [hint] = buildJourneyContractHints([apiJourney('POST', '/v1/auth/signup')], contracts);
    expect(hint.bodyFields).toEqual(contracts[0].bodyFields);
  });

  it('still lists an operation with NO contract — the exact path is itself the grounding', () => {
    const hints = buildJourneyContractHints([apiJourney('GET', '/v1/favorites')], contracts);
    expect(hints).toEqual([{ method: 'GET', path: '/v1/favorites' }]);
  });

  it('ignores non-api journeys and collapses a repeated operation', () => {
    const cli = { ...apiJourney('GET', '/x'), type: 'cli', entry: { command: ['x'] } } as unknown as Journey;
    const hints = buildJourneyContractHints(
      [apiJourney('POST', '/v1/auth/signup'), apiJourney('POST', '/v1/auth/signup'), cli],
      contracts,
    );
    expect(hints).toHaveLength(1);
  });
});

describe('buildOtherOperationHints — the setup surface', () => {
  const contracts: ApiRequestContract[] = [
    { method: 'POST', path: '/v1/auth/signup', bodyFields: [{ name: 'email', required: true }] },
  ];
  const catalog = [
    apiJourney('POST', '/v1/auth/signup'),
    apiJourney('POST', '/v1/auth/signin'),
    apiJourney('GET', '/v1/favorites'),
  ];

  it('offers the rest of the surface, with contracts, minus what the flow walks', () => {
    const own = buildJourneyContractHints([apiJourney('GET', '/v1/favorites')], contracts);
    const { operations, overflow } = buildOtherOperationHints(catalog, contracts, own);
    expect(operations).toEqual([
      { method: 'POST', path: '/v1/auth/signup', bodyFields: [{ name: 'email', required: true }] },
      { method: 'POST', path: '/v1/auth/signin' },
    ]);
    expect(overflow).toBe(0);
  });

  it('is empty when the flow already walks the whole surface', () => {
    const own = buildJourneyContractHints(catalog, contracts);
    expect(buildOtherOperationHints(catalog, contracts, own).operations).toEqual([]);
  });

  it('caps the list and counts what it dropped', () => {
    const many = Array.from({ length: MAX_OTHER_OPERATIONS + 4 }, (_, i) => apiJourney('GET', `/v1/r${i}`));
    const { operations, overflow } = buildOtherOperationHints(many, [], []);
    expect(operations).toHaveLength(MAX_OTHER_OPERATIONS);
    expect(overflow).toBe(4);
  });
});

describe('buildOutboundRequestHints', () => {
  it('attributes a request to a service by literal HOST', () => {
    const services: DetectedExternalService[] = [
      { service: 'stripe', evidence: [{ filePath: '/repo/src/pay.ts', url: 'https://api.stripe.com/v1' }] },
    ];
    const [hint] = buildOutboundRequestHints(
      [{ ...FORECAST, urlRef: { host: 'api.stripe.com' }, pathLiteral: '/v1/charges' }],
      services,
    );
    expect(hint.service).toBe('stripe');
  });

  it('attributes by base-URL ENV VAR when the source reads one', () => {
    const services: DetectedExternalService[] = [
      {
        service: 'open-meteo',
        evidence: [],
        baseUrlEnvs: [{ envVar: 'FORECAST_BASE_URL', confidence: 'literal-fallback' }],
      },
    ];
    const [hint] = buildOutboundRequestHints([{ ...FORECAST, urlRef: { envVar: 'FORECAST_BASE_URL' } }], services);
    expect(hint.service).toBe('open-meteo');
  });

  it('never guesses a service onto an unresolved base', () => {
    const services: DetectedExternalService[] = [{ service: 'open-meteo', evidence: [] }];
    const [hint] = buildOutboundRequestHints([FORECAST], services);
    expect(hint.service).toBeUndefined();
    // …and the facts survive anyway: they are what a stub has to satisfy.
    expect(hint.queryParams).toHaveLength(3);
  });

  it('caps params, fields and requests, and counts what it dropped', () => {
    const big: OutboundRequest = {
      ...FORECAST,
      queryParams: Array.from({ length: MAX_QUERY_PARAMS + 3 }, (_, i) => ({ key: `k${i}`, value: 'v' })),
      responseFieldsRead: Array.from({ length: MAX_RESPONSE_FIELDS + 5 }, (_, i) => ({ path: `f${i}` })),
    };
    const many = Array.from({ length: MAX_OUTBOUND_REQUESTS + 2 }, (_, i) => ({
      ...big,
      pathLiteral: `/p${i}`,
    }));
    const hints = buildOutboundRequestHints(many, []);
    expect(hints).toHaveLength(MAX_OUTBOUND_REQUESTS);
    expect(hints[0].queryParams).toHaveLength(MAX_QUERY_PARAMS);
    expect(hints[0].moreQueryParams).toBe(3);
    expect(hints[0].responseFields).toHaveLength(MAX_RESPONSE_FIELDS);
    expect(hints[0].moreResponseFields).toBe(5);
    expect(outboundOverflow(many)).toBe(2);
  });
});

describe('the authoring prompt blocks', () => {
  it('states the exact operation, its required fields, and the verbatim-path rule', () => {
    const prompt = buildAuthorUserPrompt(
      ctx({
        journeyContracts: [
          {
            method: 'POST',
            path: '/v1/auth/signup',
            bodyFields: [
              { name: 'email', required: true },
              { name: 'name', required: true },
              { name: 'referrer', required: 'unknown' },
            ],
          },
        ],
      }),
    );
    expect(prompt).toContain('OPERATIONS THIS FLOW WALKS');
    expect(prompt).toContain('- POST /v1/auth/signup — body requires email, name; also reads referrer');
    expect(prompt).toContain('Use\nthese paths VERBATIM');
  });

  it("renders the app's outbound request truth, typed, with its literal query values", () => {
    const prompt = buildAuthorUserPrompt(
      ctx({ outboundRequests: buildOutboundRequestHints([FORECAST], []) }),
    );
    expect(prompt).toContain('OUTBOUND REQUESTS THIS APP MAKES');
    expect(prompt).toContain('- GET /v1/forecast   (base: `baseUrl`)');
    expect(prompt).toContain('query: timezone="auto", timeformat="unixtime", temperature_unit=<dynamic>');
    expect(prompt).toContain('reads: current (object), current.time (number), current.weather_code (number)');
  });

  it('names the service when the join resolved one, and says how many were truncated', () => {
    const prompt = buildAuthorUserPrompt(
      ctx({
        outboundRequests: [{ service: 'open-meteo', method: 'GET', path: '/v1/forecast', queryParams: [], responseFields: [] }],
        outboundRequestsOverflow: 3,
      }),
    );
    expect(prompt).toContain('- open-meteo: GET /v1/forecast');
    expect(prompt).toContain('…and 3 more outbound request(s) not shown.');
  });

  it('lists the OTHER operations as setup material, under the same rules', () => {
    const prompt = buildAuthorUserPrompt(
      ctx({
        journeyContracts: [{ method: 'GET', path: '/v1/favorites' }],
        otherOperations: [
          { method: 'POST', path: '/v1/auth/signup', bodyFields: [{ name: 'email', required: true }] },
        ],
        otherOperationsOverflow: 2,
      }),
    );
    expect(prompt).toContain('OTHER OPERATIONS AVAILABLE (for setup steps — same verbatim-path rule)');
    expect(prompt).toContain('- POST /v1/auth/signup — body requires email');
    expect(prompt).toContain('(…and 2 more operation(s) not shown.)');
    // The verbatim rule now spans BOTH blocks.
    expect(prompt).toContain('a path listed in neither operations block below nor in a');
  });

  it('renders no OTHER-operations block when the flow walks everything', () => {
    const prompt = buildAuthorUserPrompt(ctx({ journeyContracts: [{ method: 'GET', path: '/x' }] }));
    expect(prompt).toContain('OPERATIONS THIS FLOW WALKS');
    expect(prompt).not.toContain('OTHER OPERATIONS AVAILABLE');
  });

  it('renders NEITHER block without data, and never on cli', () => {
    const bare = buildAuthorUserPrompt(ctx({ recipeEntry: ['node', 'cli.js'] }));
    expect(bare).not.toContain('OPERATIONS THIS FLOW WALKS');
    expect(bare).not.toContain('OUTBOUND REQUESTS THIS APP MAKES');
    const cli = buildAuthorUserPrompt(
      ctx({
        driver: 'cli',
        recipeEntry: ['node', 'cli.js'],
        journeyContracts: [{ method: 'POST', path: '/v1/auth/signup' }],
        outboundRequests: buildOutboundRequestHints([FORECAST], []),
      }),
    );
    expect(cli).not.toContain('OPERATIONS THIS FLOW WALKS');
    expect(cli).not.toContain('OTHER OPERATIONS AVAILABLE');
    expect(cli).not.toContain('OUTBOUND REQUESTS THIS APP MAKES');
    // The ungrounded prompt for the same context, byte for byte.
    expect(cli).toBe(buildAuthorUserPrompt(ctx({ driver: 'cli', recipeEntry: ['node', 'cli.js'] })));
  });
});

describe('generateGuards — the grounding rides the SAME provider the journeys do', () => {
  const repos: string[] = [];
  afterEach(() => {
    while (repos.length) rmrf(repos.pop()!);
  });

  it('reaches the api authoring context per journey, and never a cli one', async () => {
    const r = makeTempRepo();
    repos.push(r);
    writeApiRecipe(r, { entry: null });
    writeCorpus(r, [{ ref: 'docs/api.md' }]);
    writeDoc(r, 'docs/api.md', ['## list', 'GET /todos returns 200 with the todo list.'].join('\n'));
    const openings: string[] = [];

    await runGenerate({
      repoRoot: r,
      journeys: withCodeTruth(journeysOf(r, helperApiJourney('GET', '/todos')), {
        requestContracts: [
          { method: 'GET', path: '/todos', queryFields: [{ name: 'limit', required: 'unknown' }] },
          // An operation this flow does NOT walk must not leak into its prompt.
          { method: 'POST', path: '/elsewhere', bodyFields: [{ name: 'secretish', required: true }] },
        ],
        outboundRequests: [FORECAST],
      }),
      extractRunner: extractBy({
        list: [{ driver: 'api', claim: 'GET /todos returns 200 with the list', reason: 'HTTP status' }],
      }),
      turnFn: apiWorkerTurnBy({ list: rawApi('GET /todos answers 200', PASSING_API_STEPS) }, (req) => {
        if (req.messages.length === 1) openings.push(req.messages[0].text);
      }),
    });

    const prompt = openings[0]!;
    expect(prompt).toContain('- GET /todos — query also reads limit');
    expect(prompt).toContain('timeformat="unixtime"');
    // The flow walks the only api journey, so there is no OTHER-operations block,
    // and the operation this flow does NOT walk never leaks into its prompt.
    expect(prompt).not.toContain('OTHER OPERATIONS AVAILABLE');
    expect(prompt).not.toContain('secretish');
  });

  it('offers the operations the flow does NOT walk as setup material', async () => {
    const r = makeTempRepo();
    repos.push(r);
    writeApiRecipe(r, { entry: null });
    writeCorpus(r, [{ ref: 'docs/api.md' }]);
    writeDoc(r, 'docs/api.md', ['## list', 'GET /todos returns 200 with the todo list.'].join('\n'));
    const openings: string[] = [];

    await runGenerate({
      repoRoot: r,
      journeys: withCodeTruth(
        journeysOf(r, helperApiJourney('GET', '/todos'), helperApiJourney('POST', '/signup')),
        {
          requestContracts: [
            { method: 'POST', path: '/signup', bodyFields: [{ name: 'email', required: true }] },
          ],
        },
      ),
      extractRunner: extractBy({
        list: [{ driver: 'api', claim: 'GET /todos returns 200 with the list', reason: 'HTTP status' }],
      }),
      turnFn: apiWorkerTurnBy({ list: rawApi('GET /todos answers 200', PASSING_API_STEPS) }, (req) => {
        if (req.messages.length === 1) openings.push(req.messages[0].text);
      }),
    });

    // The flow's plan walks /todos; /signup is the setup surface it may reach for.
    const prompt = openings[0]!;
    expect(prompt).toContain('OPERATIONS THIS FLOW WALKS');
    expect(prompt).toContain('- GET /todos');
    expect(prompt).toContain('OTHER OPERATIONS AVAILABLE');
    expect(prompt).toContain('- POST /signup — body requires email');
  });
});
