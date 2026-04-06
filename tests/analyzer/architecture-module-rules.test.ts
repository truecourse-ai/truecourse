import { describe, it, expect } from 'vitest';
import type { ModuleInfo, MethodInfo, ModuleDependency, ModuleLevelDependency, MethodLevelDependency, AnalysisRule, FileAnalysis } from '../../packages/shared/src/types';
import { checkModuleRules, checkMethodRules } from '../../packages/analyzer/src/rules/architecture/checker';
import { ARCHITECTURE_DETERMINISTIC_RULES } from '../../packages/analyzer/src/rules/architecture/deterministic';

const enabledRules = ARCHITECTURE_DETERMINISTIC_RULES.filter((r) => r.enabled);

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

    const godViolations = violations.filter((v) => v.ruleKey === 'architecture/deterministic/god-module');
    expect(godViolations).toHaveLength(1);
    expect(godViolations[0].title).toContain('GodClass');
    expect(godViolations[0].description).toContain('20 methods');
  });

  it('does not flag module with <=15 methods', () => {
    const modules = [makeModule({ methodCount: 15 })];
    const violations = checkModuleRules(modules, [], [], enabledRules);
    const godViolations = violations.filter((v) => v.ruleKey === 'architecture/deterministic/god-module');
    expect(godViolations).toHaveLength(0);
  });

  it('detects unused export', () => {
    const methods = [makeMethod({ name: 'unusedFn', isExported: true })];
    const fileDeps: ModuleDependency[] = [];
    const violations = checkModuleRules([], methods, fileDeps, enabledRules);

    const unusedViolations = violations.filter((v) => v.ruleKey === 'architecture/deterministic/unused-export');
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
      (v) => v.ruleKey === 'architecture/deterministic/unused-export' && v.methodName === 'usedFn'
    );
    expect(unusedViolations).toHaveLength(0);
  });

  it('respects disabled rules', () => {
    const allDisabled = enabledRules.map((r) => ({ ...r, enabled: false }));
    const modules = [makeModule({ methodCount: 100 })];
    const violations = checkModuleRules(modules, [], [], allDisabled);
    expect(violations).toHaveLength(0);
  });

  // Dead module detection
  it('detects dead module (no incoming or outgoing deps)', () => {
    const modules = [
      makeModule({ name: 'ActiveModule', serviceName: 'svc' }),
      makeModule({ name: 'DeadModule', serviceName: 'svc' }),
    ];
    const moduleLevelDeps: ModuleLevelDependency[] = [
      {
        sourceModule: 'ActiveModule',
        sourceService: 'svc',
        targetModule: 'OtherModule',
        targetService: 'svc',
        importedNames: ['something'],
      },
    ];

    const violations = checkModuleRules(modules, [], [], enabledRules, moduleLevelDeps);

    const deadViolations = violations.filter((v) => v.ruleKey === 'architecture/deterministic/dead-module');
    expect(deadViolations).toHaveLength(1);
    expect(deadViolations[0].title).toContain('DeadModule');
  });

  it('does not flag module that appears in dependencies', () => {
    const modules = [makeModule({ name: 'ConnectedModule', serviceName: 'svc' })];
    const moduleLevelDeps: ModuleLevelDependency[] = [
      {
        sourceModule: 'Other',
        sourceService: 'svc',
        targetModule: 'ConnectedModule',
        targetService: 'svc',
        importedNames: ['ConnectedModule'],
      },
    ];

    const violations = checkModuleRules(modules, [], [], enabledRules, moduleLevelDeps);

    const deadViolations = violations.filter((v) => v.ruleKey === 'architecture/deterministic/dead-module');
    expect(deadViolations).toHaveLength(0);
  });

  it('does not flag dead module when rule is disabled', () => {
    const onlyDeadModuleDisabled = enabledRules.map((r) =>
      r.key === 'architecture/deterministic/dead-module' ? { ...r, enabled: false } : r
    );
    const modules = [makeModule({ name: 'Isolated', serviceName: 'svc' })];
    const moduleLevelDeps: ModuleLevelDependency[] = [];

    const violations = checkModuleRules(modules, [], [], onlyDeadModuleDisabled, moduleLevelDeps);

    const deadViolations = violations.filter((v) => v.ruleKey === 'architecture/deterministic/dead-module');
    expect(deadViolations).toHaveLength(0);
  });

  // Orphan file detection
  function makeFileAnalysis(filePath: string): FileAnalysis {
    return {
      filePath,
      language: 'typescript',
      functions: [],
      classes: [],
      imports: [],
      exports: [],
      calls: [],
      httpCalls: [],
    };
  }

  it('detects orphan file (never imported)', () => {
    const modules = [makeModule({ name: 'Orphan', filePath: '/repo/svc/src/orphan.ts', serviceName: 'svc' })];
    const fileAnalyses = [makeFileAnalysis('/repo/svc/src/orphan.ts')];
    const fileDeps: ModuleDependency[] = [];

    const violations = checkModuleRules(modules, [], fileDeps, enabledRules, undefined, undefined, fileAnalyses);

    const orphanViolations = violations.filter((v) => v.ruleKey === 'architecture/deterministic/orphan-file');
    expect(orphanViolations).toHaveLength(1);
    expect(orphanViolations[0].title).toContain('orphan.ts');
    expect(orphanViolations[0].serviceName).toBe('svc');
  });

  it('does not flag file that is imported', () => {
    const fileAnalyses = [makeFileAnalysis('/repo/svc/src/used.ts')];
    const fileDeps: ModuleDependency[] = [
      { source: '/repo/svc/src/main.ts', target: '/repo/svc/src/used.ts', importedNames: ['something'] },
    ];

    const violations = checkModuleRules([], [], fileDeps, enabledRules, undefined, undefined, fileAnalyses);

    const orphanViolations = violations.filter((v) => v.ruleKey === 'architecture/deterministic/orphan-file');
    expect(orphanViolations).toHaveLength(0);
  });

  it('does not flag entry point files', () => {
    const fileAnalyses = [
      makeFileAnalysis('/repo/svc/src/index.ts'),
      makeFileAnalysis('/repo/svc/src/main.ts'),
      makeFileAnalysis('/repo/svc/src/app.ts'),
      makeFileAnalysis('/repo/svc/src/server.ts'),
      makeFileAnalysis('/repo/svc/src/routes.ts'),
      makeFileAnalysis('/repo/svc/vite.config.ts'),
      makeFileAnalysis('/repo/svc/src/__tests__/helper.ts'),
    ];

    // These are structural entry points (never imported by other files)
    const entryPointFiles = new Set(fileAnalyses.map((fa) => fa.filePath));

    const violations = checkModuleRules([], [], [], enabledRules, undefined, undefined, fileAnalyses, undefined, entryPointFiles);

    const orphanViolations = violations.filter((v) => v.ruleKey === 'architecture/deterministic/orphan-file');
    expect(orphanViolations).toHaveLength(0);
  });

  // Layer violation detection
  it('detects layer violation (data → api)', () => {
    const modules = [
      makeModule({ name: 'DataModule', serviceName: 'svc', layerName: 'data' }),
      makeModule({ name: 'ApiModule', serviceName: 'svc', layerName: 'api' }),
    ];
    const moduleLevelDeps: ModuleLevelDependency[] = [
      {
        sourceModule: 'DataModule',
        sourceService: 'svc',
        targetModule: 'ApiModule',
        targetService: 'svc',
        importedNames: ['something'],
      },
    ];

    const violations = checkModuleRules(modules, [], [], enabledRules, moduleLevelDeps);

    const layerViolations = violations.filter((v) => v.ruleKey === 'architecture/deterministic/data-layer-depends-on-api');
    expect(layerViolations).toHaveLength(1);
    expect(layerViolations[0].title).toContain('DataModule');
    expect(layerViolations[0].title).toContain('ApiModule');
  });

  it('does not flag valid layer dependency (api → service)', () => {
    const modules = [
      makeModule({ name: 'ApiModule', serviceName: 'svc', layerName: 'api' }),
      makeModule({ name: 'ServiceModule', serviceName: 'svc', layerName: 'service' }),
    ];
    const moduleLevelDeps: ModuleLevelDependency[] = [
      {
        sourceModule: 'ApiModule',
        sourceService: 'svc',
        targetModule: 'ServiceModule',
        targetService: 'svc',
        importedNames: ['something'],
      },
    ];

    const violations = checkModuleRules(modules, [], [], enabledRules, moduleLevelDeps);

    const layerViolations = violations.filter((v) => v.ruleKey.includes('layer-depends-on'));
    expect(layerViolations).toHaveLength(0);
  });
});

