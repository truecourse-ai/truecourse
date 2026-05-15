# Verification frameworks — comparison with TrueCourse Contracts

Comparison of TrueCourse's contract framework against two external verification
systems, with concrete recommendations for what is worth borrowing.

---

## TL;DR — what we can learn, in plain English

Both papers and TrueCourse follow the same recipe: *use an LLM to translate
fuzzy English into a structured form, then use a deterministic engine to
check it.* We're already on the right architectural track. The difference
is they're more **paranoid about the LLM step** and more **rigorous about
the check step**.

**Three things they do that we don't:**

### 1. They ask the LLM the same question multiple times and only trust the answer if it agrees with itself

We call the LLM once — to extract claims from docs, to render canonical
spec prose, to extract IL. If it hallucinates a well-shaped answer, we
accept it. The arXiv paper hits >99% reliability by running the same
translation 2–3 times and requiring agreement. We could do the same at
almost no engineering cost; it would just cost more LLM tokens.

### 2. They check whether two things *mean* the same, not whether they *look* the same

Today our spec consolidator decides "are these two claims the same?" by
hashing the JSON. So `{scheme: "jwt"}` and `{auth_method: "JWT"}` count as
a conflict the user has to resolve — even though they agree. Same problem
in the verifier: an authorization predicate like
`loaded.ownerId !== req.auth.userId` doesn't match
`req.auth.userId === loaded.ownerId` because we string-compare. Adding a
"do these mean the same thing?" step — either a small LLM call or a
normalized predicate form — would remove a lot of noise without weakening
anything.

### 3. When they say "this is wrong", they also tell you *why* and *what to do*

AWS's system returns the specific rule that was violated and lets the
chatbot rewrite its answer using that feedback until it passes. Our drift
report says "expected X, got Y" but doesn't include a **concrete
counterexample** (the exact input that breaks the contract) or a
**suggested fix**. Adding both would make drifts self-explanatory and let
us close the loop with a "fix-it" Claude skill — you run
`truecourse verify`, it finds drift, a subagent proposes the patch.

**What we shouldn't copy:** Their SMT/theorem-prover machinery. Our
problem is harder than theirs — we're checking *real code* (Express
middleware, factories, dynamic mounts), not propositional statements. Full
formal verification of that surface would explode in scope. We should use
logic *selectively* — for things like authorization predicates and formula
thresholds where it pays off — and keep the structural AST comparators
for everything else.

**Three small additions, in order of impact:**

1. Run LLM extractions 2–3× and require agreement.
2. Add a "do these claims mean the same thing?" check in the merger.
3. Put counterexamples and fix suggestions in every drift.

Everything else is gravy. The detailed technical version follows below.

---

**Sources reviewed**

