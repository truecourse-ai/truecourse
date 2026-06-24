/**
 * C# positive-coverage gate.
 *
 * Mirrors the negative coverage gate (csharp-negative.test.ts) on the positive side:
 * every C#-capable rule must have at least one `// SAFE: <ruleKey>` boundary case in the
 * positive fixture — a deliberate near-miss the rule must NOT fire on. The firing check
 * itself stays the 0-FP assertion in csharp-positive.test.ts (a SAFE line firing anything
 * shows up there); this gate only enforces COMPLETENESS — that no rule is left without a
 * boundary case.
 *
 * Report-only until the corpus is filled (logs the gap + dumps the worklist); the final
 * `expect(uncovered).toEqual([])` is flipped on once every rule is covered.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { DETERMINISTIC_RULES, ALL_CODE_VISITORS } from '../../packages/analyzer/src/rules';

const POS = join(__dirname, '..', 'fixtures', 'sample-csharp-project-positive');
const ENFORCE = true; // every C#-capable rule now has a SAFE boundary case

function hostRuleKeys(): string[] {
  return DETERMINISTIC_RULES.filter((r) => r.enabled && r.engine === 'roslyn-host').map((r) => r.key);
}
function workspaceRuleKeys(): string[] {
  return DETERMINISTIC_RULES.filter((r) => r.enabled && r.engine === 'roslyn-workspace').map((r) => r.key);
}

function csharpUniverse(): Set<string> {
  const enabled = new Set(DETERMINISTIC_RULES.filter((r) => r.enabled).map((r) => r.key));
  const u = new Set<string>();
  for (const v of ALL_CODE_VISITORS) {
    if (!enabled.has(v.ruleKey)) continue;
    if (v.excludeLanguages?.includes('csharp')) continue;
    if (!v.languages || v.languages.includes('csharp')) u.add(v.ruleKey);
  }
  for (const k of hostRuleKeys()) u.add(k);
  for (const k of workspaceRuleKeys()) u.add(k);
  return u;
}

function collectCs(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir).sort()) {
    const f = join(dir, e);
    if (statSync(f).isDirectory()) { if (!['bin', 'obj', '.git'].includes(e)) collectCs(f, out); }
    else if (e.endsWith('.cs')) out.push(f);
  }
  return out;
}

function safeMarkers(): Set<string> {
  const covered = new Set<string>();
  for (const file of collectCs(POS)) {
    for (const line of readFileSync(file, 'utf-8').split('\n')) {
      const m = line.match(/SAFE:\s*(\S+)/);
      if (m) covered.add(m[1]);
    }
  }
  return covered;
}

describe('C# positive fixture — per-rule boundary coverage', () => {
  it('every C#-capable rule has a SAFE boundary case', () => {
    const universe = csharpUniverse();
    const covered = safeMarkers();
    const uncovered = [...universe].filter((k) => !covered.has(k)).sort();

    // Dump the worklist (uncovered rules grouped by domain) for the authoring workflow.
    const byDomain: Record<string, string[]> = {};
    for (const k of uncovered) {
      const domain = k.split('/')[0];
      (byDomain[domain] ??= []).push(k);
    }
    writeFileSync('/tmp/cs-positive-worklist.json', JSON.stringify(byDomain, null, 2));
    console.log(`\nPositive coverage: ${covered.size}/${universe.size} C#-capable rules have a SAFE case`);
    console.log(`Uncovered: ${uncovered.length} (worklist by domain → /tmp/cs-positive-worklist.json)`);
    for (const [d, ks] of Object.entries(byDomain).sort((a, b) => b[1].length - a[1].length)) {
      console.log(`  ${d}: ${ks.length}`);
    }

    if (ENFORCE) expect(uncovered).toEqual([]);
  });
});
