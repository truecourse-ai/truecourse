import { describe, it, expect } from 'vitest';
import type { FileAnalysis, LayerDetail, ModuleDependency } from '../../packages/shared/src/types/analysis';
import { extractModulesAndMethods } from '../../packages/analyzer/src/module-extractor';

function makeAnalysis(overrides: Partial<FileAnalysis>): FileAnalysis {
  return {
    filePath: '/repo/service/src/file.ts',
    language: 'typescript',
    functions: [],
    classes: [],
    imports: [],
    exports: [],
    calls: [],
    httpCalls: [],
    ...overrides,
  };
}

function makeLayerDetail(overrides: Partial<LayerDetail>): LayerDetail {
  return {
    serviceName: 'my-service',
    layer: 'service',
    fileCount: 1,
    filePaths: ['/repo/service/src/file.ts'],
    confidence: 0.8,
    evidence: [],
    ...overrides,
  };
}

describe('extractModulesAndMethods', () => {
  it('extracts class-based modules', () => {
    const analysis = makeAnalysis({
      filePath: '/repo/svc/src/user.ts',
      classes: [
        {
          name: 'UserService',
          methods: [
            {
              name: 'getUser',
              params: [{ name: 'id', type: 'string' }],
              isAsync: true,
              isExported: false,
              location: { filePath: '/repo/svc/src/user.ts', startLine: 5, endLine: 15, startColumn: 0, endColumn: 0 },
            },
            {
              name: 'createUser',
              params: [{ name: 'data', type: 'UserInput' }],
              isAsync: true,
              isExported: false,
              location: { filePath: '/repo/svc/src/user.ts', startLine: 17, endLine: 30, startColumn: 0, endColumn: 0 },
            },
          ],
          properties: [{ name: 'db', type: 'Database' }],
          location: { filePath: '/repo/svc/src/user.ts', startLine: 1, endLine: 31, startColumn: 0, endColumn: 0 },
        },
      ],
      imports: [{ source: './db', specifiers: [{ name: 'Database', isDefault: false, isNamespace: false }], isTypeOnly: false }],
      exports: [{ name: 'UserService', isDefault: false }],
    });

    const layers = [makeLayerDetail({ filePaths: ['/repo/svc/src/user.ts'] })];
    const result = extractModulesAndMethods([analysis], layers, []);

    expect(result.modules).toHaveLength(1);
    expect(result.modules[0].name).toBe('UserService');
    expect(result.modules[0].kind).toBe('class');
    expect(result.modules[0].methodCount).toBe(2);
    expect(result.modules[0].propertyCount).toBe(1);
    expect(result.modules[0].importCount).toBe(1);

    expect(result.methods).toHaveLength(2);
    expect(result.methods[0].name).toBe('getUser');
    expect(result.methods[0].moduleName).toBe('UserService');
    expect(result.methods[0].paramCount).toBe(1);
    expect(result.methods[0].isAsync).toBe(true);

    expect(result.methods[1].name).toBe('createUser');
    expect(result.methods[1].signature).toContain('createUser');
    expect(result.methods[1].signature).toContain('data: UserInput');
  });

  it('extracts standalone modules from files with exported functions', () => {
    const analysis = makeAnalysis({
      filePath: '/repo/svc/src/helpers.ts',
      functions: [
        {
          name: 'formatDate',
          params: [{ name: 'date', type: 'Date' }],
          returnType: 'string',
          isAsync: false,
          isExported: true,
          location: { filePath: '/repo/svc/src/helpers.ts', startLine: 1, endLine: 5, startColumn: 0, endColumn: 0 },
        },
        {
          name: 'parseId',
          params: [{ name: 'raw', type: 'string' }],
          returnType: 'number',
          isAsync: false,
          isExported: true,
          location: { filePath: '/repo/svc/src/helpers.ts', startLine: 7, endLine: 10, startColumn: 0, endColumn: 0 },
        },
      ],
      exports: [
        { name: 'formatDate', isDefault: false },
        { name: 'parseId', isDefault: false },
      ],
    });

    const layers = [makeLayerDetail({ filePaths: ['/repo/svc/src/helpers.ts'] })];
    const result = extractModulesAndMethods([analysis], layers, []);

    expect(result.modules).toHaveLength(1);
    expect(result.modules[0].name).toBe('helpers');
    expect(result.modules[0].kind).toBe('standalone');
    expect(result.modules[0].methodCount).toBe(2);

    expect(result.methods).toHaveLength(2);
    expect(result.methods[0].moduleName).toBe('helpers');
    expect(result.methods[0].signature).toContain('formatDate(date: Date): string');
  });

  it('includes files with no classes and no exported functions as standalone modules', () => {
    const analysis = makeAnalysis({
      functions: [
        {
          name: 'internalHelper',
          params: [],
          isAsync: false,
          isExported: false,
          location: { filePath: '/repo/svc/src/file.ts', startLine: 1, endLine: 3, startColumn: 0, endColumn: 0 },
        },
      ],
    });

    const layers = [makeLayerDetail({})];
    const result = extractModulesAndMethods([analysis], layers, []);

    expect(result.modules).toHaveLength(1);
    expect(result.modules[0].kind).toBe('standalone');
    expect(result.modules[0].methodCount).toBe(1);
    expect(result.methods).toHaveLength(1);
    expect(result.methods[0].name).toBe('internalHelper');
  });

  it('builds module-level dependencies from file-level deps', () => {
    const analysis1 = makeAnalysis({
      filePath: '/repo/svc/src/controller.ts',
      classes: [{
        name: 'Controller',
        methods: [],
        properties: [],
        location: { filePath: '/repo/svc/src/controller.ts', startLine: 1, endLine: 10, startColumn: 0, endColumn: 0 },
      }],
      imports: [{ source: './service', specifiers: [{ name: 'UserService', isDefault: false, isNamespace: false }], isTypeOnly: false }],
      exports: [{ name: 'Controller', isDefault: false }],
    });

    const analysis2 = makeAnalysis({
      filePath: '/repo/svc/src/service.ts',
      classes: [{
        name: 'UserService',
        methods: [],
        properties: [],
        location: { filePath: '/repo/svc/src/service.ts', startLine: 1, endLine: 10, startColumn: 0, endColumn: 0 },
      }],
      exports: [{ name: 'UserService', isDefault: false }],
    });

    const layers = [
      makeLayerDetail({ layer: 'api', filePaths: ['/repo/svc/src/controller.ts'] }),
      makeLayerDetail({ layer: 'service', filePaths: ['/repo/svc/src/service.ts'] }),
    ];

    const fileDeps: ModuleDependency[] = [
      { source: '/repo/svc/src/controller.ts', target: '/repo/svc/src/service.ts', importedNames: ['UserService'] },
    ];

    const result = extractModulesAndMethods([analysis1, analysis2], layers, fileDeps);

    expect(result.moduleDependencies).toHaveLength(1);
    expect(result.moduleDependencies[0].sourceModule).toBe('Controller');
    expect(result.moduleDependencies[0].targetModule).toBe('UserService');
    expect(result.moduleDependencies[0].importedNames).toEqual(['UserService']);
  });

  it('filters out anonymous methods', () => {
    const analysis = makeAnalysis({
      filePath: '/repo/svc/src/app.ts',
      functions: [
        {
          name: 'startServer',
          params: [],
          isAsync: true,
          isExported: true,
          location: { filePath: '/repo/svc/src/app.ts', startLine: 1, endLine: 5, startColumn: 0, endColumn: 0 },
        },
        {
          name: 'anonymous',
          params: [],
          isAsync: false,
          isExported: false,
          location: { filePath: '/repo/svc/src/app.ts', startLine: 7, endLine: 9, startColumn: 0, endColumn: 0 },
        },
      ],
      exports: [{ name: 'startServer', isDefault: false }],
    });

    const layers = [makeLayerDetail({ filePaths: ['/repo/svc/src/app.ts'] })];
    const result = extractModulesAndMethods([analysis], layers, []);

    // Only named methods, not anonymous
    expect(result.methods).toHaveLength(1);
    expect(result.methods[0].name).toBe('startServer');
    // Module method count should also exclude anonymous
    expect(result.modules[0].methodCount).toBe(1);
  });

  it('builds method-level dependencies from call expressions', () => {
    const analysis1 = makeAnalysis({
      filePath: '/repo/svc/src/controller.ts',
      classes: [{
        name: 'UserController',
        methods: [
          {
            name: 'getAll',
            params: [],
            isAsync: true,
            isExported: false,
            location: { filePath: '/repo/svc/src/controller.ts', startLine: 5, endLine: 15, startColumn: 0, endColumn: 0 },
          },
        ],
        properties: [],
        location: { filePath: '/repo/svc/src/controller.ts', startLine: 1, endLine: 20, startColumn: 0, endColumn: 0 },
      }],
      imports: [{ source: './service', specifiers: [{ name: 'UserService', isDefault: false, isNamespace: false }], isTypeOnly: false }],
      exports: [{ name: 'UserController', isDefault: false }],
      calls: [
        { callee: 'this.userService.findAll', callerFunction: 'UserController.getAll', arguments: [] },
      ],
    });

    const analysis2 = makeAnalysis({
      filePath: '/repo/svc/src/service.ts',
      classes: [{
        name: 'UserService',
        methods: [
          {
            name: 'findAll',
            params: [],
            isAsync: true,
            isExported: false,
            location: { filePath: '/repo/svc/src/service.ts', startLine: 5, endLine: 15, startColumn: 0, endColumn: 0 },
          },
        ],
        properties: [],
        location: { filePath: '/repo/svc/src/service.ts', startLine: 1, endLine: 20, startColumn: 0, endColumn: 0 },
      }],
      exports: [{ name: 'UserService', isDefault: false }],
    });

    const layers = [
      makeLayerDetail({ layer: 'api', filePaths: ['/repo/svc/src/controller.ts'] }),
      makeLayerDetail({ layer: 'service', filePaths: ['/repo/svc/src/service.ts'] }),
    ];

    const fileDeps: ModuleDependency[] = [
      { source: '/repo/svc/src/controller.ts', target: '/repo/svc/src/service.ts', importedNames: ['UserService'] },
    ];

    const result = extractModulesAndMethods([analysis1, analysis2], layers, fileDeps);

    expect(result.methodDependencies).toHaveLength(1);
    expect(result.methodDependencies[0].callerModule).toBe('UserController');
    expect(result.methodDependencies[0].callerMethod).toBe('getAll');
    expect(result.methodDependencies[0].calleeModule).toBe('UserService');
    expect(result.methodDependencies[0].calleeMethod).toBe('findAll');
    expect(result.methodDependencies[0].callCount).toBe(1);
  });

  it('skips builtin calls (console.log, Array.map, etc.)', () => {
    const analysis = makeAnalysis({
      filePath: '/repo/svc/src/service.ts',
      classes: [{
        name: 'MyService',
        methods: [
          {
            name: 'run',
            params: [],
            isAsync: false,
            isExported: false,
            location: { filePath: '/repo/svc/src/service.ts', startLine: 1, endLine: 10, startColumn: 0, endColumn: 0 },
          },
        ],
        properties: [],
        location: { filePath: '/repo/svc/src/service.ts', startLine: 1, endLine: 10, startColumn: 0, endColumn: 0 },
      }],
      exports: [{ name: 'MyService', isDefault: false }],
      calls: [
        { callee: 'console.log', callerFunction: 'MyService.run', arguments: [] },
        { callee: 'items.map', callerFunction: 'MyService.run', arguments: [] },
        { callee: 'JSON.parse', callerFunction: 'MyService.run', arguments: [] },
      ],
    });

    const layers = [makeLayerDetail({ filePaths: ['/repo/svc/src/service.ts'] })];
    const result = extractModulesAndMethods([analysis], layers, []);

    expect(result.methodDependencies).toHaveLength(0);
  });

  it('strips this. prefix before resolving callee', () => {
    const analysis1 = makeAnalysis({
      filePath: '/repo/svc/src/controller.ts',
      classes: [{
        name: 'Controller',
        methods: [
          {
            name: 'handle',
            params: [],
            isAsync: false,
            isExported: false,
            location: { filePath: '/repo/svc/src/controller.ts', startLine: 1, endLine: 10, startColumn: 0, endColumn: 0 },
          },
        ],
        properties: [],
        location: { filePath: '/repo/svc/src/controller.ts', startLine: 1, endLine: 10, startColumn: 0, endColumn: 0 },
      }],
      imports: [{ source: './helper', specifiers: [{ name: 'Helper', isDefault: false, isNamespace: false }], isTypeOnly: false }],
      exports: [{ name: 'Controller', isDefault: false }],
      calls: [
        { callee: 'this.Helper.doWork', callerFunction: 'Controller.handle', arguments: [] },
      ],
    });

    const analysis2 = makeAnalysis({
      filePath: '/repo/svc/src/helper.ts',
      classes: [{
        name: 'Helper',
        methods: [
          {
            name: 'doWork',
            params: [],
            isAsync: false,
            isExported: false,
            location: { filePath: '/repo/svc/src/helper.ts', startLine: 1, endLine: 5, startColumn: 0, endColumn: 0 },
          },
        ],
        properties: [],
        location: { filePath: '/repo/svc/src/helper.ts', startLine: 1, endLine: 5, startColumn: 0, endColumn: 0 },
      }],
      exports: [{ name: 'Helper', isDefault: false }],
    });

    const layers = [
      makeLayerDetail({ filePaths: ['/repo/svc/src/controller.ts', '/repo/svc/src/helper.ts'] }),
    ];

    const fileDeps: ModuleDependency[] = [
      { source: '/repo/svc/src/controller.ts', target: '/repo/svc/src/helper.ts', importedNames: ['Helper'] },
    ];

    const result = extractModulesAndMethods([analysis1, analysis2], layers, fileDeps);

    expect(result.methodDependencies).toHaveLength(1);
    expect(result.methodDependencies[0].calleeModule).toBe('Helper');
    expect(result.methodDependencies[0].calleeMethod).toBe('doWork');
  });

  it('preserves function metrics (lineCount, statementCount, maxNestingDepth)', () => {
    const analysis = makeAnalysis({
      filePath: '/repo/svc/src/big.ts',
      functions: [
        {
          name: 'bigFunction',
          params: [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }, { name: 'e' }],
          isAsync: false,
          isExported: true,
          location: { filePath: '/repo/svc/src/big.ts', startLine: 1, endLine: 60, startColumn: 0, endColumn: 0 },
          lineCount: 60,
          statementCount: 35,
          maxNestingDepth: 5,
        },
      ],
      exports: [{ name: 'bigFunction', isDefault: false }],
    });

    const layers = [makeLayerDetail({ filePaths: ['/repo/svc/src/big.ts'] })];
    const result = extractModulesAndMethods([analysis], layers, []);

    expect(result.methods).toHaveLength(1);
    expect(result.methods[0].paramCount).toBe(5);
    expect(result.methods[0].lineCount).toBe(60);
    expect(result.methods[0].statementCount).toBe(35);
    expect(result.methods[0].maxNestingDepth).toBe(5);
  });
});
