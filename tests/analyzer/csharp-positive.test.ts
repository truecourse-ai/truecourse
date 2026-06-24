/**
 * Integration test: C# positive fixture.
 *
 * Runs the full analyzer against sample-csharp-project-positive and asserts
 * ZERO violations across code rules and architecture rules. Any violation is
 * a false positive in a C# visitor. Mirrors js-positive.test.ts.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { discoverFiles } from '../../packages/analyzer/src/file-discovery';
import { analyzeFile } from '../../packages/analyzer/src/file-analyzer';
import { buildDependencyGraph, findEntryPoints } from '../../packages/analyzer/src/dependency-graph';
import { performSplitAnalysis } from '../../packages/analyzer/src/split-analyzer';
import { checkModuleRules, checkMethodRules, checkServiceRules } from '../../packages/analyzer/src/rules/architecture/checker';
import { DETERMINISTIC_RULES } from '../../packages/analyzer/src/rules';
import { checkCodeRules, parseFile, detectLanguage } from '../../packages/analyzer/src';
import { runRoslynHost, resolveRoslynHostBinary } from '../../packages/analyzer/src/roslyn-host-client';
import type { FileAnalysis, CodeViolation } from '../../packages/shared/src/types/analysis';

const FIXTURE_PATH = new URL('../fixtures/sample-csharp-project-positive', import.meta.url).pathname;
const hostBuilt = resolveRoslynHostBinary() !== null;

function collectFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'bin' || entry === 'obj' || entry === '.git') continue;
      files.push(...collectFiles(full));
    } else if (entry.endsWith('.cs')) {
      files.push(full);
    }
  }
  return files;
}

function runCodeRules(rootPath: string): CodeViolation[] {
  const enabledRules = DETERMINISTIC_RULES.filter((r) => r.enabled);
  const allViolations: CodeViolation[] = [];

  for (const filePath of collectFiles(rootPath)) {
    const lang = detectLanguage(filePath);
    if (!lang) continue;
    const content = readFileSync(filePath, 'utf-8');
    const tree = parseFile(filePath, content, lang);
    allViolations.push(...checkCodeRules(tree, filePath, content, enabledRules, lang));
  }

  return allViolations;
}

describe('C# positive fixture — zero false positives', () => {
  let codeViolations: CodeViolation[];
  let archViolations: Array<{ ruleKey: string; filePath?: string; title?: string }>;

  beforeAll(async () => {
    const files = discoverFiles(FIXTURE_PATH);
    const results = await Promise.all(files.map((f) => analyzeFile(f)));
    const analyses = results.filter(Boolean) as FileAnalysis[];
    const deps = buildDependencyGraph(analyses, FIXTURE_PATH);
    const split = performSplitAnalysis(FIXTURE_PATH, analyses, deps);
    codeViolations = runCodeRules(FIXTURE_PATH);

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
  }, 600_000);

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
      for (const v of archViolations.slice(0, 20)) {
        const where = v.filePath ? relative(FIXTURE_PATH, v.filePath) : '<no file>';
        console.log(`  ${v.ruleKey} at ${where} — ${v.title ?? ''}`);
      }
    }
    expect(archViolations).toHaveLength(0);
  });

  // Roslyn semantic-host rules — same 0-FP bar, run only when the host is built.
  it.skipIf(!hostBuilt)('produces zero Roslyn-host violations on clean code', async () => {
    const hostKeys = DETERMINISTIC_RULES.filter((r) => r.enabled && r.engine === 'roslyn-host').map((r) => r.key);
    const files = collectFiles(FIXTURE_PATH).map((p) => ({ path: p, text: readFileSync(p, 'utf-8') }));
    const violations = await runRoslynHost(files, hostKeys);
    if (violations.length > 0) {
      console.log(`\nFALSE POSITIVES — Roslyn host (${violations.length}):`);
      for (const v of violations) console.log(`  ${v.ruleKey} at ${relative(FIXTURE_PATH, v.path)}:${v.line}`);
    }
    expect(violations).toEqual([]);
  }, 120_000);
});
