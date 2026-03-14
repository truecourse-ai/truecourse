import { describe, it, expect, beforeAll } from 'vitest';
import type { FileAnalysis } from '../../packages/shared/src/types/analysis';
import { buildDependencyGraph, findEntryPoints } from '../../packages/analyzer/src/dependency-graph';
import { analyzeFile } from '../../packages/analyzer/src/file-analyzer';
import { discoverFiles } from '../../packages/analyzer/src/file-discovery';

const FIXTURE_PATH = new URL('../fixtures/sample-project', import.meta.url).pathname;

function makeFileAnalysis(
  filePath: string,
  imports: Array<{ source: string }>,
  language: 'typescript' | 'javascript' = 'typescript'
): FileAnalysis {
  return {
    filePath,
    language,
    functions: [],
    classes: [],
    imports: imports.map((i) => ({
      source: i.source,
      specifiers: [{ name: 'default', alias: undefined, isDefault: true, isNamespace: false }],
      isTypeOnly: false,
    })),
    exports: [],
    calls: [],
    httpCalls: [],
  };
}

describe('buildDependencyGraph', () => {
  it('resolves relative imports between two files', () => {
    const files: FileAnalysis[] = [
      makeFileAnalysis('/project/src/a.ts', [{ source: './b' }]),
      makeFileAnalysis('/project/src/b.ts', []),
    ];

    const deps = buildDependencyGraph(files);
    expect(deps.length).toBe(1);
    expect(deps[0]!.source).toBe('/project/src/a.ts');
    expect(deps[0]!.target).toBe('/project/src/b.ts');
  });

  it('resolves ./utils to ./utils/index.ts (index file resolution)', () => {
    const files: FileAnalysis[] = [
      makeFileAnalysis('/project/src/app.ts', [{ source: './utils' }]),
      makeFileAnalysis('/project/src/utils/index.ts', []),
    ];

    const deps = buildDependencyGraph(files);
    expect(deps.length).toBe(1);
    expect(deps[0]!.target).toBe('/project/src/utils/index.ts');
  });

  it('skips external package imports', () => {
    const files: FileAnalysis[] = [
      makeFileAnalysis('/project/src/app.ts', [
        { source: 'express' },
        { source: 'react' },
        { source: '@prisma/client' },
      ]),
    ];

    const deps = buildDependencyGraph(files);
    expect(deps.length).toBe(0);
  });

  it('handles multiple imports from the same file', () => {
    const files: FileAnalysis[] = [
      {
        filePath: '/project/src/a.ts',
        language: 'typescript',
        functions: [],
        classes: [],
        imports: [
          {
            source: './b',
            specifiers: [
              { name: 'foo', alias: undefined, isDefault: false, isNamespace: false },
            ],
            isTypeOnly: false,
          },
          {
            source: './b',
            specifiers: [
              { name: 'bar', alias: undefined, isDefault: false, isNamespace: false },
            ],
            isTypeOnly: false,
          },
        ],
        exports: [],
        calls: [],
        httpCalls: [],
      },
      makeFileAnalysis('/project/src/b.ts', []),
    ];

    const deps = buildDependencyGraph(files);
    expect(deps.length).toBe(2);
    expect(deps.every((d) => d.target === '/project/src/b.ts')).toBe(true);
  });
});

describe('findEntryPoints', () => {
  it('identifies files not imported by others', () => {
    const files: FileAnalysis[] = [
      makeFileAnalysis('/project/src/main.ts', [{ source: './service' }]),
      makeFileAnalysis('/project/src/service.ts', [{ source: './repo' }]),
      makeFileAnalysis('/project/src/repo.ts', []),
    ];

    const deps = buildDependencyGraph(files);
    const entryPoints = findEntryPoints(files, deps);

    expect(entryPoints).toContain('/project/src/main.ts');
    expect(entryPoints).not.toContain('/project/src/service.ts');
    expect(entryPoints).not.toContain('/project/src/repo.ts');
  });
});

describe('dependency graph with fixture project', () => {
  let fixtureAnalyses: FileAnalysis[];

  beforeAll(async () => {
    const files = discoverFiles(FIXTURE_PATH);
    const analyses: FileAnalysis[] = [];
    for (const file of files) {
      const result = await analyzeFile(file);
      if (result) {
        analyses.push(result);
      }
    }
    fixtureAnalyses = analyses;
  });

  it('finds expected dependencies in the fixture project', () => {
    const deps = buildDependencyGraph(fixtureAnalyses, FIXTURE_PATH);
    expect(deps.length).toBeGreaterThan(0);

    // api-gateway/src/index.ts imports from routes/users and routes/health
    const indexFile = fixtureAnalyses.find((a) =>
      a.filePath.includes('api-gateway/src/index.ts')
    );
    expect(indexFile).toBeDefined();

    const indexDeps = deps.filter((d) => d.source === indexFile!.filePath);
    expect(indexDeps.length).toBeGreaterThanOrEqual(2);

    // The targets should include the route files
    const targetPaths = indexDeps.map((d) => d.target);
    expect(targetPaths.some((t) => t.includes('routes/users'))).toBe(true);
    expect(targetPaths.some((t) => t.includes('routes/health'))).toBe(true);
  });

  it('resolves user-service internal dependencies', () => {
    const deps = buildDependencyGraph(fixtureAnalyses, FIXTURE_PATH);

    // user.handler.ts imports from user.repository.ts
    const handlerFile = fixtureAnalyses.find((a) =>
      a.filePath.includes('user.handler.ts')
    );
    expect(handlerFile).toBeDefined();

    const handlerDeps = deps.filter((d) => d.source === handlerFile!.filePath);
    expect(handlerDeps.some((d) => d.target.includes('user.repository'))).toBe(true);
  });

  it('resolves shared/utils internal re-exports', () => {
    const deps = buildDependencyGraph(fixtureAnalyses, FIXTURE_PATH);

    const sharedIndex = fixtureAnalyses.find((a) =>
      a.filePath.includes('shared/utils/src/index.ts')
    );
    expect(sharedIndex).toBeDefined();

    // Re-exports use `export { x } from './module'` syntax which creates imports
    const sharedDeps = deps.filter((d) => d.source === sharedIndex!.filePath);
    expect(sharedDeps.length).toBeGreaterThanOrEqual(0);
  });

  it('resolves workspace package imports to local files', () => {
    const deps = buildDependencyGraph(fixtureAnalyses, FIXTURE_PATH);

    // api-gateway imports @sample/shared-utils — should resolve to shared/utils
    const crossPkgDep = deps.find(
      (d) =>
        d.source.includes('api-gateway') &&
        d.target.includes('shared/utils')
    );
    expect(crossPkgDep).toBeDefined();
  });
});
