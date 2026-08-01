/**
 * The CLI's LLM-transport surface: `config llm setup/show/test/use`, the
 * first-run wizard's trigger conditions, and the preflight branch that skips the
 * `claude` login probe in API mode.
 *
 * Everything runs against a temp `TRUECOURSE_HOME` and stubs the provider probe
 * at its injection seam — no network, no `claude` binary.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { getDefaultTransport, setDefaultTransport } from '@truecourse/shared/llm';
import {
  readGlobalConfig,
  writeGlobalConfig,
  type GlobalApiLlmConfig,
} from '@truecourse/core/config/global-config';
import { resetConfiguredLlmTransport } from '@truecourse/core/services/llm/install-transport';
import {
  firstRunApplies,
  resetLlmFirstRun,
  runConfigLlmSetup,
  runLlmFirstRun,
  type RunConfigLlmSetupOptions,
} from '../../tools/cli/src/commands/config-llm-setup.js';
import {
  runConfigLlmShow,
  runConfigLlmTest,
  runConfigLlmUse,
} from '../../tools/cli/src/commands/config.js';
import { preflightLlmOrExit } from '../../tools/cli/src/lib/claude-preflight.js';

let home: string;
const savedEnv = { ...process.env };

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');

/** Run a command function, capturing its output and the exit code it asked for. */
async function run(fn: () => Promise<void>): Promise<{ out: string; exitCode: number | null }> {
  let exitCode: number | null = null;
  const chunks: string[] = [];
  const write = ((chunk: unknown, ...rest: unknown[]) => {
    chunks.push(typeof chunk === 'string' ? chunk : String(chunk));
    const cb = rest.find((a) => typeof a === 'function') as (() => void) | undefined;
    cb?.();
    return true;
  }) as never;
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exitCode = code ?? 0;
    throw new Error(`process.exit(${code})`);
  }) as never);
  const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(write);
  const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(write);
  const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    chunks.push(`${args.join(' ')}\n`);
  });
  try {
    await fn();
  } catch (e) {
    if (!(e instanceof Error) || !e.message.startsWith('process.exit(')) throw e;
  } finally {
    logSpy.mockRestore();
    errSpy.mockRestore();
    outSpy.mockRestore();
    exitSpy.mockRestore();
  }
  return { out: stripAnsi(chunks.join('')), exitCode };
}

/** Flag-driven setup with the probe stubbed out unless the test supplies one. */
function setupFlags(over: RunConfigLlmSetupOptions): RunConfigLlmSetupOptions {
  return { probe: async () => {}, ...over };
}

const apiBlock: GlobalApiLlmConfig = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  apiKey: 'sk-ant-secret1234',
};

function withTty<T>(fn: () => T): T {
  const original = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
  try {
    return fn();
  } finally {
    if (original) Object.defineProperty(process.stdin, 'isTTY', original);
    else delete (process.stdin as { isTTY?: boolean }).isTTY;
  }
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-cli-llm-'));
  process.env.TRUECOURSE_HOME = home;
  delete process.env.TRUECOURSE_LLM_TRANSPORT;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.COPILOT_API_KEY;
  setDefaultTransport(undefined);
  resetConfiguredLlmTransport();
  resetLlmFirstRun();
});

