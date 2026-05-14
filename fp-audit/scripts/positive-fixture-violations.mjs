#!/usr/bin/env node
/**
 * Run the analyzer over tests/fixtures/sample-js-project-positive and emit
 * every violation as a JSON list:
 *
 *   [{ ruleKey, filePath (relative), lineStart }, ...]
 *
 * Used by stage 3 (positive fixture) to decide, per applied snippet, whether
 * the rule actually fires in the target file — which decides between
 * "positive-fixture-ready" and "fixed-by-prior-work" status transitions.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const FIXTURE = resolve(ROOT, 'tests/fixtures/sample-js-project-positive');
const OUT = process.argv[2] || resolve(ROOT, 'fp-audit/state/positive-violations.json');

const A = await import(resolve(ROOT, 'packages/analyzer/dist/index.js'));

const {
  DETERMINISTIC_RULES,
  checkCodeRules,
  parseFile,
  detectLanguage,
  buildSchemaIndex,
  initParsers,
} = A;
await initParsers();
const { discoverFiles } = await import(resolve(ROOT, 'packages/analyzer/dist/file-discovery.js'));
const { analyzeFile } = await import(resolve(ROOT, 'packages/analyzer/dist/file-analyzer.js'));
const { buildDependencyGraph, findEntryPoints } = await import(
  resolve(ROOT, 'packages/analyzer/dist/dependency-graph.js')
);
const { performSplitAnalysis } = await import(
  resolve(ROOT, 'packages/analyzer/dist/split-analyzer.js')
);
const { checkModuleRules, checkMethodRules, checkServiceRules } = await import(
  resolve(ROOT, 'packages/analyzer/dist/rules/architecture/checker.js')
);
const { detectDatabases } = await import(
  resolve(ROOT, 'packages/analyzer/dist/database-detector.js')
);
const { buildScopedCompilerOptions, createTypeQueryService } = await import(
  resolve(ROOT, 'packages/analyzer/dist/ts-compiler.js')
);

function collectFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '.git') continue;
      files.push(...collectFiles(full));
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

const enabledRules = DETERMINISTIC_RULES.filter((r) => r.enabled);

console.error('discovering files...');
const files = await discoverFiles(FIXTURE);
console.error(`analyzing ${files.length} files...`);
const results = await Promise.all(files.map((f) => analyzeFile(f)));
const analyses = results.filter(Boolean);
const deps = buildDependencyGraph(analyses, FIXTURE);
const split = performSplitAnalysis(FIXTURE, analyses, deps);

const allFilePaths = collectFiles(FIXTURE);
const scoped = buildScopedCompilerOptions(FIXTURE);
let typeQuery;
if (scoped.length > 0) {
  typeQuery = createTypeQueryService(allFilePaths, scoped);
}

const databaseResult = detectDatabases(FIXTURE, analyses, split.services);
const schemaIndex = buildSchemaIndex(databaseResult);

console.error('checking code rules...');
const codeViolations = [];
for (const filePath of allFilePaths) {
  if (filePath.endsWith('.d.ts')) continue;
  const lang = detectLanguage(filePath);
  if (!lang) continue;
  const content = readFileSync(filePath, 'utf-8');
  const tree = parseFile(filePath, content, lang);
  const violations = checkCodeRules(tree, filePath, content, enabledRules, lang, typeQuery, schemaIndex);
  codeViolations.push(...violations);
}

console.error('checking architecture rules...');
const enabledArch = DETERMINISTIC_RULES.filter(
  (r) => r.enabled && r.key.startsWith('architecture/'),
);
const entryPointFiles = new Set(findEntryPoints(analyses, deps));
const archViolations = [
  ...checkServiceRules(split.services, split.dependencies, enabledArch),
  ...checkModuleRules(
    split.modules, split.methods, deps, enabledArch,
    split.moduleLevelDependencies, undefined, analyses, undefined, entryPointFiles, split.methodLevelDependencies,
  ),
  ...checkMethodRules(split.methods, enabledArch, split.methodLevelDependencies, entryPointFiles, analyses),
];

const out = [];
for (const v of codeViolations) {
  out.push({
    ruleKey: v.ruleKey,
    filePath: relative(FIXTURE, v.filePath),
    lineStart: v.lineStart ?? 0,
  });
}
for (const v of archViolations) {
  out.push({
    ruleKey: v.ruleKey,
    filePath: v.filePath ? relative(FIXTURE, v.filePath) : null,
    lineStart: 0,
  });
}

writeFileSync(OUT, JSON.stringify(out));
console.error(`wrote ${out.length} violations → ${OUT}`);
