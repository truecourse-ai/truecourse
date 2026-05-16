#!/usr/bin/env node
/**
 * Stage 3 — escape inner template-literal syntax in scratch it_blocks.
 *
 * Some sub-agents produced snippets that use template literals (backticks +
 * `${expr}`) inside the outer `check(\`...\`)` template. Those inner backticks
 * close the outer template early and break the test file.
 *
 * For each scratch JSON where the it_block contains a `check(\`...\`)` call
 * with more than two backticks total, escape every inner backtick to `\\\``
 * and every inner `${` to `\\${` so the outer template stays open and the
 * snippet text reaches `check()` intact.
 *
 * Also rewrites scratch.json so the report stays consistent. Idempotent: skips
 * already-escaped blocks.
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const STATE = resolve(ROOT, 'fp-audit/state');
const SCRATCH_DIR = resolve(STATE, 'positive-scratch');

function findCheckBacktickSpans(text) {
  // Returns [{start, end}] for the OUTER template literal that holds the
  // snippet passed to `check()`. Two common shapes:
  //   1. `check(\`...\`, 'lang')`              → outer template starts after `check(`.
  //   2. `const code = \`...\`; check(code,…)` → outer template starts after `=`.
  // In both shapes the outer template is the only multi-line backtick literal
  // in the it_block, so we just find its opening backtick and pair it with the
  // last backtick in the it_block.
  let openMatch =
    /check\(\s*`/.exec(text) ??
    /(?:const|let|var)\s+\w+\s*(?::\s*[^=]+)?=\s*`/.exec(text);
  if (!openMatch) return [];
  const start = openMatch.index + openMatch[0].length - 1;
  const end = text.lastIndexOf('`');
  if (end <= start) return [];
  return [{ start, end }];
}

function escapeInner(template) {
  // template starts and ends with `\``. Inside, escape every unescaped `\``
  // and every unescaped `${`.
  const inner = template.slice(1, -1);
  let out = '';
  let i = 0;
  while (i < inner.length) {
    const c = inner[i];
    if (c === '\\') {
      out += inner[i] + (inner[i + 1] ?? '');
      i += 2;
      continue;
    }
    if (c === '`') {
      out += '\\`';
      i++;
      continue;
    }
    if (c === '$' && inner[i + 1] === '{') {
      out += '\\${';
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return '`' + out + '`';
}

function rewriteItBlock(itBlock) {
  const spans = findCheckBacktickSpans(itBlock);
  if (spans.length === 0) return { changed: false, text: itBlock };
  // Apply spans from last to first to keep indices stable.
  let text = itBlock;
  let changed = false;
  for (let s = spans.length - 1; s >= 0; s--) {
    const { start, end } = spans[s];
    const before = text.slice(0, start);
    const tpl = text.slice(start, end + 1);
    const after = text.slice(end + 1);
    const tplEscaped = escapeInner(tpl);
    if (tplEscaped !== tpl) {
      text = before + tplEscaped + after;
      changed = true;
    }
  }
  return { changed, text };
}

let total = 0;
let fixed = 0;
for (const f of readdirSync(SCRATCH_DIR)) {
  if (!f.endsWith('.json')) continue;
  const p = join(SCRATCH_DIR, f);
  const obj = JSON.parse(readFileSync(p, 'utf8'));
  if (obj.error || !obj.it_block) continue;
  total++;
  const { changed, text } = rewriteItBlock(obj.it_block);
  if (changed) {
    obj.it_block = text;
    writeFileSync(p, JSON.stringify(obj, null, 2));
    fixed++;
    console.log(`fixed: ${f}`);
  }
}
console.log(`\nProcessed ${total} valid scratches, fixed ${fixed} with inner template literals.`);
