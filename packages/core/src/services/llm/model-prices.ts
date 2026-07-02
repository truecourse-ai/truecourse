/**
 * Live per-token model prices for the pre-flight COST estimate.
 *
 * Anthropic publishes no machine-readable pricing API, so we pull OpenRouter's
 * public model list (`GET /api/v1/models`, no auth) and cache it under the global
 * dir for a day. The resulting figure is deliberately a CEILING:
 *   - per tier we take the MOST EXPENSIVE matching model, and
 *   - we don't model prompt-caching / batch discounts (which only ever reduce cost).
 * So the real bill lands at or below what we show.
 *
 * Network failure degrades gracefully: fresh cache → stale cache → bundled table.
 * `getModelPrices()` never throws — it always returns a usable table.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getGlobalDir } from '../../config/paths.js';

/** USD per token, split by direction (Anthropic output ≈ 5× input). */
export interface ModelPrice {
  input: number;
  output: number;
}

export interface PriceTable {
  /** Per-tier ceiling prices, keyed `haiku` | `sonnet` | `opus`. */
  tiers: Record<string, ModelPrice>;
  /** Exact OpenRouter ids → price, for full-id model overrides. */
  byId: Record<string, ModelPrice>;
  fetchedAt: number;
  /** Where these numbers came from — drives the disclaimer copy. */
  source: 'live' | 'cache' | 'bundled';
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/models';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // refetch once a day
const FETCH_TIMEOUT_MS = 8000;
const CACHE_FILE = 'openrouter-prices.json';
const TIERS = ['opus', 'sonnet', 'haiku'] as const;

// Last-resort Anthropic list prices (USD per token) when we're offline with no
// cache at all. Kept coarse — the disclaimer flags it as approximate.
const BUNDLED: Record<string, ModelPrice> = {
  opus: { input: 15 / 1e6, output: 75 / 1e6 },
  sonnet: { input: 3 / 1e6, output: 15 / 1e6 },
  haiku: { input: 1 / 1e6, output: 5 / 1e6 },
};

function tierOf(id: string): (typeof TIERS)[number] | null {
  const s = id.toLowerCase();
  return s.includes('opus') ? 'opus' : s.includes('sonnet') ? 'sonnet' : s.includes('haiku') ? 'haiku' : null;
}

function cacheFilePath(): string {
  return path.join(getGlobalDir(), 'cache', CACHE_FILE);
}

function readCache(): PriceTable | null {
  try {
    const t = JSON.parse(fs.readFileSync(cacheFilePath(), 'utf-8')) as PriceTable;
    if (t && t.tiers && t.byId && typeof t.fetchedAt === 'number') return t;
  } catch {
    /* missing / unreadable cache — fall through */
  }
  return null;
}

function writeCache(t: PriceTable): void {
  try {
    fs.mkdirSync(path.dirname(cacheFilePath()), { recursive: true });
    fs.writeFileSync(cacheFilePath(), JSON.stringify(t));
  } catch {
    /* cache is best-effort; a write failure must not break the estimate */
  }
}

function bundledTable(): PriceTable {
  return { tiers: { ...BUNDLED }, byId: {}, fetchedAt: 0, source: 'bundled' };
}

/** Roll the raw OpenRouter id→price map into per-tier ceilings (Anthropic only). */
function computeTiers(byId: Record<string, ModelPrice>): Record<string, ModelPrice> {
  const tiers: Record<string, ModelPrice> = {};
  for (const [id, price] of Object.entries(byId)) {
    if (!id.startsWith('anthropic/')) continue;
    const tier = tierOf(id);
    if (!tier) continue;
    const cur = tiers[tier];
    tiers[tier] = cur
      ? { input: Math.max(cur.input, price.input), output: Math.max(cur.output, price.output) }
      : price;
  }
  for (const t of TIERS) if (!tiers[t]) tiers[t] = BUNDLED[t]; // backfill missing tier
  return tiers;
}

async function fetchPrices(): Promise<PriceTable> {
  const res = await fetch(OPENROUTER_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
  const json = (await res.json()) as {
    data?: Array<{ id?: string; pricing?: { prompt?: string; completion?: string } }>;
  };
  const byId: Record<string, ModelPrice> = {};
  for (const m of json.data ?? []) {
    if (!m.id) continue;
    const input = Number(m.pricing?.prompt);
    const output = Number(m.pricing?.completion);
    if (!Number.isFinite(input) || !Number.isFinite(output)) continue;
    byId[m.id] = { input, output };
  }
  return { tiers: computeTiers(byId), byId, fetchedAt: Date.now(), source: 'live' };
}

/**
 * Resolve a price table for the cost estimate. Returns fresh cache if it's
 * under a day old, otherwise refetches; on any failure falls back to the stale
 * cache, then to the bundled table. Always resolves — never rejects.
 */
export async function getModelPrices(): Promise<PriceTable> {
  // Offline / air-gapped mode (also how the test suite stays network-free):
  // skip the fetch + cache and price from the bundled list prices.
  if (process.env.TRUECOURSE_NO_PRICE_FETCH) return bundledTable();

  const cached = readCache();
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached;
  try {
    const fresh = await fetchPrices();
    writeCache(fresh);
    return fresh;
  } catch {
    if (cached) return { ...cached, source: 'cache' }; // stale, but real numbers
    return bundledTable();
  }
}

/**
 * Price for a resolved model string. Tries an exact OpenRouter id (with/without
 * the `anthropic/` prefix), then falls back to the tier ceiling by substring —
 * covering both our aliases (`opus`/`sonnet`/`haiku`) and full ids
 * (`claude-opus-4-8`). Returns null for models we can't price.
 */
export function priceForModel(model: string, table: PriceTable): ModelPrice | null {
  if (table.byId[model]) return table.byId[model];
  if (table.byId[`anthropic/${model}`]) return table.byId[`anthropic/${model}`];
  const tier = tierOf(model);
  if (tier && table.tiers[tier]) return table.tiers[tier];
  return null;
}
