/**
 * Integration test: JS/TS positive fixture.
 *
 * Runs the full analyzer against sample-js-project-positive and asserts
 * ZERO violations across:
 *   - code rules (per-file tree-sitter visitors)
 *   - architecture rules (module/service/method checkers)
 *
 * Any violation is a false positive. Mirrors the negative test's setup so
 * architecture-checker-only rules (cross-service-internal-import, dead-method,
 * unused-export, layer rules, god-module, circular-module-dependency,
 * dead-module, deeply-nested-logic) are exercised the same way they fire in
 * real analyses.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { discoverFiles } from '../../packages/analyzer/src/file-discovery';
import { analyzeFile } from '../../packages/analyzer/src/file-analyzer';
import { buildDependencyGraph, findEntryPoints } from '../../packages/analyzer/src/dependency-graph';
import { performSplitAnalysis, type SplitAnalysisResult } from '../../packages/analyzer/src/split-analyzer';
import { checkModuleRules, checkMethodRules, checkServiceRules } from '../../packages/analyzer/src/rules/architecture/checker';
import { DETERMINISTIC_RULES } from '../../packages/analyzer/src/rules';
import { checkCodeRules, parseFile, detectLanguage, buildSchemaIndex } from '../../packages/analyzer/src';
import { detectDatabases } from '../../packages/analyzer/src/database-detector';
import { buildScopedCompilerOptions, createTypeQueryService } from '../../packages/analyzer/src/ts-compiler';
import type { FileAnalysis, CodeViolation } from '../../packages/shared/src/types/analysis';

const FIXTURE_PATH = new URL('../fixtures/sample-js-project-positive', import.meta.url).pathname;

function collectFiles(dir: string): string[] {
  const files: string[] = [];
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

function runCodeRules(
  rootPath: string,
  precomputed?: { analyses: FileAnalysis[]; split: SplitAnalysisResult },
): CodeViolation[] {
  const enabledRules = DETERMINISTIC_RULES.filter((r) => r.enabled);
  const filePaths = collectFiles(rootPath);
  const allViolations: CodeViolation[] = [];

  const scoped = buildScopedCompilerOptions(rootPath);
  let typeQuery: ReturnType<typeof createTypeQueryService> | undefined;
  if (scoped.length > 0) {
    typeQuery = createTypeQueryService(filePaths, scoped);
  }

  let schemaIndex: ReturnType<typeof buildSchemaIndex> | undefined;
  if (precomputed) {
    const databaseResult = detectDatabases(rootPath, precomputed.analyses, precomputed.split.services);
    schemaIndex = buildSchemaIndex(databaseResult);
  }

  for (const filePath of filePaths) {
    if (filePath.endsWith('.d.ts')) continue;
    const lang = detectLanguage(filePath);
    if (!lang) continue;
    const content = readFileSync(filePath, 'utf-8');
    const tree = parseFile(filePath, content, lang);
    const violations = checkCodeRules(tree, filePath, content, enabledRules, lang, typeQuery, schemaIndex);
    allViolations.push(...violations);
  }

  return allViolations;
}

describe('JS/TS positive fixture — zero false positives', () => {
  let codeViolations: CodeViolation[];
  let archViolations: Array<{ ruleKey: string; filePath?: string; title?: string }>;

  beforeAll(async () => {
    const files = await discoverFiles(FIXTURE_PATH);
    const results = await Promise.all(files.map((f) => analyzeFile(f)));
    const analyses = results.filter(Boolean) as FileAnalysis[];
    const deps = buildDependencyGraph(analyses, FIXTURE_PATH);
    const split = performSplitAnalysis(FIXTURE_PATH, analyses, deps);
    codeViolations = runCodeRules(FIXTURE_PATH, { analyses, split });

    const enabledArch = DETERMINISTIC_RULES.filter((r) => r.enabled && r.key.startsWith('architecture/'));
    const entryPointFiles = new Set(findEntryPoints(analyses, deps));
    archViolations = [
      ...checkServiceRules(split.services, split.dependencies, enabledArch),
      ...checkModuleRules(
        split.modules, split.methods, deps, enabledArch,
        split.moduleLevelDependencies, undefined, analyses, undefined, entryPointFiles, split.methodLevelDependencies,
      ),
      ...checkMethodRules(split.methods, enabledArch, split.methodLevelDependencies, entryPointFiles, analyses),
    ];
  }, 120_000);

  it('produces zero code-rule violations on clean code', () => {
    if (codeViolations.length > 0) {
      console.log(`\nFALSE POSITIVES — code rules (${codeViolations.length}):`);
      const byRule = new Map<string, number>();
      for (const v of codeViolations) {
        byRule.set(v.ruleKey, (byRule.get(v.ruleKey) ?? 0) + 1);
      }
      for (const [rule, count] of [...byRule.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${count}x ${rule}`);
      }
      console.log('\nFirst 20 code violations:');
      for (const v of codeViolations.slice(0, 20)) {
        console.log(`  ${v.ruleKey} at ${relative(FIXTURE_PATH, v.filePath)}:${v.lineStart} — ${v.title}`);
      }
    }
    expect(codeViolations).toHaveLength(0);
  });

  it('produces zero architecture violations on clean code', () => {
    if (archViolations.length > 0) {
      console.log(`\nFALSE POSITIVES — architecture (${archViolations.length}):`);
      const byRule = new Map<string, number>();
      for (const v of archViolations) {
        byRule.set(v.ruleKey, (byRule.get(v.ruleKey) ?? 0) + 1);
      }
      for (const [rule, count] of [...byRule.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${count}x ${rule}`);
      }
      console.log('\nFirst 20 arch violations:');
      for (const v of archViolations.slice(0, 20)) {
        const where = v.filePath ? relative(FIXTURE_PATH, v.filePath) : '<no file>';
        console.log(`  ${v.ruleKey} at ${where} — ${v.title ?? ''}`);
      }
    }
    expect(archViolations).toHaveLength(0);
  });
});
