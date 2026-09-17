/**
 * OpenRouter-backed model price table: parsing, per-tier ceiling roll-up, the
 * day-long in-memory hold, and graceful degradation (the table already held →
 * bundled) when the network fails. `fetch` is stubbed so these never touch the
 * network.
 *
 * The table lives in the module, for the life of the process — there is no
 * on-disk cache — so every case that cares about what is held resets the module
 * registry and re-imports, which is the only way to start from "nothing held".
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { priceForModel, type PriceTable } from '../../packages/core/src/services/llm/model-prices.js';

const MODULE = '../../packages/core/src/services/llm/model-prices.js';
const DAY_MS = 24 * 60 * 60 * 1000;

/** A module instance holding nothing yet. */
async function freshPrices(): Promise<typeof import('../../packages/core/src/services/llm/model-prices.js')> {
  vi.resetModules();
  return import(MODULE);
}

/** Move the clock the module reads, so the held table ages past its TTL. */
function advanceClock(ms: number): void {
  const realNow = Date.now.bind(Date);
  vi.spyOn(Date, 'now').mockImplementation(() => realNow() + ms);
}

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

beforeEach(() => {
  // The global test setup forces offline mode; this suite exercises the real
  // fetch path against a stubbed `fetch`, so opt back in here.
  delete process.env.TRUECOURSE_NO_PRICE_FETCH;
});
afterEach(() => {
  process.env.TRUECOURSE_NO_PRICE_FETCH = '1';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const OPENROUTER_BODY = {
  data: [
    { id: 'anthropic/claude-opus-4', pricing: { prompt: '0.000015', completion: '0.000075' } },
    // a pricier opus → tier ceiling should pick the max of each direction
    { id: 'anthropic/claude-opus-4.1', pricing: { prompt: '0.00002', completion: '0.00009' } },
    { id: 'anthropic/claude-sonnet-4', pricing: { prompt: '0.000003', completion: '0.000015' } },
    { id: 'anthropic/claude-3.5-haiku', pricing: { prompt: '0.000001', completion: '0.000005' } },
    { id: 'openai/gpt-4o', pricing: { prompt: '0.0000025', completion: '0.00001' } }, // ignored for tiers
    { id: 'broken/model', pricing: { prompt: 'n/a' } }, // skipped (non-numeric)
  ],
};

describe('getModelPrices', () => {
  it('fetches and computes per-tier ceilings', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(OPENROUTER_BODY));
    vi.stubGlobal('fetch', fetchMock);
    const { getModelPrices } = await freshPrices();

    const t = await getModelPrices();
    expect(t.source).toBe('live');
    // opus tier = ceiling across both opus models
    expect(t.tiers.opus).toEqual({ input: 0.00002, output: 0.00009 });
    expect(t.tiers.sonnet).toEqual({ input: 0.000003, output: 0.000015 });
    expect(t.tiers.haiku).toEqual({ input: 0.000001, output: 0.000005 });
    // exact id retained for full-id overrides; non-Anthropic + malformed handled
    expect(t.byId['anthropic/claude-opus-4']).toEqual({ input: 0.000015, output: 0.000075 });
    expect(t.byId['openai/gpt-4o']).toBeTruthy();
    expect(t.byId['broken/model']).toBeUndefined();
  });

  it('serves the table it already holds, without refetching, inside the day', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(OPENROUTER_BODY));
    vi.stubGlobal('fetch', fetchMock);
    const { getModelPrices } = await freshPrices();

    const first = await getModelPrices();
    const second = await getModelPrices();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(second.source).toBe('live');
  });

  it('falls back to the bundled table when the network fails and it holds nothing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const { getModelPrices } = await freshPrices();

    const t = await getModelPrices();
    expect(t.source).toBe('bundled');
    expect(t.tiers.opus).toBeTruthy();
    expect(t.tiers.sonnet).toBeTruthy();
    expect(t.tiers.haiku).toBeTruthy();
  });

  it('falls back to the table it holds (real numbers) when the day-later refetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(OPENROUTER_BODY)));
    const { getModelPrices } = await freshPrices();
    const live = await getModelPrices();
    expect(live.source).toBe('live');

    // A day later the hold has expired, so the next call refetches — and loses.
    advanceClock(DAY_MS + 60_000);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    const t = await getModelPrices();
    expect(t.source).toBe('cache');
    expect(t.tiers).toEqual(live.tiers);
    expect(t.byId).toEqual(live.byId);
  });
});

