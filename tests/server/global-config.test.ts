/**
 * The global (per-user) config at `~/.truecourse/config.json`: typed read/write,
 * the `0600`/`0700` permission contract, malformed-file tolerance, the effective
 * transport mode (env override over saved selection), and secret redaction.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  apiModeFallbackModel,
  apiModeModel,
  getConfiguredLlmMode,
  globalConfigMtimeMs,
  maskSecret,
  readApiLlmConfig,
  readGlobalConfig,
  redactGlobalConfig,
  updateGlobalConfig,
  writeGlobalConfig,
  type GlobalConfig,
} from '../../packages/core/src/config/global-config.js';

let home: string;
const configFile = (): string => path.join(home, 'config.json');

const API_CONFIG: GlobalConfig = {
  llm: {
    transport: 'api',
    api: { provider: 'anthropic', model: 'claude-sonnet-4-5', apiKey: 'sk-ant-secret-9876' },
  },
};

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-global-config-'));
  process.env.TRUECOURSE_HOME = home;
  delete process.env.TRUECOURSE_LLM_TRANSPORT;
});

afterEach(() => {
  delete process.env.TRUECOURSE_HOME;
  delete process.env.TRUECOURSE_LLM_TRANSPORT;
  vi.restoreAllMocks();
  fs.rmSync(home, { recursive: true, force: true });
});

describe('readGlobalConfig / writeGlobalConfig', () => {
  it('returns an empty config when the file does not exist', () => {
    expect(readGlobalConfig()).toEqual({});
    expect(globalConfigMtimeMs()).toBeNull();
  });

  it('round-trips the llm block', () => {
    writeGlobalConfig(API_CONFIG);
    expect(readGlobalConfig()).toEqual(API_CONFIG);
    expect(globalConfigMtimeMs()).toBeGreaterThan(0);
  });

  it('creates the file 0600 inside a 0700 dir', () => {
    fs.rmSync(home, { recursive: true, force: true }); // the dir must be created too
    writeGlobalConfig(API_CONFIG);
    expect(fs.statSync(home).mode & 0o777).toBe(0o700);
    expect(fs.statSync(configFile()).mode & 0o777).toBe(0o600);
  });

  it('re-asserts 0600 when rewriting a loosened file', () => {
    writeGlobalConfig(API_CONFIG);
    fs.chmodSync(configFile(), 0o644);
    writeGlobalConfig({ llm: { transport: 'claude-code' } });
    expect(fs.statSync(configFile()).mode & 0o777).toBe(0o600);
  });

  it('treats a malformed file as empty and warns once on stderr', () => {
    const warn = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(configFile(), '{ not json');

    expect(readGlobalConfig()).toEqual({});
    expect(readGlobalConfig()).toEqual({});
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('malformed global config');
  });

  it('treats a non-object JSON file as empty', () => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(configFile(), '[1,2,3]');
    expect(readGlobalConfig()).toEqual({});
  });

  it('updateGlobalConfig merges over the stored config', () => {
    writeGlobalConfig(API_CONFIG);
    const merged = updateGlobalConfig({ llm: { transport: 'claude-code', api: API_CONFIG.llm!.api } });
    expect(merged.llm?.transport).toBe('claude-code');
    expect(readGlobalConfig().llm?.api?.model).toBe('claude-sonnet-4-5');
  });
});

describe('getConfiguredLlmMode', () => {
  it('defaults to claude-code when nothing is saved', () => {
    expect(getConfiguredLlmMode()).toBe('claude-code');
  });

  it('reads the saved selection', () => {
    writeGlobalConfig(API_CONFIG);
    expect(getConfiguredLlmMode()).toBe('api');
  });

  it('lets TRUECOURSE_LLM_TRANSPORT override the saved selection both ways', () => {
    writeGlobalConfig(API_CONFIG);
    process.env.TRUECOURSE_LLM_TRANSPORT = 'claude-code';
    expect(getConfiguredLlmMode()).toBe('claude-code');

    writeGlobalConfig({ llm: { transport: 'claude-code', api: API_CONFIG.llm!.api } });
    process.env.TRUECOURSE_LLM_TRANSPORT = 'api';
    expect(getConfiguredLlmMode()).toBe('api');
  });

  it('ignores an unrecognized env value', () => {
    writeGlobalConfig(API_CONFIG);
    process.env.TRUECOURSE_LLM_TRANSPORT = 'nonsense';
    expect(getConfiguredLlmMode()).toBe('api');
  });
});

describe('api model lookup', () => {
  it('exposes the model + fallback only while API mode is active', () => {
    writeGlobalConfig({
      llm: {
        transport: 'api',
        api: { provider: 'openai', model: 'gpt-4o', fallbackModel: 'gpt-4o-mini' },
      },
    });
    expect(apiModeModel()).toBe('gpt-4o');
    expect(apiModeFallbackModel()).toBe('gpt-4o-mini');
    expect(readApiLlmConfig()?.provider).toBe('openai');

    process.env.TRUECOURSE_LLM_TRANSPORT = 'claude-code';
    expect(apiModeModel()).toBeNull();
    expect(apiModeFallbackModel()).toBeNull();
    // The credentials stay readable, so flipping back never re-asks for them.
    expect(readApiLlmConfig()?.model).toBe('gpt-4o');
  });

  it('is null when API mode is on but no model is saved', () => {
    writeGlobalConfig({ llm: { transport: 'api' } });
    expect(apiModeModel()).toBeNull();
  });
});

describe('redactGlobalConfig', () => {
  it('masks every secret and leaves the rest intact', () => {
    const config: GlobalConfig = {
      llm: {
        transport: 'api',
        api: {
          provider: 'bedrock',
          model: 'anthropic.claude-sonnet-4-20250514-v1:0',
          apiKey: 'sk-ant-secret-9876',
          accessKeyId: 'AKIAEXAMPLE',
          secretAccessKey: 'super-secret-key-4321',
          sessionToken: 'tok-1234',
          region: 'us-west-2',
        },
      },
    };
    const redacted = redactGlobalConfig(config);
    expect(redacted.llm?.api?.apiKey).toBe('••••9876');
    expect(redacted.llm?.api?.secretAccessKey).toBe('••••4321');
    expect(redacted.llm?.api?.sessionToken).toBe('••••1234');
    expect(redacted.llm?.api?.region).toBe('us-west-2');
    expect(redacted.llm?.api?.accessKeyId).toBe('AKIAEXAMPLE');
    // Non-mutating: the caller's config still holds the real secrets.
    expect(config.llm?.api?.apiKey).toBe('sk-ant-secret-9876');
    expect(JSON.stringify(redacted)).not.toContain('sk-ant-secret-9876');
  });

  it('handles a config with no api block', () => {
    expect(redactGlobalConfig({ llm: { transport: 'claude-code' } })).toEqual({
      llm: { transport: 'claude-code' },
    });
    expect(redactGlobalConfig({})).toEqual({});
  });

  it('never reveals more than the last 4 chars', () => {
    expect(maskSecret('abcdefgh')).toBe('••••efgh');
    expect(maskSecret('abc')).toBe('••••');
  });
});
