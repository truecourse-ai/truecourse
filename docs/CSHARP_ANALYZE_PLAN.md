# C# Support for `analyze` — Implementation Plan

> **STATUS: PLANNED.** Companion to `CSHARP_SUPPORT_PLAN.md` (verify). Both ship together
> on this branch — C# verify does not merge without C# analyze.
>
> File:line references are as-of-research pointers and may drift; treat the file and the
> named symbol as authoritative, not the exact line.

## 1. Goal & scope

Make `truecourse analyze` treat **C#** (ASP.NET Core, EF Core, Dapper) as a first-class
language at parity with TypeScript/JavaScript and Python: full graph (services, modules,
dependencies, layers, databases, routes, flows) plus the deterministic + LLM rule engine.
Python is the template — it was the last language added and `packages/analyzer/ADDING_A_LANGUAGE.md`
documents the seams.

A prior draft exists: commit `34c096d5` on branch `feature/csharp-fixture` (extractor,
namespace resolver, routes, service detector, fixture). It predates the per-domain rules
restructure and is **reference material, not a rebase target** — port files forward
individually. Its resolver is explicitly superseded by §3.

## 2. Decision: no language server, no Roslyn sidecar

Verified facts driving this decision:

1. **The LSP layer's only production job is correcting `isExported` flags.**
   `packages/core/src/services/analyzer.service.ts` consumes only `exportMap` from both the
   TS compiler and LSP paths. `interfaceImplementations` is computed but never consumed
   (TODO markers in `lsp-client.ts` / `ts-compiler.ts`). The dependency graph is built by
   per-language resolvers, never by LSP.
2. **C# declares visibility in syntax** (`public` / `internal` keywords) — tree-sitter
   export detection is exact, not heuristic. The one job an LSP performs (Pyright fixing
   Python's convention-based exports) has no C# equivalent.
3. **C#'s hard dependency-graph problem is invisible to the LSP integration model.**
   Same-namespace cross-file references require no `using` directive, so they never appear
   at the import positions where `LspClient` asks definition questions.
4. **LSP cannot serve rule type-queries.** The protocol has no "type of expression" request
   (hover returns human-readable markdown). The TS rules that need types use the in-process
   TS Compiler `TypeChecker`. The C# equivalent would be an embedded Roslyn sidecar
   requiring the .NET SDK + MSBuild solution load + completed NuGet restore — which breaks
   clone-and-analyze, slows runs by minutes, and breaks the fp-automation cloud loop.

**Consequence:** the semantic layer for C# is a tree-sitter **symbol index** (§3). The
cost is 7 rules unsupported + 7 rules partial out of the full catalog (§5); everything
else reaches full parity. A Roslyn sidecar is an explicit non-goal; revisit only if
type-checker-grade rules become a product requirement.

## 3. The C# symbol index

New module: `packages/analyzer/src/symbol-index/` (language-agnostic core + C# provider —
the same design serves future namespace-import languages like Java or PHP).

**Pass 1 — declaration index.** For every parsed `.cs` file, record each type declaration:
name, kind (`class` / `interface` / `struct` / `enum` / `record`), full namespace
(file-scoped `namespace X.Y;` and block forms, including nesting), visibility, file path,
base list, and for enums their members.

**Pass 2 — reference resolution.** Per file, compute the **visible namespace set**:

- the file's own namespace **and every ancestor namespace** (C# resolves unqualified names
  up the namespace chain — this is how same-namespace/parent-namespace references work
  with zero `using` directives),
