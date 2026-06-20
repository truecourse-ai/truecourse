# C# Plan — Outperform Sonar (Roslyn semantic engine)

> Goal, stated bluntly: **TrueCourse C# must equal-or-exceed SonarC# on coverage
> AND correctness, then add what Sonar can't do (decisions/contracts/drift +
> LLM).** Optimize for best-in-class, not for any current constraint. The
> build-free / tree-sitter-only property is *not* sacred; it becomes a fallback,
> not the ceiling.

## Clean-room / competitive boundary (read first)

Sonar is a **competitor**. This plan is clean-room and symmetric with how we
already treat JS/TS and Python:

- We **never run, bundle, or depend on** SonarAnalyzer.CSharp (or any Sonar code)
  in the product. Same for any non-permissive analyzer.
- We **copy rules (coverage), never logic.** We reimplement detections as our own
  analyzers — our own rule keys, our own names, our own wording. Exactly what
  `ALL-RULES.md` already does: `Our Key` / `Name` / `Description` are ours; the
  upstream id lives only in the **`Source ID`** column for sync bookkeeping.
- We do **not** copy upstream rule descriptions or identifiers verbatim. The
  harvested rule catalogs (Sonar, Roslyn CA, StyleCop, Roslynator) are **coverage
  checklists only** — they tell us *which defects exist to catch*, nothing more.
- We do **not** run Microsoft CA / StyleCop / Roslynator either. We reimplement
  their rule sets as our own analyzers, the same way we reimplemented ESLint /
  SonarJS / Ruff / SonarPython as our own visitors (we never ran those tools).

Roslyn is used **only as a semantic-information provider** (types, symbols,
dataflow) — the same role `ts-compiler.ts` plays for JS/TS and Pyright plays for
Python. It is an information source for *our* analyzers, not a diagnostic engine
we surface.

## The strategic reframe

Reproducing a semantic compiler with a syntax tree is a race we lose forever — we
will always lag Sonar on dataflow/nullability and re-introduce false positives
they already fixed. The fix is not to run their analyzer; it's to **author our own
analyzers on the same class of semantic model they use**:

> Use Roslyn for the semantic model → author our own analyzers that consult it →
> drive coverage from the rule *catalogs* of the whole C# linter ecosystem
> (tracked as checklists in `truecourse-rules-sync`) → layer
> **contracts/decisions/drift + LLM** on the typed model (the moat Sonar has no
> answer for). Our own keys, our own logic, throughout.

Coverage identity we're building (all implemented by **us**):

```
TrueCourse-C#  =  our analyzers covering { Roslyn CA ∪ StyleCop ∪ Roslynator ∪ Sonar } rule sets
               ∪  our domain analyzers   (architecture/db/reliability/contract-aware)
               ∪  TrueCourse contract/decision/drift/verify/infer layer
               ∪  LLM enrichment of the typed model
   ⊇  SonarC#  +  things Sonar cannot do
```

## Architecture

A **.NET Roslyn semantic host** — a small .NET worker process spawned by the Node
analyzer over stdio/IPC, exactly the pattern we already use for Pyright (Python).

- Loads the real `.sln`/`.csproj` via **MSBuildWorkspace** (full fidelity:
  references, generated code, nullable context).
- Exposes a **semantic query API** (types, symbols, references, type hierarchy,
  dataflow) that **our own analyzers** call — the C# equivalent of
  `ts-compiler.ts`'s `TypeQueryService` and the Pyright LSP. It does **not** run
  third-party analyzer packs.
- Registered in `lsp-servers/registry.ts` at the existing `csharp:` slot (already
  stubbed: `// csharp: createOmniSharpConfig`). We use a **Roslyn-based host**,
  not classic OmniSharp (archived).

