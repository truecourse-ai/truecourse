# Skill — Regenerate fixture and evaluate against reference

End-to-end recipe for closing gaps between LLM-generated specs/contracts and the
hand-written reference. Loop until generated output matches reference well enough.

## When to use

- Eval report says coverage is below target (e.g. 12/22 planted bugs caught)
- After prompt or algorithm changes in `packages/contract-extractor` /
  `packages/spec-consolidator`
- Before merging changes that affect spec/contract extraction quality

## Inputs

- `tests/fixtures/sample-js-project-il/code/` — implementation with `// IL-DRIFT:` markers
- `tests/fixtures/sample-js-project-il/docs/` — input PRDs/ADRs
- `tests/fixtures/sample-js-project-il/reference/` — hand-written ground truth

## Steps

### 1. Apply fixes to the generator

Whatever combination of:
- Prompt guidance in `packages/contract-extractor/src/prompt.ts`
- Slicer behavior in `packages/contract-extractor/src/slicer.ts`
- Merger / post-merge passes in `packages/contract-extractor/src/merger.ts` or new files
- Consolidator changes in `packages/spec-consolidator`

Build after editing:

```bash
pnpm --filter @truecourse/contract-extractor build
pnpm --filter @truecourse/spec-consolidator build
```

### 2. Clear generated state on the fixture

```bash
rm -rf tests/fixtures/sample-js-project-il/.truecourse
```

This removes generated specs, contracts, and the extractor cache. The reference
`reference/` and source `code/`, `docs/` are untouched.

### 3. Regenerate specs

```bash
cd tests/fixtures/sample-js-project-il
truecourse spec scan
truecourse spec resolve --all-defaults
truecourse spec apply
cd -
```

`scan` runs the consolidator; `resolve --all-defaults` accepts the engine's
pre-pick for every open conflict; `apply` materializes `.truecourse/specs/`.

### 4. Regenerate contracts

```bash
cd tests/fixtures/sample-js-project-il
truecourse contracts generate
cd -
```

This runs the per-slice LLM extractor — ~one `claude -p` subprocess per slice.
Takes a few minutes; consumes API credits.

### 5. Run the verifier with generated contracts

Use the eval script at `/tmp/check-generated.mjs` (or recreate from this template):

```js
import { verify } from '<repo>/packages/contract-verifier/src/verify.ts';
import fs from 'node:fs';
import path from 'node:path';

const FIXTURE = '<repo>/tests/fixtures/sample-js-project-il';

function parseMarkers(rootDir) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(ts|tsx|js|jsx)$/.test(entry.name)) continue;
      const source = fs.readFileSync(full, 'utf-8');
      for (const line of source.split('\n')) {
        const m = line.match(/\/\/\s*IL-DRIFT:\s*(.+)/);
        if (m) out.push(m[1].trim());
      }
    }
  };
  walk(rootDir);
  return out;
}

const expected = new Set(parseMarkers(path.join(FIXTURE, 'code/src')));
const result = await verify({
  contractsDir: path.join(FIXTURE, '.truecourse/contracts'),
  codeDir: path.join(FIXTURE, 'code'),
});
const actual = new Set(result.drifts.map((d) =>
  `${d.artifactRef.type}:${d.artifactRef.identity} / ${d.obligationKey}`
));

const missed = [...expected].filter((k) => !actual.has(k)).sort();
const caught = [...expected].filter((k) => actual.has(k)).sort();
const unexpected = [...actual].filter((k) => !expected.has(k)).sort();

console.log(`${caught.length}/${expected.size} caught, ${unexpected.length} FPs`);
console.log(`Missed:`); missed.forEach((k) => console.log(`  ❌ ${k}`));
console.log(`Unexpected:`); unexpected.forEach((k) => console.log(`  ⚠️  ${k}`));
```

Run with: `pnpm exec tsx /tmp/check-generated.mjs`

### 6. Write the eval report

Save to `reference/EVAL-REPORT-<YYYY-MM-DD>.md` with:

- Headline: `N/22 caught`, `M FPs`, resolver errors, unresolved refs
- Per-bug table: which fired, which missed
- Root cause for each miss (with file path + which clause is missing)
- Verdict + recommended next iteration of fixes

### 7. Iterate

If coverage isn't satisfactory, return to step 1 with the new gaps.

## Success criteria

- **All 22 planted bugs caught** (12/22 = 54% is the 2026-05-22 baseline; target is 22/22)
- **Zero false positives**, or every FP is a known rename mirror (see report)
- **Zero unresolved refs**
- **Zero resolver errors**

## Notes

- Each LLM run is non-deterministic. Coverage can vary ±2 between identical runs
  with no code changes. Always run twice if a fix appears to barely move the
  needle — could be noise.
- Cached slices are not re-run if the slice text + prompt fingerprint match.
  After prompt changes, the cache invalidates automatically via `promptFingerprint`.
- For purely deterministic re-runs (e.g. testing slicer changes), set
  `TRUECOURSE_EXTRACTOR_DRY_RUN=1` to skip the LLM call and use a stub fragment.
