/**
 * The MODEL PRICE source for a suite. No test reaches OpenRouter: `tests/setup.ts`
 * installs {@link NO_PRICES} for every file, so a process under test holds no
 * price table at all unless the test puts one in place with
 * {@link installModelPrices}.
 *
 * The seam is set through BOTH specifiers a test can reach core by — the package
 * (`@truecourse/core/services/llm/model-prices`, which resolves to the built
 * `dist`) and the source path — because under vitest those are separate module
 * instances with separate seam state.
 */

import {
  setModelPriceSource as setByPackage,
  type ModelPrice,
  type ModelPriceSource,
} from '@truecourse/core/services/llm/model-prices';
import { setModelPriceSource as setBySource } from '../../packages/core/src/services/llm/model-prices';

/** The source every test starts from: it never answers, so there are no prices. */
export const NO_PRICES: ModelPriceSource = async () => {
  throw new Error('No model prices are installed for this test.');
};

/**
 * OpenRouter's rates for two models, per token, as its list published them:
 * a cache read is a tenth of fresh input, a cache write 125% of it.
 */
export const TEST_PRICES: Record<string, ModelPrice> = {
  'anthropic/claude-opus-5': {
    input: 0.000005,
    output: 0.000025,
    cacheRead: 0.0000005,
    cacheWrite: 0.00000625,
  },
  'openai/gpt-5.6-sol': {
    input: 0.000002,
    output: 0.00001,
    cacheRead: 0.0000002,
    cacheWrite: 0.0000025,
  },
};

function install(source: ModelPriceSource): void {
  setByPackage(source);
  setBySource(source);
}

/** Put a known table in place of the fetch. Any table already held is forgotten. */
export function installModelPrices(byId: Record<string, ModelPrice> = TEST_PRICES): void {
  install(async () => byId);
}

/** Back to no prices at all. */
export function uninstallModelPrices(): void {
  install(NO_PRICES);
}
