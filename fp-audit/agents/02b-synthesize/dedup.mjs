#!/usr/bin/env node
/**
 * Deterministic per-rule why-string dedup + chunking for the synthesis stage.
 *
 * Reads fp-audit/state/fp.jsonl, groups FP rows by rule, deduplicates `why`
 * strings (exact match + light normalization), then writes per-rule chunked
 * input files for the synthesis sub-agents.
 *
 * Usage:
 *   node dedup.mjs <fp_jsonl> <out_dir> [--max-chunk-rows=4000] [--min-fps=10]
 *
 *   <fp_jsonl>   path to fp-audit/state/fp.jsonl
 *   <out_dir>    where to write per-rule chunk files
 *                  <out_dir>/<rule_safe>/chunk-NN.json
 *                  <out_dir>/<rule_safe>/manifest.json
 *                  <out_dir>/index.json   (rules covered + chunk counts)
 *   --max-chunk-rows  rows of unique-why per chunk (default 4000)
 *   --min-fps         skip rules with fewer FPs than this (default 10)
 *
 * Each chunk file is a JSON object:
 *   {
 *     rule, chunk_index, total_chunks, total_fps, total_unique,
 *     rows: [{ why, count, fp_ids: [...] }, ...]
 *   }
 *
 * Sub-agents read one chunk and identify modes within it. The reduce sub-agent
 * reads all chunk outputs for a rule and merges modes.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

function die(msg) {
  process.stderr.write(`dedup: ${msg}\n`);
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length < 2) die("usage: dedup.mjs <fp_jsonl> <out_dir> [--max-chunk-rows=N] [--min-fps=N]");

const [fpPath, outDir, ...rest] = args;
const flagInt = (name, def) => {
  const f = rest.find((a) => a.startsWith(`${name}=`));
  return f ? parseInt(f.split("=")[1], 10) : def;
};
const maxChunkRows = flagInt("--max-chunk-rows", 4000);
const minFps = flagInt("--min-fps", 10);

if (!existsSync(fpPath)) die(`fp.jsonl not found: ${fpPath}`);

// Slug rule name for filesystem safety.
const slug = (s) => s.replace(/[^a-zA-Z0-9._-]+/g, "_");

// Light normalization: lowercase, collapse whitespace, mask backtick literals,
// mask string literals, mask integer literals. Preserves semantic content.
const normalize = (w) => {
  if (!w) return "";
  return w
    .toLowerCase()
    .replace(/`[^`]*`/g, "`X`")
    .replace(/['"][^'"]*['"]/g, '""')
    .replace(/\b\d+\b/g, "N")
    .replace(/\s+/g, " ")
    .trim();
};

// Per rule: Map<normalized_why, { why, count, fp_ids }>
const byRule = new Map();

const fpLines = readFileSync(fpPath, "utf8").split("\n");
for (const line of fpLines) {
  const t = line.trim();
  if (!t) continue;
  let r;
  try {
    r = JSON.parse(t);
  } catch {
    continue;
  }
  if (r.class !== "FP") continue;
  const rule = r.rule ?? "";
  const why = r.why ?? "";
  const norm = normalize(why);
  const id = r.id ?? "";
  if (!byRule.has(rule)) byRule.set(rule, new Map());
  const bucket = byRule.get(rule);
  if (!bucket.has(norm)) {
    // Keep the longest representative `why` (best signal for the LLM).
    bucket.set(norm, { why, count: 0, fp_ids: [] });
  }
  const row = bucket.get(norm);
  if (why.length > row.why.length) row.why = why;
  row.count += 1;
  row.fp_ids.push(id);
}

mkdirSync(outDir, { recursive: true });

const index = []; // { rule, total_fps, total_unique, chunks }

for (const [rule, bucket] of byRule) {
  const totalFps = [...bucket.values()].reduce((s, x) => s + x.count, 0);
  if (totalFps < minFps) continue;

  // Sort by frequency desc (head first), with deterministic tie-break.
  const rows = [...bucket.values()].sort(
    (a, b) => b.count - a.count || a.why.localeCompare(b.why),
  );

  const ruleDir = join(outDir, slug(rule));
  mkdirSync(ruleDir, { recursive: true });

  const totalUnique = rows.length;
  const totalChunks = Math.max(1, Math.ceil(totalUnique / maxChunkRows));
  const manifest = [];

  for (let i = 0; i < totalChunks; i++) {
    const slice = rows.slice(i * maxChunkRows, (i + 1) * maxChunkRows);
    const payload = {
      rule,
      chunk_index: i,
      total_chunks: totalChunks,
      total_fps: totalFps,
      total_unique: totalUnique,
      rows: slice,
    };
    const fname = `chunk-${String(i).padStart(2, "0")}.json`;
    writeFileSync(join(ruleDir, fname), JSON.stringify(payload, null, 2) + "\n");
    manifest.push({ chunk: fname, rows: slice.length, fps: slice.reduce((s, x) => s + x.count, 0) });
  }

  writeFileSync(
    join(ruleDir, "manifest.json"),
    JSON.stringify({ rule, total_fps: totalFps, total_unique: totalUnique, total_chunks: totalChunks, chunks: manifest }, null, 2) + "\n",
  );

  index.push({ rule, rule_safe: slug(rule), total_fps: totalFps, total_unique: totalUnique, total_chunks: totalChunks });
}

// Sort index by total_fps desc — heavy rules first.
index.sort((a, b) => b.total_fps - a.total_fps);

writeFileSync(join(outDir, "index.json"), JSON.stringify(index, null, 2) + "\n");

const summary = index.reduce(
  (acc, x) => {
    acc.rules += 1;
    acc.chunks += x.total_chunks;
    acc.fps += x.total_fps;
    acc.unique += x.total_unique;
    return acc;
  },
  { rules: 0, chunks: 0, fps: 0, unique: 0 },
);

process.stdout.write(
  `dedup: ${summary.rules} rules, ${summary.fps} FPs → ${summary.unique} unique whys (${(100 * (1 - summary.unique / summary.fps)).toFixed(1)}% collapse) → ${summary.chunks} chunks written to ${outDir}\n`,
);
