/**
 * `installConfiguredLlmTransport()` — the single point where the saved LLM
 * selection becomes a process-wide transport: mode selection (the direct-API
 * transport in api mode, the Agent SDK one-shot in claude-code mode), the env
 * override, mtime-cached re-install, api-block validation, and the promise that
 * a transport installed by someone else (the enterprise edition) is never cleared.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// The dist entry the module under test installs into — importing the source
// copy here would be a different module instance, with its own default slot.
import { getDefaultTransport, setDefaultTransport, type LlmTransport } from '@truecourse/shared/llm';
import { writeGlobalConfig, type GlobalConfig } from '../../packages/core/src/config/global-config.js';
import {
  LlmApiConfigError,
  createConfiguredApiTransport,
  getConfiguredLlmMode,
  installConfiguredLlmTransport,
  isClaudeCodeTransport,
  resetConfiguredLlmTransport,
  resolveApiKey,
} from '../../packages/core/src/services/llm/install-transport.js';

let home: string;
const savedEnv = { ...process.env };

function apiConfig(over: Partial<NonNullable<NonNullable<GlobalConfig['llm']>['api']>> = {}): GlobalConfig {
  return {
    llm: {
      transport: 'api',
      api: { provider: 'anthropic', model: 'claude-sonnet-4-5', apiKey: 'sk-test', ...over },
    },
  };
}

const sentinel: LlmTransport = async () => 'sentinel';

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-install-transport-'));
  process.env.TRUECOURSE_HOME = home;
  delete process.env.TRUECOURSE_LLM_TRANSPORT;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.COPILOT_API_KEY;
  setDefaultTransport(undefined);
  resetConfiguredLlmTransport();
});

afterEach(() => {
  setDefaultTransport(undefined);
  resetConfiguredLlmTransport();
  process.env = { ...savedEnv };
  fs.rmSync(home, { recursive: true, force: true });
});

describe('installConfiguredLlmTransport — mode selection', () => {
  it('installs the claude-code transport when no selection is saved', () => {
    installConfiguredLlmTransport();
    expect(isClaudeCodeTransport(getDefaultTransport())).toBe(true);
    expect(getConfiguredLlmMode()).toBe('claude-code');
  });

  it('installs the claude-code transport in claude-code mode, even with credentials saved', () => {
    writeGlobalConfig({ llm: { transport: 'claude-code', api: apiConfig().llm!.api } });
    installConfiguredLlmTransport();
    expect(isClaudeCodeTransport(getDefaultTransport())).toBe(true);
  });

  it('never clears a transport installed by someone else', () => {
    setDefaultTransport(sentinel);
    writeGlobalConfig({ llm: { transport: 'claude-code' } });
    installConfiguredLlmTransport();
    expect(getDefaultTransport()).toBe(sentinel);
  });

  it('installs the API transport in api mode', () => {
    writeGlobalConfig(apiConfig());
    installConfiguredLlmTransport();
    expect(typeof getDefaultTransport()).toBe('function');
    expect(isClaudeCodeTransport(getDefaultTransport())).toBe(false);
  });

  it('honors the TRUECOURSE_LLM_TRANSPORT override in both directions', () => {
    writeGlobalConfig({ llm: { transport: 'claude-code', api: apiConfig().llm!.api } });
    process.env.TRUECOURSE_LLM_TRANSPORT = 'api';
    installConfiguredLlmTransport();
    expect(getDefaultTransport()).toBeDefined();
    expect(isClaudeCodeTransport(getDefaultTransport())).toBe(false);

    resetConfiguredLlmTransport();
    setDefaultTransport(undefined);
    writeGlobalConfig(apiConfig());
    process.env.TRUECOURSE_LLM_TRANSPORT = 'claude-code';
    installConfiguredLlmTransport();
    expect(isClaudeCodeTransport(getDefaultTransport())).toBe(true);
  });

  it('replaces its own transport when the saved selection flips back', () => {
    writeGlobalConfig(apiConfig());
    installConfiguredLlmTransport();
    const installed = getDefaultTransport();
    expect(installed).toBeDefined();

    writeGlobalConfig({ llm: { transport: 'claude-code', api: apiConfig().llm!.api } });
    installConfiguredLlmTransport();
    expect(getDefaultTransport()).not.toBe(installed);
    expect(isClaudeCodeTransport(getDefaultTransport())).toBe(true);
  });
});

describe('installConfiguredLlmTransport — mtime caching', () => {
  it('reuses the installed transport until the config file changes', () => {
    writeGlobalConfig(apiConfig());
    installConfiguredLlmTransport();
    const first = getDefaultTransport();

    installConfiguredLlmTransport();
    expect(getDefaultTransport()).toBe(first);

    writeGlobalConfig(apiConfig({ model: 'claude-opus-4-5' }));
    installConfiguredLlmTransport();
    expect(getDefaultTransport()).not.toBe(first);
  });

  it('rebuilds when the env override changes without a file write', () => {
    writeGlobalConfig(apiConfig());
    installConfiguredLlmTransport();
    expect(getDefaultTransport()).toBeDefined();

    process.env.TRUECOURSE_LLM_TRANSPORT = 'claude-code';
    installConfiguredLlmTransport();
    expect(isClaudeCodeTransport(getDefaultTransport())).toBe(true);
  });
});

describe('api-block validation', () => {
  it('points at the setup command when api mode has no config at all', () => {
    writeGlobalConfig({ llm: { transport: 'api' } });
    expect(() => installConfiguredLlmTransport()).toThrow(LlmApiConfigError);
    expect(() => createConfiguredApiTransport()).toThrow(/truecourse config llm setup/);
  });

  it('keeps throwing on a retry after a failed install (no silent no-op)', () => {
    writeGlobalConfig({ llm: { transport: 'api' } });
    expect(() => installConfiguredLlmTransport()).toThrow(LlmApiConfigError);
    expect(() => installConfiguredLlmTransport()).toThrow(LlmApiConfigError);
  });

  it('requires a model', () => {
    writeGlobalConfig({ llm: { transport: 'api', api: { provider: 'anthropic', model: '  ' } } });
    expect(() => createConfiguredApiTransport()).toThrow(/needs a model/);
  });

  it('rejects an unknown provider', () => {
    writeGlobalConfig({
      llm: {
        transport: 'api',
        api: { provider: 'gemini' as 'anthropic', model: 'x', apiKey: 'k' },
      },
    });
    expect(() => createConfiguredApiTransport()).toThrow(/Unknown LLM provider/);
  });

  it('requires a resolvable key and names the env var it looked at', () => {
    writeGlobalConfig(apiConfig({ apiKey: undefined }));
    expect(() => createConfiguredApiTransport()).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('accepts the provider standard env var instead of a stored key', () => {
    writeGlobalConfig(apiConfig({ apiKey: undefined }));
    process.env.ANTHROPIC_API_KEY = 'sk-from-env';
    expect(() => createConfiguredApiTransport()).not.toThrow();
  });

  it('resolves a key from the named env var, and errors when that var is unset', () => {
    writeGlobalConfig(apiConfig({ apiKey: undefined, apiKeyEnv: 'MY_TEAM_KEY' }));
    expect(() => createConfiguredApiTransport()).toThrow(/MY_TEAM_KEY/);

    process.env.MY_TEAM_KEY = 'sk-named';
    expect(() => createConfiguredApiTransport()).not.toThrow();
  });

  it('prefers the stored key, then the named var, then the standard var', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-standard';
    process.env.MY_TEAM_KEY = 'sk-named';
    const base = { provider: 'anthropic' as const, model: 'm' };
    expect(resolveApiKey({ ...base, apiKey: 'sk-stored', apiKeyEnv: 'MY_TEAM_KEY' })).toBe('sk-stored');
    expect(resolveApiKey({ ...base, apiKeyEnv: 'MY_TEAM_KEY' })).toBe('sk-named');
    expect(resolveApiKey(base)).toBe('sk-standard');
  });

  it('needs no key for bedrock (ambient AWS credential chain)', () => {
    writeGlobalConfig({
      llm: { transport: 'api', api: { provider: 'bedrock', model: 'anthropic.claude-v2', region: 'us-west-2' } },
    });
    expect(() => createConfiguredApiTransport()).not.toThrow();
  });
});
