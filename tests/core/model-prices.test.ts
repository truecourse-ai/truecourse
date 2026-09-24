/**
 * The model price table: OpenRouter's four published rates per model, the
 * per-tier ceiling roll-up, the day-long in-memory hold, the table kept when a
 * refetch fails — and NO table at all when no fetch has ever succeeded, since
 * there are no invented prices to fall back on.
 *
 * Then the two readers: a call that ran, priced bucket by bucket at its own
 * rates, and the per-config pricing hook the api session driver is handed.
 *
 * The real OpenRouter fetch runs against a stubbed `fetch`, so nothing here
 * reaches the network; everything else prices from a table installed through
 * the source seam.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  costOfCall,
  getModelPrices,
  heldModelPrices,
  priceForModel,
  resetModelPriceSource,
  totalCost,
  type PriceTable,
} from '../../packages/core/src/services/llm/model-prices.js';
import { priceCall, pricingFor, priceOfConfig } from '../../packages/core/src/services/llm/provider.js';
import { installModelPrices, TEST_PRICES, uninstallModelPrices } from '../helpers/model-prices';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Move the clock the module reads, so the held table ages. */
function advanceClock(ms: number): void {
  const realNow = Date.now.bind(Date);
  vi.spyOn(Date, 'now').mockImplementation(() => realNow() + ms);
}

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

/** The real OpenRouter source, against `fetch` as stubbed here; nothing held. */
function useOpenRouter(fetchMock: ReturnType<typeof vi.fn>): void {
  vi.stubGlobal('fetch', fetchMock);
  resetModelPriceSource();
}

