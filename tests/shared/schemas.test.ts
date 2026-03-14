import { describe, it, expect } from 'vitest';
import {
  CreateRepoSchema,
  AnalyzeRepoSchema,
  GenerateInsightsSchema,
  ChatMessageSchema,
} from '../../packages/shared/src/schemas/index';
import {
  FileAnalysisSchema,
  SourceLocationSchema,
  FunctionDefinitionSchema,
  ImportStatementSchema,
  HttpCallSchema,
  ModuleDependencySchema,
  SupportedLanguageSchema,
} from '../../packages/shared/src/types/analysis';
import {
  ServiceInfoSchema,
  LayerDetectionResultSchema,
  EntitySchema,
} from '../../packages/shared/src/types/entity';
import {
  InsightSchema,
} from '../../packages/shared/src/types/insights';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const validLocation = {
  filePath: 'src/index.ts',
  startLine: 1,
  startColumn: 0,
  endLine: 5,
  endColumn: 1,
};

// ---------------------------------------------------------------------------
// API Schemas
// ---------------------------------------------------------------------------

describe('CreateRepoSchema', () => {
  it('accepts { path: "/some/path" }', () => {
    const result = CreateRepoSchema.safeParse({ path: '/some/path' });
    expect(result.success).toBe(true);
  });

  it('rejects { path: "" } (min 1)', () => {
    const result = CreateRepoSchema.safeParse({ path: '' });
    expect(result.success).toBe(false);
  });

  it('rejects {} (missing path)', () => {
    const result = CreateRepoSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('AnalyzeRepoSchema', () => {
  it('accepts { branch: "main" }', () => {
    const result = AnalyzeRepoSchema.safeParse({ branch: 'main' });
    expect(result.success).toBe(true);
  });

  it('accepts {} (branch is optional)', () => {
    const result = AnalyzeRepoSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe('GenerateInsightsSchema', () => {
  it('accepts { analysisId: valid-uuid }', () => {
    const result = GenerateInsightsSchema.safeParse({
      analysisId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
  });

  it('rejects { analysisId: "not-a-uuid" }', () => {
    const result = GenerateInsightsSchema.safeParse({
      analysisId: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });
});

describe('ChatMessageSchema', () => {
  it('accepts { message: "hello" }', () => {
    const result = ChatMessageSchema.safeParse({ message: 'hello' });
    expect(result.success).toBe(true);
  });

  it('accepts { message: "hello", conversationId: valid-uuid }', () => {
    const result = ChatMessageSchema.safeParse({
      message: 'hello',
      conversationId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
  });

  it('rejects { message: "" }', () => {
    const result = ChatMessageSchema.safeParse({ message: '' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Analysis Type Schemas
// ---------------------------------------------------------------------------

describe('SupportedLanguageSchema', () => {
  it('accepts "typescript"', () => {
    expect(SupportedLanguageSchema.safeParse('typescript').success).toBe(true);
  });

  it('accepts "javascript"', () => {
    expect(SupportedLanguageSchema.safeParse('javascript').success).toBe(true);
  });

  it('rejects "python"', () => {
    expect(SupportedLanguageSchema.safeParse('python').success).toBe(false);
  });
});

describe('SourceLocationSchema', () => {
  it('accepts a valid location object', () => {
    const result = SourceLocationSchema.safeParse(validLocation);
    expect(result.success).toBe(true);
  });

  it('rejects missing fields', () => {
    const result = SourceLocationSchema.safeParse({ filePath: 'a.ts' });
    expect(result.success).toBe(false);
  });
});

describe('HttpCallSchema', () => {
  it('accepts { method: "GET", url: "/api", location: {...} }', () => {
    const result = HttpCallSchema.safeParse({
      method: 'GET',
      url: '/api',
      location: validLocation,
    });
    expect(result.success).toBe(true);
  });

  it('rejects { method: "INVALID", ... }', () => {
    const result = HttpCallSchema.safeParse({
      method: 'INVALID',
      url: '/api',
      location: validLocation,
    });
    expect(result.success).toBe(false);
  });
});

describe('FileAnalysisSchema', () => {
  it('accepts a complete FileAnalysis object', () => {
    const result = FileAnalysisSchema.safeParse({
      filePath: 'src/index.ts',
      language: 'typescript',
      functions: [
        {
          name: 'main',
          params: [{ name: 'args' }],
          isAsync: false,
          isExported: true,
          location: validLocation,
        },
      ],
      classes: [],
      imports: [
        {
          source: 'express',
          specifiers: [{ name: 'express', isDefault: true, isNamespace: false }],
          isTypeOnly: false,
        },
      ],
      exports: [{ name: 'main', isDefault: false }],
      calls: [],
      httpCalls: [],
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing required fields', () => {
    const result = FileAnalysisSchema.safeParse({
      filePath: 'src/index.ts',
    });
    expect(result.success).toBe(false);
  });
});

describe('ModuleDependencySchema', () => {
  it('accepts valid module dependency', () => {
    const result = ModuleDependencySchema.safeParse({
      source: 'src/a.ts',
      target: 'src/b.ts',
      importedNames: ['foo', 'bar'],
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Entity Type Schemas
// ---------------------------------------------------------------------------

describe('LayerDetectionResultSchema', () => {
  it('accepts valid layer detection result', () => {
    const result = LayerDetectionResultSchema.safeParse({
      layer: 'api',
      confidence: 0.9,
      evidence: ['has route handlers'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid layer value', () => {
    const result = LayerDetectionResultSchema.safeParse({
      layer: 'presentation',
      confidence: 0.5,
      evidence: [],
    });
    expect(result.success).toBe(false);
  });
});

describe('ServiceInfoSchema', () => {
  it('accepts valid service info', () => {
    const result = ServiceInfoSchema.safeParse({
      name: 'api-gateway',
      rootPath: 'services/api-gateway',
      type: 'api-server',
      framework: 'express',
      fileCount: 10,
      layers: [
        { layer: 'api', confidence: 0.9, evidence: ['routes'] },
      ],
      files: ['src/index.ts'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid service type', () => {
    const result = ServiceInfoSchema.safeParse({
      name: 'test',
      rootPath: '.',
      type: 'invalid-type',
      fileCount: 0,
      layers: [],
      files: [],
    });
    expect(result.success).toBe(false);
  });
});

describe('EntitySchema', () => {
  it('accepts valid entity', () => {
    const result = EntitySchema.safeParse({
      name: 'User',
      service: 'user-service',
      framework: 'typeorm',
      fields: [
        { name: 'id', type: 'number', isPrimaryKey: true },
        { name: 'email', type: 'string' },
      ],
      relationships: [
        { type: 'oneToMany', targetEntity: 'Post', fieldName: 'posts' },
      ],
      confidence: 0.95,
      signals: ['@Entity decorator'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing required fields', () => {
    const result = EntitySchema.safeParse({
      name: 'User',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Insight Schema
// ---------------------------------------------------------------------------

describe('InsightSchema', () => {
  it('accepts valid insight', () => {
    const result = InsightSchema.safeParse({
      id: 'ins-1',
      type: 'architecture',
      title: 'Microservices detected',
      content: 'The project uses a microservices architecture.',
      severity: 'info',
      createdAt: '2025-01-01T00:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('accepts insight with optional fields', () => {
    const result = InsightSchema.safeParse({
      id: 'ins-2',
      type: 'violation',
      title: 'Circular dependency',
      content: 'Service A depends on Service B which depends on A.',
      severity: 'high',
      targetService: 'service-a',
      fixPrompt: 'Extract shared code into a library.',
      createdAt: '2025-01-01T00:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing required fields', () => {
    const result = InsightSchema.safeParse({
      id: 'ins-3',
      type: 'architecture',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid type', () => {
    const result = InsightSchema.safeParse({
      id: 'ins-4',
      type: 'invalid-type',
      title: 'Test',
      content: 'Test',
      severity: 'info',
      createdAt: '2025-01-01T00:00:00Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid severity', () => {
    const result = InsightSchema.safeParse({
      id: 'ins-5',
      type: 'architecture',
      title: 'Test',
      content: 'Test',
      severity: 'extreme',
      createdAt: '2025-01-01T00:00:00Z',
    });
    expect(result.success).toBe(false);
  });
});
