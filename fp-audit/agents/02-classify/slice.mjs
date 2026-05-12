#!/usr/bin/env node
/**
 * Deterministic violation slicer for the FP audit pipeline.
 *
 * Reads a frozen LATEST.json snapshot and writes per-slice JSONL files using a
 * head-plus-tail strategy per rule:
 *
 *   - Group violations by (ruleKey, shapeSig).
 *   - For each rule, take the top --head-shapes-per-rule largest groups as
 *     their own slices (preserves common-pattern diversity).
 *   - Dump all the rule's remaining (long-tail) groups into a single
 *     heterogeneous "tail" slice that the classifier handles row-by-row.
 *   - Any group exceeding --max-per-slice is chunked across multiple slices.
 *
 * Output is deterministic given the same (snapshot, target source tree) pair.
 *
 * Usage:
 *   node slice.mjs <snapshot.json> <clone_path> <slices_dir> \
 *        [--max-per-slice=200] [--head-shapes-per-rule=5]
 *
 *   <snapshot.json>  path to a snapshots/<iso>_audit.json
 *   <clone_path>     path to the cloned target repo (for reading source context)
 *   <slices_dir>     output dir; slice-NNNN.jsonl files + manifest.json
 *
 * Each output line has the schema:
 *   { repo, target_commit, file, line, rule, shape_sig, snippet, title }
 *
 * manifest.json schema:
 *   [{ slice, rule, kind: "head"|"tail", shape_sig?, count }, ...]
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

function die(msg) {
  process.stderr.write(`slice: ${msg}\n`);
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length < 3) die("usage: slice.mjs <snapshot.json> <clone_path> <slices_dir> [--max-per-slice=N] [--head-shapes-per-rule=N]");

const [snapshotPath, clonePath, slicesDir, ...rest] = args;
const flagInt = (name, def) => {
  const flag = rest.find((a) => a.startsWith(`${name}=`));
  return flag ? parseInt(flag.split("=")[1], 10) : def;
};
const maxPerSlice = flagInt("--max-per-slice", 200);
const headShapesPerRule = flagInt("--head-shapes-per-rule", 5);

if (!existsSync(snapshotPath)) die(`snapshot not found: ${snapshotPath}`);
if (!existsSync(clonePath)) die(`clone path not found: ${clonePath}`);

const snap = JSON.parse(readFileSync(snapshotPath, "utf8"));
const violations = snap?.violations ?? [];
const targetCommit = snap?.analysis?.commitHash ?? null;

// Determine repo name from the slices_dir convention `.../targets/<name>-<sha>/slices`
const repo = (() => {
  const parts = resolve(slicesDir).split("/");
  const targetsIdx = parts.lastIndexOf("targets");
  if (targetsIdx === -1 || targetsIdx + 1 >= parts.length) return null;
  const dirName = parts[targetsIdx + 1];
  return dirName.replace(/-[a-f0-9]+$/, "");
})();

// Cache file reads — many violations share files.
const fileCache = new Map();
function readFileLines(absPath) {
  if (fileCache.has(absPath)) return fileCache.get(absPath);
  let lines = null;
  try {
    lines = readFileSync(absPath, "utf8").split("\n");
  } catch {
    lines = null;
  }
  fileCache.set(absPath, lines);
  return lines;
}

/**
 * shapeSig: SHA1 of a normalized window around the violation.
 *  - 5-line window (line-2 .. line+2)
 *  - identifiers → `_`, strings → `""`, numeric literals → `0`, whitespace collapsed
 * Pure function of the source bytes; identical input ⇒ identical hash.
 */
function shapeSig(absPath, line) {
  const lines = readFileLines(absPath);
  if (!lines) return "no-source";
  const start = Math.max(0, line - 3); // 1-indexed line minus 2 → 0-indexed start
  const end = Math.min(lines.length, line + 2);
  const ctx = lines.slice(start, end).join("\n");
  const normalized = ctx
    .replace(/[a-zA-Z_$][\w$]*/g, "_")
    .replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, '""')
    .replace(/\d+/g, "0")
    .replace(/\s+/g, " ")
    .trim();
  return createHash("sha1").update(normalized).digest("hex").slice(0, 12);
}

const groups = new Map(); // key: `${rule}::${shape_sig}` → array of entries

for (const v of violations) {
  if (!v.filePath || !v.lineStart || !v.ruleKey) continue;
  const abs = resolve(clonePath, v.filePath);
  const sig = shapeSig(abs, v.lineStart);
  const entry = {
    repo,
    target_commit: targetCommit,
    file: v.filePath,
    line: v.lineStart,
    rule: v.ruleKey,
    shape_sig: sig,
    snippet: v.snippet ?? null,
    title: v.title ?? null,
  };
  const key = `${v.ruleKey}::${sig}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(entry);
}

// Re-bucket groups by rule. Within each rule, take top-N largest shape groups
// as "head" slices; collapse the rest into a single "tail" slice.
const byRule = new Map(); // rule → array of { shape_sig, entries }
for (const [key, entries] of groups) {
  const [rule, shape_sig] = key.split("::");
  if (!byRule.has(rule)) byRule.set(rule, []);
  byRule.get(rule).push({ shape_sig, entries });
}

const orderedRules = [...byRule.keys()].sort();
mkdirSync(slicesDir, { recursive: true });

let sliceIdx = 0;
const manifest = [];

const writeSlice = (chunk, meta) => {
  // Sort entries within a slice for stable ordering.
  chunk.sort((a, b) =>
    a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file),
  );
  const sliceName = `slice-${String(sliceIdx).padStart(4, "0")}.jsonl`;
  const slicePath = join(slicesDir, sliceName);
  writeFileSync(slicePath, chunk.map((e) => JSON.stringify(e)).join("\n") + "\n");
  manifest.push({ slice: sliceName, ...meta, count: chunk.length });
  sliceIdx += 1;
};

for (const rule of orderedRules) {
  const ruleGroups = byRule.get(rule);
  // Order groups by size desc, then shape_sig for determinism on ties.
  ruleGroups.sort((a, b) =>
    b.entries.length - a.entries.length || a.shape_sig.localeCompare(b.shape_sig),
  );

  const headGroups = ruleGroups.slice(0, headShapesPerRule);
  const tailGroups = ruleGroups.slice(headShapesPerRule);

  // Head: each large shape group → its own slice (chunked if oversized).
  for (const g of headGroups) {
    for (let i = 0; i < g.entries.length; i += maxPerSlice) {
      const chunk = g.entries.slice(i, i + maxPerSlice);
      writeSlice(chunk, { rule, kind: "head", shape_sig: g.shape_sig });
    }
  }

  // Tail: all rare shapes for this rule merged into one heterogeneous slice
  // (chunked if oversized). The classifier handles each row independently.
  if (tailGroups.length > 0) {
    const tailEntries = tailGroups.flatMap((g) => g.entries);
    for (let i = 0; i < tailEntries.length; i += maxPerSlice) {
      const chunk = tailEntries.slice(i, i + maxPerSlice);
      writeSlice(chunk, { rule, kind: "tail" });
    }
  }
}

writeFileSync(join(slicesDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

const totalRows = manifest.reduce((s, m) => s + m.count, 0);
process.stdout.write(
  `${sliceIdx} slices written to ${slicesDir} (${totalRows} violations across ${orderedRules.length} rules; head=${headShapesPerRule}, max-per-slice=${maxPerSlice})\n`,
);
