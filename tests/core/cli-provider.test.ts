import { describe, it, expect } from 'vitest';
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
