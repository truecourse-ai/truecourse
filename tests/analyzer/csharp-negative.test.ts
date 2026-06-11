/**
 * Integration test: C# negative fixture — marker-driven rule coverage.
 *
 * Mirrors js-negative.test.ts: every `// VIOLATION: rule-key` comment in
 * sample-csharp-project-negative must produce a matching violation, and —
 * stronger than the JS harness — every rule that CAN fire on C# (a visitor
 * declaring csharp, or an audited universal visitor) must have at least one
 * marker, so fixture coverage can't silently lag the visitor set.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { discoverFiles } from '../../packages/analyzer/src/file-discovery';
import { analyzeFile } from '../../packages/analyzer/src/file-analyzer';
import { buildDependencyGraph } from '../../packages/analyzer/src/dependency-graph';
import { performSplitAnalysis } from '../../packages/analyzer/src/split-analyzer';
import { DETERMINISTIC_RULES, ALL_CODE_VISITORS } from '../../packages/analyzer/src/rules';
import { checkCodeRules, parseFile, detectLanguage } from '../../packages/analyzer/src';
import type { FileAnalysis, CodeViolation } from '../../packages/shared/src/types/analysis';

const FIXTURE_PATH = new URL('../fixtures/sample-csharp-project-negative', import.meta.url).pathname;

// ---------------------------------------------------------------------------
// Marker parsing
// ---------------------------------------------------------------------------

interface ExpectedViolation {
  ruleKey: string;
  filePath: string;
  line: number; // 1-indexed line of the violating code (line AFTER the comment)
}

function collectCsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      if (entry === 'bin' || entry === 'obj' || entry === '.git') continue;
      files.push(...collectCsFiles(fullPath));
    } else if (entry.endsWith('.cs')) {
      files.push(fullPath);
    }
  }
  return files;
}

function parseExpectedViolations(rootPath: string): ExpectedViolation[] {
  const expected: ExpectedViolation[] = [];
  for (const filePath of collectCsFiles(rootPath)) {
    const lines = readFileSync(filePath, 'utf-8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/\/\/\s*VIOLATION:\s*(\S+)/);
      if (match) {
        expected.push({ ruleKey: match[1], filePath, line: i + 2 });
      }
    }
  }
  return expected;
}

function runCodeRules(rootPath: string): CodeViolation[] {
  const enabledRules = DETERMINISTIC_RULES.filter((r) => r.enabled);
  const allViolations: CodeViolation[] = [];
  for (const filePath of collectCsFiles(rootPath)) {
    const lang = detectLanguage(filePath);
    if (!lang) continue;
    const content = readFileSync(filePath, 'utf-8');
    const tree = parseFile(filePath, content, lang);
    allViolations.push(...checkCodeRules(tree, filePath, content, enabledRules, lang));
  }
  return allViolations;
}

/** Every deterministic code rule that can fire on C#: visitors declaring
 *  csharp plus the audited universal visitors. */
