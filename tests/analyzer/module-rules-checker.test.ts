import { describe, it, expect } from 'vitest';
import type { ModuleInfo, MethodInfo, ModuleDependency, AnalysisRule } from '../../packages/shared/src/types';
import { checkModuleRules } from '../../packages/analyzer/src/rules/module-rules-checker';
import { DETERMINISTIC_RULES } from '../../packages/analyzer/src/rules/deterministic-rules';

const enabledRules = DETERMINISTIC_RULES.filter((r) => r.enabled);

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

function makeMethod(overrides: Partial<MethodInfo>): MethodInfo {
  return {
    name: 'testMethod',
    moduleName: 'TestModule',
    serviceName: 'my-service',
    filePath: '/repo/svc/src/test.ts',
    signature: 'testMethod()',
    paramCount: 0,
    isAsync: false,
    isExported: false,
    ...overrides,
  };
}

describe('checkModuleRules', () => {
  it('detects god module (>15 methods)', () => {
    const modules = [makeModule({ name: 'GodClass', methodCount: 20 })];
    const violations = checkModuleRules(modules, [], [], enabledRules);

    const godViolations = violations.filter((v) => v.ruleKey === 'arch/god-module');
    expect(godViolations).toHaveLength(1);
    expect(godViolations[0].title).toContain('GodClass');
    expect(godViolations[0].description).toContain('20 methods');
  });

  it('does not flag module with <=15 methods', () => {
    const modules = [makeModule({ methodCount: 15 })];
    const violations = checkModuleRules(modules, [], [], enabledRules);
    const godViolations = violations.filter((v) => v.ruleKey === 'arch/god-module');
    expect(godViolations).toHaveLength(0);
  });

  it('detects long method (>30 statements)', () => {
    const methods = [makeMethod({ name: 'longFn', statementCount: 35 })];
    const violations = checkModuleRules([], methods, [], enabledRules);

    const longViolations = violations.filter((v) => v.ruleKey === 'arch/long-method');
    expect(longViolations).toHaveLength(1);
    expect(longViolations[0].description).toContain('35 statements');
  });

  it('does not flag method with <=30 statements', () => {
    const methods = [makeMethod({ statementCount: 30 })];
    const violations = checkModuleRules([], methods, [], enabledRules);
    const longViolations = violations.filter((v) => v.ruleKey === 'arch/long-method');
    expect(longViolations).toHaveLength(0);
  });

  it('detects too many parameters (>=5)', () => {
    const methods = [makeMethod({ name: 'manyParams', paramCount: 6 })];
    const violations = checkModuleRules([], methods, [], enabledRules);

    const paramViolations = violations.filter((v) => v.ruleKey === 'arch/too-many-parameters');
    expect(paramViolations).toHaveLength(1);
    expect(paramViolations[0].description).toContain('6 parameters');
  });

  it('does not flag method with <5 parameters', () => {
    const methods = [makeMethod({ paramCount: 4 })];
    const violations = checkModuleRules([], methods, [], enabledRules);
    const paramViolations = violations.filter((v) => v.ruleKey === 'arch/too-many-parameters');
    expect(paramViolations).toHaveLength(0);
  });

  it('detects deeply nested logic (>4 levels)', () => {
    const methods = [makeMethod({ name: 'nested', maxNestingDepth: 6 })];
    const violations = checkModuleRules([], methods, [], enabledRules);

    const nestViolations = violations.filter((v) => v.ruleKey === 'arch/deeply-nested-logic');
    expect(nestViolations).toHaveLength(1);
    expect(nestViolations[0].description).toContain('nesting depth 6');
  });

  it('does not flag method with <=4 nesting depth', () => {
    const methods = [makeMethod({ maxNestingDepth: 4 })];
    const violations = checkModuleRules([], methods, [], enabledRules);
    const nestViolations = violations.filter((v) => v.ruleKey === 'arch/deeply-nested-logic');
    expect(nestViolations).toHaveLength(0);
  });

  it('detects unused export', () => {
    const methods = [makeMethod({ name: 'unusedFn', isExported: true })];
    // No dependencies importing 'unusedFn'
    const fileDeps: ModuleDependency[] = [];
    const violations = checkModuleRules([], methods, fileDeps, enabledRules);

    const unusedViolations = violations.filter((v) => v.ruleKey === 'arch/unused-export');
    expect(unusedViolations.length).toBeGreaterThanOrEqual(1);
    expect(unusedViolations[0].title).toContain('unusedFn');
  });

  it('does not flag exported function that is imported', () => {
    const methods = [makeMethod({ name: 'usedFn', isExported: true })];
    const fileDeps: ModuleDependency[] = [
      { source: '/repo/svc/src/other.ts', target: '/repo/svc/src/test.ts', importedNames: ['usedFn'] },
    ];
    const violations = checkModuleRules([], methods, fileDeps, enabledRules);

    const unusedViolations = violations.filter(
      (v) => v.ruleKey === 'arch/unused-export' && v.methodName === 'usedFn'
    );
    expect(unusedViolations).toHaveLength(0);
  });

  it('respects disabled rules', () => {
    const allDisabled = enabledRules.map((r) => ({ ...r, enabled: false }));
    const modules = [makeModule({ methodCount: 100 })];
    const methods = [makeMethod({ paramCount: 20, statementCount: 100, maxNestingDepth: 10 })];
    const violations = checkModuleRules(modules, methods, [], allDisabled);
    expect(violations).toHaveLength(0);
  });

  it('detects multiple violations at once', () => {
    const modules = [makeModule({ name: 'Big', methodCount: 20 })];
    const methods = [
      makeMethod({ name: 'fn1', paramCount: 7, statementCount: 50, maxNestingDepth: 6 }),
    ];
    const violations = checkModuleRules(modules, methods, [], enabledRules);

    const ruleKeys = violations.map((v) => v.ruleKey);
    expect(ruleKeys).toContain('arch/god-module');
    expect(ruleKeys).toContain('arch/long-method');
    expect(ruleKeys).toContain('arch/too-many-parameters');
    expect(ruleKeys).toContain('arch/deeply-nested-logic');
  });
});
