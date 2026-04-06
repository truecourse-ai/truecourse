import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { discoverFiles } from '../../packages/analyzer/src/file-discovery';
import { analyzeFile } from '../../packages/analyzer/src/file-analyzer';
import { buildDependencyGraph, findEntryPoints } from '../../packages/analyzer/src/dependency-graph';
import { performSplitAnalysis, type SplitAnalysisResult } from '../../packages/analyzer/src/split-analyzer';
import { checkModuleRules, checkMethodRules, checkServiceRules } from '../../packages/analyzer/src/rules/architecture/checker';
import { DETERMINISTIC_RULES } from '../../packages/analyzer/src/rules';
import type { FileAnalysis, ModuleDependency } from '../../packages/shared/src/types/analysis';

const SAMPLE_PROJECT_PATH = new URL('../fixtures/sample-project', import.meta.url).pathname;
const EXPECTED_GRAPH_PATH = `${SAMPLE_PROJECT_PATH}/expected-graph.json`;

interface ExpectedViolation {
  ruleKey: string;
  title: string;
  severity: string;
}

interface ExpectedGraph {
  services: { name: string; type: string }[];
  serviceDependencies: { source: string; target: string }[];
  modules: { name: string; service: string; kind: string; layer: string }[];
  moduleDependencies: {
    source: string;
    sourceService: string;
    target: string;
    targetService: string;
    importedNames: string[];
  }[];
  deterministicViolations: ExpectedViolation[];
}

function buildActualGraph(rootPath: string, analyses: FileAnalysis[]) {
  const deps = buildDependencyGraph(analyses, rootPath);
  const split = performSplitAnalysis(rootPath, analyses, deps);

  return {
    deps,
    split,
    graph: {
      services: split.services
        .map((s) => ({ name: s.name, type: s.type }))
        .sort((a, b) => a.name.localeCompare(b.name)),

      serviceDependencies: split.dependencies
        .map((d) => ({ source: d.source, target: d.target }))
        .sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target)),

      modules: split.modules
        .map((m) => ({ name: m.name, service: m.serviceName, kind: m.kind, layer: m.layerName }))
        .sort((a, b) => a.service.localeCompare(b.service) || a.name.localeCompare(b.name)),

      moduleDependencies: split.moduleLevelDependencies
        .map((d) => ({
          source: d.sourceModule,
          sourceService: d.sourceService,
          target: d.targetModule,
          targetService: d.targetService,
          importedNames: d.importedNames.sort(),
        }))
        .sort(
          (a, b) =>
            a.sourceService.localeCompare(b.sourceService) ||
            a.source.localeCompare(b.source) ||
            a.targetService.localeCompare(b.targetService) ||
            a.target.localeCompare(b.target),
        ),
    },
  };
}

function buildActualViolations(
  analyses: FileAnalysis[],
  deps: ModuleDependency[],
  split: SplitAnalysisResult,
  entryPoints: Set<string>,
): ExpectedViolation[] {
  const enabledDet = DETERMINISTIC_RULES.filter((r) => r.enabled);

  const serviceV = checkServiceRules(split.services, split.dependencies, enabledDet);
  const moduleV = checkModuleRules(
    split.modules, split.methods, deps, enabledDet,
    split.moduleLevelDependencies, undefined, analyses, undefined, entryPoints,
    split.methodLevelDependencies,
  );
  const methodV = checkMethodRules(
    split.methods, enabledDet, split.methodLevelDependencies, entryPoints, analyses,
  );

  return [...serviceV, ...moduleV, ...methodV]
    .map((v) => ({ ruleKey: v.ruleKey, title: v.title, severity: v.severity }))
    .sort((a, b) => a.ruleKey.localeCompare(b.ruleKey) || a.title.localeCompare(b.title));
}

describe('graph snapshot — sample-project', () => {
  let analyses: FileAnalysis[];
  let expected: ExpectedGraph;

  beforeAll(async () => {
    const files = discoverFiles(SAMPLE_PROJECT_PATH);
    const results = await Promise.all(files.map((f) => analyzeFile(f)));
    analyses = results.filter(Boolean) as FileAnalysis[];
    expected = JSON.parse(readFileSync(EXPECTED_GRAPH_PATH, 'utf-8'));
  });

  it('detects the correct services', () => {
    const { graph } = buildActualGraph(SAMPLE_PROJECT_PATH, analyses);
    expect(graph.services).toEqual(expected.services);
  });

  it('detects the correct service dependencies', () => {
    const { graph } = buildActualGraph(SAMPLE_PROJECT_PATH, analyses);
    expect(graph.serviceDependencies).toEqual(expected.serviceDependencies);
  });

  it('detects the correct modules', () => {
    const { graph } = buildActualGraph(SAMPLE_PROJECT_PATH, analyses);
    expect(graph.modules).toEqual(expected.modules);
  });

  it('detects the correct module dependencies', () => {
    const { graph } = buildActualGraph(SAMPLE_PROJECT_PATH, analyses);
    expect(graph.moduleDependencies).toEqual(expected.moduleDependencies);
  });

  it('detects the correct deterministic violations', () => {
    const { deps, split } = buildActualGraph(SAMPLE_PROJECT_PATH, analyses);
    const entryPoints = new Set(findEntryPoints(analyses, deps));
    const actual = buildActualViolations(analyses, deps, split, entryPoints);
    expect(actual).toEqual(expected.deterministicViolations);
  });
});
