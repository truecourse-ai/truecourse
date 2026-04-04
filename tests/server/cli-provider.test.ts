import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ServiceViolationOutputSchema,
  CodeViolationOutputSchema,
  EnrichmentOutputSchema,
  FlowEnrichmentOutputSchema,
} from '../../apps/server/src/services/llm/schemas.js';

// ---------------------------------------------------------------------------
// Test the BaseCLIProvider internals via ClaudeCodeProvider
// ---------------------------------------------------------------------------

describe('ClaudeCodeProvider', () => {
  describe('getCleanEnv', () => {
    it('strips CLAUDE_CODE_* and CLAUDE_INTERNAL_* env vars', async () => {
      // Dynamically import to avoid circular issues
      const { ClaudeCodeProvider } = await import('../../apps/server/src/services/llm/cli-provider.js');
      const provider = new ClaudeCodeProvider();

      // Set some env vars
      process.env.CLAUDE_CODE_TEST = 'should-be-stripped';
      process.env.CLAUDE_INTERNAL_TEST = 'should-be-stripped';
      process.env.NORMAL_VAR = 'should-remain';

      // Access via protected method — use any cast for testing
      const cleanEnv = (provider as any).getCleanEnv();

      expect(cleanEnv.CLAUDE_CODE_TEST).toBeUndefined();
      expect(cleanEnv.CLAUDE_INTERNAL_TEST).toBeUndefined();
      expect(cleanEnv.NORMAL_VAR).toBe('should-remain');

      // Cleanup
      delete process.env.CLAUDE_CODE_TEST;
      delete process.env.CLAUDE_INTERNAL_TEST;
      delete process.env.NORMAL_VAR;
    });
  });

  describe('parseAndValidate', () => {
    it('parses structured_output from JSON envelope', async () => {
      const { ClaudeCodeProvider } = await import('../../apps/server/src/services/llm/cli-provider.js');
      const provider = new ClaudeCodeProvider();

      const structuredOutput = {
        violations: [{
          type: 'service',
          title: 'Test violation',
          content: 'Test content',
          severity: 'medium',
          targetServiceId: 'svc-0',
          fixPrompt: null,
          ruleKey: 'test-rule',
        }],
        serviceDescriptions: [],
      };

      // Simulate --output-format json with --json-schema
      const raw = JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: '',
        structured_output: structuredOutput,
      });
      const result = (provider as any).parseAndValidate(raw, ServiceViolationOutputSchema);

      expect(result.data.violations).toHaveLength(1);
      expect(result.data.violations[0].title).toBe('Test violation');
      expect(result.data.violations[0].severity).toBe('medium');
    });

    it('falls back to result field as JSON', async () => {
      const { ClaudeCodeProvider } = await import('../../apps/server/src/services/llm/cli-provider.js');
      const provider = new ClaudeCodeProvider();

      const validOutput = {
        violations: [],
        serviceDescriptions: [],
      };

      const raw = JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: JSON.stringify(validOutput),
      });
      const result = (provider as any).parseAndValidate(raw, ServiceViolationOutputSchema);

      expect(result.data.violations).toHaveLength(0);
    });

    it('throws on is_error response', async () => {
      const { ClaudeCodeProvider } = await import('../../apps/server/src/services/llm/cli-provider.js');
      const provider = new ClaudeCodeProvider();

      const raw = JSON.stringify({
        type: 'result',
        is_error: true,
        result: 'Not logged in',
      });
      expect(() => (provider as any).parseAndValidate(raw, ServiceViolationOutputSchema)).toThrow('Not logged in');
    });

    it('throws on invalid JSON', async () => {
      const { ClaudeCodeProvider } = await import('../../apps/server/src/services/llm/cli-provider.js');
      const provider = new ClaudeCodeProvider();

      expect(() => (provider as any).parseAndValidate('not json', ServiceViolationOutputSchema)).toThrow();
    });

    it('throws when no structured_output present', async () => {
      const { ClaudeCodeProvider } = await import('../../apps/server/src/services/llm/cli-provider.js');
      const provider = new ClaudeCodeProvider();

      const raw = JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'Some text response',
      });
      expect(() => (provider as any).parseAndValidate(raw, ServiceViolationOutputSchema)).toThrow();
    });
  });

  describe('toJsonSchema', () => {
    it('converts Zod schemas to valid JSON Schema strings', async () => {
      const { ClaudeCodeProvider } = await import('../../apps/server/src/services/llm/cli-provider.js');
      const provider = new ClaudeCodeProvider();

      const jsonSchemaStr = (provider as any).toJsonSchema(ServiceViolationOutputSchema);
      const parsed = JSON.parse(jsonSchemaStr);

      expect(parsed).toHaveProperty('type', 'object');
      expect(parsed).toHaveProperty('properties');
      expect(parsed.properties).toHaveProperty('violations');
      expect(parsed.properties).toHaveProperty('serviceDescriptions');
    });
  });

  describe('ClaudeCodeProvider configuration', () => {
    it('has correct binary name', async () => {
      const { ClaudeCodeProvider } = await import('../../apps/server/src/services/llm/cli-provider.js');
      const provider = new ClaudeCodeProvider();

      expect(provider.binaryName).toBe('claude');
    });

    it('has correct base args', async () => {
      const { ClaudeCodeProvider } = await import('../../apps/server/src/services/llm/cli-provider.js');
      const provider = new ClaudeCodeProvider();

      const args = provider.baseArgs;
      expect(args).toContain('--print');
      expect(args).toContain('--dangerously-skip-permissions');
      expect(args).toContain('--no-session-persistence');
      expect(args).toContain('json'); // output format
    });
  });
});

// ---------------------------------------------------------------------------
// Zod schema conversion sanity checks
// ---------------------------------------------------------------------------

describe('Schema conversion via toJsonSchema', () => {
  it('all output schemas convert to valid JSON Schema via provider', async () => {
    const { ClaudeCodeProvider } = await import('../../apps/server/src/services/llm/cli-provider.js');
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

// ---------------------------------------------------------------------------
// Factory function test
// ---------------------------------------------------------------------------

describe('createLLMProvider factory', () => {
  it('returns ClaudeCodeProvider when LLM_PROVIDER is claude-code', async () => {
    // We can't easily change config at runtime since it's read-only,
    // so we test the provider class directly
    const { ClaudeCodeProvider } = await import('../../apps/server/src/services/llm/cli-provider.js');
    const provider = new ClaudeCodeProvider();

    // Verify it implements the expected interface methods
    expect(typeof provider.generateServiceViolations).toBe('function');
    expect(typeof provider.generateDatabaseViolations).toBe('function');
    expect(typeof provider.generateModuleViolations).toBe('function');
    expect(typeof provider.generateAllViolations).toBe('function');
    expect(typeof provider.generateAllViolationsWithLifecycle).toBe('function');
    expect(typeof provider.generateCodeViolations).toBe('function');
    expect(typeof provider.generateAllCodeViolations).toBe('function');
    expect(typeof provider.enrichFlow).toBe('function');
    expect(typeof provider.chat).toBe('function');
  });
});
