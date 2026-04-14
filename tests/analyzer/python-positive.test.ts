/**
 * Integration test: Python positive fixture.
 *
 * Runs the full analyzer against sample-python-project-positive and asserts
 * ZERO code violations. Any violation found is a false positive.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { DETERMINISTIC_RULES } from '../../packages/analyzer/src/rules';
import { checkCodeRules, parseFile, detectLanguage } from '../../packages/analyzer/src';
import type { CodeViolation } from '../../packages/shared/src/types/analysis';

const FIXTURE_PATH = new URL('../fixtures/sample-python-project-positive', import.meta.url).pathname;

function collectFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (['node_modules', '.git', '__pycache__', '.venv'].includes(entry)) continue;
      files.push(...collectFiles(full));
    } else if (/\.py$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

function runCodeRules(rootPath: string): CodeViolation[] {
  const enabledRules = DETERMINISTIC_RULES.filter((r) => r.enabled);
  const filePaths = collectFiles(rootPath);
  const allViolations: CodeViolation[] = [];

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

describe('Python positive fixture — zero false positives', () => {
  let violations: CodeViolation[];

  beforeAll(() => {
    violations = runCodeRules(FIXTURE_PATH);
  }, 60_000);

  it('produces zero violations on clean code', () => {
    if (violations.length > 0) {
      console.log(`\nFALSE POSITIVES (${violations.length}):`);
      const byRule = new Map<string, number>();
      for (const v of violations) {
        byRule.set(v.ruleKey, (byRule.get(v.ruleKey) ?? 0) + 1);
      }
      for (const [rule, count] of [...byRule.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${count}x ${rule}`);
      }
      console.log('\nFirst 20 violations:');
      for (const v of violations.slice(0, 20)) {
        console.log(`  ${v.ruleKey} at ${relative(FIXTURE_PATH, v.filePath)}:${v.lineStart} — ${v.title}`);
      }
    }
    expect(violations).toHaveLength(0);
  });
});
