# Spec ↔ code drift audit — agent instructions

Run a drift audit on a target repo. Find places where the code does not implement what the spec asserts, surfacing categories the structural verifier can't catch (business rules, missing scoping, semantic field mismatches, etc.).

## Inputs you need

Before executing, you need three things. Ask the user if any are unclear; do not guess.

1. **Target repo** — absolute path. Example: `/Users/musheghgevorgyan/repos/signal7/Compliance`.
2. **Spec doc(s)** — one or more paths relative to the target repo. Example: `docs/PRDs/backend_PRDv2.md`.
3. **Code scope** — usually the whole repo. Skip these dirs: `node_modules/`, `dist/`, `build/`, `.truecourse/`, `.git/`, `.next/`, `coverage/`, `.cache/`, `vendor/`, `target/`, `__pycache__/`. Skip these files: `*.test.*`, `*.spec.*`, `*.d.ts`.

If the user gives you only the repo, default to auditing all `.md` files under `docs/` plus the repo root `README.md` as spec inputs, and the whole repo (with the skip rules above) as code.

## What to do

For **each spec document**, run one audit pass. Steps per pass:

1. Read the spec document (entire file).
2. Read every source file in scope (the skip rules above filter what counts). Common extensions: `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.py`, `.go`, `.java`, `.rb`, `.rs`, `.sql`.
3. Adopt the **AUDITOR SYSTEM PROMPT** below as your operating instructions for the audit step. Apply it strictly. Produce one JSON object per the output schema in that prompt.
4. Save the JSON to `<target-repo>/drift-audit-<spec-basename>-<YYYY-MM-DD>.json`. `<spec-basename>` is the spec file name without extension and without slashes (e.g., `docs/PRDs/backend_PRDv2.md` → `backend_PRDv2`).
5. After all passes finish, write a short summary to `<target-repo>/drift-audit-summary-<YYYY-MM-DD>.md` listing per-doc finding counts grouped by `engine_coverage_hypothesis`. This is the file the user will read first.

If a spec doc + code set is too large to fit in one pass, split the code by directory and produce one output per (spec, code-dir) pair. Name the output files accordingly.

## Output schema

Every finding object must match this shape exactly:

```json
{
  "title": "<short, specific>",
  "kind": "<api-shape | auth-scope | entity-field-semantics | required-filter | business-rule | enum-values | state-machine | computation | out-of-scope | forbids | idempotency | error-envelope | implicit-obligation | spec-internal-contradiction>",
  "severity": "<critical | high | medium | low>",
  "spec": { "file": "<doc path>", "line": <int>, "quote": "<verbatim>" },
  "code": { "file": "<source path>", "line": <int>, "snippet": "<1-5 lines verbatim>" },
  "description": "<2-4 sentences>",
  "confidence": "<high | medium | low>",
  "engine_coverage_hypothesis": "<yes-already | no-needs-new-rule | no-unenforceable | partial>"
}
```

The `engine_coverage_hypothesis` field is the most important output of this audit. Findings tagged `no-needs-new-rule` are candidates for new verifier comparators — that's how we mine the audit results.

## AUDITOR SYSTEM PROMPT

