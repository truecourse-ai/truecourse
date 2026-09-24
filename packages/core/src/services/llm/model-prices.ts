/**
 * Per-token model prices, as OpenRouter publishes them.
 *
 * Anthropic and OpenAI publish no machine-readable pricing API, so the table is
 * OpenRouter's public model list (`GET /api/v1/models`, no auth), held in memory
 * and refetched at most once a day. Each model carries up to four rates — fresh
 * input, output, cache read and cache write — exactly as listed; a rate the list
 * does not publish is absent, never filled in.
 *
 * THERE IS NO TABLE until a fetch has succeeded. A later fetch that fails keeps
 * the table already held (stale, but real numbers); with nothing held there are
 * no prices at all, and every reader says so rather than inventing one.
 *
 * Two readers price against it, differently:
 *   - a TURN THAT RAN is priced exactly, each token bucket at its own rate
 *     ({@link costOfCall}) — that is what Settings › Usage shows and what a
 *     credits workspace is debited;
 *   - the pre-flight ESTIMATE is a ceiling (`token-estimator.ts`), since it
 *     cannot know in advance how a run's input will split between the buckets.
 *
 * Where the table comes from is a seam ({@link setModelPriceSource}): the
 * process fetches OpenRouter, and a test installs a known table instead.
 */

/** USD per token, one rate per bucket a provider bills. */
export interface ModelPrice {
  /** Fresh (uncached) input. */
  input: number;
  output: number;
  /** Input served from the prompt cache. Absent when the list publishes none. */
  cacheRead?: number;
  /** Input written to the prompt cache. Absent when the list publishes none. */
  cacheWrite?: number;
}

export interface PriceTable {
  /** Per-tier ceiling prices, keyed `haiku` | `sonnet` | `opus` — only the tiers the list holds. */
  tiers: Record<string, ModelPrice>;
  /** Exact OpenRouter ids → price. */
  byId: Record<string, ModelPrice>;
  fetchedAt: number;
  /** `live` fresh from the source; `cache` the table held when a refetch failed. */
  source: 'live' | 'cache';
}

/** Where the per-model prices come from: OpenRouter id → price. Rejects when it cannot answer. */
export type ModelPriceSource = () => Promise<Record<string, ModelPrice>>;

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/models';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // refetch once a day
const FETCH_TIMEOUT_MS = 8000;
/** After a failed fetch, how long readers are answered from what is held before the next try. */
const RETRY_AFTER_FAILURE_MS = 60 * 1000;

