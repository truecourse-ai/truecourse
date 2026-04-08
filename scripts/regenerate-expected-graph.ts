/**
 * Regenerate expected-graph.json for a fixture project.
 *
 * Usage:
 *   npx tsx scripts/regenerate-expected-graph.ts tests/fixtures/sample-js-project-negative
 *   npx tsx scripts/regenerate-expected-graph.ts tests/fixtures/sample-python-project-negative
 */

import { writeFileSync } from 'fs';
import { join } from 'path';
import { discoverFiles } from '../packages/analyzer/src/file-discovery';
import { analyzeFile } from '../packages/analyzer/src/file-analyzer';
import { buildDependencyGraph } from '../packages/analyzer/src/dependency-graph';
import { performSplitAnalysis } from '../packages/analyzer/src/split-analyzer';
import type { FileAnalysis } from '../packages/shared/src/types/analysis';

async function main() {
  const fixturePath = process.argv[2];
  if (!fixturePath) {
    console.error('Usage: npx tsx scripts/regenerate-expected-graph.ts <fixture-path>');
    process.exit(1);
  }

  console.log(`Analyzing ${fixturePath}...`);
  const files = discoverFiles(fixturePath);
  const results = await Promise.all(files.map((f) => analyzeFile(f)));
  const analyses = results.filter(Boolean) as FileAnalysis[];

  const deps = buildDependencyGraph(analyses, fixturePath);
  const split = performSplitAnalysis(fixturePath, analyses, deps);

  const graph = {
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

  };

  const outPath = join(fixturePath, 'expected-graph.json');
  writeFileSync(outPath, JSON.stringify(graph, null, 2) + '\n');
  console.log(`Services: ${graph.services.length}`);
  console.log(`Modules: ${graph.modules.length}`);
  console.log(`Module dependencies: ${graph.moduleDependencies.length}`);
  console.log(`Written to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