- AWS Bedrock Automated Reasoning checks — [aws.amazon.com/blogs/machine-learning/how-automated-reasoning-checks-in-amazon-bedrock-transform-generative-ai-compliance](https://aws.amazon.com/blogs/machine-learning/how-automated-reasoning-checks-in-amazon-bedrock-transform-generative-ai-compliance/)
- "Neurosymbolic Verification" — [arxiv.org/abs/2511.09008](https://arxiv.org/abs/2511.09008)
- TrueCourse contract framework — `docs/contracts/PLAN.md`,
  `packages/spec-consolidator/` (Module 1),
  `packages/contract-extractor/` (Module 2),
  `packages/contract-verifier/` (Module 3)

---

## What each one actually does

| | **AWS Bedrock Automated Reasoning** | **arXiv 2511.09008 (Neurosymbolic Verification)** | **TrueCourse Contracts** |
|---|---|---|---|
| Input | Natural-language policy (e.g. ST4S, insurance rules) + an LLM-generated answer | NL policy + NL statement to verify against it | Repo docs (PRD/ADR/RFC/README) + the source tree |
| Verifies | *"Does this LLM answer satisfy the encoded policy?"* | *"Is this NL claim logically valid w.r.t. the policy?"* | *"Does the code drift from the documented contract?"* |
| Formalism | SMT/SAT-encoded rules | LLM auto-formalises NL → logic, formal solver checks | Custom block-DSL `.tc` IL + structural comparators over tree-sitter AST |
| Solver | SMT/SAT (mathematical proof) | Symbolic solver after autoformalization | None — string/regex/AST comparison; conservative (FN-tolerant, FP-free) |
| LLM role | Encode policy once (human-supervised); translate output into propositions at runtime | Two-stage: formalize + (for critical apps) **N-way redundant formalization + semantic-equivalence cross-check** | One-shot extraction of `.tc` fragments per spec slice; Zod + parse + resolve gate only |
| Guarantee claim | Soundness inside the encoded policy; per-rule counterexamples | >99% soundness, near-zero FP on logical validity | 0% FP on planted-bug fixture; FN tolerated by design |
| Audit artifact | Per-rule proof / violation list | "Auditable logical artifacts" that justify the verdict | `.tc` files + `.truecourse/verify/LATEST.json` drift report |

## The two systems aren't doing the same job as TrueCourse

AWS and the arXiv paper are **runtime guardrails on LLM answers** — they sit
between an LLM and an end-user and check each output against a policy.
TrueCourse is a **build-time / CI drift detector** — it checks that *code*
still matches *docs*. The closest equivalence: AWS encodes a policy → answers
must satisfy it; TrueCourse encodes a spec (as IL) → code must satisfy it.
Same shape, different substrate (logical propositions vs. AST patterns).

## Same architectural skeleton

All three follow the neurosymbolic recipe:

```
NL artifact ── LLM ──▶ formal/structured representation ──▶ symbolic check ──▶ verdict + evidence
```

In all three, the LLM's job is **only the translation step**, and the verdict
comes from a deterministic engine. TrueCourse already does this; the
difference is the strength of the symbolic side.

## Where TrueCourse already does something similar

Worth crediting before borrowing:

- **Two-detector redundancy on version chains.** `version-chain.ts` runs a
  deterministic filename-heuristic detector and `version-chain-llm.ts` runs
  an LLM-augmented detector in parallel; results merge with deterministic
  wins on overlap (`orchestrator.ts:137-144`). This is the closest thing to
  redundant formalisation in the codebase today — narrowly scoped, but the
  right shape.
- **Partial structural semantics in the merger.** Beyond exact-fingerprint
  auto-merge, the merger attempts **superset folding** (`merger.ts:304-333`)
  and **constraint-into-definition folding** (`merger.ts:388-424`) so a
  richer claim absorbs a thinner one without going through a user conflict.
  Not semantic equivalence, but more than pure string-match.
- **Origin trails.** Claims keep `provenance` (file + line + quote) and
  `additionalSources` from cross-doc merges (`merger.ts:248-252`,
  `types.ts:97-105`); `module.yaml` carries `sourceDocs`. That's the
  TrueCourse equivalent of AWS's audit-ready evidence — already shipped.

## Where they're materially stronger than TrueCourse — and what's worth borrowing

### 1. Redundant formalization with semantic-equivalence cross-check (arXiv's core trick)

The arXiv paper hits >99% soundness by formalising the same input multiple
times and only accepting if the formalisations are semantically equivalent.
TrueCourse runs **one** Claude call at three different points and only
validates structure — never agreement:

- **Module 1 block extraction** (`spec-consolidator/src/extractor.ts` +
  `prompt.ts:50-54`) — one call per block, output Zod-validated by
  `cache.ts:73-99`. A hallucinated-but-well-shaped `Claim` is accepted as
  truth.
- **Module 1 section materialisation** (`materializer.ts:115-116`) — one
  call to render prose from resolved claims. No cross-check that the
  rendered markdown actually reflects the claims it was given.
- **Module 2 IL extraction** (`contract-extractor/src/validator.ts:43-109`)
  — one call per slice; only parse + resolve + Zod gate.

Cheap win, applied at all three boundaries: run the LLM N=2–3 times and
require artifact-level equivalence (identity + key-fields hash) before
accepting. Costs scale linearly under `TRUECOURSE_MAX_CONCURRENCY`. The
Module 1 boundary is arguably the bigger win — every downstream artifact
(IL, drift report) depends on the claims being right.

### 2. Semantic-equivalence merging in the spec consolidator

The Module 1 merger groups claims by **string-keyed `(topic, subject)`**
(`merger.ts:79-82`) and decides "same claim" by **SHA-256 of the claim JSON
+ status** (`merger.ts:217-223`). Superset and constraint-folding catch
some near-duplicates structurally, but two claims that *express the same
constraint in different shapes* — e.g. `{scheme: "jwt"}` from one PRD vs
`{auth_method: "JWT"}` from another — will hash differently and surface as
a user-facing conflict, even though they agree.

This is exactly where arXiv's autoformalize-and-compare pattern would
apply: at merge time, when two candidate claims have the same
`(topic, subject)` but different fingerprints, run a *semantic-equivalence
check* (small LLM call: "are these two claims expressing the same rule?
yes/no + canonical form"). If equivalent, auto-merge with the LLM's
canonical form; if not, surface as a conflict as today. Reduces
review-surface noise without weakening the user-resolution surface for
genuine disagreements.

Because the merge step already produces structured `Conflict` objects
(`types.ts:197-211`), the integration point is well-isolated.

### 3. SMT/logic for the predicates that today are opaque strings

TrueCourse's `AuthorizationRule` predicates and `Formula` thresholds are
stored as strings the comparator literally matches
(`packages/contract-verifier/src/comparator/authorization-rule.ts:31-74`,
`comparator/formula.ts:45-100`). That's why a refactor like
`if (loaded.ownerId !== req.auth.userId) throw` vs
`if (req.auth.userId === loaded.ownerId) {}` can drift apart in the
comparator's eyes despite being equivalent.

The smallest useful upgrade is a tiny **predicate language** (Datalog-ish or
SMT-LIB-lite) with named vars and equality/inequality, normalized at
IL-extraction time. Then the comparator proves predicate equivalence rather
than string-matching. Same applies to `Formula`: SMT can prove `>=` and
`> – 1` are equivalent over integers under stated domain constraints.

### 4. Model-checking state machines instead of pattern-matching them

The `StateMachine` comparator (`comparator/state-machine.ts:37-80`) walks the
AST for `Record<State, State[]>` literals and looks for guarded assignments.
A model-checker over the lifted transition relation could prove "no path from
non-terminal to terminal without guard X" — catches refactors that route the
same transition through a helper function, which the current AST walk misses.

### 5. Counterexamples in every drift

AWS returns *which rule was violated and why*; the arXiv paper returns
auditable artifacts. TrueCourse drifts carry `expected/observed/source`
(good) but no concrete *counterexample* — e.g. for a `Formula` off-by-one
drift, the input value that produces divergent output; for an
`AuthorizationRule` drift, the request shape that bypasses the check.
Counterexamples make drifts self-explanatory and let CI fail with
reproduction inputs.

### 6. Iterative LLM-rewrite loop (AWS's chatbot example)

AWS lets the chatbot use the verifier's feedback to rewrite its answer until
provably correct. TrueCourse's analogue: when `truecourse verify` finds
drift, feed the drift back into a "fix" Claude Code skill that proposes a
code-side patch *or* a spec amendment. Closes the loop `PLAN.md` already
sketches but doesn't yet automate.

### 7. Negative-spec is a TrueCourse strength to keep highlighting

`out-of-scope.implemented` (`PLAN.md:524`) is exactly the kind of
bidirectional check AWS markets — "you shipped something that's not
allowed." Worth treating as a headline capability rather than a footnote;
neither AWS's blog nor the arXiv paper emphasizes the *anti-spec* direction.

## What *not* to copy

- **Don't fully formalize end-to-end.** The arXiv >99% number is on
  propositional NL validity. The hard problem in TrueCourse isn't formalising
  the *spec* — it's formalising the *code*. Express middleware, decorators,
  factory-built handlers, dynamic mounts: SMT-encoding all of that is a far
  larger surface than the current tree-sitter comparator suite. Layer SMT
  only where it pays (predicates, formulas, state-machine reachability), not
  as a wholesale replacement.
- **Don't take "soundness" at face value.** Both AWS and the arXiv paper
  define soundness *within their encoded policy*. The encoding step is still
  LLM-mediated and human-reviewed. TrueCourse's `decisions.json` + Spec tab
  is the same review surface — keep it.

## Suggested concrete next steps (small, ordered)

1. **N-way LLM agreement at the Module 1 extractor** in
   `packages/spec-consolidator/src/extractor.ts` — biggest reliability win
   because every downstream artifact depends on claims being right.
2. **Semantic-equivalence step in the merger** — when two candidates share
   `(topic, subject)` but disagree by fingerprint, ask the LLM whether
   they're the same rule before surfacing as a user conflict
   (`packages/spec-consolidator/src/merger.ts` integration point).
3. **N-way IL extraction with equivalence gate** in
   `packages/contract-extractor/` — same pattern as 1, applied to Module 2.
4. **Predicate normalization** for `AuthorizationRule` / `Formula` at lift
   time (no full SMT yet — just canonical AST of the predicate so
   comparators do semantic match, not string match).
5. **Counterexample field on `ContractDrift`** in
   `packages/contract-verifier/src/types/index.ts`, populated by each
   comparator with the input that exhibits the drift.
6. **Drift → fix-suggestion skill** (Claude Code subagent) that reads
   `.truecourse/verify/LATEST.json` and proposes a patch — mirrors AWS's
   iterative-rewrite UX.
7. Defer full SMT/model-checking until 1–6 ship; revisit once predicates
   are normalised and the cost/benefit is visible.

Nothing in the two articles invalidates the TrueCourse design — they
validate the neurosymbolic shape and point at where the symbolic side can
be tightened. The highest-leverage gap is at Module 1: the consolidator
already exposes the right artifacts (claims, conflicts, decisions) for an
arXiv-style semantic-equivalence layer to drop in without re-architecting
the pipeline.
