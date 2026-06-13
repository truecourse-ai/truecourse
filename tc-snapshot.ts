/**
 * Regression harness for the `.tc` parse+resolve pipeline.
 *
 * Resolves every `.tc` fixture corpus through `parseTcFile` + `resolve` and
 * dumps a canonical JSON snapshot of the typed output. `tc-snapshot-after.ts`
 * runs the same corpus through `parseAndResolve` and the two snapshots must be
 * byte-identical — pinning the corpus baseline against accidental drift.
 *
 * Run:  node_modules/.bin/tsx tc-snapshot.ts <out.json>
 *
 * Excludes the raw `body` StatementNode (it is resolve-internal). Paths are
 * made relative to the worktree root so the snapshot is machine-independent.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseTcFile } from './packages/contract-verifier/src/parser-ohm/index.js';
import { resolve } from './packages/contract-verifier/src/resolver/index.js';

const ROOT = path.resolve('.');
const CORPORA = [
  'tests/fixtures/sample-js-project-il/reference/contracts',
  'tests/fixtures/sample-python-project-il/reference/contracts',
];

function walk(dir: string, out: string[]): void {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);          // include _inferred/ for max coverage
    else if (e.isFile() && full.endsWith('.tc')) out.push(full);
  }
}

/** Deterministic stringify: object keys sorted recursively. */
function stable(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(stable);
  const o = v as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o).sort()) out[k] = stable(o[k]);
  return out;
}

const snapshot: Record<string, unknown> = {};
let totalArtifacts = 0;
let totalErrors = 0;
let totalUnresolved = 0;
let totalFiles = 0;

for (const corpusRel of CORPORA) {
  const files: string[] = [];
  walk(path.join(ROOT, corpusRel), files);
  files.sort();
  totalFiles += files.length;

  const parsed = files.map((abs) => {
    const rel = path.relative(ROOT, abs);
    return parseTcFile(rel, fs.readFileSync(abs, 'utf-8'));
  });
  const res = resolve(parsed);

  // Canonical artifact list, sorted by key, body excluded.
  const artifacts = [...res.index.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, a]) => ({
      key,
      ref: a.ref,
      origin: a.origin,
      provenance: a.provenance,
      confidence: a.confidence,
      declarationLoc: a.declarationLoc,
      contract: a.contract,
    }));

  const errors = [...res.errors].sort((x, y) =>
    JSON.stringify(x) < JSON.stringify(y) ? -1 : 1,
  );
  const unresolvedRefs = [...res.unresolvedRefs].sort((x, y) =>
    JSON.stringify(x) < JSON.stringify(y) ? -1 : 1,
  );

  totalArtifacts += artifacts.length;
  totalErrors += errors.length;
  totalUnresolved += unresolvedRefs.length;

  snapshot[corpusRel] = stable({ fileCount: files.length, artifacts, errors, unresolvedRefs });
}

const outPath = process.argv[2] ?? '/tmp/tcgrammar/snapshot.json';
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2));

console.error(
  `corpora=${CORPORA.length} files=${totalFiles} artifacts=${totalArtifacts} ` +
    `errors=${totalErrors} unresolvedRefs=${totalUnresolved}\nwrote ${outPath}`,
);
