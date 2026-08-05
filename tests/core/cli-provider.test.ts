import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ServiceViolationOutputSchema,
  CodeViolationOutputSchema,
  EnrichmentOutputSchema,
  FlowEnrichmentOutputSchema,
} from '../../packages/core/src/services/llm/schemas.js';

// The CLI-spawn + envelope-parse internals moved to the shared transport
// (`@truecourse/llm`); see tests/llm/cli-transport.test.ts for the parse
// behaviour. What remains here is the provider's own surface.

describe('ClaudeCodeProvider', () => {
  describe('toJsonSchema', () => {
    it('converts Zod schemas to valid JSON Schema strings', async () => {
      const { ClaudeCodeProvider } = await import('../../packages/core/src/services/llm/cli-provider.js');
      const provider = new ClaudeCodeProvider();

      const jsonSchemaStr = (provider as any).toJsonSchema(ServiceViolationOutputSchema);
      const parsed = JSON.parse(jsonSchemaStr);

      expect(parsed).toHaveProperty('type', 'object');
      expect(parsed).toHaveProperty('properties');
      expect(parsed.properties).toHaveProperty('violations');
      expect(parsed.properties).toHaveProperty('serviceDescriptions');
    });
  });
});

describe('Schema conversion via toJsonSchema', () => {
  it('all output schemas convert to valid JSON Schema via provider', async () => {
    const { ClaudeCodeProvider } = await import('../../packages/core/src/services/llm/cli-provider.js');
    const provider = new ClaudeCodeProvider();

    const schemas = [
      ServiceViolationOutputSchema,
      CodeViolationOutputSchema,
      EnrichmentOutputSchema,
      FlowEnrichmentOutputSchema,
    ];

    for (const schema of schemas) {
      const jsonSchemaStr = (provider as any).toJsonSchema(schema);
      const parsed = JSON.parse(jsonSchemaStr);
      expect(parsed).toHaveProperty('type', 'object');
      expect(parsed).toHaveProperty('properties');
    }
  });
});

// The model on analyze's `claude` argv. `analyze --llm-transport cli` spawns the
// binary even when API mode is the saved selection, so what it puts after
// `--model` matters: a provider model name (`gpt-5.5`) is a deterministic exit 1.
describe('ClaudeCodeProvider.modelFlag', () => {
  const savedEnv = { ...process.env };
  let home: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-analyze-model-home-'));
    process.env.TRUECOURSE_HOME = home;
    delete process.env.TRUECOURSE_LLM_TRANSPORT;
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    fs.rmSync(home, { recursive: true, force: true });
    vi.resetModules();
  });

  it('never carries the api-configured model, whatever the saved selection is', async () => {
    delete process.env.CLAUDE_CODE_MODEL;
    vi.resetModules();
    const { writeGlobalConfig, effectiveLlmMode, apiModeModel } = await import(
      '../../packages/core/src/config/global-config.js'
    );
    writeGlobalConfig({
      llm: { transport: 'api', api: { provider: 'openai', model: 'gpt-5.5', apiKey: 'sk-test' } },
    });
    // API mode really is selected, and `--llm-transport cli` really does move the run.
    expect(effectiveLlmMode()).toBe('api');
    expect(apiModeModel()).toBe('gpt-5.5');
    expect(effectiveLlmMode('cli')).toBe('claude-code');

    const { ClaudeCodeProvider } = await import(
      '../../packages/core/src/services/llm/cli-provider.js'
    );
    expect(new ClaudeCodeProvider().modelFlag).toEqual([]);
  });

  it('carries CLAUDE_CODE_MODEL — the one source analyze reads', async () => {
    process.env.CLAUDE_CODE_MODEL = 'opus';
    vi.resetModules();
    const { ClaudeCodeProvider } = await import(
      '../../packages/core/src/services/llm/cli-provider.js'
    );
    expect(new ClaudeCodeProvider().modelFlag).toEqual(['--model', 'opus']);
  });
});

describe('createLLMProvider factory', () => {
  it('returns a provider implementing the LLMProvider interface', async () => {
    const { ClaudeCodeProvider } = await import('../../packages/core/src/services/llm/cli-provider.js');
    const provider = new ClaudeCodeProvider();

    expect(typeof provider.generateServiceViolations).toBe('function');
    expect(typeof provider.generateDatabaseViolations).toBe('function');
    expect(typeof provider.generateModuleViolations).toBe('function');
    expect(typeof provider.generateAllViolations).toBe('function');
    expect(typeof provider.generateAllViolationsWithLifecycle).toBe('function');
    expect(typeof provider.generateCodeViolations).toBe('function');
    expect(typeof provider.generateAllCodeViolations).toBe('function');
    expect(typeof provider.enrichFlow).toBe('function');
  });
});