- `using` directives, `using static`, and `using X = Y.Z;` aliases,
- `global using` directives from any file in the same project,
- implicit usings when the `.csproj` has `<ImplicitUsings>enable</ImplicitUsings>`
  (the SDK-defined set for the project's SDK type).

Then resolve type references (object creation, base lists, parameter/return/field/property
types, attribute names, static member access, fully-qualified names) against the index,
filtered through visibility. Ambiguous matches (same type name in two visible namespaces)
resolve to none and are counted — surfaced in the analyze log, never guessed.

**What the index feeds:**

| Consumer | How |
|---|---|
| Dependency graph | file→file edges from resolved references — **including same-namespace edges the draft resolver missed**. `ProjectReference` entries in `.csproj` scope cross-project resolution. |
| Interface → implementations | base-list entries whose index kind is `interface`, **plus DI registrations** (`AddScoped/AddSingleton/AddTransient<IFoo, Foo>()`) as exact bindings — constructor-injected interfaces are the dominant ASP.NET call pattern, so this is what makes flow tracing work. |
| Exports | visibility keywords straight from syntax (index pass 1 already has them). |
| Index-backed rules (§5) | declared return types (un-awaited `Task` detection), enum member sets (`switch-exhaustiveness`), repo-local type hierarchies (`unsafe-type-assertion`). |

Integration point: the resolver registry's per-import signature does not fit pass 2
(edges don't come from import statements). Extend `dependency-graph.ts` with a
per-language **edge contributor** seam — a language may contribute resolved file-level
edges directly; JS/TS/Python paths are untouched.

- [ ] `symbol-index/` core: declaration index + visible-namespace computation + reference resolver
- [ ] `.csproj` reader: `ProjectReference`, `ImplicitUsings`, SDK type (reuse/adapt verify's `extractor/manifests.ts` logic — analyzer-side copy, packages stay independent)
- [ ] edge-contributor seam in `dependency-graph.ts` + C# contributor
- [ ] interface→implementation map + DI-registration scan, wired into flow tracing
- [ ] ambiguity counters surfaced in the analyze log (no silent guessing)

## 4. Rule language-support matrix (new — applies to all languages)

Today "which languages does rule X support" is implicit: it's whichever visitor files
exist. That makes coverage unauditable and lets gaps hide. Make it explicit and enforced.

**Schema** — `packages/shared/src/types/rules.ts`:

```ts
export const RuleLanguageStatusSchema = z.enum([
  'supported',       // full-fidelity visitor
  'partial',         // visitor exists; documented recall limitation
  'not-applicable',  // bug is inexpressible in this language (compiler-enforced,
                     // or the construct doesn't exist, e.g. JSX rules for Python)
  'unsupported',     // applicable in principle, not implemented
])

export const RuleLanguageSupportSchema = z.object({
  status: RuleLanguageStatusSchema,
  reason: z.string().optional(), // REQUIRED for partial / not-applicable / unsupported
})

// On AnalysisRuleSchema:
languageSupport: z.record(AnalysisLanguageSchema, RuleLanguageSupportSchema)
```

`AnalysisLanguageSchema` = the analyze-facing language set (`javascript` covering js/ts/tsx,
`python`, `csharp`) — declared per language family, not per grammar variant.

**Population** — `packages/analyzer/src/rules/language-support.ts`, not inline on 1,185
rule definitions. `withLanguageSupport()` derives each status from what actually runs and
the registry (`ALL_DEFAULT_RULES`) ships rules with the matrix populated:

- LLM rules → `supported` everywhere (prompts read source text, language-agnostic)
- non-`code` categories (service/module/method/database) → `supported` (graph-level)
- `code` deterministic → `supported` where a visitor declares the language; universal
  visitors count for javascript+python only (they're written against those grammars'
  node-type names — C# requires an explicit audit, its grammar names nodes differently)
- everything else → `unsupported` with reason, unless a curated disposition in
  `RULE_LANGUAGE_DISPOSITIONS` says `not-applicable` (inexpressible) or gives a permanent
  reason (`requires a type checker`)

Derivation can't drift: a hand-written `supported` without a visitor, or a `not-applicable`
that outlives a later port, fails the enforcement test.

**Enforcement** — `tests/analyzer/rule-language-support.test.ts`:

- every rule declares a status for **every** analysis language — no omissions;
- `supported`/`partial` ⇒ a visitor with that `ruleKey` must include that language
  (or be universal); `not-applicable`/`unsupported` ⇒ no such visitor may exist;
- `partial`/`not-applicable`/`unsupported` ⇒ non-empty `reason`.

This makes the coverage claim auditable and CI-enforced — a rule can't silently lack a
C# port, and a dead disposition can't outlive a later port.

**Surfacing:**

- [ ] `truecourse rules` (`tools/cli/src/commands/rules.ts`): per-language status columns
      + `--language <lang>` filter showing status + reason
- [ ] dashboard rules page: per-language badges (status; reason via `HoverPopover`)
- [ ] backfill script generates initial JS/Python entries from existing visitor
      `languages` fields; hand-review the generated `not-applicable` vs `unsupported`
      split (e.g. React rules are `not-applicable` for Python, not `unsupported`)

## 5. C# dispositions for the 36 type-query rules

These are the only rules whose JS visitors use the TS Compiler `TypeQueryService`
(0 Python visitors use it). Planned dispositions — each confirmed per-rule during the
port and recorded in `languageSupport`:

**`supported` via syntax / symbol index (6):**

| Rule | C# detection |
|---|---|
| `async-void-function` | literal `async void` tokens |
| `unsafe-any-usage` | `dynamic` keyword (explicit in C#, unlike TS `any` propagation) |
| `missing-null-check-after-find` | `FirstOrDefault`/`SingleOrDefault`/`Find` by name + null-check flow |
| `missing-return-await` | return-of-task inside `try`/`using` — syntactic |
| `missing-transaction` | multiple EF `SaveChanges`/Dapper writes without transaction scope — call-pattern |
| `unnecessary-namespace-qualifier` | qualified name already in the visible-namespace set (index) |

**`partial` — common forms caught, inferred-type tail missed (7):**

| Rule | Caught | Missed |
|---|---|---|
| `floating-promise` | un-awaited call whose return type is repo-declared `Task` (index), `*Async` naming, known BCL list | third-party non-`Async`-named `Task` methods; generic/`var` inference chains |
| `missing-await` | same mechanism | same tail |
| `unhandled-promise` | same mechanism | same tail |
| `switch-exhaustiveness` | switches over repo-declared enums (index has members — exact) | external enums (e.g. `HttpStatusCode`) |
| `base-to-string` | interpolation of values with repo-declared types lacking `ToString` override | inferred-type expressions |
| `restrict-template-expressions` | same mechanism | same tail |
| `unsafe-type-assertion` | downcasts within repo-local hierarchies (index) | casts involving external types |

**`unsupported` — requires a real type checker (7):** `unnecessary-condition` (nullability
flow), `unnecessary-type-assertion`, `unnecessary-type-conversion`, `redundant-type-argument`,
`unnecessary-type-parameter`, `readonly-parameter-types`, `prefer-this-return-type`.
Reason recorded as `requires-type-checker`; the .NET SDK's built-in Roslyn analyzers emit
these as build warnings, so users are not left uncovered.

**`not-applicable` — inexpressible in C# (16):** `argument-type-mismatch`,
`array-sort-without-compare`, `await-non-thenable`, `confusing-void-expression`,
`function-return-type-varies`, `loose-boolean-expression`, `misused-promise`,
`misused-spread`, `non-number-arithmetic`, `react-leaked-render`, `restrict-plus-operands`,
`ts-void-return-value`, `unknown-catch-variable`, `unsafe-enum-comparison`,
`unsafe-unary-minus`, `values-not-convertible-to-number` — the C# compiler rejects the
code (or the construct doesn't exist: JSX, JS coercion, TS-only syntax).

## 6. Work breakdown

### A. Language foundation

The parser layer (grammar WASM, `csharp` enum member, `.cs` handling, build copying) is
already on this branch from the verify work.

- [ ] `packages/analyzer/src/language-config.ts` — `CSHARP_CONFIG`: extensions `['.cs']`;
      node types (`method_declaration`, `local_function_statement`, `class_declaration`,
      `interface_declaration`, `record_declaration`, `struct_declaration`, `using_directive`,
      `invocation_expression`); module resolution (no barrel files); URL interpolation
      (`{id}` route-template style); package indicators (`*.csproj`, `*.sln`,
      `Directory.Packages.props`); ignore (`bin/`, `obj/`, `.vs/`); test patterns
      (`*Tests.cs`, `*.Tests/` projects); bootstrap (`Program.cs` / `Main`); draft
      `34c096d5` has a starting point
- [ ] `packages/analyzer/src/extractors/languages/csharp.ts` — functions, classes, imports
      (`using` incl. global/static/alias), exports (visibility keywords); port from draft,
      add records/file-scoped namespaces/top-level statements
- [ ] `packages/analyzer/src/file-analyzer.ts` — `case 'csharp':` dispatch
- [ ] `packages/analyzer/src/index.ts` — export the C# extractor functions
- [ ] **No `lsp-servers/csharp`** — the registry simply has no C# entry; the existing
      "no server registered" path is the designed behavior, not a fallback (§2)

### B. Symbol index & dependency graph

See §3 checklist.

### C. Services, routes, patterns

- [ ] `packages/analyzer/src/service-detectors/csharp.ts` — `.csproj` dependencies
      (PackageReference/ProjectReference incl. central package management), library vs app
      via SDK + `OutputType`; `.sln` awareness for service boundaries
- [ ] `packages/analyzer/src/extractors/routes/csharp.ts` — ASP.NET attribute routing
      (`[Route]`, `[HttpGet]`…, route-prefix composition) + minimal APIs (`MapGet`/…,
      `MapGroup` prefixes); same route semantics verify's `operation-aspnet.ts` implements,
      built analyzer-side (packages stay independent; verify's extractor is the behavioral
      reference)
- [ ] `packages/analyzer/src/extractors/http/matchers.ts` — `HttpClient`
      (`GetAsync`/`PostAsync`/`SendAsync`), `IHttpClientFactory`, Refit, RestSharp
- [ ] `packages/analyzer/src/patterns/` — service patterns (ASP.NET Core, Worker Service,
      Orleans); layer patterns (EF Core, Dapper, NHibernate; controllers/services/
      repositories conventions); database patterns (`Npgsql`, `Microsoft.Data.SqlClient`,
      `MySqlConnector`, `Microsoft.Data.Sqlite`, `StackExchange.Redis`, `MongoDB.Driver`
      → `DATABASE_IMPORT_MAP`, connection-string env conventions)
- [ ] `packages/analyzer/src/schema-parsers/efcore.ts` — entity classes + `[Column]`/
      fluent mapping → schema index for `needsSchemaIndex` rules (verify's
      `cs-column-map.ts` is the behavioral reference)

### D. Rule support matrix

See §4 checklist. Lands **before** the rules port so every ported domain updates the
matrix as it goes.

### E. Rules port

- [ ] `packages/analyzer/src/rules/_shared/csharp-framework-detection.ts` — web framework
      (ASP.NET controllers vs minimal APIs), ORM (EF Core / Dapper / NHibernate), DI
      detection; mirrors `python-framework-detection.ts`
- [ ] audit `visitors/universal.ts` against the C# grammar — node-type names differ
      (`string_literal` / `interpolated_string_expression` vs `string` /
      `template_string`); extend `nodeTypes` or the rules silently never fire on C#
- [ ] per-domain `visitors/csharp/` directories, smallest first so conventions settle
      early: architecture (4 Python-visitor equivalent) → database (10) → reliability (10)
      → style (10) → performance (16) → security (61) → bugs (235) → code-quality (255)
- [ ] every visitor declares `languages: ['csharp']`; every rule's `languageSupport.csharp`
      entry set in the same change (enforcement test makes this unskippable)
- [ ] the 36 type-query rules: dispositions per §5

### F. Fixtures & tests

Fixture-first, realistic code only (no synthetic violation samples) — same bar as the
JS/Python fixtures.

- [ ] `tests/fixtures/sample-csharp-project-negative/` — realistic multi-service ASP.NET
      Core + EF Core + Dapper repo with true-positive violations; drives the graph
      snapshot (services/modules/deps/layers/db expected output) — draft `34c096d5`'s
      3-service fixture is the seed, updated to current conventions
- [ ] `tests/fixtures/sample-csharp-project-positive/` — clean code asserting **zero**
      violations (FP regression harness, mirrors js/python)
- [ ] `tests/analyzer/csharp-graph-snapshot.test.ts` — services, modules, dependencies
      (must include same-namespace edges), layers, databases, routes
- [ ] symbol-index unit tests — namespace visibility (ancestors, global/implicit usings,
      aliases), ambiguity behavior, DI bindings
- [ ] per-domain visitor tests as each domain ports
- [ ] full suite green — including JS/Python graph snapshots (edge-contributor seam must
      not perturb existing graphs)

### G. Battle test

- [ ] fp-automation campaign against real OSS ASP.NET Core repos (`analyze --no-llm`),
      fixture → fix → test cycle per finding, **0% FP gate** before C# is declared
      supported

### H. Docs

- [ ] `docs/PLAN.md` — Phase 12 (multi-language) status + pointer to this plan
- [ ] `README.md` — supported languages
- [ ] `packages/analyzer/ADDING_A_LANGUAGE.md` — add the symbol-index path for
      namespace-import languages; correct the OmniSharp row (LSP is not required where
      visibility is syntactic)

## 7. Execution order

```
A foundation → B symbol index/dep graph → C services/routes/patterns → F1 fixture+snapshot
                                                                            ↓
H docs ← G battle test ← F2 visitor tests ← E rules port ← D support matrix
```

D (matrix) is independent of A–C and can proceed in parallel; it must complete before E.
