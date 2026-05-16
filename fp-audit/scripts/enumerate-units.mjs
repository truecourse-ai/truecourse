#!/usr/bin/env node
/**
 * Stage 3 — enumerate dispatch units.
 *
 * One unit per (rule, mode) for rules in rule-briefs.json, plus one unit per
 * (rule, shape_sig) for rules with FPs not in rule-briefs.json. Filters out
 * units where every member fp_id already has positive_fixture_path set.
 *
 * Writes fp-audit/state/dispatch-units.json. Each entry:
 *   {
 *     unit_id:  "<rule_safe>__<mode_or_shape_id>",
 *     rule:     "<rule>",
 *     category: "<first segment of rule>",
 *     test_file:"tests/analyzer/<category>-rules.test.ts",
 *     source:   "brief" | "fallback",
 *     mode: { name, summary, suggested_predicate, representative_fp_ids, member_fp_ids },
 *     clone_path: "<absolute path to repo clone>",
 *     scratch_path: "fp-audit/state/positive-scratch/<unit_id>.json"
 *   }
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const STATE = resolve(ROOT, 'fp-audit/state');
const BRIEFS_PATH = resolve(STATE, 'rule-briefs.json');
const FP_PATH = resolve(STATE, 'fp.jsonl');
const TARGETS_DIR = resolve(STATE, 'targets');
const OUT_PATH = resolve(STATE, 'dispatch-units.json');

const CATEGORY_FILE = {
  bugs: 'tests/analyzer/bugs-rules.test.ts',
  'code-quality': 'tests/analyzer/code-quality-rules.test.ts',
  performance: 'tests/analyzer/performance-rules.test.ts',
  reliability: 'tests/analyzer/reliability-rules.test.ts',
  security: 'tests/analyzer/security-rules.test.ts',
  style: 'tests/analyzer/style-rules.test.ts',
  'type-aware': 'tests/analyzer/type-aware-rules.test.ts',
  database: 'tests/analyzer/database-rules.test.ts',
};

function testFileForRule(rule) {
  const parts = rule.split('/');
  if (parts[0] === 'architecture' && parts[1] === 'module') {
    return 'tests/analyzer/architecture-module-rules.test.ts';
  }
  if (parts[0] === 'architecture' && parts[1] === 'service') {
    return 'tests/analyzer/architecture-service-rules.test.ts';
  }
  if (parts[0] === 'architecture') {
    // Generic architecture/ rules: route to module file (no subcategory)
    return 'tests/analyzer/architecture-module-rules.test.ts';
  }
  return CATEGORY_FILE[parts[0]] ?? null;
}

function ruleSafe(rule) {
  return rule.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
}

function clonePathForRepo(repo) {
  // targets/<repo>-<short>/state.json carries clone_path.
  const fs = require('node:fs');
  return null;
}

// --- Load briefs ---
const briefs = JSON.parse(readFileSync(BRIEFS_PATH, 'utf8'));
const briefsByRule = new Map();
for (const b of briefs) briefsByRule.set(b.rule, b);

// --- Load fp.jsonl ---
const fpRows = [];
const fpByRule = new Map();
const fpById = new Map();
const txt = readFileSync(FP_PATH, 'utf8');
for (const line of txt.split('\n')) {
  if (!line.trim()) continue;
  const row = JSON.parse(line);
  fpRows.push(row);
  fpById.set(row.id, row);
  if (row.class === 'FP') {
    let arr = fpByRule.get(row.rule);
    if (!arr) {
      arr = [];
      fpByRule.set(row.rule, arr);
    }
    arr.push(row);
  }
}

// --- Resolve clone_path per repo ---
const cloneByRepo = new Map();
const targetsList = (await import('node:fs')).readdirSync(TARGETS_DIR);
for (const dir of targetsList) {
  const statePath = resolve(TARGETS_DIR, dir, 'state.json');
  if (!existsSync(statePath)) continue;
  const st = JSON.parse(readFileSync(statePath, 'utf8'));
  cloneByRepo.set(st.repo, st.clone_path);
}

// --- Build units ---
const units = [];
const skipReasons = [];

// 1. From briefs: one unit per (rule, mode)
for (const brief of briefs) {
  const rule = brief.rule;
  const tf = testFileForRule(rule);
  if (!tf) {
    skipReasons.push({ rule, reason: 'unknown category', source: 'brief' });
    continue;
  }
  for (const mode of brief.modes) {
    const memberIds = mode.member_fp_ids ?? [];
    if (memberIds.length === 0) continue;

    // Resumability: skip if every member has positive_fixture_path
    const allDone = memberIds.every((id) => {
      const r = fpById.get(id);
      return r && r.positive_fixture_path !== null && r.positive_fixture_path !== undefined;
    });
    if (allDone) continue;

    // clone path: pick representative's repo
    const repIds = mode.representative_fp_ids?.length ? mode.representative_fp_ids : memberIds.slice(0, 1);
    let clone = null;
    for (const rid of repIds) {
      const r = fpById.get(rid);
      if (r && cloneByRepo.has(r.repo)) {
        clone = cloneByRepo.get(r.repo);
        break;
      }
    }
    if (!clone) {
      // fall back: any member
      for (const mid of memberIds) {
        const r = fpById.get(mid);
        if (r && cloneByRepo.has(r.repo)) {
          clone = cloneByRepo.get(r.repo);
          break;
        }
      }
    }

    const unitId = `${ruleSafe(rule)}__${mode.name.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`;
    units.push({
      unit_id: unitId,
      rule,
      category: rule.split('/')[0],
      test_file: tf,
      source: 'brief',
      mode: {
        name: mode.name,
        summary: mode.summary,
        suggested_predicate: mode.suggested_predicate ?? null,
        representative_fp_ids: mode.representative_fp_ids ?? [],
        member_fp_ids: memberIds,
      },
      clone_path: clone,
      scratch_path: `fp-audit/state/positive-scratch/${unitId}.json`,
    });
  }
}

// 2. Fallback for rules with FPs but no brief: group by shape_sig
for (const [rule, rows] of fpByRule.entries()) {
  if (briefsByRule.has(rule)) continue;
  const tf = testFileForRule(rule);
  if (!tf) {
    skipReasons.push({ rule, reason: 'unknown category', source: 'fallback' });
    continue;
  }
  const byShape = new Map();
  for (const row of rows) {
    if (row.positive_fixture_path) continue;
    let arr = byShape.get(row.shape_sig);
    if (!arr) {
      arr = [];
      byShape.set(row.shape_sig, arr);
    }
    arr.push(row);
  }
  for (const [shape, group] of byShape.entries()) {
    if (group.length === 0) continue;
    const memberIds = group.map((r) => r.id);
    const repIds = group.slice(0, 3).map((r) => r.id);
    const summary = group[0].why || '(no summary)';
    const predicate = group[0].skip_hint || null;
    const clone = cloneByRepo.get(group[0].repo) ?? null;
    const modeName = `shape-${shape.slice(0, 6)}`;
    const unitId = `${ruleSafe(rule)}__${modeName}`;
    units.push({
      unit_id: unitId,
      rule,
      category: rule.split('/')[0],
      test_file: tf,
      source: 'fallback',
      mode: {
        name: modeName,
        summary,
        suggested_predicate: predicate,
        representative_fp_ids: repIds,
        member_fp_ids: memberIds,
      },
      clone_path: clone,
      scratch_path: `fp-audit/state/positive-scratch/${unitId}.json`,
    });
  }
}

// --- Stats ---
const briefUnits = units.filter((u) => u.source === 'brief');
const fallbackUnits = units.filter((u) => u.source === 'fallback');
const ruleCountBriefs = new Set(briefUnits.map((u) => u.rule)).size;
const ruleCountFallback = new Set(fallbackUnits.map((u) => u.rule)).size;

writeFileSync(
  OUT_PATH,
  JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      total_units: units.length,
      brief_modes: briefUnits.length,
      brief_rules: ruleCountBriefs,
      fallback_shape_groups: fallbackUnits.length,
      fallback_rules: ruleCountFallback,
      skip_reasons: skipReasons,
      units,
    },
    null,
    2,
  ),
);

console.log(`Wrote ${OUT_PATH}`);
console.log(`  total units: ${units.length}`);
console.log(`  brief modes: ${briefUnits.length} (from ${ruleCountBriefs} rules)`);
console.log(`  fallback shape groups: ${fallbackUnits.length} (from ${ruleCountFallback} rules)`);
if (skipReasons.length) {
  console.log(`  skipped: ${skipReasons.length}`);
  for (const s of skipReasons) console.log(`    - ${s.rule} (${s.source}): ${s.reason}`);
}
