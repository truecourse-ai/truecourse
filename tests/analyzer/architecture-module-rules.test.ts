import { describe, it, expect } from 'vitest';
import type { ModuleInfo, MethodInfo, ModuleLevelDependency, AnalysisRule } from '../../packages/shared/src/types';
import { checkModuleRules } from '../../packages/analyzer/src/rules/architecture/checker';
import { ARCHITECTURE_DETERMINISTIC_RULES } from '../../packages/analyzer/src/rules/architecture/deterministic';
import { checkCodeRules } from '../../packages/analyzer/src/rules/combined-code-checker';
import { ALL_DEFAULT_RULES } from '../../packages/analyzer/src/rules/index';
import { parseCode } from '../../packages/analyzer/src/parser';

const enabledRules = ARCHITECTURE_DETERMINISTIC_RULES.filter((r) => r.enabled);
const allEnabledRules = ALL_DEFAULT_RULES.filter((r) => r.enabled);

function makeModule(overrides: Partial<ModuleInfo>): ModuleInfo {
  return {
    name: 'TestModule',
    filePath: '/repo/svc/src/test.ts',
    kind: 'class',
    serviceName: 'my-service',
    layerName: 'service',
    methodCount: 3,
    propertyCount: 1,
    importCount: 2,
    exportCount: 1,
    ...overrides,
  };
}

function check(code: string, language: 'typescript' | 'javascript' | 'python' = 'typescript') {
  const ext = language === 'python' ? '.py' : '.ts';
  const tree = parseCode(code, language);
  return checkCodeRules(tree, `/test/file${ext}`, code, allEnabledRules, language);
}

describe('checkModuleRules', () => {
  it('detects data-layer-depends-on-api violation', () => {
    const modules = [
      makeModule({ name: 'DataRepo', layerName: 'data' }),
      makeModule({ name: 'ApiController', layerName: 'api' }),
    ];
    const moduleLevelDeps: ModuleLevelDependency[] = [
      { sourceModule: 'DataRepo', sourceService: 'my-service', targetModule: 'ApiController', targetService: 'my-service', importedNames: ['handler'], resolvedImportPaths: [] } as any,
    ];
    const violations = checkModuleRules(modules, [], [], enabledRules, moduleLevelDeps);
    const layerViolations = violations.filter((v) => v.ruleKey === 'architecture/deterministic/data-layer-depends-on-api');
    expect(layerViolations).toHaveLength(1);
  });

  it('does not flag valid layer dependency', () => {
    const modules = [
      makeModule({ name: 'ApiController', layerName: 'api' }),
      makeModule({ name: 'UserService', layerName: 'service' }),
    ];
    const moduleLevelDeps: ModuleLevelDependency[] = [
      { sourceModule: 'ApiController', sourceService: 'my-service', targetModule: 'UserService', targetService: 'my-service', importedNames: ['service'], resolvedImportPaths: [] } as any,
    ];
    const violations = checkModuleRules(modules, [], [], enabledRules, moduleLevelDeps);
    const layerViolations = violations.filter((v) => v.ruleKey === 'architecture/deterministic/data-layer-depends-on-api');
    expect(layerViolations).toHaveLength(0);
  });
});

describe('architecture/deterministic/barrel-file-re-export-all', () => {
  it('detects index file with many export * statements', () => {
    const code = `
export * from './a';
export * from './b';
export * from './c';
export * from './d';
export * from './e';
export * from './f';
`;
    const tree = parseCode(code, 'typescript');
    const violations = checkCodeRules(tree, '/test/index.ts', code, allEnabledRules, 'typescript');
    const matches = violations.filter((v) => v.ruleKey === 'architecture/deterministic/barrel-file-re-export-all');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });
});
