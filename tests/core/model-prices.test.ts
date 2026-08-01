/**
 * OpenRouter-backed model price table: parsing, per-tier ceiling roll-up, the
 * daily cache, and graceful degradation (stale cache → bundled) when the network
 * fails. `fetch` is stubbed so these never touch the network.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  getModelPrices,
  priceForModel,
  type PriceTable,
} from '../../packages/core/src/services/llm/model-prices.js';

let home: string;
const cacheFile = () => path.join(home, 'cache', 'openrouter-prices.json');

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-prices-'));
  process.env.TRUECOURSE_HOME = home;
  // The global test setup forces offline mode; this suite exercises the real
  // fetch/cache path against a stubbed `fetch`, so opt back in here.
  delete process.env.TRUECOURSE_NO_PRICE_FETCH;
});
afterEach(() => {
  delete process.env.TRUECOURSE_HOME;
  process.env.TRUECOURSE_NO_PRICE_FETCH = '1';
  vi.unstubAllGlobals();
  fs.rmSync(home, { recursive: true, force: true });
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
  it('fetches, computes per-tier ceilings, and writes the cache', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(OPENROUTER_BODY));
    vi.stubGlobal('fetch', fetchMock);

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
    expect(fs.existsSync(cacheFile())).toBe(true);
  });

  it('serves a fresh cache without refetching', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(OPENROUTER_BODY));
    vi.stubGlobal('fetch', fetchMock);
    await getModelPrices(); // populates cache
    await getModelPrices(); // should hit cache
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to the bundled table when the network fails with no cache', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const t = await getModelPrices();
    expect(t.source).toBe('bundled');
    expect(t.tiers.opus).toBeTruthy();
    expect(t.tiers.sonnet).toBeTruthy();
    expect(t.tiers.haiku).toBeTruthy();
  });

  it('falls back to a stale cache (real numbers) when a refetch fails', async () => {
    fs.mkdirSync(path.dirname(cacheFile()), { recursive: true });
    fs.writeFileSync(
      cacheFile(),
      JSON.stringify({
        tiers: { opus: { input: 1, output: 2 }, sonnet: { input: 1, output: 2 }, haiku: { input: 1, output: 2 } },
        byId: {},
        fetchedAt: 0, // ancient → triggers a refetch
        source: 'live',
      }),
    );
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const t = await getModelPrices();
    expect(t.source).toBe('cache');
    expect(t.tiers.opus).toEqual({ input: 1, output: 2 });
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