afterEach(() => {
  setDefaultTransport(undefined);
  resetConfiguredLlmTransport();
  process.env = { ...savedEnv };
  fs.rmSync(home, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// setup — the non-interactive flag surface
// ---------------------------------------------------------------------------

describe('config llm setup — flags', () => {
  it('saves the claude-code selection in a 0600 file', async () => {
    const { exitCode } = await run(() => runConfigLlmSetup(setupFlags({ transport: 'claude-code' })));
    expect(exitCode).toBeNull();
    expect(readGlobalConfig().llm?.transport).toBe('claude-code');
    const mode = fs.statSync(path.join(home, 'config.json')).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('saves an api selection, probes it first, and warns about --api-key in shell history', async () => {
    const probe = vi.fn(async () => {});
    const { out, exitCode } = await run(() =>
      runConfigLlmSetup({
        transport: 'api',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        fallbackModel: 'claude-haiku-4-5',
        apiKey: 'sk-ant-secret1234',
        probe,
      }),
    );
    expect(exitCode).toBeNull();
    expect(probe).toHaveBeenCalledTimes(1);
    expect(out).toContain('shell history');
    const api = readGlobalConfig().llm?.api;
    expect(readGlobalConfig().llm?.transport).toBe('api');
    expect(api).toMatchObject({
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      fallbackModel: 'claude-haiku-4-5',
      apiKey: 'sk-ant-secret1234',
    });
  });

  it('stores the env var NAME for --api-key-env, never a key', async () => {
    process.env.MY_TEAM_KEY = 'sk-from-env';
    await run(() =>
      runConfigLlmSetup(
        setupFlags({ transport: 'api', provider: 'anthropic', model: 'm', apiKeyEnv: 'MY_TEAM_KEY' }),
      ),
    );
    const api = readGlobalConfig().llm?.api;
    expect(api?.apiKeyEnv).toBe('MY_TEAM_KEY');
    expect(api?.apiKey).toBeUndefined();
    expect(fs.readFileSync(path.join(home, 'config.json'), 'utf-8')).not.toContain('sk-from-env');
  });

  it('reads the key from stdin with --api-key-stdin', async () => {
    const original = Object.getOwnPropertyDescriptor(process, 'stdin');
    Object.defineProperty(process, 'stdin', {
      value: Readable.from(['sk-from-stdin\n']),
      configurable: true,
    });
    try {
      await run(() =>
        runConfigLlmSetup(
          setupFlags({ transport: 'api', provider: 'anthropic', model: 'm', apiKeyStdin: true }),
        ),
      );
    } finally {
      if (original) Object.defineProperty(process, 'stdin', original);
    }
    expect(readGlobalConfig().llm?.api?.apiKey).toBe('sk-from-stdin');
  });

  it('--no-test saves without probing', async () => {
    const probe = vi.fn(async () => {});
    await run(() =>
      runConfigLlmSetup({
        transport: 'api',
        provider: 'openai',
        model: 'gpt-4o',
        apiKey: 'sk-openai',
        test: false,
        probe,
      }),
    );
    expect(probe).not.toHaveBeenCalled();
    expect(readGlobalConfig().llm?.api?.provider).toBe('openai');
  });

  it('never saves a configuration whose probe failed', async () => {
    const probe = vi.fn(async () => {
      throw new Error('401 invalid x-api-key');
    });
    const { out, exitCode } = await run(() =>
      runConfigLlmSetup({ transport: 'api', provider: 'anthropic', model: 'm', apiKey: 'sk-bad', probe }),
    );
    expect(exitCode).toBe(1);
    expect(out).toContain('401 invalid x-api-key');
    expect(readGlobalConfig().llm).toBeUndefined();
  });

  it('names --transport when run non-interactively with no answer', async () => {
    const { out, exitCode } = await run(() => runConfigLlmSetup({}));
    expect(exitCode).toBe(1);
    expect(out).toContain('--transport claude-code');
    expect(readGlobalConfig().llm).toBeUndefined();
  });

  it('names the missing --provider / --model flags', async () => {
    const { out, exitCode } = await run(() => runConfigLlmSetup(setupFlags({ transport: 'api' })));
    expect(exitCode).toBe(1);
    expect(out).toContain('--provider');
    expect(out).toContain('--model');
  });

  it('names the key flags when no key can be found anywhere', async () => {
    const { out, exitCode } = await run(() =>
      runConfigLlmSetup(setupFlags({ transport: 'api', provider: 'anthropic', model: 'm' })),
    );
    expect(exitCode).toBe(1);
    expect(out).toContain('--api-key-stdin');
    expect(out).toContain('ANTHROPIC_API_KEY');
  });

  it('accepts the provider standard env var instead of a key flag', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-standard';
    const { exitCode } = await run(() =>
      runConfigLlmSetup(setupFlags({ transport: 'api', provider: 'anthropic', model: 'm' })),
    );
    expect(exitCode).toBeNull();
    expect(readGlobalConfig().llm?.api?.apiKey).toBeUndefined();
  });

  it('needs no key for bedrock and keeps its AWS fields', async () => {
    const { exitCode } = await run(() =>
      runConfigLlmSetup(
        setupFlags({
          transport: 'api',
          provider: 'bedrock',
          model: 'anthropic.claude-3-7-sonnet-20250219-v1:0',
          region: 'us-west-2',
          accessKeyId: 'AKIA123',
          secretAccessKey: 'aws-secret-9999',
        }),
      ),
    );
    expect(exitCode).toBeNull();
    expect(readGlobalConfig().llm?.api).toMatchObject({
      provider: 'bedrock',
      region: 'us-west-2',
      accessKeyId: 'AKIA123',
      secretAccessKey: 'aws-secret-9999',
    });
  });

  it('parses repeatable --header k=v pairs', async () => {
    await run(() =>
      runConfigLlmSetup(
        setupFlags({
          transport: 'api',
          provider: 'anthropic',
          model: 'm',
          apiKey: 'sk-x',
          header: ['x-team=platform', 'x-trace=on'],
        }),
      ),
    );
    expect(readGlobalConfig().llm?.api?.headers).toEqual({ 'x-team': 'platform', 'x-trace': 'on' });
  });

  it('rejects a malformed --header', async () => {
    const { exitCode } = await run(() =>
      runConfigLlmSetup(
        setupFlags({ transport: 'api', provider: 'anthropic', model: 'm', apiKey: 'sk-x', header: ['nope'] }),
      ),
    );
    expect(exitCode).toBe(1);
    expect(readGlobalConfig().llm).toBeUndefined();
  });

  it('keeps unrelated global config keys when saving', async () => {
    fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ runMode: 'service' }));
    await run(() => runConfigLlmSetup(setupFlags({ transport: 'claude-code' })));
    const raw = JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf-8'));
    expect(raw.runMode).toBe('service');
    expect(raw.llm.transport).toBe('claude-code');
  });
});

// ---------------------------------------------------------------------------
// use
// ---------------------------------------------------------------------------

describe('config llm use', () => {
  it('flips to api and keeps the stored credentials', async () => {
    writeGlobalConfig({ llm: { transport: 'claude-code', api: apiBlock } });
    const { exitCode } = await run(() => runConfigLlmUse('api'));
    expect(exitCode).toBeNull();
    expect(readGlobalConfig().llm?.transport).toBe('api');
    expect(readGlobalConfig().llm?.api?.apiKey).toBe('sk-ant-secret1234');
  });

  it('flips back to claude-code without dropping the api block', async () => {
    writeGlobalConfig({ llm: { transport: 'api', api: apiBlock } });
    await run(() => runConfigLlmUse('claude-code'));
    expect(readGlobalConfig().llm?.transport).toBe('claude-code');
    expect(readGlobalConfig().llm?.api?.model).toBe('claude-sonnet-4-5');
  });

  it('points at setup when api was never configured', async () => {
    const { out, exitCode } = await run(() => runConfigLlmUse('api'));
    expect(exitCode).toBe(1);
    expect(out).toContain('truecourse config llm setup');
    expect(readGlobalConfig().llm).toBeUndefined();
  });

  it('rejects an unknown transport', async () => {
    const { out, exitCode } = await run(() => runConfigLlmUse('openai'));
    expect(exitCode).toBe(1);
    expect(out).toContain('claude-code');
  });

  it('warns when the env override contradicts the new selection', async () => {
    writeGlobalConfig({ llm: { transport: 'claude-code', api: apiBlock } });
    process.env.TRUECOURSE_LLM_TRANSPORT = 'claude-code';
    const { out } = await run(() => runConfigLlmUse('api'));
    expect(out).toContain('TRUECOURSE_LLM_TRANSPORT');
  });
});

// ---------------------------------------------------------------------------
// show
// ---------------------------------------------------------------------------

describe('config llm show', () => {
  it('leads with the transport block and masks the stored key', async () => {
    writeGlobalConfig({ llm: { transport: 'api', api: { ...apiBlock, fallbackModel: 'claude-haiku-4-5' } } });
    const { out } = await run(() => runConfigLlmShow({ cwd: home }));
    expect(out).toContain('transport  api (config file)');
    expect(out).toContain('Anthropic API');
    expect(out).toContain('claude-sonnet-4-5');
    expect(out).toContain('claude-haiku-4-5');
    expect(out).toContain('••••1234 (config file)');
    expect(out).not.toContain('sk-ant-secret1234');
    // The stage table still renders, now resolving through the api model.
    expect(out).toContain('api model');
  });

  it('names the env var a key comes from, and never prints its value', async () => {
    process.env.MY_TEAM_KEY = 'sk-env-value5678';
    writeGlobalConfig({
      llm: { transport: 'api', api: { provider: 'anthropic', model: 'm', apiKeyEnv: 'MY_TEAM_KEY' } },
    });
    const { out } = await run(() => runConfigLlmShow({ cwd: home }));
    expect(out).toContain('••••5678 (env MY_TEAM_KEY)');
    expect(out).not.toContain('sk-env-value5678');
  });

  it('reports the env override as the transport source', async () => {
    writeGlobalConfig({ llm: { transport: 'claude-code' } });
    process.env.TRUECOURSE_LLM_TRANSPORT = 'api';
    const { out } = await run(() => runConfigLlmShow({ cwd: home }));
    expect(out).toContain('transport  api (env TRUECOURSE_LLM_TRANSPORT)');
  });

  it('says the selection was never made when nothing is saved', async () => {
    const { out } = await run(() => runConfigLlmShow({ cwd: home }));
    expect(out).toContain('transport  claude-code (default — never chosen)');
  });
});

// ---------------------------------------------------------------------------
// test
// ---------------------------------------------------------------------------

describe('config llm test', () => {
  it('reports success against the saved configuration', async () => {
    writeGlobalConfig({ llm: { transport: 'api', api: apiBlock } });
    const probe = vi.fn(async () => {});
    const { out, exitCode } = await run(() => runConfigLlmTest({ probe }));
    expect(exitCode).toBeNull();
    expect(probe).toHaveBeenCalledWith(expect.objectContaining({ provider: 'anthropic' }));
    expect(out).toContain('works');
  });

  it('surfaces the provider error and exits 1', async () => {
    writeGlobalConfig({ llm: { transport: 'api', api: apiBlock } });
    const { out, exitCode } = await run(() =>
      runConfigLlmTest({
        probe: async () => {
          throw new Error('model not found: claude-sonnet-4-5');
        },
      }),
    );
    expect(exitCode).toBe(1);
    expect(out).toContain('model not found');
  });

  it('exits 1 when nothing is configured', async () => {
    const { out, exitCode } = await run(() => runConfigLlmTest({ probe: async () => {} }));
    expect(exitCode).toBe(1);
    expect(out).toContain('truecourse config llm setup');
  });

  it('tests the saved config even when claude-code is active, with a warning', async () => {
    writeGlobalConfig({ llm: { transport: 'claude-code', api: apiBlock } });
    const { out, exitCode } = await run(() => runConfigLlmTest({ probe: async () => {} }));
    expect(exitCode).toBeNull();
    expect(out).toContain('config llm use api');
  });
});

// ---------------------------------------------------------------------------
// first run
// ---------------------------------------------------------------------------

describe('first-run wizard trigger', () => {
  it('never prompts or writes without a TTY', async () => {
    const { out, exitCode } = await run(() => runLlmFirstRun({ commandPath: 'analyze' }));
    expect(exitCode).toBeNull();
    expect(out).toBe('');
    expect(fs.existsSync(path.join(home, 'config.json'))).toBe(false);
  });

  it('applies on a TTY when nothing is saved', () => {
    expect(withTty(() => firstRunApplies({ commandPath: 'analyze' }))).toBe(true);
  });

  it('is skipped once a transport is saved', () => {
    writeGlobalConfig({ llm: { transport: 'claude-code' } });
    expect(withTty(() => firstRunApplies({ commandPath: 'analyze' }))).toBe(false);
  });

  it('is skipped when the run passes --llm-transport', () => {
    expect(withTty(() => firstRunApplies({ commandPath: 'spec scan', transportFlag: 'cli' }))).toBe(false);
  });

  it('is skipped when TRUECOURSE_LLM_TRANSPORT is set', () => {
    process.env.TRUECOURSE_LLM_TRANSPORT = 'api';
    expect(withTty(() => firstRunApplies({ commandPath: 'analyze' }))).toBe(false);
  });

  it('is skipped for the config llm subtree, hooks run, and the bare command', () => {
    withTty(() => {
      expect(firstRunApplies({ commandPath: 'config llm setup' })).toBe(false);
      expect(firstRunApplies({ commandPath: 'config llm' })).toBe(false);
      expect(firstRunApplies({ commandPath: 'hooks run' })).toBe(false);
      expect(firstRunApplies({ commandPath: '' })).toBe(false);
      // Sibling commands in the same groups still ask.
      expect(firstRunApplies({ commandPath: 'hooks install' })).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// preflight branching
// ---------------------------------------------------------------------------

describe('preflightLlmOrExit', () => {
  it('installs the configured transport in api mode instead of probing `claude`', async () => {
    writeGlobalConfig({ llm: { transport: 'api', api: apiBlock } });
    const { exitCode } = await run(() => preflightLlmOrExit(undefined));
    expect(exitCode).toBeNull();
    expect(typeof getDefaultTransport()).toBe('function');
  });

  it('fails fast with the setup pointer when the api config is unusable', async () => {
    writeGlobalConfig({ llm: { transport: 'api' } });
    const { out, exitCode } = await run(() => preflightLlmOrExit(undefined));
    expect(exitCode).toBe(1);
    expect(out).toContain('truecourse config llm setup');
    expect(getDefaultTransport()).toBeUndefined();
  });

  it('validates the api config for a per-run --llm-transport api override', async () => {
    writeGlobalConfig({ llm: { transport: 'claude-code' } });
    const { out, exitCode } = await run(() => preflightLlmOrExit('api'));
    expect(exitCode).toBe(1);
    expect(out).toContain('truecourse config llm setup');
  });

  it('checks nothing for the agent transport', async () => {
    writeGlobalConfig({ llm: { transport: 'api' } });
    const { out, exitCode } = await run(() => preflightLlmOrExit('agent'));
    expect(exitCode).toBeNull();
    expect(out).toBe('');
  });

  it('honors the env override into api mode', async () => {
    writeGlobalConfig({ llm: { api: apiBlock } });
    process.env.TRUECOURSE_LLM_TRANSPORT = 'api';
    const { exitCode } = await run(() => preflightLlmOrExit(undefined));
    expect(exitCode).toBeNull();
    expect(typeof getDefaultTransport()).toBe('function');
  });
});
