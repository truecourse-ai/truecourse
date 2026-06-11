/**
 * C# graph snapshot — pins the full analyze output for the C# fixture:
 * services (csproj SDK typing), modules (static classes as standalone
 * modules), file-level dependencies (symbol-index edges, including
 * same-namespace references that have no using directive), layers
 * (PascalCase directories), routes (attribute routing with [controller]
 * substitution + minimal APIs), and databases (manifest-declared EF Core
 * provider + StackExchange.Redis import, with parsed entity tables).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { join, relative } from 'path';
import { readFileSync } from 'fs';
import type { FileAnalysis, ModuleDependency } from '@truecourse/shared';
import { discoverFiles } from '../../packages/analyzer/src/file-discovery';
import { analyzeFile } from '../../packages/analyzer/src/file-analyzer';
import { buildDependencyGraph } from '../../packages/analyzer/src/dependency-graph';
import { performSplitAnalysis, type SplitAnalysisResult } from '../../packages/analyzer/src/split-analyzer';

const FIXTURE_PATH = join(__dirname, '..', 'fixtures', 'sample-csharp-project-negative');

describe('C# fixture — graph snapshot', () => {
  let analyses: FileAnalysis[];
  let deps: ModuleDependency[];
  let split: SplitAnalysisResult;
  let expectedGraph: {
    services: { name: string; type: string }[];
    modules: { name: string; service: string; kind: string; layer: string }[];
    fileDependencies: { source: string; target: string }[];
    routes: { method: string; path: string; file: string }[];
    databases: { type: string; driver: string; connectedServices: string[]; tables: string[] }[];
  };

  beforeAll(async () => {
    const files = discoverFiles(FIXTURE_PATH);
    const results = await Promise.all(files.map((f) => analyzeFile(f)));
    analyses = results.filter(Boolean) as FileAnalysis[];
    deps = buildDependencyGraph(analyses, FIXTURE_PATH);
    split = performSplitAnalysis(FIXTURE_PATH, analyses, deps);
    expectedGraph = JSON.parse(readFileSync(join(FIXTURE_PATH, 'expected-graph.json'), 'utf-8'));
  });

  it('detects the correct services', () => {
    const services = split.services
      .map((s) => ({ name: s.name, type: s.type }))
      .sort((a, b) => a.name.localeCompare(b.name));
    expect(services).toEqual(expectedGraph.services);
  });

  it('detects the correct modules', () => {
    const modules = split.modules
      .map((m) => ({ name: m.name, service: m.serviceName, kind: m.kind, layer: m.layerName }))
      .sort((a, b) => a.service.localeCompare(b.service) || a.name.localeCompare(b.name));
    expect(modules).toEqual(expectedGraph.modules);
  });

  it('resolves file dependencies, including same-namespace references without usings', () => {
    const fileDeps = deps
      .map((d) => ({ source: relative(FIXTURE_PATH, d.source), target: relative(FIXTURE_PATH, d.target) }))
      .sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target));
    expect(fileDeps).toEqual(expectedGraph.fileDependencies);

    // The load-bearing C# case: TokenModel.cs references User with no using
    // directive (same-namespace), invisible to import-based resolution.
    expect(fileDeps).toContainEqual({
      source: join('services', 'UserService', 'Models', 'TokenModel.cs'),
      target: join('services', 'UserService', 'Models', 'UserModel.cs'),
    });
  });

  it('extracts routes from attribute routing and minimal APIs', () => {
    const routes = analyses
      .flatMap((a) =>
        (a.routeRegistrations ?? []).map((r) => ({
          method: r.httpMethod,
          path: r.path,
          file: relative(FIXTURE_PATH, a.filePath),
        })),
      )
      .sort((a, b) => a.file.localeCompare(b.file) || a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
    expect(routes).toEqual(expectedGraph.routes);

    // [Route("api/[controller]")] + [HttpGet("{component}")] composition
    expect(routes).toContainEqual({
      method: 'GET',
      path: '/api/status/{component}',
      file: join('services', 'ApiGateway', 'Controllers', 'StatusController.cs'),
    });
  });

  it('detects databases from manifest-declared providers and imports', () => {
    const databases = (split.databaseResult?.databases ?? [])
      .map((db) => ({
        type: db.type,
        driver: db.driver,
        connectedServices: [...db.connectedServices].sort(),
        tables: db.tables.map((t) => t.name).sort(),
      }))
      .sort((a, b) => a.type.localeCompare(b.type));
    expect(databases).toEqual(expectedGraph.databases);
  });

  it('traces method-level dependencies through DI-injected services', () => {
    const methodDeps = split.methodLevelDependencies.map(
      (d) => `${d.callerService}::${d.callerModule}::${d.callerMethod} -> ${d.calleeService}::${d.calleeModule}::${d.calleeMethod}`,
    );
    // Controller → service through a constructor-injected private field
    expect(methodDeps).toContain('ApiGateway::UserController::GetAll -> ApiGateway::UserService::FindAll');
    // Service → repository → cross-service library call
    expect(methodDeps).toContain('UserService::UserService::GetAll -> UserService::UserRepository::FindAll');
    expect(methodDeps).toContain('UserService::UserHandler::CreateUser -> Utils::Validators::ValidateEmail');
  });
});
