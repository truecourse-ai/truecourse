/**
 * OpenAI, first-party, on the Responses API (Azure OpenAI through `baseURL`).
 * Every tool is sent strict with the normalized schema: strict mode needs
 * every property required, so optionals go widened to nullable and the
 * injected nulls are stripped from the reply.
 *
 * OpenAI caches by PREFIX automatically and takes no breakpoints; the key is
 * a routing hint that keeps calls sharing a prefix on the same machine, so it
 * belongs to the cluster of calls, not to a message.
 *
 * `store: false` is what makes the REPLAY stateless, and it is not an
 * optimization. The driver resends the whole history every turn, and the
 * Responses API takes a replayed reasoning part one of two ways: with `store`
 * left at its default the request carries `{ type: 'item_reference', id:
 * 'rs_…' }`, a pointer the endpoint must still be holding — one that is not
 * (an Azure AI Foundry deployment, a rotated backend) answers "Item with id
 * 'rs_…' not found" and the whole session dies on a validation error it can
 * never retry past. With `store: false` the request carries the reasoning item
 * itself, encrypted content and all, so nothing has to be retained anywhere.
 * That is the whole cost of statelessness and there is no way around it: the
 * item reference is the only smaller form, and it is the one that needs the
 * retention `store: false` gives up. So every turn of a long session re-sends
 * the reasoning of every turn before it, and the wire grows with the square of
 * the transcript.
 *
 * `reasoning.encrypted_content` is what asks the model to hand that encrypted
 * content back, and it is the SDK's ask to make, not ours: it adds the include
 * itself when `store` is false and the model id reads as a reasoning model, and
 * a model that has no reasoning to encrypt REJECTS the parameter outright
 * ("Encrypted content is not supported with this model"), which would be every
 * turn of every session on a `gpt-4o`-class model.
 */

import { createOpenAI } from '@ai-sdk/openai';
import { defineProvider } from './define.js';

export const openai = defineProvider({
  kind: 'openai',
  capabilities: { normalizeToolSchema: true, strictTools: true, enforcesLargeSchemas: true },
  buildModel: (cfg, modelId) =>
    createOpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL, headers: cfg.headers })(modelId),
  callOptions: (_modelId, cacheKey) => ({
    openai: { promptCacheKey: cacheKey, parallelToolCalls: false, store: false },
  }),
});
