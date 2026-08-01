/**
 * `probeApiConfig()` — the live check `config llm setup` / `config llm test`
 * run before a provider configuration is saved or trusted. Same semantics the
 * enterprise Models page uses, exercised through the transport seam (no network).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { LlmRequest } from '@truecourse/shared/llm';
import { probeApiConfig } from '../../packages/core/src/services/llm/probe.js';
import { LlmApiConfigError } from '../../packages/core/src/services/llm/install-transport.js';

let home: string;
const savedEnv = { ...process.env };

const anthropic = { provider: 'anthropic' as const, model: 'claude-sonnet-4-5', apiKey: 'sk-test' };

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-llm-probe-'));
  process.env.TRUECOURSE_HOME = home;
  delete process.env.ANTHROPIC_API_KEY;
});

afterEach(() => {
  process.env = { ...savedEnv };
  fs.rmSync(home, { recursive: true, force: true });
});

describe('probeApiConfig', () => {
  it('sends the configuration probe: json answer, 30s timeout, and resolves on a reply', async () => {
    let seen: LlmRequest | undefined;
    await expect(
      probeApiConfig(anthropic, {
        createTransport: () => async (req) => {
          seen = req;
          return '{"ok": true}';
        },
      }),
    ).resolves.toBeUndefined();
    expect(seen?.system).toBe('You are a configuration probe.');
    expect(seen?.user).toBe('Reply with exactly {"ok": true}.');
    expect(seen?.responseFormat).toBe('json');
    expect(seen?.timeoutMs).toBe(30_000);
  });

  it('rejects an empty completion', async () => {
    await expect(
      probeApiConfig(anthropic, { createTransport: () => async () => '   ' }),
    ).rejects.toThrow(/empty response/);
  });

  it('surfaces the provider error verbatim', async () => {
    await expect(
      probeApiConfig(anthropic, {
        createTransport: () => async () => {
          throw new Error('401 invalid x-api-key');
        },
      }),
    ).rejects.toThrow('401 invalid x-api-key');
  });

  it('rejects an unusable config before any call', async () => {
    let called = false;
    await expect(
      probeApiConfig(
        { provider: 'anthropic', model: 'm' },
        {
          createTransport: () => async () => {
            called = true;
            return 'ok';
          },
        },
      ),
    ).rejects.toThrow(LlmApiConfigError);
    expect(called).toBe(false);
  });

  it('passes the provider config through to the transport factory', async () => {
    let cfg: { provider: string; model: string; apiKey?: string } | undefined;
    await probeApiConfig(
      { ...anthropic, baseURL: 'https://gateway.internal/v1' },
      {
        createTransport: (c) => {
          cfg = c;
          return async () => 'ok';
        },
      },
    );
    expect(cfg).toMatchObject({ provider: 'anthropic', model: 'claude-sonnet-4-5', apiKey: 'sk-test' });
  });
});
