#!/usr/bin/env node
/**
 * Stage 3 — verify each newly inserted "does not flag …" test fails today,
 * and update fp.jsonl status fields accordingly.
 *
 * Inputs:
 *   - fp-audit/state/apply-report.json   (which scratches were applied + final names)
 *   - fp-audit/state/positive-scratch/<unit_id>.json
 *   - fp-audit/state/dispatch-units.json (member_fp_ids per unit)
 *   - /tmp/vitest-stage3.json            (vitest JSON output for all rule tests)
 *   - fp-audit/state/fp.jsonl
 *
 * Outputs:
 *   - Updates fp.jsonl row-by-row with `positive_fixture_path`, `status`,
 *     and (if applicable) `fixed_by_commit`. Writes atomically.
 *   - fp-audit/state/verify-report.json   (per-unit verification outcome)
 *
 * Status transitions:
 *   - test failed today              → status = "positive-fixture-ready"
 *   - test passed today              → status = "fixed-by-prior-work", fixed_by_commit = current analyzer HEAD
 *   - scratch is `error` (un-fixturable) → status stays "unconfirmed", positive_fixture_path stays null
 *   - matching test not found in run → log as warning, leave row unchanged
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = resolve(import.meta.dirname, '../..');
const STATE = resolve(ROOT, 'fp-audit/state');
const SCRATCH_DIR = resolve(STATE, 'positive-scratch');
const FP_PATH = resolve(STATE, 'fp.jsonl');
const APPLY_PATH = resolve(STATE, 'apply-report.json');
const UNITS_PATH = resolve(STATE, 'dispatch-units.json');
const VITEST_PATH = '/tmp/vitest-stage3.json';
const VERIFY_PATH = resolve(STATE, 'verify-report.json');

const apply = JSON.parse(readFileSync(APPLY_PATH, 'utf8'));
const unitsFile = JSON.parse(readFileSync(UNITS_PATH, 'utf8'));
const unitById = new Map(unitsFile.units.map((u) => [u.unit_id, u]));
const vitest = JSON.parse(readFileSync(VITEST_PATH, 'utf8'));

// HEAD commit of the analyzer worktree
const analyzerHead = execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim();

// Build a lookup of test results: (describe-block-name, test-name) → status
// Vitest emits ancestorTitles[0] as the describe name; title as the it name.
const testStatus = new Map();
for (const tf of vitest.testResults) {
  for (const a of tf.assertionResults) {
    const describe = a.ancestorTitles[0] ?? '';
    const key = `${describe}\t${a.title}`;
    testStatus.set(key, a.status);
  }
}
console.log(`Loaded ${testStatus.size} test results from vitest.`);

// For each applied scratch, look up its test result.
const report = {
  generated_at: new Date().toISOString(),
  analyzer_head: analyzerHead,
  total_applied: apply.applied.length,
  total_errored_scratch: apply.errored_scratches.length,
  results: {
    failing_as_expected: [],
    fixed_by_prior_work: [],
    not_found_in_vitest: [],
  },
};

const updatesByFpId = new Map(); // fp_id → patch object

for (const a of apply.applied) {
  const { unit_id, rule, test_file, test_name } = a;
  const scratch = JSON.parse(readFileSync(join(SCRATCH_DIR, `${unit_id}.json`), 'utf8'));
  const memberIds = unitById.get(unit_id).mode.member_fp_ids;
  const key = `${rule}\t${test_name}`;
  const status = testStatus.get(key);
  if (status === undefined) {
    report.results.not_found_in_vitest.push({ unit_id, rule, test_name });
    continue;
  }
  if (status === 'failed') {
    report.results.failing_as_expected.push({ unit_id, rule, test_name });
    for (const fpId of memberIds) {
      updatesByFpId.set(fpId, {
        positive_fixture_path: `${test_file}::${test_name}`,
        status: 'positive-fixture-ready',
      });
    }
  } else if (status === 'passed') {
    report.results.fixed_by_prior_work.push({ unit_id, rule, test_name });
    for (const fpId of memberIds) {
      updatesByFpId.set(fpId, {
        positive_fixture_path: `${test_file}::${test_name}`,
        status: 'fixed-by-prior-work',
        fixed_by_commit: analyzerHead,
      });
    }
  }
}

// Errored scratches: leave status untouched. Surface them in report.
report.errored_scratches = apply.errored_scratches;

// Apply updates to fp.jsonl (atomic). Stream-read, patch, stream-write.
// Only FP rows are touched — synthesis modes occasionally include a TP id by
// mistake; we must not overwrite a TP's confirmed status with an FP fixture.
console.log(`\nUpdating ${updatesByFpId.size} fp.jsonl rows...`);
const text = readFileSync(FP_PATH, 'utf8');
const outLines = [];
let touched = 0;
let skippedTp = 0;
for (const line of text.split('\n')) {
  if (!line.trim()) continue;
  const row = JSON.parse(line);
  const patch = updatesByFpId.get(row.id);
  if (patch) {
    if (row.class !== 'FP') {
      skippedTp++;
    } else {
      Object.assign(row, patch);
      touched++;
    }
  }
  outLines.push(JSON.stringify(row));
}
console.log(`  skipped non-FP rows that appeared in member_fp_ids: ${skippedTp}`);
const tmp = FP_PATH + '.tmp';
writeFileSync(tmp, outLines.join('\n') + '\n');
execSync(`mv ${tmp} ${FP_PATH}`);
console.log(`  patched ${touched} rows`);

writeFileSync(VERIFY_PATH, JSON.stringify(report, null, 2));
console.log(`\nVerify report → ${VERIFY_PATH}`);
console.log(`  applied scratches:    ${report.total_applied}`);
console.log(`  failing as expected:  ${report.results.failing_as_expected.length}`);
console.log(`  fixed-by-prior-work:  ${report.results.fixed_by_prior_work.length}`);
console.log(`  not-found-in-vitest:  ${report.results.not_found_in_vitest.length}`);
console.log(`  errored scratch:      ${report.total_errored_scratch}`);
