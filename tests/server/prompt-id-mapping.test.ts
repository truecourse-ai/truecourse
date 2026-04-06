import { describe, it, expect } from 'vitest';
import {
  resolveId,
  resolveIds,
  buildServiceTemplateVars,
  buildDatabaseTemplateVars,
  buildModuleTemplateVars,
  buildEnrichmentTemplateVars,
  buildCodeTemplateVars,
} from '../../apps/server/src/services/llm/prompts.js';

describe('resolveId', () => {
  it('resolves a short ID to a real UUID', () => {
    const idMap = new Map([['svc-0', 'abc-123'], ['svc-1', 'def-456']]);
    expect(resolveId('svc-0', idMap)).toBe('abc-123');
    expect(resolveId('svc-1', idMap)).toBe('def-456');
  });

  it('returns the original if not found in map', () => {
    const idMap = new Map([['svc-0', 'abc-123']]);
    expect(resolveId('svc-99', idMap)).toBe('svc-99');
  });

  it('returns null for null/undefined input', () => {
    const idMap = new Map([['svc-0', 'abc-123']]);
    expect(resolveId(null, idMap)).toBeNull();
    expect(resolveId(undefined, idMap)).toBeNull();
  });
});

describe('resolveIds', () => {
  it('resolves an array of short IDs', () => {
    const idMap = new Map([['prev-0', 'aaa'], ['prev-1', 'bbb'], ['prev-2', 'ccc']]);
    expect(resolveIds(['prev-0', 'prev-2'], idMap)).toEqual(['aaa', 'ccc']);
  });

  it('passes through unrecognized IDs', () => {
    const idMap = new Map([['prev-0', 'aaa']]);
    expect(resolveIds(['prev-0', 'prev-99'], idMap)).toEqual(['aaa', 'prev-99']);
  });

  it('handles empty array', () => {
    expect(resolveIds([], new Map())).toEqual([]);
  });
});

describe('buildServiceTemplateVars', () => {
  it('assigns short IDs to services and returns idMap', () => {
    const { vars, idMap } = buildServiceTemplateVars({
      architecture: 'microservices',
      services: [
        { id: 'uuid-svc-a', name: 'api-gateway', type: 'api-server', fileCount: 10, layers: ['api'] },
        { id: 'uuid-svc-b', name: 'user-service', type: 'api-server', fileCount: 5, layers: ['data'] },
      ],
      dependencies: [],
      llmRules: [{ key: 'llm/test', name: 'Test rule', severity: 'medium', prompt: 'test' }],
    });

    expect(vars.serviceList).toContain('[id: svc-0]');
    expect(vars.serviceList).toContain('[id: svc-1]');
    expect(vars.serviceList).not.toContain('uuid-svc-a');
    expect(idMap.get('svc-0')).toBe('uuid-svc-a');
    expect(idMap.get('svc-1')).toBe('uuid-svc-b');
  });

  it('assigns short IDs to existing violations', () => {
    const { vars, idMap } = buildServiceTemplateVars({
      architecture: 'microservices',
      services: [{ id: 'uuid-svc-a', name: 'api', type: 'api-server', fileCount: 5, layers: [] }],
      dependencies: [],
      llmRules: [],
      existingViolations: [
        { id: 'uuid-prev-x', type: 'service', title: 'Test', content: 'desc', severity: 'high' },
        { id: 'uuid-prev-y', type: 'service', title: 'Test2', content: 'desc2', severity: 'low' },
      ],
    });

    expect(vars.existingViolations).toContain('[id: prev-0]');
    expect(vars.existingViolations).toContain('[id: prev-1]');
    expect(vars.existingViolations).not.toContain('uuid-prev-x');
    expect(idMap.get('prev-0')).toBe('uuid-prev-x');
    expect(idMap.get('prev-1')).toBe('uuid-prev-y');
  });
});