/** A published per-token rate, or undefined when the field is missing, malformed or negative (OpenRouter's "variable"). */
function rate(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

const fetchOpenRouter: ModelPriceSource = async () => {
  const res = await fetch(OPENROUTER_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
  const json = (await res.json()) as {
    data?: Array<{
      id?: string;
      pricing?: {
        prompt?: string;
        completion?: string;
        input_cache_read?: string;
        input_cache_write?: string;
      };
    }>;
  };
  const byId: Record<string, ModelPrice> = {};
  for (const m of json.data ?? []) {
    if (!m.id) continue;
    const input = rate(m.pricing?.prompt);
    const output = rate(m.pricing?.completion);
    if (input === undefined || output === undefined) continue;
    const price: ModelPrice = { input, output };
    const cacheRead = rate(m.pricing?.input_cache_read);
    const cacheWrite = rate(m.pricing?.input_cache_write);
    if (cacheRead !== undefined) price.cacheRead = cacheRead;
    if (cacheWrite !== undefined) price.cacheWrite = cacheWrite;
    byId[m.id] = price;
  }
  return byId;
};

let source: ModelPriceSource = fetchOpenRouter;

/** The last table this process fetched. A server outlives many runs. */
let cached: PriceTable | null = null;
/** The fetch in flight, shared by every reader that asks meanwhile. */
let pending: Promise<PriceTable | null> | null = null;
/** When the last fetch failed, so an unreachable list is asked once a minute, not once a turn. */
let failedAt = 0;

/** Install where prices come from, forgetting any table already held. */
export function setModelPriceSource(next: ModelPriceSource): void {
  source = next;
  cached = null;
  pending = null;
  failedAt = 0;
}

/** Back to OpenRouter, forgetting any table already held. */
export function resetModelPriceSource(): void {
  setModelPriceSource(fetchOpenRouter);
}

const TIERS = ['opus', 'sonnet', 'haiku'] as const;

function tierOf(id: string): (typeof TIERS)[number] | null {
  const s = id.toLowerCase();
  return s.includes('opus') ? 'opus' : s.includes('sonnet') ? 'sonnet' : s.includes('haiku') ? 'haiku' : null;
}

function maxRate(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.max(a, b);
}

/**
 * Roll the id→price map into per-tier CEILINGS (Anthropic only), for a model
 * named by alias (`opus`) or by an id the list does not hold: each rate is the
 * highest any listed model of the tier publishes. A tier the list holds no
 * model of has no entry, so a model resolving to it is unpriced.
 */
function computeTiers(byId: Record<string, ModelPrice>): Record<string, ModelPrice> {
  const tiers: Record<string, ModelPrice> = {};
  for (const [id, price] of Object.entries(byId)) {
    if (!id.startsWith('anthropic/')) continue;
    const tier = tierOf(id);
    if (!tier) continue;
    const cur = tiers[tier];
    if (!cur) {
      tiers[tier] = { ...price };
      continue;
    }
    const next: ModelPrice = {
      input: Math.max(cur.input, price.input),
      output: Math.max(cur.output, price.output),
    };
    const cacheRead = maxRate(cur.cacheRead, price.cacheRead);
    const cacheWrite = maxRate(cur.cacheWrite, price.cacheWrite);
    if (cacheRead !== undefined) next.cacheRead = cacheRead;
    if (cacheWrite !== undefined) next.cacheWrite = cacheWrite;
    tiers[tier] = next;
  }
  return tiers;
}

/** What is held, marked stale when it has aged past a day; null when nothing is. */
function held(): PriceTable | null {
  if (!cached) return null;
  return Date.now() - cached.fetchedAt < CACHE_TTL_MS ? cached : { ...cached, source: 'cache' };
}

/** One fetch from `from`. Resolves the table it got, or what is held when it failed; never rejects. */
async function load(from: ModelPriceSource): Promise<PriceTable | null> {
  try {
    const byId = await from();
    const table: PriceTable = { tiers: computeTiers(byId), byId, fetchedAt: Date.now(), source: 'live' };
    if (source === from) {
      cached = table;
      failedAt = 0;
    }
    return table;
  } catch {
    if (source === from) failedAt = Date.now();
    // Stale, but real numbers; with nothing held there are no prices.
    return cached ? { ...cached, source: 'cache' } : null;
  }
}

function refresh(): Promise<PriceTable | null> {
  if (pending) return pending;
  if (Date.now() - failedAt < RETRY_AFTER_FAILURE_MS) return Promise.resolve(held());
  const attempt = load(source).finally(() => {
    if (pending === attempt) pending = null;
  });
  pending = attempt;
  return attempt;
}

/**
 * The price table, or NULL when no fetch has ever succeeded in this process.
 * Serves the held table while it is under a day old; past that it refetches,
 * and a refetch that fails answers the table it holds (`source: 'cache'`).
 * Within a minute of a failed fetch it answers what it holds without trying
 * again. Never rejects.
 */
export async function getModelPrices(): Promise<PriceTable | null> {
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached;
  return refresh();
}

/**
 * The table held right now, for a reader that cannot wait (the per-turn pricing
 * hook runs synchronously inside the driver's accounting). A missing or aged
 * table starts a fetch in the background; until one has succeeded this answers
 * null.
 */
export function heldModelPrices(): PriceTable | null {
  if (!cached || Date.now() - cached.fetchedAt >= CACHE_TTL_MS) void refresh();
  return held();
}

/**
 * OpenRouter ids are `vendor/model`, but a user configures the bare provider id
 * (`gpt-4o`, `claude-sonnet-4-5`). Match any key whose path suffix is exactly
 * that id; when two vendors publish the same model name, the vendor-alphabetical
 * first wins — deterministic.
 */
function priceBySuffix(model: string, table: PriceTable): ModelPrice | null {
  let best: string | null = null;
  for (const id of Object.keys(table.byId)) {
    const slash = id.indexOf('/');
    if (slash <= 0 || id.slice(slash + 1) !== model) continue;
    if (best === null || id < best) best = id;
  }
  return best ? table.byId[best] : null;
}

/**
 * Price for a resolved model string. Tries an exact OpenRouter id (with/without
 * the `anthropic/` prefix), then any vendor's id with the same model suffix,
 * then the tier ceiling by substring — covering both our aliases
 * (`opus`/`sonnet`/`haiku`) and full ids (`claude-opus-4-8`). Returns null for
 * models the table cannot price.
 */
export function priceForModel(model: string, table: PriceTable): ModelPrice | null {
  if (table.byId[model]) return table.byId[model];
  if (table.byId[`anthropic/${model}`]) return table.byId[`anthropic/${model}`];
  const bySuffix = priceBySuffix(model, table);
  if (bySuffix) return bySuffix;
  const tier = tierOf(model);
  if (tier && table.tiers[tier]) return table.tiers[tier];
  return null;
}

/** One call's tokens, in the four disjoint buckets both backends report. */
export interface CallTokens {
  /** Fresh (uncached) input. */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
}

/**
 * A call's cost by kind, the way the Usage page splits tokens: a cache write
 * is input (fresh input read at full price on its way into the cache), and
 * `cached` is the cache reads.
 */
export interface CallCost {
  input: number;
  output: number;
  cached: number;
}

/**
 * What one call that RAN cost: every bucket at its own published rate.
 *
 * A call that reported tokens in a cache bucket the model publishes no rate for
 * is UNPRICED (null), not priced at some other bucket's rate. Every stand-in is
 * wrong in a direction nobody can see: at the input rate a cache read is billed
 * about ten times over and a cache write about a fifth short, at zero it is
 * free. An unpriced turn is recorded as unpriced, which is the truth; a
 * bucket with no tokens needs no rate.
 */
export function costOfCall(price: ModelPrice, usage: CallTokens): CallCost | null {
  if (usage.cacheReadTokens > 0 && price.cacheRead === undefined) return null;
  if (usage.cacheCreateTokens > 0 && price.cacheWrite === undefined) return null;
  return {
    input: usage.inputTokens * price.input + usage.cacheCreateTokens * (price.cacheWrite ?? 0),
    output: usage.outputTokens * price.output,
    cached: usage.cacheReadTokens * (price.cacheRead ?? 0),
  };
}

/** A call's cost as one number. */
export function totalCost(cost: CallCost): number {
  return cost.input + cost.output + cost.cached;
}