describe('priceForModel', () => {
  const table: PriceTable = {
    tiers: { opus: { input: 9, output: 9 }, sonnet: { input: 8, output: 8 }, haiku: { input: 7, output: 7 } },
    byId: {
      'anthropic/claude-sonnet-4-5': { input: 3, output: 15 },
      'openai/gpt-4o': { input: 2.5, output: 10 },
      'zebra/llama-3-70b': { input: 0.9, output: 0.9 },
      'acme/llama-3-70b': { input: 0.5, output: 0.5 },
    },
    fetchedAt: Date.now(),
    source: 'live',
  };

  it('matches an exact OpenRouter id', () => {
    expect(priceForModel('openai/gpt-4o', table)).toEqual({ input: 2.5, output: 10 });
  });

  it('matches an Anthropic id without the vendor prefix', () => {
    expect(priceForModel('claude-sonnet-4-5', table)).toEqual({ input: 3, output: 15 });
  });

  // OpenRouter ids are `vendor/model`; users configure the bare provider id.
  it('matches any vendor by model-name suffix', () => {
    expect(priceForModel('gpt-4o', table)).toEqual({ input: 2.5, output: 10 });
  });

  it('picks the vendor-alphabetical first on an ambiguous suffix', () => {
    expect(priceForModel('llama-3-70b', table)).toEqual({ input: 0.5, output: 0.5 });
  });

  it('does not suffix-match a partial name segment', () => {
    expect(priceForModel('4o', table)).toBeNull();
  });

  it('falls back to the tier ceiling for our aliases and unknown Claude ids', () => {
    expect(priceForModel('opus', table)).toEqual({ input: 9, output: 9 });
    expect(priceForModel('claude-haiku-9-9', table)).toEqual({ input: 7, output: 7 });
  });

  it('returns null for a model it cannot price', () => {
    expect(priceForModel('some-local-model', table)).toBeNull();
  });
});

/**
 * A model id is not always a priced model: behind an Azure AI Foundry endpoint
 * it is a DEPLOYMENT name no price list holds. The config says which list-price
 * model that deployment serves, and only its own model is mapped.
 */
describe('pricingFor', () => {
  const TRANSPORT = '../../packages/core/src/services/llm/install-transport.js';
  const USAGE = { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheCreateTokens: 0 };
  const DEPLOYMENTS = {
    data: [
      { id: 'openai/gpt-5.6-sol', pricing: { prompt: '0.000002', completion: '0.000008' } },
      { id: 'openai/gpt-5.6-luna', pricing: { prompt: '0.0000004', completion: '0.0000016' } },
    ],
  };
  const SOL = 1000 * 0.000002 + 100 * 0.000008;
  const LUNA = 1000 * 0.0000004 + 100 * 0.0000016;

  /** A hook for `cfg` whose price table has already resolved — the table loads
   *  off the hot path, so the first priced call is the one that starts it. */
  async function hookFor(cfg: { model: string; priceModel?: string }) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(DEPLOYMENTS)));
    vi.resetModules();
    const { pricingFor }: typeof import('../../packages/core/src/services/llm/install-transport.js') =
      await import(TRANSPORT);
    const known = pricingFor({ model: 'gpt-5.6-sol' });
    known('gpt-5.6-sol', USAGE);
    await vi.waitFor(() => expect(known('gpt-5.6-sol', USAGE)).toBeGreaterThan(0));
    return pricingFor(cfg);
  }

  it('prices the deployment as the model it serves', async () => {
    const priced = await hookFor({ model: 'gpt-5.6-sol-2', priceModel: 'gpt-5.6-sol' });
    expect(priced('gpt-5.6-sol-2', USAGE)).toBeCloseTo(SOL, 12);
  });

  it('cannot price a deployment name on its own', async () => {
    const priced = await hookFor({ model: 'gpt-5.6-sol-2' });
    expect(priced('gpt-5.6-sol-2', USAGE)).toBe(0);
  });

  it('prices any other model the call really ran on under its own id', async () => {
    const priced = await hookFor({ model: 'gpt-5.6-sol-2', priceModel: 'gpt-5.6-sol' });
    expect(priced('gpt-5.6-luna', USAGE)).toBeCloseTo(LUNA, 12);
  });
});
