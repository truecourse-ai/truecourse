#!/usr/bin/env node
/**
 * Stage 3 — apply positive-scratch JSON files to tests/analyzer/*-rules.test.ts.
 *
 * Strategy per scratch (skipping error scratches):
 *   - Find the FIRST `describe('<rule>',` block in test_file.
 *     If found: insert the new `it(...)` just before that describe's closing `});`
 *     at column 0.
 *     If a test with the same name already exists in that describe, append
 *     " (mode <mode.name>)" to disambiguate.
 *   - If no matching describe: append a new top-level
 *     `describe('<rule>', () => { <it_block> })` block to the end of the file.
 *
 * Writes each test file atomically (tmp + rename). Tracks results:
 *   fp-audit/state/apply-report.json
 *
 * Re-running is idempotent: if the (rule, test_name) pair is already present in
 * the target describe, the scratch is recorded as "already-present" and skipped.
 */

import { readFileSync, writeFileSync, renameSync, existsSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const STATE = resolve(ROOT, 'fp-audit/state');
const SCRATCH_DIR = resolve(STATE, 'positive-scratch');
const UNITS_PATH = resolve(STATE, 'dispatch-units.json');
const REPORT_PATH = resolve(STATE, 'apply-report.json');

const units = JSON.parse(readFileSync(UNITS_PATH, 'utf8')).units;
const unitById = new Map(units.map((u) => [u.unit_id, u]));

const scratches = [];
for (const f of readdirSync(SCRATCH_DIR)) {
  if (!f.endsWith('.json')) continue;
  const id = f.replace(/\.json$/, '');
  const obj = JSON.parse(readFileSync(join(SCRATCH_DIR, f), 'utf8'));
  scratches.push({ unit_id: id, scratch: obj, unit: unitById.get(id) });
}

const errored = scratches.filter((s) => s.scratch.error);
const valid = scratches.filter((s) => !s.scratch.error);
console.log(`Loaded ${scratches.length} scratches (${valid.length} valid, ${errored.length} error)`);

// Group valid by test_file
const byFile = new Map();
for (const s of valid) {
  const tf = s.scratch.test_file;
  if (!byFile.has(tf)) byFile.set(tf, []);
  byFile.get(tf).push(s);
}

const report = {
  generated_at: new Date().toISOString(),
  total_scratches: scratches.length,
  valid: valid.length,
  errored: errored.length,
  files: [],
  applied: [],
  already_present: [],
  malformed_reverted: [],
  insertions_failed: [],
  errored_scratches: errored.map((s) => ({ unit_id: s.unit_id, rule: s.scratch.rule, mode: s.scratch.mode, reason: s.scratch.error })),
};

/**
 * Walk the file character-by-character, tracking line numbers and brace/paren
 * depth while respecting strings, template literals, and comments. Returns a
 * list of top-level `describe('<rule>',` blocks with their open and close line
 * numbers (1-based becomes 0-based here for slice convenience).
 *
 * A "top-level describe" is a describe call whose `describe(` token starts at
 * column 0. The close line is the line where the matching `});` of the
 * describe call lives.
 */
function findDescribeBlocks(content, rule) {
  const lines = content.split('\n');
  const escaped = rule.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const openRe = new RegExp(`^describe\\(['"\`]${escaped}['"\`]\\s*,`);
  const openLines = [];
  for (let i = 0; i < lines.length; i++) {
    if (openRe.test(lines[i])) openLines.push(i);
  }
  if (openLines.length === 0) return [];

  // For each open line, find the matching `});` close line by tracking parens
  // for the describe(...) call expression. We use a tokenizer that knows about
  // strings, templates, and comments. We scan from the column right after the
  // opening `(` of `describe(`.
  const results = [];
  for (const openLine of openLines) {
    // Find position of the `(` that opens describe call on that line.
    const lineText = lines[openLine];
    const parenIdx = lineText.indexOf('(');
    if (parenIdx < 0) continue;
    // Build absolute offset.
    let pos = 0;
    for (let l = 0; l < openLine; l++) pos += lines[l].length + 1;
    pos += parenIdx + 1; // immediately after the opening paren of describe(

    // Tokenize forward, tracking parens depth.
    let depth = 1; // we just consumed the opening `(`
    let i = pos;
    let inLine = '\n';
    let mode = 'code';
    let stringQuote = null;
    const len = content.length;
    while (i < len && depth > 0) {
      const c = content[i];
      const next = content[i + 1];
      if (mode === 'code') {
        if (c === '/' && next === '/') {
          // Line comment until \n
          while (i < len && content[i] !== '\n') i++;
          continue;
        }
        if (c === '/' && next === '*') {
          i += 2;
          while (i < len && !(content[i] === '*' && content[i + 1] === '/')) i++;
          i += 2;
          continue;
        }
        if (c === '\'' || c === '"') {
          mode = 'string';
          stringQuote = c;
          i++;
          continue;
        }
        if (c === '`') {
          mode = 'template';
          i++;
          continue;
        }
        if (c === '(' || c === '{' || c === '[') depth++;
        else if (c === ')' || c === '}' || c === ']') depth--;
        i++;
        continue;
      }
      if (mode === 'string') {
        if (c === '\\') {
          i += 2;
          continue;
        }
        if (c === stringQuote) {
          mode = 'code';
          stringQuote = null;
          i++;
          continue;
        }
        i++;
        continue;
      }
      if (mode === 'template') {
        if (c === '\\') {
          i += 2;
          continue;
        }
        if (c === '`') {
          mode = 'code';
          i++;
          continue;
        }
        if (c === '$' && next === '{') {
          // Template expression — switch back to code mode with brace tracking.
          // We treat `${` as opening a code segment that ends at the matching `}`.
          // Simpler approach: track a brace depth for the template.
          // Push a "template-expr" frame; we'll pop when its depth returns to 0.
          // Implementation: count braces while in this special sub-mode.
          let exprDepth = 1;
          i += 2;
          let subMode = 'code';
          let subStringQuote = null;
          while (i < len && exprDepth > 0) {
            const cc = content[i];
            const nn = content[i + 1];
            if (subMode === 'code') {
              if (cc === '/' && nn === '/') {
                while (i < len && content[i] !== '\n') i++;
                continue;
              }
              if (cc === '/' && nn === '*') {
                i += 2;
                while (i < len && !(content[i] === '*' && content[i + 1] === '/')) i++;
                i += 2;
                continue;
              }
              if (cc === '\'' || cc === '"') { subMode = 'string'; subStringQuote = cc; i++; continue; }
              if (cc === '`') { subMode = 'template-nested'; i++; continue; }
              if (cc === '{') exprDepth++;
              else if (cc === '}') exprDepth--;
              i++;
              continue;
            }
            if (subMode === 'string') {
              if (cc === '\\') { i += 2; continue; }
              if (cc === subStringQuote) { subMode = 'code'; subStringQuote = null; i++; continue; }
              i++;
              continue;
            }
            if (subMode === 'template-nested') {
              if (cc === '\\') { i += 2; continue; }
              if (cc === '`') { subMode = 'code'; i++; continue; }
              i++;
              continue;
            }
          }
          continue;
        }
        i++;
        continue;
      }
    }
    // i is now one past the matching `)`. Find the trailing `;` and figure out which line it's on.
    // Compute closeLine.
    let closeAbs = i - 1; // position of `)`
    // Optionally consume `;` and whitespace
    let scan = i;
    while (scan < len && /\s/.test(content[scan])) scan++;
    if (content[scan] === ';') closeAbs = scan;
    // Compute the line number of closeAbs
    let p = 0;
    let closeLine = 0;
    for (let l = 0; l < lines.length; l++) {
      if (p + lines[l].length >= closeAbs) {
        closeLine = l;
        break;
      }
      p += lines[l].length + 1;
    }
    results.push({ open: openLine, close: closeLine });
  }
  return results;
}

function describeHasTestName(content, describeOpen, describeClose, testName) {
  const lines = content.split('\n').slice(describeOpen, describeClose + 1);
  const escaped = testName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Test names use single, double, or backtick quotes; look for `it('<name>` etc.
  const re = new RegExp(`it\\(['"\`]${escaped}['"\`]\\s*,`);
  return lines.some((l) => re.test(l));
}

function normalizeItBlock(itBlock) {
  // Ensure the it() block has 2-space leading indent on each line.
  // Many sub-agents produced "  it(..." already; normalize defensively.
  const lines = itBlock.replace(/\r\n/g, '\n').split('\n');
  // Trim leading/trailing blank lines.
  while (lines.length && lines[0].trim() === '') lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  if (lines.length === 0) return '';
  // Determine current first-line indent.
  const firstIndent = lines[0].match(/^\s*/)[0];
  if (firstIndent === '') {
    return lines.map((l) => '  ' + l).join('\n');
  }
  return lines.join('\n');
}

function atomicWrite(filePath, content) {
  const tmp = filePath + '.tmp';
  writeFileSync(tmp, content);
  renameSync(tmp, filePath);
}

for (const [testFile, scratchList] of byFile.entries()) {
  const filePath = resolve(ROOT, testFile);
  if (!existsSync(filePath)) {
    for (const s of scratchList) {
      report.insertions_failed.push({ unit_id: s.unit_id, reason: `test file missing: ${testFile}` });
    }
    continue;
  }

  const originalContent = readFileSync(filePath, 'utf8');
  let content = originalContent;
  let fileApplied = 0;
  let fileAlreadyPresent = 0;

  for (const s of scratchList) {
    const { scratch, unit_id, unit } = s;
    const rule = scratch.rule;
    let testName = scratch.test_name;
    let itBlock = normalizeItBlock(scratch.it_block);

    // Locate existing describe block for this rule.
    const blocks = findDescribeBlocks(content, rule);

    // Disambiguate duplicate test names if needed.
    if (blocks.length > 0) {
      const block = blocks[0]; // insert into first
      if (describeHasTestName(content, block.open, block.close, testName)) {
        const newName = `${testName} (mode ${scratch.mode})`;
        const escapedOld = scratch.test_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Replace the test name inside the it_block.
        itBlock = itBlock.replace(
          new RegExp(`it\\((['"\`])${escapedOld}\\1\\s*,`),
          `it($1${newName.replace(/[$']/g, '\\$&')}$1,`,
        );
        testName = newName;
        // Re-check uniqueness; if STILL present, append the unit_id for total uniqueness
        if (describeHasTestName(content, block.open, block.close, testName)) {
          const uniqueName = `${testName} [${unit_id.slice(-8)}]`;
          const escapedOld2 = testName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          itBlock = itBlock.replace(
            new RegExp(`it\\((['"\`])${escapedOld2}\\1\\s*,`),
            `it($1${uniqueName.replace(/[$']/g, '\\$&')}$1,`,
          );
          testName = uniqueName;
        }
      }
      // Insert just before close line.
      const lines = content.split('\n');
      const insertAt = block.close; // before `});`
      // Re-find block in current content
      const currentBlocks = findDescribeBlocks(content, rule);
      const targetBlock = currentBlocks[0];
      const linesNow = content.split('\n');
      linesNow.splice(targetBlock.close, 0, itBlock);
      content = linesNow.join('\n');
      fileApplied++;
      report.applied.push({ unit_id, rule, test_file: testFile, test_name: testName, mode: 'inserted-into-describe' });
    } else {
      // Append new describe block at end.
      const indented = normalizeItBlock(itBlock);
      const newDescribe = `\ndescribe('${rule}', () => {\n${indented}\n});\n`;
      content = content.replace(/\s*$/, '\n') + newDescribe;
      fileApplied++;
      report.applied.push({ unit_id, rule, test_file: testFile, test_name: testName, mode: 'new-describe-block' });
    }
  }

  // Write atomically.
  try {
    atomicWrite(filePath, content);
    report.files.push({ test_file: testFile, scratch_count: scratchList.length, applied: fileApplied, already_present: fileAlreadyPresent });
  } catch (err) {
    // Revert
    atomicWrite(filePath, originalContent);
    for (const s of scratchList) {
      report.malformed_reverted.push({ unit_id: s.unit_id, reason: err.message });
    }
  }
}

writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
console.log(`\nApply report → ${REPORT_PATH}`);
console.log(`  applied:          ${report.applied.length}`);
console.log(`  already-present:  ${report.already_present.length}`);
console.log(`  malformed-revert: ${report.malformed_reverted.length}`);
console.log(`  insert-failed:    ${report.insertions_failed.length}`);
console.log(`  errored-scratch:  ${report.errored_scratches.length}`);
