// Probe layer classification of fixture files
import { resolve } from 'node:path';
const ROOT = resolve(import.meta.dirname, '../..');
const FIXTURE = resolve(ROOT, 'tests/fixtures/sample-js-project-positive');
const A = await import(resolve(ROOT, 'packages/analyzer/dist/index.js'));
await A.initParsers();
const { discoverFiles } = await import(resolve(ROOT, 'packages/analyzer/dist/file-discovery.js'));
const { analyzeFile } = await import(resolve(ROOT, 'packages/analyzer/dist/file-analyzer.js'));
const { buildDependencyGraph } = await import(resolve(ROOT, 'packages/analyzer/dist/dependency-graph.js'));
const { performSplitAnalysis } = await import(resolve(ROOT, 'packages/analyzer/dist/split-analyzer.js'));

const files = await discoverFiles(FIXTURE);
const results = await Promise.all(files.map(f => analyzeFile(f)));
const analyses = results.filter(Boolean);
const deps = buildDependencyGraph(analyses, FIXTURE);
const split = performSplitAnalysis(FIXTURE, analyses, deps);

// Print layer breakdown
const byLayer = new Map();
for (const m of split.modules) {
  if (!byLayer.has(m.layerName)) byLayer.set(m.layerName, []);
  byLayer.get(m.layerName).push(m);
}
for (const [layer, mods] of byLayer) {
  console.log(`layer=${layer}: ${mods.length} modules`);
}

// Show data + api modules
console.log('\n=== data layer modules (sample) ===');
const dataMods = (byLayer.get('data') || []).slice(0, 20);
for (const m of dataMods) {
  console.log(`  ${m.serviceName} :: ${m.name} :: ${m.filePath.replace(FIXTURE+'/','')}`);
}

console.log('\n=== api layer modules (sample) ===');
const apiMods = (byLayer.get('api') || []).slice(0, 20);
for (const m of apiMods) {
  console.log(`  ${m.serviceName} :: ${m.name} :: ${m.filePath.replace(FIXTURE+'/','')}`);
}

// Module-level deps where src is data and tgt is api
const target = ['apps/remix/app/routes/_recipient+/sign.$token+/rejected.tsx',
                'apps/remix/app/components/embed/authoring/configure-fields-view.tsx'];
console.log('\n=== Checking fbpw source files ===');
for (const t of target) {
  const fp = `${FIXTURE}/${t}`;
  const mod = split.modules.find(m => m.filePath === fp);
  if (mod) {
    console.log(`  ${t}: layer=${mod.layerName} service=${mod.serviceName} name=${mod.name}`);
  } else {
    console.log(`  ${t}: NO MODULE`);
  }
}

// Count module deps
console.log(`\n=== Module-level deps ===`);
console.log(`Total: ${split.moduleLevelDependencies?.length ?? 0}`);
const dataToApiDeps = (split.moduleLevelDependencies || []).filter(d => {
  const sm = split.modules.find(m => `${m.serviceName}::${m.name}` === `${d.sourceService}::${d.sourceModule}`);
  const tm = split.modules.find(m => `${m.serviceName}::${m.name}` === `${d.targetService}::${d.targetModule}`);
  return sm?.layerName === 'data' && tm?.layerName === 'api';
});
console.log(`data → api deps: ${dataToApiDeps.length}`);
const dataToExtDeps = (split.moduleLevelDependencies || []).filter(d => {
  const sm = split.modules.find(m => `${m.serviceName}::${m.name}` === `${d.sourceService}::${d.sourceModule}`);
  const tm = split.modules.find(m => `${m.serviceName}::${m.name}` === `${d.targetService}::${d.targetModule}`);
  return sm?.layerName === 'data' && tm?.layerName === 'external';
});
console.log(`data → external deps: ${dataToExtDeps.length}`);
