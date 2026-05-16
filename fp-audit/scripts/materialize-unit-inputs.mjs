#!/usr/bin/env node
/**
 * Stage 3 — materialize per-unit input files for sub-agents.
 *
 * Reads dispatch-units.json. For each unit, writes:
 *   fp-audit/state/positive-inputs/<unit_id>.json
 *
 * The input file is a slim prompt-ready package: rule, mode metadata (without
 * the bloated member_fp_ids list), plus pre-resolved representative samples
 * { fp_id, file, line, language, snippet }.
 *
 *   - language: from file extension (.ts/.tsx/.js/.jsx/.py).
 *   - snippet:  ±20 lines around the violation in the cloned repo.
 *
 * The orchestrator (NOT the sub-agent) writes member_fp_ids into the final
 * scratch.json after the sub-agent returns.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const STATE = resolve(ROOT, 'fp-audit/state');
const UNITS_PATH = resolve(STATE, 'dispatch-units.json');
const FP_PATH = resolve(STATE, 'fp.jsonl');
const OUT_DIR = resolve(STATE, 'positive-inputs');

mkdirSync(OUT_DIR, { recursive: true });

// Pre-load test file headers so sub-agents see the harness conventions for
// their target file (e.g., architecture tests use checkModuleRules + makeModule
// rather than the source-string check() helper used elsewhere).
const TEST_FILES = [
  'tests/analyzer/architecture-module-rules.test.ts',
  'tests/analyzer/architecture-service-rules.test.ts',
  'tests/analyzer/bugs-rules.test.ts',
  'tests/analyzer/code-quality-rules.test.ts',
  'tests/analyzer/database-rules.test.ts',
  'tests/analyzer/performance-rules.test.ts',
  'tests/analyzer/reliability-rules.test.ts',
  'tests/analyzer/security-rules.test.ts',
  'tests/analyzer/style-rules.test.ts',
  'tests/analyzer/type-aware-rules.test.ts',
];
const testHeaders = {};
for (const tf of TEST_FILES) {
  const p = resolve(ROOT, tf);
  if (!existsSync(p)) continue;
  const lines = readFileSync(p, 'utf8').split('\n');
  // Capture from start up through and including the first `describe(`
  // (covers imports, helper functions, and shared fixture builders).
  let endIdx = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (/^describe\(/.test(lines[i])) {
      endIdx = i;
      break;
    }
  }
  testHeaders[tf] = lines.slice(0, Math.min(endIdx, 60)).join('\n');
}

const data = JSON.parse(readFileSync(UNITS_PATH, 'utf8'));

// Build fp index, keyed by id. We only need the ids referenced by units, so do
// a first pass to collect needed ids, then a streaming scan of fp.jsonl to
// pluck only those rows.
const neededIds = new Set();
for (const u of data.units) {
  for (const id of u.mode.representative_fp_ids ?? []) neededIds.add(id);
}
console.log(`Need details for ${neededIds.size} representative FPs across ${data.units.length} units`);

const fpById = new Map();
const text = readFileSync(FP_PATH, 'utf8');
let scanned = 0;
for (const line of text.split('\n')) {
  if (!line.trim()) continue;
  scanned++;
  // Quick filter: only parse rows whose id substring matches.
  // Each id is 16 hex chars; check via indexOf cheap substring scan.
  // (Full JSON.parse is needed anyway, but skip lines with no match.)
  let hit = false;
  for (const id of neededIds) {
    if (line.includes(id)) {
      hit = true;
      break;
    }
  }
  if (!hit) continue;
  const row = JSON.parse(line);
  if (neededIds.has(row.id)) fpById.set(row.id, row);
}
console.log(`Resolved ${fpById.size}/${neededIds.size} representative FP rows from ${scanned} fp.jsonl lines`);

function languageFromFile(file) {
  if (file.endsWith('.tsx')) return 'tsx';
  if (file.endsWith('.ts')) return 'typescript';
  if (file.endsWith('.jsx')) return 'jsx';
  if (file.endsWith('.js') || file.endsWith('.mjs') || file.endsWith('.cjs')) return 'javascript';
  if (file.endsWith('.py')) return 'python';
  return 'typescript';
}

function readSnippet(clonePath, file, line, before = 20, after = 20) {
  if (!clonePath) return null;
  const abs = join(clonePath, file);
  try {
    const content = readFileSync(abs, 'utf8');
    const lines = content.split('\n');
    const start = Math.max(0, line - 1 - before);
    const end = Math.min(lines.length, line + after);
    const slice = lines.slice(start, end);
    return {
      start_line: start + 1,
      end_line: end,
      lines: slice,
    };
  } catch (err) {
    return { error: err.message };
  }
}

let withSamples = 0;
let withoutSamples = 0;
for (const unit of data.units) {
  const samples = [];
  for (const fpId of unit.mode.representative_fp_ids ?? []) {
    const row = fpById.get(fpId);
    if (!row) continue;
    const lang = languageFromFile(row.file);
    const snip = readSnippet(unit.clone_path, row.file, row.line);
    samples.push({
      fp_id: fpId,
      file: row.file,
      line: row.line,
      language: lang,
      why: row.why,
      shape_sig: row.shape_sig,
      snippet: snip,
    });
    if (samples.length >= 3) break; // 3 representatives is plenty for the sub-agent
  }
  if (samples.length > 0) withSamples++;
  else withoutSamples++;

  const input = {
    unit_id: unit.unit_id,
    rule: unit.rule,
    category: unit.category,
    test_file: unit.test_file,
    source: unit.source,
    mode: {
      name: unit.mode.name,
      summary: unit.mode.summary,
      suggested_predicate: unit.mode.suggested_predicate,
    },
    representative_samples: samples,
    member_fp_count: unit.mode.member_fp_ids.length,
    clone_path: unit.clone_path,
    scratch_path: unit.scratch_path,
    test_file_harness: testHeaders[unit.test_file] ?? null,
  };
  writeFileSync(join(OUT_DIR, `${unit.unit_id}.json`), JSON.stringify(input, null, 2));
}

console.log(`Wrote ${data.units.length} per-unit input files to ${OUT_DIR}`);
console.log(`  with representative samples: ${withSamples}`);
console.log(`  without samples (no FP row found): ${withoutSamples}`);
