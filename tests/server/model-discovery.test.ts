import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  discoverClaudeModels,
  pickDefaultModel,
  type ClaudeModelInfo,
} from '../../packages/core/src/services/llm/model-discovery.js';

function model(over: Partial<ClaudeModelInfo> = {}): ClaudeModelInfo {
  return {
    value: 'sonnet',
    displayName: 'Sonnet',
    description: 'Sonnet 5 · Efficient for routine tasks',
    ...over,
  };
}

/**
 * Write a fake `claude` that speaks the stdio control protocol: read one
 * newline-delimited control_request, echo back the canned initialize response
 * with a matching request_id. Lets us exercise the real spawn/parse path
 * without a Claude login or network.
 */
function fakeClaude(dir: string, body: string): string {
  const bin = path.join(dir, 'fake-claude.mjs');
  fs.writeFileSync(
    bin,
    `#!/usr/bin/env node
import readline from 'node:readline';
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const req = JSON.parse(line);
  ${body}
});
`,
    { mode: 0o755 },
  );
  return bin;
}

const RESPONDS_WITH_MODELS = `
  process.stdout.write(JSON.stringify({
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: req.request_id,
      response: {
        account: { email: 'dev@example.com', subscriptionType: 'Claude Max' },
        models: [
          { value: 'default', resolvedModel: 'claude-opus-4-8[1m]', displayName: 'Default (recommended)', description: 'Opus 4.8' },
          { value: 'opus[1m]', resolvedModel: 'claude-opus-4-8[1m]', displayName: 'Opus', description: 'Opus 4.8' },
          { value: 'haiku', displayName: 'Haiku', description: 'Haiku 4.5' },
        ],
      },
    },
  }) + '\\n');
`;

describe('pickDefaultModel', () => {
  it('prefers an Opus model over other tiers', () => {
    const models = [
      model({ value: 'haiku', displayName: 'Haiku' }),
      model({ value: 'claude-fable-5[1m]', displayName: 'Fable' }),
      model({ value: 'opus[1m]', displayName: 'Opus' }),
      model({ value: 'sonnet', displayName: 'Sonnet' }),
    ];
    expect(pickDefaultModel(models)?.value).toBe('opus[1m]');
  });

  it('never picks Fable, which bills at a premium tier', () => {
    const models = [
      model({ value: 'claude-fable-5[1m]', displayName: 'Fable' }),
      model({ value: 'sonnet', displayName: 'Sonnet' }),
    ];
    expect(pickDefaultModel(models)?.value).toBe('sonnet');
  });

  it('identifies Opus via resolvedModel when the alias does not say so', () => {
    const models = [
      model({ value: 'haiku', displayName: 'Haiku' }),
      model({
        value: 'default',
        displayName: 'Default (recommended)',
        resolvedModel: 'claude-opus-4-8[1m]',
      }),
    ];
    expect(pickDefaultModel(models)?.value).toBe('default');
  });

  it('prefers an explicit Opus entry over the moving `default` alias', () => {
    // `default` resolves to Opus today but tracks whatever Claude Code prefers
    // tomorrow. Pinning to it would reintroduce silent model drift.
    const models = [
      model({
        value: 'default',
        displayName: 'Default (recommended)',
        resolvedModel: 'claude-opus-4-8[1m]',
      }),
      model({ value: 'opus[1m]', displayName: 'Opus' }),
    ];
    expect(pickDefaultModel(models)?.value).toBe('opus[1m]');
  });

  it('does not mistake a Fable entry for Opus via its description', () => {
    const models = [
      model({
        value: 'claude-fable-5[1m]',
        displayName: 'Fable',
        description: 'Most capable — more capable than Opus 4.8',
      }),
      model({ value: 'haiku', displayName: 'Haiku' }),
    ];
    expect(pickDefaultModel(models)?.value).toBe('haiku');
  });

  it('falls back to the first model when no Opus is available', () => {
    const models = [model({ value: 'sonnet' }), model({ value: 'haiku' })];
    expect(pickDefaultModel(models)?.value).toBe('sonnet');
  });

  it('returns null for an empty list', () => {
    expect(pickDefaultModel([])).toBeNull();
  });
});

describe('discoverClaudeModels', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-model-discovery-'));

  it('returns the models reported by the control protocol', async () => {
    const bin = fakeClaude(tmp, RESPONDS_WITH_MODELS);
    const models = await discoverClaudeModels({ binary: bin });
    expect(models?.map((m) => m.value)).toEqual(['default', 'opus[1m]', 'haiku']);
    expect(models?.[0].resolvedModel).toBe('claude-opus-4-8[1m]');
  });

  it('ignores non-JSON banner noise on stdout', async () => {
    const bin = fakeClaude(tmp, `process.stdout.write('starting up...\\n'); ${RESPONDS_WITH_MODELS}`);
    const models = await discoverClaudeModels({ binary: bin });
    expect(models?.map((m) => m.value)).toEqual(['default', 'opus[1m]', 'haiku']);
  });

  it('returns null when the binary does not exist', async () => {
    const models = await discoverClaudeModels({ binary: '/nonexistent/claude-xyz' });
    expect(models).toBeNull();
  });

  it('returns null when the CLI reports a control error', async () => {
    const bin = fakeClaude(
      tmp,
      `process.stdout.write(JSON.stringify({
        type: 'control_response',
        response: { subtype: 'error', request_id: req.request_id, error: 'nope' },
      }) + '\\n');`,
    );
    expect(await discoverClaudeModels({ binary: bin })).toBeNull();
  });

  it('returns null when the CLI exits without responding', async () => {
    const bin = fakeClaude(tmp, `process.exit(1);`);
    expect(await discoverClaudeModels({ binary: bin })).toBeNull();
  });

  it('returns null when the CLI hangs past the timeout', async () => {
    const bin = fakeClaude(tmp, `/* never respond */`);
    expect(await discoverClaudeModels({ binary: bin, timeoutMs: 300 })).toBeNull();
  });

  it('returns null when the response carries no models', async () => {
    const bin = fakeClaude(
      tmp,
      `process.stdout.write(JSON.stringify({
        type: 'control_response',
        response: { subtype: 'success', request_id: req.request_id, response: { account: {} } },
      }) + '\\n');`,
    );
    expect(await discoverClaudeModels({ binary: bin })).toBeNull();
  });

  it('ignores a control_response for a different request', async () => {
    const bin = fakeClaude(
      tmp,
      `process.stdout.write(JSON.stringify({
        type: 'control_response',
        response: { subtype: 'success', request_id: 'someone-else', response: { models: [{ value: 'x', displayName: 'X', description: '' }] } },
      }) + '\\n');`,
    );
    expect(await discoverClaudeModels({ binary: bin, timeoutMs: 500 })).toBeNull();
  });
});