describe('checkMethodRules', () => {
  it('detects long method (>30 statements)', () => {
    const methods = [makeMethod({ name: 'longFn', statementCount: 35 })];
    const violations = checkMethodRules(methods, enabledRules);

    const longViolations = violations.filter((v) => v.ruleKey === 'architecture/deterministic/long-method');
    expect(longViolations).toHaveLength(1);
    expect(longViolations[0].description).toContain('35 statements');
  });

  it('does not flag method with <=30 statements', () => {
    const methods = [makeMethod({ statementCount: 30 })];
    const violations = checkMethodRules(methods, enabledRules);
    const longViolations = violations.filter((v) => v.ruleKey === 'architecture/deterministic/long-method');
    expect(longViolations).toHaveLength(0);
  });

  it('detects too many parameters (>=5)', () => {
    const methods = [makeMethod({ name: 'manyParams', paramCount: 6 })];
    const violations = checkMethodRules(methods, enabledRules);

    const paramViolations = violations.filter((v) => v.ruleKey === 'architecture/deterministic/too-many-parameters');
    expect(paramViolations).toHaveLength(1);
    expect(paramViolations[0].description).toContain('6 parameters');
  });

  it('does not flag method with <5 parameters', () => {
    const methods = [makeMethod({ paramCount: 4 })];
    const violations = checkMethodRules(methods, enabledRules);
    const paramViolations = violations.filter((v) => v.ruleKey === 'architecture/deterministic/too-many-parameters');
    expect(paramViolations).toHaveLength(0);
  });

  it('detects deeply nested logic (>4 levels)', () => {
    const methods = [makeMethod({ name: 'nested', maxNestingDepth: 6 })];
    const violations = checkMethodRules(methods, enabledRules);

    const nestViolations = violations.filter((v) => v.ruleKey === 'architecture/deterministic/deeply-nested-logic');
    expect(nestViolations).toHaveLength(1);
    expect(nestViolations[0].description).toContain('nesting depth 6');
  });

  it('does not flag method with <=4 nesting depth', () => {
    const methods = [makeMethod({ maxNestingDepth: 4 })];
    const violations = checkMethodRules(methods, enabledRules);
    const nestViolations = violations.filter((v) => v.ruleKey === 'architecture/deterministic/deeply-nested-logic');
    expect(nestViolations).toHaveLength(0);
  });

  it('detects dead method (no incoming or outgoing calls)', () => {
    const methods = [
      makeMethod({ name: 'activeMethod', moduleName: 'Mod', serviceName: 'svc' }),
      makeMethod({ name: 'deadMethod', moduleName: 'Mod', serviceName: 'svc' }),
    ];
    const methodLevelDeps: MethodLevelDependency[] = [
      {
        callerMethod: 'activeMethod',
        callerModule: 'Mod',
        callerService: 'svc',
        calleeMethod: 'otherMethod',
        calleeModule: 'Other',
        calleeService: 'svc',
        callCount: 1,
      },
    ];

    const violations = checkMethodRules(methods, enabledRules, methodLevelDeps);

    const deadViolations = violations.filter((v) => v.ruleKey === 'architecture/deterministic/dead-method');
    expect(deadViolations).toHaveLength(1);
    expect(deadViolations[0].title).toContain('deadMethod');
  });

  it('does not flag method that appears as caller or callee', () => {
    const methods = [
      makeMethod({ name: 'caller', moduleName: 'A', serviceName: 'svc' }),
      makeMethod({ name: 'callee', moduleName: 'B', serviceName: 'svc' }),
    ];
    const methodLevelDeps: MethodLevelDependency[] = [
      {
        callerMethod: 'caller',
        callerModule: 'A',
        callerService: 'svc',
        calleeMethod: 'callee',
        calleeModule: 'B',
        calleeService: 'svc',
        callCount: 2,
      },
    ];

    const violations = checkMethodRules(methods, enabledRules, methodLevelDeps);

    const deadViolations = violations.filter((v) => v.ruleKey === 'architecture/deterministic/dead-method');
    expect(deadViolations).toHaveLength(0);
  });

  it('does not run dead method check when methodLevelDeps is undefined', () => {
    const methods = [makeMethod({ name: 'someMethod' })];

    const violations = checkMethodRules(methods, enabledRules);

    const deadViolations = violations.filter((v) => v.ruleKey === 'architecture/deterministic/dead-method');
    expect(deadViolations).toHaveLength(0);
  });

  it('detects multiple violations at once', () => {
    const methods = [
      makeMethod({ name: 'fn1', paramCount: 7, statementCount: 50, maxNestingDepth: 6 }),
    ];
    const violations = checkMethodRules(methods, enabledRules);

    const ruleKeys = violations.map((v) => v.ruleKey);
    expect(ruleKeys).toContain('architecture/deterministic/long-method');
    expect(ruleKeys).toContain('architecture/deterministic/too-many-parameters');
    expect(ruleKeys).toContain('architecture/deterministic/deeply-nested-logic');
  });

  it('respects disabled rules', () => {
    const allDisabled = enabledRules.map((r) => ({ ...r, enabled: false }));
    const methods = [makeMethod({ paramCount: 20, statementCount: 100, maxNestingDepth: 10 })];
    const violations = checkMethodRules(methods, allDisabled);
    expect(violations).toHaveLength(0);
  });
});

