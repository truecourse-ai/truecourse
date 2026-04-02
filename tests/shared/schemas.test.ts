import { describe, it, expect } from 'vitest';
import {
  CreateRepoSchema,
  AnalyzeRepoSchema,
  GenerateViolationsSchema,
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
  ModuleInfoSchema,
  MethodInfoSchema,
  ModuleLevelDependencySchema,
  MethodLevelDependencySchema,
} from '../../packages/shared/src/types/analysis';
import {
  ServiceInfoSchema,
  LayerDetectionResultSchema,
  EntitySchema,
  LayerDetailSchema,
  LayerDependencyInfoSchema,
} from '../../packages/shared/src/types/entity';
import {
  ViolationSchema,
} from '../../packages/shared/src/types/violations';

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

describe('GenerateViolationsSchema', () => {
  it('accepts { analysisId: valid-uuid }', () => {
    const result = GenerateViolationsSchema.safeParse({
      analysisId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
  });

  it('rejects { analysisId: "not-a-uuid" }', () => {
    const result = GenerateViolationsSchema.safeParse({
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

  it('accepts "python"', () => {
    expect(SupportedLanguageSchema.safeParse('python').success).toBe(true);
  });

  it('rejects "ruby"', () => {
    expect(SupportedLanguageSchema.safeParse('ruby').success).toBe(false);
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
// Violation Schema
// ---------------------------------------------------------------------------

describe('ViolationSchema', () => {
  it('accepts valid violation', () => {
    const result = ViolationSchema.safeParse({
      id: 'ins-1',
      type: 'architecture',
      title: 'Microservices detected',
      content: 'The project uses a microservices architecture.',
      severity: 'info',
      createdAt: '2025-01-01T00:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('accepts violation with optional fields', () => {
    const result = ViolationSchema.safeParse({
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
    const result = ViolationSchema.safeParse({
      id: 'ins-3',
      type: 'architecture',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid type', () => {
    const result = ViolationSchema.safeParse({
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
    const result = ViolationSchema.safeParse({
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

// ---------------------------------------------------------------------------
// Phase 2: Layer Detail & Dependency Schemas
// ---------------------------------------------------------------------------

describe('LayerDetailSchema', () => {
  it('accepts valid layer detail', () => {
    const result = LayerDetailSchema.safeParse({
      serviceName: 'api-gateway',
      layer: 'api',
      fileCount: 5,
      filePaths: ['src/routes/users.ts', 'src/routes/health.ts'],
      confidence: 0.9,
      evidence: ['Imports API framework: express'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid layer value', () => {
    const result = LayerDetailSchema.safeParse({
      serviceName: 'api-gateway',
      layer: 'presentation',
      fileCount: 1,
      filePaths: ['src/index.ts'],
      confidence: 0.5,
      evidence: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing serviceName', () => {
    const result = LayerDetailSchema.safeParse({
      layer: 'api',
      fileCount: 1,
      filePaths: [],
      confidence: 0.5,
      evidence: [],
    });
    expect(result.success).toBe(false);
  });
});

describe('LayerDependencyInfoSchema', () => {
  it('accepts valid layer dependency', () => {
    const result = LayerDependencyInfoSchema.safeParse({
      sourceServiceName: 'api-gateway',
      sourceLayer: 'api',
      targetServiceName: 'api-gateway',
      targetLayer: 'service',
      dependencyCount: 3,
      isViolation: false,
    });
    expect(result.success).toBe(true);
  });

  it('accepts violation with reason', () => {
    const result = LayerDependencyInfoSchema.safeParse({
      sourceServiceName: 'user-service',
      sourceLayer: 'data',
      targetServiceName: 'user-service',
      targetLayer: 'api',
      dependencyCount: 1,
      isViolation: true,
      violationReason: 'data layer should not depend on api layer',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid source layer', () => {
    const result = LayerDependencyInfoSchema.safeParse({
      sourceServiceName: 'svc',
      sourceLayer: 'invalid',
      targetServiceName: 'svc',
      targetLayer: 'api',
      dependencyCount: 1,
      isViolation: false,
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing isViolation', () => {
    const result = LayerDependencyInfoSchema.safeParse({
      sourceServiceName: 'svc',
      sourceLayer: 'api',
      targetServiceName: 'svc',
      targetLayer: 'service',
      dependencyCount: 1,
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Module & Method Schemas (Phase 4)
// ---------------------------------------------------------------------------

describe('ModuleInfoSchema', () => {
  it('accepts valid module info', () => {
    const result = ModuleInfoSchema.safeParse({
      name: 'UserService',
      filePath: 'src/services/user.ts',
      kind: 'class',
      serviceName: 'user-service',
      layerName: 'service',
      methodCount: 5,
      propertyCount: 2,
      importCount: 3,
      exportCount: 1,
    });
    expect(result.success).toBe(true);
  });

  it('accepts optional fields (superClass, lineCount)', () => {
    const result = ModuleInfoSchema.safeParse({
      name: 'UserService',
      filePath: 'src/services/user.ts',
      kind: 'class',
      serviceName: 'user-service',
      layerName: 'service',
      methodCount: 5,
      propertyCount: 2,
      importCount: 3,
      exportCount: 1,
      superClass: 'BaseService',
      lineCount: 100,
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid kind', () => {
    const result = ModuleInfoSchema.safeParse({
      name: 'Test',
      filePath: 'test.ts',
      kind: 'invalid_kind',
      serviceName: 'svc',
      layerName: 'api',
      methodCount: 0,
      propertyCount: 0,
      importCount: 0,
      exportCount: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing required fields', () => {
    const result = ModuleInfoSchema.safeParse({
      name: 'Test',
    });
    expect(result.success).toBe(false);
  });
});

describe('MethodInfoSchema', () => {
  it('accepts valid method info', () => {
    const result = MethodInfoSchema.safeParse({
      name: 'getUser',
      moduleName: 'UserService',
      serviceName: 'user-service',
      filePath: 'src/services/user.ts',
      signature: 'getUser(id: string): Promise<User>',
      paramCount: 1,
      isAsync: true,
      isExported: true,
    });
    expect(result.success).toBe(true);
  });

  it('accepts optional fields (returnType, lineCount, statementCount, maxNestingDepth)', () => {
    const result = MethodInfoSchema.safeParse({
      name: 'process',
      moduleName: 'Worker',
      serviceName: 'svc',
      filePath: 'src/worker.ts',
      signature: 'process()',
      paramCount: 0,
      isAsync: false,
      isExported: false,
      returnType: 'void',
      lineCount: 50,
      statementCount: 30,
      maxNestingDepth: 4,
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing required fields', () => {
    const result = MethodInfoSchema.safeParse({
      name: 'test',
      moduleName: 'Mod',
    });
    expect(result.success).toBe(false);
  });
});

describe('ModuleLevelDependencySchema', () => {
  it('accepts valid module dependency', () => {
    const result = ModuleLevelDependencySchema.safeParse({
      sourceModule: 'Controller',
      sourceService: 'api-gateway',
      targetModule: 'UserService',
      targetService: 'user-service',
      importedNames: ['UserService'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing importedNames', () => {
    const result = ModuleLevelDependencySchema.safeParse({
      sourceModule: 'A',
      sourceService: 'svc',
      targetModule: 'B',
      targetService: 'svc',
    });
    expect(result.success).toBe(false);
  });
});

describe('MethodLevelDependencySchema', () => {
  it('accepts valid method dependency', () => {
    const result = MethodLevelDependencySchema.safeParse({
      callerMethod: 'getAll',
      callerModule: 'UserController',
      callerService: 'api-gateway',
      calleeMethod: 'findAll',
      calleeModule: 'UserService',
      calleeService: 'user-service',
      callCount: 3,
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing callCount', () => {
    const result = MethodLevelDependencySchema.safeParse({
      callerMethod: 'a',
      callerModule: 'A',
      callerService: 'svc',
      calleeMethod: 'b',
      calleeModule: 'B',
      calleeService: 'svc',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-number callCount', () => {
    const result = MethodLevelDependencySchema.safeParse({
      callerMethod: 'a',
      callerModule: 'A',
      callerService: 'svc',
      calleeMethod: 'b',
      calleeModule: 'B',
      calleeService: 'svc',
      callCount: 'many',
    });
    expect(result.success).toBe(false);
  });
});
