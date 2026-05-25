# PLAN — Gap 4: NamedConstant comparator

Status: IN PROGRESS (started 2026-05-24, il-framework branch).
Tracking: tasks #36–#42. Fixture set: `docs/contracts/audit-findings-by-engine-gap.json` → `named-constant` bucket (11 findings — 4 critical, 7 high).

## Goal

Catch drift in named constants and literal values the spec asserts. Examples from the audit:

- spec says `TIER_WEIGHTS = {Critical:3, Significant:2, Noticeable:1, ...}`, code has `{Critical:16, Significant:8, ...}`
- spec says `LLM_MODEL = "claude-sonnet-4-6"`, code has `"google/gemini-3-flash-preview"`
- spec says `_CROP_Y_ABOVE = 12`, code has `80`
- spec says env-var is `ANTHROPIC_API_KEY`, code reads `OPENROUTER_API_KEY`

## Scope decisions (locked)

- **Broad constant detection** (JS/TS):
  - top-level `const`/`let` with literal initializer (`const MODEL = 'claude-...'`)
  - object/dict property values (`const cfg = { model: 'claude-...' }`)
  - default function parameter values (`function f(model = 'claude-...')`)
- **Identifier-name primary matching** with loose case-normalization (`TIER_WEIGHTS` ↔ `tierWeights` ↔ `tier_weights`).
- **No file-path matching** — repos restructure.
- **No role-based matching** — too vague; relies on LLM guessing semantic intent.
- **Python out of scope** (engine is JS/TS-only).

## IL artifact shape

```ts
export interface NamedConstantContract {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  /**
   * For primitives: the literal value (string | number | boolean).
   * For object: { [key: string]: primitive-or-object }
   * For array: primitive[]
   * Stored as `unknown` so comparator can deep-equal across kinds.
   */
  expectedValue: unknown;
}
```

## .tc grammar sketch

```
constant LLM_MODEL {
  origin SPEC.md "Tech Stack" 100..110
  type string
  expected-value "claude-sonnet-4-6"
}

constant TIER_WEIGHTS {
  origin SPEC.md "Scoring" 60..80
  type object
  expected-value {
    Critical: 3
    Significant: 2
    Noticeable: 1
    Moderate: 1
    Minor: 1
    "Out of Tech Control": 0.5
  }
}

constant MAX_RETRY {
  origin SPEC.md "Config" 50..50
  type number
  expected-value 5
}
```

## Code-side extractor output

```ts
export interface ExtractedConstant {
  name: string;
  value: unknown;
  /** What shape we matched, for debugging. */
  shape: 'const-literal' | 'object-property' | 'default-arg';
  source: SourceLocation;
}
```

Where the extractor is found:
- `const TIER_WEIGHTS = { ... }` → `shape: 'const-literal'`, name = `TIER_WEIGHTS`
- `const cfg = { model: 'claude-...' }` → emits `shape: 'object-property'`, name = `model`, value = `'claude-...'`
- `function f(model = 'claude-...')` → `shape: 'default-arg'`, name = `model`

For the object-property case: the extractor produces ONE record per property, keyed by the property name. That way `cfg.model` is matchable by a spec rule named `model`.

## Comparator drift kinds

```
constant.${name}.value-mismatch       high (critical for tier weights / model IDs in the prompt)
constant.${name}.no-code-counterpart  info
```

## Adapter contract

- Code-side extractor scans whole code dir once at start of `verify`.
- Constants are deduped by `(name, value)` to handle the same constant declared multiple places.
- Comparator matches by name with normalization: drop non-alphanumerics, lowercase. So `TIER_WEIGHTS` ↔ `tierWeights` ↔ `tier-weights` ↔ `tier_weights` all match.
- Deep-equal value comparison for objects/arrays.

## Implementation order

1. ✅ This plan — task #36
2. IL kind + lifter — task #37
3. Code-side extractor — task #38
4. Comparator — task #39
5. Orchestrator wiring — task #40
6. LLM prompt — task #41
7. End-to-end on Compliance — task #42

## Out of scope

- Python constants
- Environment-variable defaults (already partially covered by ForbiddenArtifact env-var category — gap 3)
- Constants whose value is a function/expression rather than a literal (`const X = computeX()`) — unparseable for v1
- Cross-file constant dependency tracking
