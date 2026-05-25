# PLAN — Gap 3: ForbiddenArtifact comparator

Status: IN PROGRESS (started 2026-05-24, il-framework branch).
Tracking: tasks #27–#34. Fixture set: `docs/contracts/audit-findings-by-engine-gap.json` → `forbidden-presence` bucket (12 findings — 5 critical, 7 high).

## Goal

Make the verifier fire when the spec asserts that something MUST NOT exist in the codebase (a file, an env-var read, a dependency, a feature gate, an operation marked out-of-scope) but code has it anyway.

## Why this category matters

Today the IL has `status: 'shipped' | 'planned' | 'deferred' | 'out-of-scope'` on Operations, and the LLM extractor uses it. But the verifier treats non-shipped status as "skip the operation entirely" — it never asks "is this code that the spec said NOT to ship?" Every "ServiceTitan downloader is out-of-scope but ships anyway" finding falls through that gap.

The fix decomposes into two parts:

1. **Operations marked `out-of-scope`** — the existing `Operation` comparator gets a new check: if status=out-of-scope and code has a matching route → forbidden-present drift. No new artifact kind needed.

2. **Everything else** — files, env-vars, dependencies, feature flags — a new `ForbiddenArtifact` IL kind with a category enum.

## Scope decisions (locked)

- **One `ForbiddenArtifact` kind, category-discriminated** (not multiple kinds). Categories: `file-glob`, `env-var`, `dependency`, `feature-flag`.
- **Out-of-scope Operation drift lives in the existing Operation comparator** — not in ForbiddenArtifact. Reduces artifact bloat; the spec already encodes the obligation via `status: out-of-scope`.
- **JS/TS scope** — env-var detection looks for `process.env.X`, `Deno.env.get('X')`, `import.meta.env.X`. Python (`os.getenv`) deferred.
- **Dependency detection scope** — `package.json` (`dependencies`, `devDependencies`, `peerDependencies`). `requirements.txt`, `Pipfile`, `go.mod` deferred.

## IL artifact shape

```ts
export interface ForbiddenArtifactContract {
  category: 'file-glob' | 'env-var' | 'dependency' | 'feature-flag';
  /**
   * Category-specific pattern:
   *   file-glob:    minimatch pattern (`pipeline/**\/st_downloader.py`)
   *   env-var:      env var name (`AUTH_BYPASS`)
   *   dependency:   package name (`openai`, `@openai/sdk`)
   *   feature-flag: feature flag name or env var (`FEATURE_FOO_ENABLED`)
   */
  pattern: string;
  /** Why the spec forbids this — surfaced in drift messages. */
  reason: string;
}
```

## .tc grammar

```
forbidden-artifact servicetitan.downloader-out-of-scope {
  origin "docs/PRDs/signature_detection_prd_v1.md" "Out of Scope" 590..600
  category file-glob
  pattern "pipeline/**/st_downloader.py"
  reason "ServiceTitan invoice download is explicitly out of scope for V1 per PRD §Out of Scope"
}

forbidden-artifact auth-bypass.no-env-var {
  origin "docs/PRDs/backend_PRDv2.md" "Auth" 160..170
  category env-var
  pattern "AUTH_BYPASS"
  reason "Spec forbids any code path that disables JWT validation"
}

forbidden-artifact openai-dep {
  origin "docs/sig_pipeline/ap_automation_review.md" "Tech Stack" 290..310
  category dependency
  pattern "openai"
  reason "Spec mandates Anthropic SDK; the openai package must not be present"
}
```

## Code-side detection

Per-category detector — each is a simple function over the code dir:

| Category | Detection |
|---|---|
| `file-glob` | `fs.readdirSync` walk + minimatch (already vendored in `comparator/minimatch.ts`) |
| `env-var` | tree-sitter walk for `process.env.NAME`, `Deno.env.get('NAME')`, `import.meta.env.NAME` member-expressions |
| `dependency` | parse `package.json`, check `dependencies` / `devDependencies` / `peerDependencies` |
| `feature-flag` | grep for the flag name in config files (json/yaml/ts) + env-var pass |

Detector output:
```ts
export interface ForbiddenMatch {
  filePath: string;
  lineStart?: number;
  lineEnd?: number;
  /** Verbatim slice that matched, for drift display. */
  snippet?: string;
}
```

## Comparator drift kinds

```
forbidden.${category}.${pattern}.present       high (critical for env-var auth bypass)
forbidden.operation.${identity}.out-of-scope-present   critical
```

## Implementation order

1. ✅ Plan (this doc) — task #27
2. IL kind + lifter — task #28
3. Detectors — task #29
4. ForbiddenArtifact comparator — task #30
5. Extend Operation comparator for status=out-of-scope — task #31
6. Orchestrator wiring — task #32
7. LLM prompt — task #33
8. End-to-end on Compliance — task #34

## Out of scope

- Python env-var / dependency detection (deferred to Python verifier expansion)
- Network-side forbids (cron-jobs that should be off, external services) — needs runtime model the engine doesn't have
- "Spec says X is forbidden under condition Y" — conditional forbids; v1 is unconditional only
