import { discoverFiles } from '../packages/analyzer/src/file-discovery.js';
import { analyzeFile } from '../packages/analyzer/src/file-analyzer.js';
import { buildDependencyGraph, findEntryPoints } from '../packages/analyzer/src/dependency-graph.js';
import { performSplitAnalysis } from '../packages/analyzer/src/split-analyzer.js';
import { checkModuleRules, checkMethodRules } from '../packages/analyzer/src/rules/module-rules-checker.js';
import { checkServiceRules } from '../packages/analyzer/src/rules/service-rules-checker.js';
import { DETERMINISTIC_RULES } from '../packages/analyzer/src/rules/deterministic-rules.js';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import type { FileAnalysis, ModuleDependency } from '../packages/shared/src/types/analysis.js';

async function main() {
  const ROOT = resolve('./tests/fixtures/sample-python-project');
  const files = discoverFiles(ROOT);
  const analyses = (await Promise.all(files.map(f => analyzeFile(f)))).filter(Boolean) as FileAnalysis[];
  const deps: ModuleDependency[] = buildDependencyGraph(analyses, ROOT);
  const split = performSplitAnalysis(ROOT, analyses, deps);
  const entryPoints = new Set(findEntryPoints(analyses, deps));

  const enabledDet = DETERMINISTIC_RULES.filter(r => r.enabled);
  const serviceV = checkServiceRules(split.services, split.dependencies, enabledDet);
  const moduleV = checkModuleRules(
    split.modules, split.methods, deps, enabledDet,
    split.moduleLevelDependencies, undefined, analyses, undefined, entryPoints,
    split.methodLevelDependencies,
  );
  const methodV = checkMethodRules(
    split.methods, enabledDet, split.methodLevelDependencies, entryPoints, analyses,
  );

  const violations = [...serviceV, ...moduleV, ...methodV]
    .map(v => ({ ruleKey: v.ruleKey, title: v.title, severity: v.severity }))
    .sort((a, b) => a.ruleKey.localeCompare(b.ruleKey) || a.title.localeCompare(b.title));

  const graph = {
    services: split.services
      .map(s => ({ name: s.name, type: s.type }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    serviceDependencies: split.dependencies
      .map(d => ({ source: d.source, target: d.target }))
      .sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target)),
    modules: split.modules
      .map(m => ({ name: m.name, kind: m.kind, layer: m.layerName, service: m.serviceName }))
      .sort((a, b) => a.service.localeCompare(b.service) || a.name.localeCompare(b.name)),
    moduleDependencies: (split.moduleLevelDependencies || [])
      .map(d => ({
        source: d.sourceModule,
        sourceService: d.sourceService,
        target: d.targetModule,
        targetService: d.targetService,
        importedNames: d.importedNames.sort(),
      }))
      .sort((a, b) =>
        a.sourceService.localeCompare(b.sourceService) ||
        a.source.localeCompare(b.source) ||
        a.targetService.localeCompare(b.targetService) ||
        a.target.localeCompare(b.target)),
    deterministicViolations: violations,
  };

  const outPath = resolve('./tests/fixtures/sample-python-project/expected-graph.json');
  writeFileSync(outPath, JSON.stringify(graph, null, 2) + '\n');
  console.log('Written to', outPath);
  console.log('Services:', graph.services.length);
  console.log('Modules:', graph.modules.length);
  console.log('Module deps:', graph.moduleDependencies.length);
  console.log('Violations:', graph.deterministicViolations.length);
}

main();
