/**
 * What a Google (Gemini API) provider block puts on the wire.
 *
 * The session driver hands tools over as compacted JSON schemas — repeated
 * nodes factored into `$defs` and pointed at with `$ref` — and Gemini's
 * function declarations take an OpenAPI subset with no references at all. So
 * this runs the REAL `@ai-sdk/google` model over a captured fetch and reads
 * the request: where it goes, which key it carries, and that the schema
 * arrives with its references resolved.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { buildModel, providerTuningFor } from '../../packages/llm-api/src/index';

const cfg = { provider: 'google' as const, model: 'gemini-2.5-pro', apiKey: 'AIza-test' };

/** The smallest generateContent payload the SDK's reader accepts. */
const REPLY = {
  candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
  usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
};

/** A tool schema as the driver sends it: one node factored into `$defs`. */
const TOOL_SCHEMA = {
  type: 'object',
  properties: { from: { $ref: '#/$defs/point' }, to: { $ref: '#/$defs/point' } },
  required: ['from', 'to'],
  additionalProperties: false,
  $defs: {
    point: {
      type: 'object',
      properties: { x: { type: 'number' }, y: { type: 'number' } },
      required: ['x', 'y'],
      additionalProperties: false,
    },
  },
};

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: {
    tools?: Array<{ functionDeclarations: Array<{ name: string; parameters: unknown }> }>;
  };
}

/** Run one call through the real provider and hand back what it put on the wire. */
async function sentFor(overrides: { baseURL?: string } = {}): Promise<Sent> {
  let sent: Sent | undefined;
  vi.stubGlobal('fetch', async (url: unknown, init: { body: string; headers: Record<string, string> }) => {
    sent = { url: String(url), headers: init.headers, body: JSON.parse(init.body) };
    return new Response(JSON.stringify(REPLY), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  const model = buildModel({ ...cfg, ...overrides }, cfg.model);
  await (model as { doGenerate: (o: unknown) => Promise<unknown> }).doGenerate({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'go' }] }],
    tools: [{ type: 'function', name: 'move', description: 'Move.', inputSchema: TOOL_SCHEMA }],
    providerOptions: providerTuningFor('google').callOptions(cfg.model, 'k'),
  });
  if (!sent) throw new Error('nothing was sent');
  return sent;
}

afterEach(() => vi.unstubAllGlobals());

describe('the google provider', () => {
  it('calls the Gemini API with the stored key', async () => {
    const sent = await sentFor();

    expect(sent.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent',
    );
    expect(sent.headers['x-goog-api-key']).toBe('AIza-test');
  });

  it('calls a custom base URL instead when one is set', async () => {
    const sent = await sentFor({ baseURL: 'https://gateway.example.com/v1beta' });

    expect(sent.url).toBe('https://gateway.example.com/v1beta/models/gemini-2.5-pro:generateContent');
  });

  it('sends a factored tool schema with its references resolved', async () => {
    const sent = await sentFor();

    const [declaration] = sent.body.tools?.[0].functionDeclarations ?? [];
    expect(declaration.name).toBe('move');
    const point = {
      type: 'object',
      properties: { x: { type: 'number' }, y: { type: 'number' } },
      required: ['x', 'y'],
    };
    expect(declaration.parameters).toEqual({
      type: 'object',
      properties: { from: point, to: point },
      required: ['from', 'to'],
    });
    expect(JSON.stringify(declaration.parameters)).not.toContain('$ref');
  });
});
