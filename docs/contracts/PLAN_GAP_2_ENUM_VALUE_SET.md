# PLAN — Gap 2: Enum value-set comparator

Status: IN PROGRESS (started 2026-05-24, il-framework branch).
Tracking: tasks #20–#26. Fixture set: `docs/contracts/audit-findings-by-engine-gap.json` → `enum-value-set` bucket (15 findings — 4 critical, 11 high).

## Goal

Make the verifier fire when the set of enum values the code uses (or the subset of an enum that triggers downstream behavior) drifts from what the spec asserts.

## Why this is mostly verifier-only

`EnumContract` already exists in the IL: `packages/contract-verifier/src/types/index.ts:222`:
```ts
export interface EnumContract {
  representation: 'string-literal' | 'integer';
  closed: boolean;
  values: string[];
}
```
The parser already lifts `enum X { values [...] }` blocks. The LLM extractor already emits `Enum` fragments. **Nothing reads `values[]` today.** Most of the lift is a new code-side extractor + a new comparator.

## Scope decisions (locked)

- **JS/TS code-side enum forms recognized in v1:**
  - TS string-literal union: `type X = 'a' | 'b' | 'c'`
  - TS enum declaration: `enum X { A = 'a', B = 'b' }`
  - Zod: `z.enum(['a', 'b'])`, `z.union([z.literal('a'), z.literal('b')])`
  - `as const` runtime objects: `const X = { A: 'a', B: 'b' } as const`
  - Runtime sets/arrays with conventional naming: `const VALID_X = new Set(['a', 'b'])`, `const ALLOWED_X = ['a', 'b']`, `const X_VALUES = [...]`
- **Trigger-subset semantics in v1** — the IL adds `triggerSubsets` so the comparator can catch the `is_flagged includes OUTLIER` family of drifts (not just pure value-set diffs).
- **Python:** out of scope (engine is JS/TS-only per gap-1 carryover).

## IL extension

Extend `EnumContract`:
```ts
export interface EnumContract {
  representation: 'string-literal' | 'integer';
  closed: boolean;
  values: string[];
  /**
   * Named subsets of `values` that trigger downstream behavior. For
   * example, a signature classification enum may have a `flagging`
   * subset = ["MISSING", "INVALID", "SUSPECT", "OUTLIER"] — anything
   * in this subset causes `is_flagged = true` downstream.
   *
   * Each subset is independently diffable. v1 verifies these by
   * locating code that computes a boolean from membership in this
   * subset (e.g. `NON_PASS = new Set(["...", "..."])`) and diffing
   * its value list against the spec.
   */
  triggerSubsets?: { name: string; values: string[] }[];
}
```

## .tc grammar extension

```
enum SignatureClassification {
  values [PASS, MISSING, PARTIAL, SUSPECT, OUTLIER]
  trigger-subset flagging [MISSING, PARTIAL, SUSPECT, OUTLIER]
  trigger-subset non-pass  [MISSING, PARTIAL, SUSPECT, OUTLIER]
}
```

## Code-side extractor output

```ts
export interface ExtractedEnum {
  /** Identifier used in code (`SignatureClassification`, `NON_PASS_SET`, …). */
  name: string;
  values: string[];
  /** Source-shape we matched (helps with error messages). */
  shape: 'ts-union' | 'ts-enum' | 'zod-enum' | 'zod-union'
       | 'as-const-object' | 'set-literal' | 'array-literal';
  source: SourceLocation;
}
```

## Comparator drift kinds

```
enum.${enumName}.missing-value.${v}            high
enum.${enumName}.extra-value.${v}              medium
enum.${enumName}.subset.${subsetName}.missing-value.${v}   high
enum.${enumName}.subset.${subsetName}.extra-value.${v}     medium
enum.${enumName}.no-code-counterpart           info
```

## Adapter contract — extractor must scan the WHOLE repo, key by name

Spec-side enum identity uses its `<EnumName>` (e.g. `SignatureClassification`). Code-side extractor produces every enum-shaped artifact in the codebase and the comparator matches by name (case-insensitive, suffix-tolerant — `SignatureClassification` ↔ `signature_classification` ↔ `SIGNATURE_CLASSIFICATION`). When no code-side counterpart exists, comparator emits an `enum.no-code-counterpart` info drift.

For trigger subsets: extractor identifies named code-side sets/arrays whose CONTENT is a subset of an enum's values. Comparator matches subset names (`flagging` ↔ `flagging_set`, `NON_PASS_SET` ↔ `non-pass`).

## Implementation order

1. ✅ This plan — task #20
2. IL extension — task #21 (add `triggerSubsets`, .tc grammar, lifter)
3. Code-side enum extractor — task #22 (the bulk of the work)
4. Comparator — task #23
5. Orchestrator wiring — task #24
6. LLM prompt — task #25
7. End-to-end on Compliance — task #26

## Out of scope (explicit)

- Python enum/Literal extraction (Phase: when verifier gains Python support)
- Numeric enum representation drift (rare in practice; `representation: 'integer'` is preserved but not yet diffed)
- Cross-enum dependency analysis (e.g. "X's values must subset Y's values")
- Inference of enum membership from regex patterns
