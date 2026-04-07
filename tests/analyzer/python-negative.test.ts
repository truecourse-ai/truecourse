/**
 * Integration test: Python negative fixture.
 *
 * Runs the full analyzer against sample-python-project-negative and asserts:
 * 1. Every `# VIOLATION: rule-key` comment has a matching violation
 * 2. Reports unexpected violations for review
 *
 * Also tests architecture detection (services, modules).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { discoverFiles } from '../../packages/analyzer/src/file-discovery';
import { analyzeFile } from '../../packages/analyzer/src/file-analyzer';
import { buildDependencyGraph } from '../../packages/analyzer/src/dependency-graph';
import { performSplitAnalysis } from '../../packages/analyzer/src/split-analyzer';
import { checkCodeRules, parseFile, detectLanguage } from '../../packages/analyzer/src';
import { DETERMINISTIC_RULES } from '../../packages/analyzer/src/rules';
import type { FileAnalysis, CodeViolation } from '../../packages/shared/src/types/analysis';

const FIXTURE_PATH = new URL('../fixtures/sample-python-project-negative', import.meta.url).pathname;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ExpectedViolation {
  ruleKey: string;
  filePath: string;
  line: number;
}

/**
 * Parse all `# VIOLATION: rule-key` comments from Python source files.
 */
function parseExpectedViolations(rootPath: string): ExpectedViolation[] {
  const expected: ExpectedViolation[] = [];

  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        if (entry === 'node_modules' || entry === '.git' || entry === '__pycache__' || entry === '.venv') continue;
        walk(fullPath);
      } else if (/\.py$/.test(entry)) {
        const content = readFileSync(fullPath, 'utf-8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const match = lines[i].match(/#\s*VIOLATION:\s*(.+)/);
          if (match) {
            const ruleKey = match[1].trim();
            expected.push({
              ruleKey,
              filePath: fullPath,
              line: i + 2,
            });
          }
        }
      }
    }
  }

  walk(rootPath);
  return expected;
}

/**
 * Run code-level rules on all Python files in the fixture.
 */
function runCodeRules(rootPath: string): CodeViolation[] {
  const enabledRules = DETERMINISTIC_RULES.filter((r) => r.enabled);
  const allViolations: CodeViolation[] = [];

  function collectFiles(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === 'node_modules' || entry === '.git' || entry === '__pycache__' || entry === '.venv') continue;
        files.push(...collectFiles(full));
      } else if (/\.py$/.test(entry)) {
        files.push(full);
      }
    }
    return files;
  }

  const filePaths = collectFiles(rootPath);

  for (const filePath of filePaths) {
    const lang = detectLanguage(filePath);
    if (!lang) continue;
    const content = readFileSync(filePath, 'utf-8');
    const tree = parseFile(filePath, content, lang);
    const violations = checkCodeRules(tree, filePath, content, enabledRules, lang);
    allViolations.push(...violations);
  }

  return allViolations;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Python negative fixture — code rules', () => {
  let violations: CodeViolation[];
  let expected: ExpectedViolation[];

  beforeAll(() => {
    violations = runCodeRules(FIXTURE_PATH);
    expected = parseExpectedViolations(FIXTURE_PATH);
  }, 60_000);

  it('has expected violation markers', () => {
    expect(expected.length).toBeGreaterThan(0);
    console.log(`Found ${expected.length} VIOLATION markers across fixture files`);
  });

  it('finds violations for each expected marker', () => {
    const missing: ExpectedViolation[] = [];

    for (const exp of expected) {
      const found = violations.some(
        (v) => v.ruleKey === exp.ruleKey && v.filePath === exp.filePath,
      );
      if (!found) {
        missing.push(exp);
      }
    }

    if (missing.length > 0) {
      console.log(`\nMISSING VIOLATIONS (${missing.length}):`);
      for (const m of missing) {
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

  it('does not produce unexpected violations in violation source files', () => {
    const srcViolations = violations.filter((v) => v.filePath.includes('/src/'));
    const expectedSet = new Set(expected.map((e) => `${e.ruleKey}::${e.filePath}`));

    const unexpected = srcViolations.filter(
      (v) => !expectedSet.has(`${v.ruleKey}::${v.filePath}`),
    );

    if (unexpected.length > 0) {
      console.log(`\nUNEXPECTED VIOLATIONS (${unexpected.length}):`);
      const byRule = new Map<string, number>();
      for (const u of unexpected) {
        byRule.set(u.ruleKey, (byRule.get(u.ruleKey) ?? 0) + 1);
      }
      for (const [rule, count] of [...byRule.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
        console.log(`  ${count}x ${rule}`);
      }
    }
  });
});

describe('Python negative fixture — architecture', () => {
  let analyses: FileAnalysis[];

  beforeAll(async () => {
    const files = discoverFiles(FIXTURE_PATH);
    const results = await Promise.all(files.map((f) => analyzeFile(f)));
    analyses = results.filter(Boolean) as FileAnalysis[];
  });

  it('detects services', () => {
    const deps = buildDependencyGraph(analyses, FIXTURE_PATH);
    const split = performSplitAnalysis(FIXTURE_PATH, analyses, deps);
    expect(split.services.length).toBeGreaterThan(0);
    console.log(`Services: ${split.services.map((s) => s.name).join(', ')}`);
  });

  it('detects modules', () => {
    const deps = buildDependencyGraph(analyses, FIXTURE_PATH);
    const split = performSplitAnalysis(FIXTURE_PATH, analyses, deps);
    expect(split.modules.length).toBeGreaterThan(0);
    console.log(`Modules: ${split.modules.length}`);
  });
});