function csharpCoverageUniverse(): Set<string> {
  const enabledKeys = new Set(DETERMINISTIC_RULES.filter((r) => r.enabled).map((r) => r.key));
  const universe = new Set<string>();
  for (const visitor of ALL_CODE_VISITORS) {
    if (!enabledKeys.has(visitor.ruleKey)) continue;
    if (!visitor.languages || visitor.languages.includes('csharp')) {
      universe.add(visitor.ruleKey);
    }
  }
  return universe;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('C# negative fixture — code rules', () => {
  let violations: CodeViolation[];
  let expected: ExpectedViolation[];

  beforeAll(async () => {
    const files = discoverFiles(FIXTURE_PATH);
    const results = await Promise.all(files.map((f) => analyzeFile(f)));
    const analyses = results.filter(Boolean) as FileAnalysis[];
    const deps = buildDependencyGraph(analyses, FIXTURE_PATH);
    performSplitAnalysis(FIXTURE_PATH, analyses, deps);
    violations = runCodeRules(FIXTURE_PATH);
    expected = parseExpectedViolations(FIXTURE_PATH);
  }, 120_000);

  it('has expected violation markers', () => {
    expect(expected.length).toBeGreaterThan(0);
    console.log(`Found ${expected.length} VIOLATION markers across fixture files`);
  });

  it('only marks rules that exist and can fire on C#', () => {
    const universe = csharpCoverageUniverse();
    const unknown = [...new Set(expected.map((e) => e.ruleKey))].filter((k) => !universe.has(k));
    if (unknown.length > 0) {
      console.log('\nMARKERS FOR UNKNOWN/NON-C# RULES:', unknown.join(', '));
    }
    expect(unknown).toEqual([]);
  });

  it('finds violations for each expected marker', () => {
    const missing: ExpectedViolation[] = [];
    for (const exp of expected) {
      const found = violations.some(
        (v) => v.ruleKey === exp.ruleKey && v.filePath === exp.filePath,
      );
      if (!found) missing.push(exp);
    }

    if (missing.length > 0) {
      console.log(`\nMISSING VIOLATIONS (${missing.length}):`);
      for (const m of missing.slice(0, 40)) {
        console.log(`  ${m.ruleKey} at ${relative(FIXTURE_PATH, m.filePath)}:${m.line}`);
      }
    }

    const coveredRules = new Set(violations.map((v) => v.ruleKey));
    const expectedRules = new Set(expected.map((e) => e.ruleKey));
    const detectedCount = [...expectedRules].filter((r) => coveredRules.has(r)).length;
    console.log(`\nRule coverage: ${detectedCount}/${expectedRules.size} expected rules detected`);
    console.log(`Total violations found: ${violations.length}`);

    expect(missing.length).toBe(0);
  });

  it('covers every C#-capable rule with at least one marker', () => {
    const universe = csharpCoverageUniverse();
    const marked = new Set(expected.map((e) => e.ruleKey));
    const uncovered = [...universe].filter((k) => !marked.has(k)).sort();
    if (uncovered.length > 0) {
      console.log(`\nRULES WITHOUT MARKERS (${uncovered.length}):`);
      for (const k of uncovered) console.log(`  ${k}`);
    }
    expect(uncovered).toEqual([]);
  });

  it('does not produce unexpected violations in violation source files', () => {
    // Scope: dedicated marker files. The pre-existing service files carry
    // their own seeded defects asserted by the graph/architecture tests.
    const scoped = violations.filter((v) => v.filePath.includes('/Violations/'));
    const expectedSet = new Set(expected.map((e) => `${e.ruleKey}::${e.filePath}`));
    const unexpected = scoped.filter((v) => !expectedSet.has(`${v.ruleKey}::${v.filePath}`));

    if (unexpected.length > 0) {
      console.log(`\nUNEXPECTED VIOLATIONS (${unexpected.length}):`);
      const byRule = new Map<string, number>();
      for (const u of unexpected) byRule.set(u.ruleKey, (byRule.get(u.ruleKey) ?? 0) + 1);
      for (const [rule, count] of [...byRule.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
        console.log(`  ${count}x ${rule}`);
      }
      for (const u of unexpected.slice(0, 20)) {
        console.log(`  ${u.ruleKey} at ${relative(FIXTURE_PATH, u.filePath)}:${u.lineStart}`);
      }
    }
    expect(unexpected.length).toBe(0);
  });

  it('does not fire duplicate rules at the same location', () => {
    const seen = new Map<string, CodeViolation>();
    const overlaps: Array<{ filePath: string; line: number; rules: string[] }> = [];
    const byLocation = new Map<string, CodeViolation[]>();
    for (const v of violations) {
      const key = `${v.filePath}:${v.lineStart}:${v.ruleKey}`;
      if (seen.has(key)) {
        const locKey = `${v.filePath}:${v.lineStart}`;
        if (!byLocation.has(locKey)) byLocation.set(locKey, [seen.get(key)!]);
        byLocation.get(locKey)!.push(v);
      }
      seen.set(key, v);
    }
    for (const [loc, list] of byLocation) {
      const [filePath, line] = [loc.slice(0, loc.lastIndexOf(':')), Number(loc.slice(loc.lastIndexOf(':') + 1))];
      overlaps.push({ filePath, line, rules: list.map((v) => v.ruleKey) });
    }
    if (overlaps.length > 0) {
      console.log(`\nDUPLICATE-RULE OVERLAPS (${overlaps.length}):`);
      for (const o of overlaps.slice(0, 20)) {
        console.log(`  ${relative(FIXTURE_PATH, o.filePath)}:${o.line} — ${o.rules.join(' + ')}`);
      }
    }
    expect(overlaps).toEqual([]);
  });
});
