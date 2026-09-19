/**
 * `probeApiConfig()` — the live check the Models page runs before a provider
 * configuration is saved or trusted, exercised through its own seam (no
 * network).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { probeApiConfig } from '../../packages/core/src/services/llm/probe.js';
import { LlmApiConfigError } from '../../packages/core/src/services/llm/provider.js';

let home: string;
const savedEnv = { ...process.env };

const anthropic = { provider: 'anthropic' as const, model: 'claude-sonnet-4-5', apiKey: 'sk-test' };

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-llm-probe-'));
  process.env.TRUECOURSE_RUNTIME_DIR = home;
  delete process.env.ANTHROPIC_API_KEY;
});

afterEach(() => {
  process.env = { ...savedEnv };
  fs.rmSync(home, { recursive: true, force: true });
});

describe('probeApiConfig', () => {
  it('resolves when the provider answers', async () => {
    await expect(probeApiConfig(anthropic, { probe: async () => {} })).resolves.toBeUndefined();
  });

  it('surfaces the provider error verbatim', async () => {
    await expect(
      probeApiConfig(anthropic, {
        probe: async () => {
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
          probe: async () => {
            called = true;
          },
        },
      ),
    ).rejects.toThrow(LlmApiConfigError);
    expect(called).toBe(false);
  });

  it('hands the probe the provider config it validated', async () => {
    let cfg: { provider: string; model: string; apiKey?: string; baseURL?: string } | undefined;
    await probeApiConfig(
      { ...anthropic, baseURL: 'https://gateway.internal/v1' },
      {
        probe: async (c) => {
          cfg = c;
        },
      },
    );
    expect(cfg).toMatchObject({
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      apiKey: 'sk-test',
      baseURL: 'https://gateway.internal/v1',
    });
  });
});
