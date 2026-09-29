/**
 * Google requests captured after the real AI SDK and provider adapter have
 * serialized them. These tests cover the schema and thought signatures the
 * API actually receives, including the session driver's tool construction.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { z } from 'zod';
import { createApiSessionDriver } from '../../packages/llm-api/src/session-driver';
import { buildAuthorTools } from '../../packages/core/src/services/interface-author/tools';
import { buildModel, providerFor } from '../../packages/llm-api/src/index';

const cfg = { provider: 'google' as const, model: 'gemini-2.5-pro', apiKey: 'AIza-test' };

/** The smallest generateContent payload the SDK's reader accepts. */
const REPLY = {
  candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
  usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
};

/** A repeated tool node factored into `$defs`. */
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
    tools?: Array<{ functionDeclarations: Array<{ name: string; parametersJsonSchema: unknown; parameters?: unknown }> }>;
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
    providerOptions: providerFor('google').callOptions(cfg.model, 'k'),
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

  it('sends full JSON Schema including references', async () => {
    const sent = await sentFor();

    const [declaration] = sent.body.tools?.[0].functionDeclarations ?? [];
    expect(declaration.name).toBe('move');
    expect(declaration.parametersJsonSchema).toEqual(TOOL_SCHEMA);
    expect(declaration.parameters).toBeUndefined();
  });
});

it('preserves optional arguments, bounds and thought signatures through the session driver', async () => {
  const requests: any[] = [];
  const replies = [
    { functionCall: { name: 'search_repo', args: { query: 'not-present-in-the-fixture-928xyz' } }, thoughtSignature: 'opaque-thought-signature' },
    { functionCall: { name: 'outcome', args: { findings: ['done'] } }, thoughtSignature: 'second-signature' },
  ];
  vi.stubGlobal('fetch', async (_url: unknown, init: { body: string }) => {
    requests.push(JSON.parse(init.body));
    const part = replies.shift();
    if (!part) throw new Error('unexpected model call');
    const response = {
      candidates: [{ content: { role: 'model', parts: [part] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
    };
    return new Response(`data: ${JSON.stringify(response)}\n\n`, {
      headers: { 'content-type': 'text/event-stream' },
    });
  });
  const driver = createApiSessionDriver({ ...cfg, model: 'gemini-3.8-flash' }, { retry: { attempts: 1 } });
  const result = await driver.runSession({
    def: {
      kind: 'guard-setup.preparation-observations',
      reasoning: 'high',
      systemPrompt: 'Review the source and report findings.',
      tools: buildAuthorTools({ repoRoot: new URL('../fixtures', import.meta.url).pathname, derived: null, authored: null, replaceable: new Set() }),
      outcomeSchema: z.object({ findings: z.array(z.string().min(1)).min(1).max(12) }),
      budget: { turns: 20, maxResumes: 0, tokenCeiling: 100_000 },
    },
    initialMessages: ['Find the evidence for the assigned task.'],
    onEvent: () => {},
    signal: new AbortController().signal,
  }).done;

  expect(result).toMatchObject({ kind: 'outcome', value: { findings: ['done'] } });
  expect(requests).toHaveLength(2);
  const declarations = requests[0].tools[0].functionDeclarations;
  const schema = declarations.find((d: any) => d.name === 'search_repo').parametersJsonSchema;
  expect(schema.required).toEqual(['query']);
  expect(schema.properties.pathContains).toMatchObject({ type: 'string', minLength: 1 });
  expect(declarations.find((d: any) => d.name === 'search_interfaces').parametersJsonSchema.properties.limit).toMatchObject({ type: 'integer', minimum: 1, maximum: 20 });
  const outcome = declarations.find((d: any) => d.name === 'outcome').parametersJsonSchema;
  expect(outcome.properties.findings).toMatchObject({ type: 'array', minItems: 1, maxItems: 12 });
  // The author tools carry `check_draft`, a schema declared too large for
  // Gemini to enforce, so the whole request goes without VALIDATED.
  expect(requests[0].toolConfig?.functionCallingConfig?.mode).not.toBe('VALIDATED');
  expect(declarations.every((d: any) => d.parametersJsonSchema)).toBe(true);
  expect(requests[0].generationConfig.thinkingConfig.thinkingLevel).toBe('high');
  const replay = requests[1].contents.find((c: any) => c.role === 'model');
  expect(replay.parts).toContainEqual({
    functionCall: { id: expect.any(String), name: 'search_repo', args: { query: 'not-present-in-the-fixture-928xyz' } },
    thoughtSignature: 'opaque-thought-signature',
  });
  expect(JSON.stringify(requests[1])).not.toContain('skip_thought_signature_validator');
});