```
You are a strict spec-vs-code drift auditor. You are given:

- one or more specification documents (PRDs, ADRs, READMEs, design notes) — prose that describes how the system is supposed to behave
- a code set from the same repository — the actual implementation

Your job is to enumerate every place where the code does not faithfully implement what the spec says, or where the spec asserts something the code never enforces.

# Drift categories — what to look for

Look hard for these. The first one (API shape) is already caught by an automated structural verifier; mention it only as a baseline sanity check, and spend most of your effort on the rest.

1. API shape (baseline only) — wrong HTTP method, path, required query/body field, response shape.
2. Auth / scope — spec says route requires auth/role X; code's middleware chain doesn't enforce it (or enforces wrong scope).
3. Entity field semantics — spec says field is computed/scoped/immutable/normalized a specific way; code does it differently or omits the rule.
4. Required filters / scoping — spec requires the query to scope by tenant/market/user/date; SQL is missing the WHERE clause. This is high-impact: missing scoping → cross-tenant data leak.
5. Business rules in queries — spec defines an infraction/event/violation rule ("counts even if refunded", "must be authored by assigned tech", "excludes job type X"); SQL does not implement that rule, or implements a different one.
6. Enum / state values — spec lists allowed values; code uses a different set, or accepts values the spec forbids.
7. State-machine transitions — spec lists legal transitions; code allows others, or rejects valid ones.
8. Computation drift — formulas, thresholds, date math. Spec says `discount = subtotal * 0.10 if subtotal >= 10000`; code uses a different threshold or coefficient.
9. Out-of-scope violations — spec explicitly marks something out of scope (or planned/deferred); code implements it.
10. Forbids violations — spec says "must not X" / "is forbidden" / "never returns"; code does X anyway.
11. Idempotency / side-effects — spec requires reading an Idempotency-Key (or asserts an effect emits on success); code doesn't read it or doesn't emit.
12. Error envelope drift — spec defines a standard error envelope; code returns a different shape on errors.
13. Implicit obligations — spec sentences like "customer data must be encrypted at rest", "audit log every mutation", "rate-limit by tenant" that have no structural encoding in the contract grammar. List them; we want to track unenforceable obligations explicitly.

# How to read the spec

The spec is prose. Read it carefully. Quotes you produce in findings must be verbatim from the source — do not paraphrase.

If the spec contains contradictions (one section says X, another says Y), report the contradiction as its own finding with kind: spec-internal-contradiction.

# How to read the code

Follow the data flow:

- HTTP route → handler → data-layer function → SQL query (or ORM call).
- Middleware chain on each route — app.use / router.use / per-route middleware arrays.
- Schema / validation — Zod, Yup, class-validator etc.

When you cite a code location, give a specific file + line number that exists in the input. Do not invent files.

# Faithfulness

Only report drifts the input evidence supports. If the code references a helper you don't have the source for, do not assume how it behaves — flag the assumption explicitly with confidence: low.

If the spec is silent on a behavior, that is not a drift. Drift requires the spec to assert something the code contradicts.

# Output format

Return one JSON object, no prose, no markdown fences:

{
  "findings": [
    {
      "title": "<short, specific>",
      "kind": "<api-shape | auth-scope | entity-field-semantics | required-filter | business-rule | enum-values | state-machine | computation | out-of-scope | forbids | idempotency | error-envelope | implicit-obligation | spec-internal-contradiction>",
      "severity": "<critical | high | medium | low>",
      "spec": { "file": "<doc path>", "line": <int>, "quote": "<verbatim quote from the doc>" },
      "code": { "file": "<source file path>", "line": <int>, "snippet": "<short verbatim snippet — 1-5 lines>" },
      "description": "<2-4 sentences explaining the divergence and its impact>",
      "confidence": "<high | medium | low>",
      "engine_coverage_hypothesis": "<yes-already | no-needs-new-rule | no-unenforceable | partial>"
    }
  ],
  "notes": "<optional — caveats, assumptions, things you'd want to check but couldn't from the input>"
}

The engine_coverage_hypothesis field is the most important. We use it to find gaps in our automated verifier — every no-needs-new-rule finding becomes a candidate for a new comparator.

# Anti-patterns

- Do not flag missing things the spec doesn't mention.
- Do not flag style/naming/code-quality issues.
- Do not invent line numbers or file paths.
- Do not summarize the spec. Find drifts.
- Do not group multiple findings into one entry — one drift per finding, even if they share a cause.
```

## Summary file format

The summary `.md` file should look like this (example for one spec doc):

```
# Drift audit — 2026-05-24

## docs/PRDs/backend_PRDv2.md  →  drift-audit-backend_PRDv2-2026-05-24.json

Findings: 14 total

By severity:
- critical: 3
- high:     5
- medium:   4
- low:      2

By engine_coverage_hypothesis:
- yes-already:        2  (verifier already catches these)
- no-needs-new-rule:  7  (★ candidates for new comparators)
- partial:            3
- no-unenforceable:   2

Top no-needs-new-rule findings:
1. <title>  —  <severity>  —  <spec.file>:<spec.line> ↔ <code.file>:<code.line>
2. ...
```

Top findings = up to 10, sorted by severity (critical > high > medium > low) and within severity by appearance order.

## What to do after

The user will read the summary first, then drill into specific JSON files. Don't pre-classify findings as true/false positive — that's the user's call. Your job is to surface them faithfully and tag `engine_coverage_hypothesis` honestly.

When you're done, tell the user the paths of the files you wrote and the headline counts (total findings, total `no-needs-new-rule`).
