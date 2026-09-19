/**
 * What a run reaches the model WITH: a workspace's stored provider block,
 * validated into a provider config, and the price table its calls are costed
 * against.
 *
 * There is no process-wide provider. A run is built from the block of the
 * workspace that asked for it, and the session driver (`session-driver.ts`) is
 * what it is handed to — except in OPERATOR MODE, where every workspace runs on
 * this process's own `claude` login and there is no block at all.
 */

import type { ProviderConfig } from '@truecourse/llm-api';
import { LLM_PROVIDER_KINDS } from '@truecourse/shared';
import type { LlmApiConfig } from './provider-config.js';
import { getModelPrices, priceForModel, type PriceTable } from './model-prices.js';

const SETUP_HINT = 'Set a provider in Settings → Models.';

/** The stored provider block cannot be used. */
export class LlmApiConfigError extends Error {
  constructor(problem: string) {
    super(`${problem} ${SETUP_HINT}`);
    this.name = 'LlmApiConfigError';
  }
}

/** Validate a stored provider block and turn it into a provider config. */
export function buildProviderConfig(api: LlmApiConfig | undefined): ProviderConfig {
  if (!api) throw new LlmApiConfigError('No LLM provider is configured.');
  if (!LLM_PROVIDER_KINDS.includes(api.provider)) {
    throw new LlmApiConfigError(
      `Unknown LLM provider \`${String(api.provider)}\` (expected one of ${LLM_PROVIDER_KINDS.join(', ')}).`,
    );
  }
  const model = api.model?.trim();
  if (!model) throw new LlmApiConfigError('The API transport needs a model.');

  const cfg: ProviderConfig = {
    provider: api.provider,
    model,
    fallbackModel: api.fallbackModel?.trim() || undefined,
    priceModel: api.priceModel?.trim() || undefined,
    baseURL: api.baseURL?.trim() || undefined,
    headers: api.headers,
  };
  if (api.provider === 'bedrock') {
    // Any omitted credential falls through to the ambient AWS chain.
    cfg.region = api.region?.trim() || undefined;
    cfg.accessKeyId = api.accessKeyId?.trim() || undefined;
    cfg.secretAccessKey = api.secretAccessKey?.trim() || undefined;
    cfg.sessionToken = api.sessionToken?.trim() || undefined;
    return cfg;
  }
  // The key travels with the stored config and nowhere else: there is no env
  // fallback, so a block saved without one is refused here as it is on save.
  const apiKey = api.apiKey?.trim();
  if (!apiKey) {
    throw new LlmApiConfigError(`No API key for provider \`${api.provider}\` — no key is stored.`);
  }
  cfg.apiKey = apiKey;
  return cfg;
}

// ---------------------------------------------------------------------------
// Cost accounting
// ---------------------------------------------------------------------------

// The price table is fetched once, off the hot path: the pricing hook is
// synchronous (it runs inside the transport's per-call accounting), so it prices
// with whatever table has resolved and charges 0 until then. Cost is
// observational — it must never delay or fail a call.
let priceTable: PriceTable | null = null;
let priceTablePending = false;

function primePriceTable(): void {
  if (priceTable || priceTablePending) return;
  priceTablePending = true;
  void getModelPrices()
    .then((t) => {
      priceTable = t;
    })
    .catch(() => {
      /* unpriceable run — tokens are still recorded */
    })
    .finally(() => {
      priceTablePending = false;
    });
}

/** One call's tokens, in the buckets both backends report. */
interface CallTokens {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
}

/**
 * Ceiling cost for one call: every input-side token (fresh, cache-read,
 * cache-written) is charged at the list input rate — providers only ever
 * discount those, so the real bill lands at or below this.
 */
export function priceCall(modelId: string, usage: CallTokens): number {
  try {
    primePriceTable();
    if (!priceTable) return 0;
    const price = priceForModel(modelId, priceTable);
    if (!price) return 0;
    const input = usage.inputTokens + usage.cacheReadTokens + usage.cacheCreateTokens;
    return input * price.input + usage.outputTokens * price.output;
  } catch {
    return 0;
  }
}

/**
 * The pricing hook for ONE config's calls. A model id is not always a priced
 * model: behind a gateway it is a DEPLOYMENT name (`gpt-5.6-sol-2`), which no
 * price list holds, so the config names the list-price model it serves and the
 * call is priced as that. Only the config's OWN model is mapped — a fallback
 * call prices under the id it really ran on, or not at all.
 */
export function pricingFor(
  cfg: Pick<ProviderConfig, 'model' | 'priceModel'>,
): (modelId: string, usage: CallTokens) => number {
  return (modelId, usage) =>
    priceCall(cfg.priceModel && modelId === cfg.model ? cfg.priceModel : modelId, usage);
}