afterEach(() => {
  uninstallModelPrices();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const OPENROUTER_BODY = {
  data: [
    {
      id: 'anthropic/claude-opus-5',
      pricing: {
        prompt: '0.000005',
        completion: '0.000025',
        input_cache_read: '0.0000005',
        input_cache_write: '0.00000625',
      },
    },
    // a pricier opus → the tier ceiling takes the max of each rate
    {
      id: 'anthropic/claude-opus-4.1',
      pricing: {
        prompt: '0.000015',
        completion: '0.000075',
        input_cache_read: '0.0000015',
        input_cache_write: '0.00001875',
      },
    },
    { id: 'anthropic/claude-sonnet-4', pricing: { prompt: '0.000003', completion: '0.000015' } },
    {
      id: 'openai/gpt-5.6-sol',
      pricing: {
        prompt: '0.000002',
        completion: '0.00001',
        input_cache_read: '0.0000002',
        input_cache_write: '0.0000025',
      },
    },
    { id: 'broken/model', pricing: { prompt: 'n/a' } }, // skipped (non-numeric)
    { id: 'openrouter/auto', pricing: { prompt: '-1', completion: '-1' } }, // skipped ("variable")
  ],
};

describe('getModelPrices', () => {
  it('reads all four published rates, and rolls Anthropic models into tier ceilings', async () => {
    useOpenRouter(vi.fn().mockResolvedValue(okResponse(OPENROUTER_BODY)));

    const t = await getModelPrices();
    expect(t).not.toBeNull();
    expect(t!.source).toBe('live');
    expect(t!.byId['openai/gpt-5.6-sol']).toEqual({
      input: 0.000002,
      output: 0.00001,
      cacheRead: 0.0000002,
      cacheWrite: 0.0000025,
    });
    // A rate the list does not publish is absent, never filled in.
    expect(t!.byId['anthropic/claude-sonnet-4']).toEqual({ input: 0.000003, output: 0.000015 });
    expect(t!.byId['broken/model']).toBeUndefined();
    expect(t!.byId['openrouter/auto']).toBeUndefined();

    expect(t!.tiers.opus).toEqual({
      input: 0.000015,
      output: 0.000075,
      cacheRead: 0.0000015,
      cacheWrite: 0.00001875,
    });
    expect(t!.tiers.sonnet).toEqual({ input: 0.000003, output: 0.000015 });
    // No haiku on the list: the tier has no price, and neither does a model resolving to it.
    expect(t!.tiers.haiku).toBeUndefined();
    expect(priceForModel('haiku', t!)).toBeNull();
  });

  it('serves the table it already holds, without refetching, inside the day', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(OPENROUTER_BODY));
    useOpenRouter(fetchMock);

    const first = await getModelPrices();
    const second = await getModelPrices();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('has NO table when the fetch fails and nothing is held — no invented prices', async () => {
    useOpenRouter(vi.fn().mockRejectedValue(new Error('offline')));
    expect(await getModelPrices()).toBeNull();
    expect(heldModelPrices()).toBeNull();
  });

  it('asks an unreachable list again after a minute, not on every read', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
    useOpenRouter(fetchMock);
    expect(await getModelPrices()).toBeNull();
    expect(await getModelPrices()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    advanceClock(61_000);
    fetchMock.mockResolvedValue(okResponse(OPENROUTER_BODY));
    expect((await getModelPrices())?.source).toBe('live');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the table it holds (real numbers) when the day-later refetch fails', async () => {
    useOpenRouter(vi.fn().mockResolvedValue(okResponse(OPENROUTER_BODY)));
    const live = await getModelPrices();
    expect(live!.source).toBe('live');

    advanceClock(DAY_MS + 60_000);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    const t = await getModelPrices();
    expect(t!.source).toBe('cache');
    expect(t!.byId).toEqual(live!.byId);
    expect(t!.tiers).toEqual(live!.tiers);
  });

  it('prices from an installed table in place of the fetch', async () => {
    installModelPrices();
    const t = await getModelPrices();
    expect(t!.byId).toEqual(TEST_PRICES);
    expect(priceForModel('claude-opus-5', t!)).toEqual(TEST_PRICES['anthropic/claude-opus-5']);
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

describe('costOfCall — a call that ran', () => {
  const OPUS = TEST_PRICES['anthropic/claude-opus-5']!;
  const USAGE = { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 50_000, cacheCreateTokens: 4000 };

  it('prices every bucket at its own published rate', () => {
    expect(totalCost(costOfCall(OPUS, USAGE)!)).toBeCloseTo(
      1000 * 0.000005 + 200 * 0.000025 + 50_000 * 0.0000005 + 4000 * 0.00000625,
      12,
    );
  });

  it('splits the cost the way the tokens are split: a cache write is input', () => {
    const cost = costOfCall(OPUS, USAGE)!;
    expect(cost.input).toBeCloseTo(1000 * 0.000005 + 4000 * 0.00000625, 12);
    expect(cost.output).toBeCloseTo(200 * 0.000025, 12);
    expect(cost.cached).toBeCloseTo(50_000 * 0.0000005, 12);
  });

  it('charges a cache read less than the same tokens fresh, and a cache write more', () => {
    const tokens = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 };
    const fresh = totalCost(costOfCall(OPUS, { ...tokens, inputTokens: 10_000 })!);
    const read = totalCost(costOfCall(OPUS, { ...tokens, cacheReadTokens: 10_000 })!);
    const written = totalCost(costOfCall(OPUS, { ...tokens, cacheCreateTokens: 10_000 })!);
    expect(read).toBeCloseTo(fresh / 10, 12);
    expect(written).toBeCloseTo(fresh * 1.25, 12);
  });

  it('leaves a call unpriced when it reported cache tokens its model publishes no rate for', () => {
    const noCache = { input: 0.000003, output: 0.000015 };
    expect(costOfCall(noCache, { ...USAGE, cacheCreateTokens: 0 })).toBeNull();
    expect(costOfCall(noCache, { ...USAGE, cacheReadTokens: 0 })).toBeNull();
    // A bucket with no tokens needs no rate.
    expect(totalCost(costOfCall(noCache, { ...USAGE, cacheReadTokens: 0, cacheCreateTokens: 0 })!)).toBeCloseTo(
      1000 * 0.000003 + 200 * 0.000015,
      12,
    );
  });
});

/**
 * A model id is not always a priced model: behind an Azure AI Foundry endpoint
 * it is a DEPLOYMENT name no price list holds. The config says which list-price
 * model that deployment serves, and only its own model is mapped.
 */
describe('pricingFor', () => {
  const USAGE = { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 9000, cacheCreateTokens: 0 };
  const SOL = TEST_PRICES['openai/gpt-5.6-sol']!;
  const LUNA = { input: 0.0000004, output: 0.0000016, cacheRead: 0.00000004 };
  const cost = (p: typeof LUNA) => 1000 * p.input + 100 * p.output + 9000 * p.cacheRead;

  /** A hook for `cfg` over a table that has already been fetched. */
  async function hookFor(cfg: { model: string; priceModel?: string }) {
    installModelPrices({ ...TEST_PRICES, 'openai/gpt-5.6-luna': LUNA });
    await getModelPrices();
    return pricingFor(cfg);
  }

  it('prices the deployment as the model it serves, cache reads at the cache rate', async () => {
    const priced = await hookFor({ model: 'gpt-5.6-sol-2', priceModel: 'gpt-5.6-sol' });
    expect(totalCost(priced('gpt-5.6-sol-2', USAGE)!)).toBeCloseTo(cost({ ...SOL, cacheRead: SOL.cacheRead! }), 12);
  });

  it('cannot price a deployment name on its own', async () => {
    const priced = await hookFor({ model: 'gpt-5.6-sol-2' });
    expect(priced('gpt-5.6-sol-2', USAGE)).toBeNull();
  });

  it('prices any other model the call really ran on under its own id', async () => {
    const priced = await hookFor({ model: 'gpt-5.6-sol-2', priceModel: 'gpt-5.6-sol' });
    expect(totalCost(priced('gpt-5.6-luna', USAGE)!)).toBeCloseTo(cost(LUNA), 12);
  });

  it('records a turn unpriced while no table has been fetched', () => {
    uninstallModelPrices();
    expect(priceCall('gpt-5.6-sol', USAGE)).toBeNull();
    expect(pricingFor({ model: 'gpt-5.6-sol' })('gpt-5.6-sol', USAGE)).toBeNull();
  });

  it('answers the price a config is charged at, and none without a table', async () => {
    installModelPrices();
    expect(await priceOfConfig({ model: 'gpt-5.6-sol-2', priceModel: 'gpt-5.6-sol' })).toEqual(SOL);
    expect(await priceOfConfig({ model: 'gpt-5.6-sol-2' })).toBeNull();
    uninstallModelPrices();
    expect(await priceOfConfig({ model: 'gpt-5.6-sol' })).toBeNull();
  });
});
