/**
 * How a REPLAYED reasoning part reaches the OpenAI Responses API.
 *
 * The session driver resends the whole history every turn, and the model hands
 * back reasoning parts tagged with the provider's own item id. The SDK converts
 * those one of two ways, and the choice is `store`: left at its default the
 * request carries `{ type: 'item_reference', id: 'rs_…' }`, a pointer the
 * endpoint must still be holding — one that is not answers "Item with id 'rs_…'
 * not found" and the session dies on a validation error no retry can clear.
 * With `store: false` the reasoning item travels whole, encrypted content and
 * all, and nothing has to be retained anywhere.
 *
 * So this runs the REAL `@ai-sdk/openai` responses model over a captured fetch
 * and reads the request body: the only place that distinction is visible.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { buildModel, providerTuningFor } from '../../packages/llm-api/src/index';

const cfg = { provider: 'openai' as const, model: 'gpt-5.6-sol', apiKey: 'test' };

/** A replayed turn: prose plus the reasoning the model handed back with it. */
const REPLAYED_PROMPT = [
  { role: 'user' as const, content: [{ type: 'text' as const, text: 'go' }] },
  {
    role: 'assistant' as const,
    content: [
      {
        type: 'reasoning' as const,
        text: 'weighing it',
        providerOptions: {
          openai: { itemId: 'rs_034f', reasoningEncryptedContent: 'gAAAAAB-opaque' },
        },
      },
      { type: 'text' as const, text: 'probing' },
    ],
  },
  { role: 'user' as const, content: [{ type: 'text' as const, text: 'continue' }] },
];

/** The smallest Responses payload the SDK's reader accepts. */
const REPLY = {
  id: 'resp_1',
  created_at: 0,
  model: 'gpt-5.6-sol',
  status: 'completed',
  incomplete_details: null,
  output: [
    {
      type: 'message',
      id: 'msg_1',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: 'ok', annotations: [] }],
    },
  ],
  usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
};

/** Run one call through the real provider and hand back what it put on the wire. */
async function requestBodyFor(
  providerOptions: Record<string, Record<string, unknown>>,
): Promise<{ input: Array<Record<string, unknown>>; store?: boolean; include?: string[] }> {
  let body: unknown;
  vi.stubGlobal('fetch', async (_url: unknown, init: { body: string }) => {
    body = JSON.parse(init.body);
    return new Response(JSON.stringify(REPLY), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  const model = buildModel(cfg, cfg.model);
  await (model as { doGenerate: (o: unknown) => Promise<unknown> }).doGenerate({
    prompt: REPLAYED_PROMPT,
    providerOptions,
  });
  return body as { input: Array<Record<string, unknown>>; store?: boolean; include?: string[] };
}

afterEach(() => vi.unstubAllGlobals());

describe('openai reasoning replay', () => {
  it('sends the reasoning item whole, never a reference the endpoint must be holding', async () => {
    const body = await requestBodyFor(providerTuningFor('openai').callOptions('gpt-5.6-sol', 'k'));

    expect(body.store).toBe(false);
    expect(body.include).toContain('reasoning.encrypted_content');
    const reasoning = body.input.filter((item) => item.type === 'reasoning');
    expect(reasoning).toHaveLength(1);
    expect(reasoning[0]).toMatchObject({ encrypted_content: 'gAAAAAB-opaque' });
    // The id still rides along — it is part of the item, not a lookup — but
    // nothing in the request DEPENDS on the backend resolving it.
    expect(body.input.some((item) => item.type === 'item_reference')).toBe(false);
  });

  it('without the tuning it is a bare item_reference — the shape that failed', async () => {
    const body = await requestBodyFor({ openai: {} });

    expect(body.input).toContainEqual({ type: 'item_reference', id: 'rs_034f' });
    expect(body.input.some((item) => item.type === 'reasoning')).toBe(false);
  });
});