// ===========================================================================
// Architecture code-level rules (AST visitors)
// ===========================================================================

import { checkCodeRules } from '../../packages/analyzer/src/rules/combined-code-checker';
import { ALL_DEFAULT_RULES } from '../../packages/analyzer/src/rules/index';
import { parseCode } from '../../packages/analyzer/src/parser';

const allEnabledRules = ALL_DEFAULT_RULES.filter((r) => r.enabled);

function checkCode(code: string, language: 'typescript' | 'javascript' | 'python' = 'typescript', filePath?: string) {
  const ext = language === 'python' ? '.py' : '.ts';
  const path = filePath ?? `/test/file${ext}`;
  const tree = parseCode(code, language);
  return checkCodeRules(tree, path, code, allEnabledRules, language);
}

function only(violations: ReturnType<typeof checkCode>, ruleKey: string) {
  return violations.filter((v) => v.ruleKey === ruleKey);
}

describe('architecture/deterministic/duplicate-import (JS)', () => {
  const KEY = 'architecture/deterministic/duplicate-import';

  it('detects same module imported twice', () => {
    const code = `
import { foo } from 'lodash';
import { bar } from 'lodash';
`;
    const violations = only(checkCode(code), KEY);
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag different modules', () => {
    const code = `
import { foo } from 'lodash';
import { bar } from 'underscore';
`;
    const violations = only(checkCode(code), KEY);
    expect(violations).toHaveLength(0);
  });
});