**Tiering (preserves a zero-setup path, doesn't cap the flagship):**

| Tier | Engine | When | Coverage |
|---|---|---|---|
| Flagship | Roslyn host (SDK present) | CI / PR-gate / hosted / local-with-SDK | full — superset of Sonar |
| Fallback | existing tree-sitter visitors | no .NET SDK, quick local pass | syntactic subset only |

The 308 tree-sitter C# visitors are **kept** as the SDK-free fallback and as the
behavioral basis for the domain analyzers we re-home onto Roslyn.

## Phases

### Phase 0 — Benchmark harness (define "win" before building)
A corpus of real, diverse C# repos (OSS apps, libraries, ASP.NET services). Run
**SonarC# (Sonar way)** and current TrueCourse head-to-head; record per-rule
coverage and TP/FP. This is the baseline we must beat and the regression gate for
every later phase. (Direct application of our battle-test / zero-FP cycle.) Sonar
is run here **only as an external benchmark to measure against** — its output
never enters our product.

### Phase 1 — Roslyn semantic host (the foundation)
The .NET worker + IPC protocol + MSBuildWorkspace load + semantic query API.
Node-side `csharp` provider in the registry. Tree-sitter path becomes the
documented fallback. Deliverable: "given a solution, answer type/symbol/dataflow
queries for our analyzers."

### Phase 2 — Catalog the gap, drive from `truecourse-rules-sync`
Add the C# linter catalogs as **checklist sources** in the sync repo (sonar-csharp,
roslyn-ca, later stylecop/roslynator). Diff against our existing 308 C# rules to
produce the net-new coverage list, each assigned **our own** key. No upstream code
or text enters the repo — only the coverage delta + Source-ID bookkeeping.

### Phase 3 — Our analyzers (where we match and exceed)
Author **our own Roslyn analyzers** for the net-new coverage and re-home our
domain rules (architecture/database/reliability/contract-aware) onto the semantic
model — far higher recall than the tree-sitter ports. Fixture-first, zero-FP cycle
against the Phase 0 corpus. Detection logic, identifiers, and wording are entirely
ours.

### Phase 4 — The moat (what Sonar cannot do)
Feed the typed model into the TrueCourse layer:
- **Contracts/decisions/verify/infer/drift for C#** become type-accurate (today
  they're tree-sitter approximations) — occurrence-level drift, contract
  extraction, the PR-gate contract semantics.
- **LLM enrichment** of findings over the typed model — catch the
  statically-undecidable defects Sonar structurally can't, and explain/triage
  findings. Sonar has no equivalent.

### Phase 5 — Prove it
Re-run Phase 0. Ship gate: **coverage ≥ Sonar AND false-positive rate ≤ Sonar**
across the corpus, per domain. Publish the head-to-head (doubles as landing-page
OSS analysis material).

## Decisions needed (my recommendations inline)

1. **Build requirement.** Flagship = Roslyn (needs .NET SDK + restore); keep
   tree-sitter as the no-SDK fallback. *Recommend: yes — flagship Roslyn, fallback
   tree-sitter.* This is the only way to reach the type-dependent 323; CI and the
   PR-gate already have an SDK.
2. **Confirm clean-room sourcing** (above) is the bar: catalogs as checklists,
   our own analyzers/keys/wording, no third-party analyzer ever run or bundled.
   *Recommend: yes — it's already our JS/Python practice.*

## Risks / cross-cutting

- **Distribution**: shipping a .NET host beside a Node CLI — package a
  self-contained .NET binary per-platform, or require the SDK. Needs a story.
- **Performance**: solution load is seconds–minutes; cache the Compilation,
  analyze PR diffs incrementally.
- **Double-maintenance**: don't maintain 300+ rules in two engines forever —
  Roslyn analyzers become the long-term home for C# deterministic rules;
  tree-sitter C# narrows to fallback + shared cross-language structural extraction.

## Why this beats Sonar (not ties)

1. Same class of semantic engine → our analyzers match their dataflow/type rules
   instead of forever chasing them in a syntax tree.
2. We reimplement the union of the whole ecosystem's rule *coverage* (CA ∪
   StyleCop ∪ Roslynator ∪ Sonar) as our own analyzers → more deterministic
   coverage than any single tool.
3. Our analyzers tuned on our corpus with a zero-FP gate → fewer false positives.
4. The contract/decision/drift/verify layer + LLM → an entire dimension Sonar has
   no product for. **Sonar finds issues; we find issues *and* track the decisions,
   contracts, and drift behind them, with compiler-grade fidelity.**