describe('buildDatabaseTemplateVars', () => {
  it('assigns short IDs to databases', () => {
    const { vars, idMap } = buildDatabaseTemplateVars({
      databases: [
        { id: 'uuid-db-1', name: 'postgres', type: 'postgres', driver: 'prisma', tableCount: 3, connectedServices: [] },
      ],
      llmRules: [],
    });

    expect(vars.databaseList).toContain('[id: db-0]');
    expect(vars.databaseList).not.toContain('uuid-db-1');
    expect(idMap.get('db-0')).toBe('uuid-db-1');
  });
});

describe('buildModuleTemplateVars', () => {
  it('assigns short IDs to modules and methods', () => {
    const { vars, idMap } = buildModuleTemplateVars({
      modules: [
        { id: 'uuid-mod-a', name: 'UserService', kind: 'class', serviceName: 'api', layerName: 'service', methodCount: 2, propertyCount: 0, importCount: 1, exportCount: 1 },
      ],
      methods: [
        { id: 'uuid-mth-1', moduleName: 'UserService', name: 'create', signature: 'create()', paramCount: 1, isAsync: true },
        { moduleName: 'UserService', name: 'noId', signature: 'noId()', paramCount: 0, isAsync: false },
      ],
      moduleDependencies: [],
      methodDependencies: [],
      llmRules: [],
    });

    expect(vars.moduleList).toContain('[id: mod-0]');
    expect(vars.moduleList).not.toContain('uuid-mod-a');
    expect(idMap.get('mod-0')).toBe('uuid-mod-a');

    expect(vars.methodList).toContain('[id: mth-0]');
    expect(vars.methodList).not.toContain('uuid-mth-1');
    expect(idMap.get('mth-0')).toBe('uuid-mth-1');

    // Method without id should not get a short ID
    expect(vars.methodList).not.toContain('mth-1');
  });
});

describe('buildEnrichmentTemplateVars', () => {
  it('assigns short IDs to detections', () => {
    const { vars, idMap } = buildEnrichmentTemplateVars(
      [
        { id: 'uuid-det-1', ruleKey: 'architecture/deterministic/god-service', title: 'God service', description: 'too big', severity: 'medium', category: 'service', serviceName: 'api' },
        { id: 'uuid-det-2', ruleKey: 'architecture/deterministic/dead-method', title: 'Dead method', description: 'unused', severity: 'low', category: 'method', serviceName: 'api', methodName: 'foo' },
      ],
      'Architecture: microservices',
    );

    expect(vars.detections).toContain('[id: det-0]');
    expect(vars.detections).toContain('[id: det-1]');
    expect(vars.detections).not.toContain('uuid-det-1');
    expect(idMap.get('det-0')).toBe('uuid-det-1');
    expect(idMap.get('det-1')).toBe('uuid-det-2');
  });
});

describe('buildCodeTemplateVars', () => {
  it('assigns short IDs to existing code violations', () => {
    const { vars, idMap } = buildCodeTemplateVars({
      files: [{ path: 'test.ts', content: 'const x = 1;' }],
      llmRules: [{ key: 'llm/test', name: 'Test', severity: 'high', prompt: 'test' }],
      existingViolations: [
        { id: 'uuid-cv-1', filePath: 'test.ts', lineStart: 1, lineEnd: 1, ruleKey: 'llm/test', severity: 'high', title: 'Issue', content: 'desc' },
      ],
    });

    expect(vars.existingViolations).toContain('[id: cv-0]');
    expect(vars.existingViolations).not.toContain('uuid-cv-1');
    expect(idMap.get('cv-0')).toBe('uuid-cv-1');
  });

  it('returns empty idMap when no existing violations', () => {
    const { idMap } = buildCodeTemplateVars({
      files: [{ path: 'test.ts', content: 'const x = 1;' }],
      llmRules: [{ key: 'llm/test', name: 'Test', severity: 'high', prompt: 'test' }],
    });

    expect(idMap.size).toBe(0);
  });
});