describe('architecture/deterministic/unused-import', () => {
  const KEY = 'architecture/deterministic/unused-import';

  it('detects import never used', () => {
    const code = `
import { unusedThing } from 'some-lib';
const x = 1;
`;
    const violations = only(checkCode(code), KEY);
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag used import', () => {
    const code = `
import { usedThing } from 'some-lib';
const x = usedThing();
`;
    const violations = only(checkCode(code), KEY);
    expect(violations).toHaveLength(0);
  });
});

describe('architecture/deterministic/declarations-in-global-scope', () => {
  const KEY = 'architecture/deterministic/declarations-in-global-scope';

  it('detects mutable let in global scope', () => {
    const code = `let counter = 0;`;
    const violations = only(checkCode(code), KEY);
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag UPPER_CASE constants', () => {
    const code = `const MAX_RETRIES = 3;`;
    const violations = only(checkCode(code), KEY);
    expect(violations).toHaveLength(0);
  });
});

describe('architecture/deterministic/type-assertion-overuse', () => {
  const KEY = 'architecture/deterministic/type-assertion-overuse';

  it('detects as any', () => {
    const code = `const val = something as any;`;
    const violations = only(checkCode(code), KEY);
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag as specific type', () => {
    const code = `const val = something as string;`;
    const violations = only(checkCode(code), KEY);
    expect(violations).toHaveLength(0);
  });
});

describe('architecture/deterministic/missing-error-status-code', () => {
  const KEY = 'architecture/deterministic/missing-error-status-code';

  it('detects catch sending response without status', () => {
    const code = `
try {
  await doSomething();
} catch (e) {
  res.json({ error: 'failed' });
}
`;
    const violations = only(checkCode(code, 'typescript', '/src/routes/api.ts'), KEY);
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag catch with status code', () => {
    const code = `
try {
  await doSomething();
} catch (e) {
  res.status(500).json({ error: 'failed' });
}
`;
    const violations = only(checkCode(code, 'typescript', '/src/routes/api.ts'), KEY);
    expect(violations).toHaveLength(0);
  });
});

describe('architecture/deterministic/raw-error-in-response', () => {
  const KEY = 'architecture/deterministic/raw-error-in-response';

  it('detects error stack in response', () => {
    const code = `
try {
  await doSomething();
} catch (err) {
  res.json({ stack: err.stack });
}
`;
    const violations = only(checkCode(code, 'typescript', '/src/routes/api.ts'), KEY);
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag generic error message', () => {
    const code = `
try {
  await doSomething();
} catch (err) {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
}
`;
    const violations = only(checkCode(code, 'typescript', '/src/routes/api.ts'), KEY);
    expect(violations).toHaveLength(0);
  });
});
