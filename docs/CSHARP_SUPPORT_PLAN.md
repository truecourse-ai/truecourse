# C# Support for `verify` — Implementation Plan

> **STATUS: PLANNED.** Scope: **`verify` only** (contract-drift detection over C#).
> `spec` and `contract`-from-prose are language-agnostic (zero work); `infer` rides
> verify's extractors and gets C# **for free**. **No language server is involved** —
> verify is pure tree-sitter. (Earlier drafts of this doc scoped the full `analyze`/scan
> treatment — LSP, resolvers, ~601 rule visitors — which is *not* needed here.)
>
> File:line references are as-of-research pointers and may drift; treat the file and
> the named symbol as authoritative, not the exact line.

## 1. Goal & scope

Make `truecourse verify` detect IL contract drift in **C#** (ASP.NET Core, EF Core, Dapper)
the same way it does for TS/JS and Python. Python was the first non-JS verify language and
is the line-by-line template throughout.

**Why no language server.** The LSP (Pyright for Python, Roslyn/OmniSharp for C#) is an
`analyze`/scan concern only — it provides module resolution, export detection, and type info
for the dependency graph and the deterministic rule visitors. **`verify` never touches it.**
`contract-verifier` imports exactly two things from `@truecourse/analyzer` — `initParsers`
and `parseFile` (the tree-sitter layer) — and operates entirely on `web-tree-sitter`
`Tree`/`SyntaxNode` ASTs. Grep confirms zero `lsp`/`pyright`/`language-server` references in
the package.

**What each capability needs for C#:**

| Capability | Package | C# work |
|---|---|---|
| `spec` | `spec-consolidator` | **None** — reads `.md`, language-agnostic |
| `contract` (from prose) | `contract-extractor` | **None** — reads `claims.json`, language-agnostic |
| `infer` (code → `.tc`) | `contract-verifier/src/infer` | **None of its own** — calls the shared `extractCodeContracts()` façade; C# falls out automatically once verify's extractors speak C# |
| **`verify`** | `contract-verifier` | **The work** — this document |
| tree-sitter parsing | `analyzer` (parser layer only) | ~4 lines so `parseFile` can turn `.cs` into an AST |

## 2. Prerequisite: teach the tree-sitter layer to parse `.cs`

`parseFile(filePath, code, language)` → `parseCode` → `getParser(language)` is driven solely by
`GRAMMAR_WASM: Record<SupportedLanguage, string>` (`packages/analyzer/src/parser.ts`). It has
**no `LanguageConfig` dependency** — confirmed by reading `getParser`/`parseCode`/`parseFile`.
So the entire analyzer touch is the parser layer:

- [ ] `packages/shared/src/types/analysis.ts:7` — add `'csharp'` to `SupportedLanguageSchema`.
      *(`GRAMMAR_WASM` is `Record<SupportedLanguage, …>`, so this forces the next line to compile.)*
- [ ] `packages/analyzer/src/parser.ts` — add `csharp: 'tree-sitter-c-sharp/tree-sitter-c_sharp.wasm'`
      to `GRAMMAR_WASM` (**underscore** in the filename). *(Template: the `python:` entry.)*
- [ ] `packages/analyzer/package.json` — add `tree-sitter-c-sharp` (devDep, like `tree-sitter-python`).
- [ ] `scripts/build.ts` — add the C# grammar to `WASM_SUBPATHS` so the `.wasm` is copied into
      `dist/wasm/` (easy half — pure WASM, exactly like Python; no Emscripten compile).

**Explicitly NOT needed** (all scan-only): `language-config.ts` / `LanguageConfig`,
`file-analyzer.ts`, any LSP server or `lsp-servers/*`, `resolvers/*`, `service-detectors/*`,
`rules/**` visitors, `patterns/*`, the dashboard CodeMirror mode. None of these are on verify's path.

## 3. Shared enum — `DatabaseType`

- [ ] `packages/shared/src/types/database.ts:7` — add `'sqlserver'` to `DatabaseTypeSchema`
      (currently `['postgres','redis','mongodb','mysql','sqlite']`; SQL Server is the dominant EF Core
      database). **Required** — EF Core entity/query drift is in v1 scope.

## 4. The work — `packages/contract-verifier`

> **Architecture payoff:** every comparator except `authorization-rule.ts` is a **pure fact-diff**
> (Operation, ErrorEnvelope, Pagination, Idempotency, AuthRequirement, Entity, StateMachine,
> EffectGroup, Formula, QueryRule, Enum, ForbiddenArtifact, NamedConstant, ArchitectureDecision —
> zero `node.type`/`s.lang` switches). Once the extractors emit C# facts, the comparators work
> unchanged. **Verifying this property holds for C# is the central milestone.**

**Node-type cheat sheet** (the per-language AST vocabulary every extractor below maps):
JS `member_expression` / Py `attribute` → **C# `member_access_expression`** (field `name`);
JS `assignment_expression` / Py `assignment` → **C# `assignment_expression`**;
JS `call_expression` / Py `call` → **C# `invocation_expression`**;
JS `binary_expression` (`==`) / Py `comparison_operator` → **C# `binary_expression`**;
JS `object` / Py `dictionary` → **C# `object_creation_expression` / `initializer_expression`**;
JS `array` / Py `list` → **C# `array_creation_expression` / collection initializer**;
JS `string_fragment` / Py `string_content` → **C# `string_literal` / interpolated parts**;
JS `number` / Py `integer` → **C# `integer_literal` / `real_literal`**.
C# functions = `method_declaration` / `local_function_statement` / `lambda_expression`;
imports = `using_directive`; decorators → **attributes** (`attribute_list` / `attribute`).

### 4.1 Create

- [ ] **`extractor/node-types.ts`** (strongly recommended, **do first**) — a per-language node-type
      table (`NODE_TYPES[lang].member`, `.assign`, `.call`, `.stringContent`, …) so the Tier-2 sites
      in §4.3 become table lookups instead of a third inline ternary arm. This is the single biggest
      defense against the silent-failure risk (§5).
- [ ] `extractor/operation-aspnet.ts` — **the FastAPI analog and key leverage point.** Attribute-routed
      controllers (`[ApiController]` + `[Route("api/[controller]")]` class prefix + `[HttpGet("{id}")]`,
      with `[controller]`/`[action]` token expansion) **and** minimal APIs (`app.MapGet`, `MapGroup`
      prefix chaining). Must emit the same language-agnostic `ExtractedOperation` shape so all downstream
      comparators (Operation/ErrorEnvelope/Pagination/Auth/Idempotency) work unchanged. Response status
      from `[ProducesResponseType]` / `return Ok()/NotFound()/StatusCode(n)`. *(Template: `extractor/operation-fastapi.ts`.)*
- [ ] `extractor/enum/cs-enums.ts` — `enum_declaration` + `[Flags]` + const-string class patterns.
      *(Template: `enum/py-enums.ts`.)*
- [ ] `extractor/constant/cs-constants.ts` — `const` / `static readonly` fields. *(Template: `constant/py-constants.ts`.)*
- [ ] `extractor/query/efcore.ts` — LINQ over `DbSet<T>` (`.Where().Include().ToListAsync()`).
      *(Template: `query/sqlalchemy.ts` + `query/django.ts`.)*
- [ ] `extractor/query/dapper.ts` — `connection.Query<T>("SELECT…")`. *(Template: `query/raw-sql.ts`.)*
- [ ] `extractor/entity-schema/efcore.ts` — `DbSet<T>` + `[Table]`/
      `[Column]`/`[Key]` annotations + `OnModelCreating` Fluent API (precedence: Fluent > annotations > convention).

### 4.2 Edit — Tier 1 (clean: add a `csharp:` matcher key, no logic rewrite)

- [ ] `extractor/source-walker.ts` — `EXT_TO_LANG['.cs'] = 'csharp'` (the verifier's own ext→lang map,
      its single source of truth for which files to look at); add `bin`/`obj`/`.vs`/`packages` to `SKIP_DIRS`.
- [ ] `extractor/enum/index.ts` — `csharp:` key → `cs-enums.ts`.
- [ ] `extractor/constant/index.ts` — `csharp:` key → `cs-constants.ts`.
- [ ] `extractor/query/index.ts` — `csharpQueries(s)` bundler + `csharp:` key; extend `QueryAdapterName`
      (`query/types.ts`) with `'efcore' | 'dapper'`.
- [ ] `extractor/computed-field/index.ts` — add `method_declaration` to the shared `match` node check +
      C# `parameter` handling; then `csharp: match`.
- [ ] `extractor/state-field/index.ts` — shared `match` must accept `member_access_expression` and field
      `name`; then `csharp:` key.
- [ ] `extractor/effect/index.ts` — `isCall` += `invocation_expression`; `isMember` += `member_access_expression`;
      `memberProp` → `.name`; `strVal` → `string_literal`; then `csharp: matchEffects`.
- [ ] `extractor/architecture/shared/characteristic-imports.ts` — `csharpImportRefs(s)` over `using_directive`;
      then `csharp:` key.

### 4.3 Edit — Tier 2 (inline 3-way C# branches — the silent-failure surface)

> Build `extractor/node-types.ts` (§4.1) first, then convert these to table lookups.

- [ ] `comparator/authorization-rule.ts` (**the only AST-walking comparator** — IDOR/ownership):
      `member_expression` → `member_access_expression`; the `/req\.auth/`-style regex needs a distinct C#
      arm (`User.FindFirst(ClaimTypes...)`, `HttpContext.User`, `[Authorize]`).
- [ ] `extractor/entity-facts/index.ts` — `csAssign` (LHS `member_access_expression`); **new arm** for
      `object_creation_expression` (`new Order { Customer = … }`); `hasLowercaseCall` → `ToLower()`/`ToLowerInvariant()`.
- [ ] `extractor/state-machine-facts/index.ts` (**~10 sites — densest file**): `object_creation_expression`/
      `initializer_expression`, `array_creation_expression`, `assignment_expression`, `member_access_expression`,
      field `name`, `binary_expression` + `||`, `string_literal`.
- [ ] `extractor/formula-facts/index.ts` — `scanCsFunction` (`method_declaration`/lambda); `csParamNames`;
      replace the coarse `isPython` boolean with a lang discriminant (`numValue` needs `integer_literal`/`real_literal`).
- [ ] `extractor/effect/emission-facts.ts` — `isCall`→`invocation_expression`; `isMember`→`member_access_expression`;
      `isFnBoundary` += `method_declaration`/`lambda_expression`; C# control-flow node names; `callEmitsFailureStatus`
      → C# failure vocabulary (`return BadRequest()`/`StatusCode(500)`/`NotFound()`/`Results.Problem`).
- [ ] `extractor/forbidden/index.ts` — `findCsEnvVarReads` (`Environment.GetEnvironmentVariable`,
      `Configuration["X"]`, `builder.Configuration.GetValue<>`); decide whether `.csproj`/`.config` join `CONFIG_EXT`.

### 4.4 Edit — Tier 3 (framework passes & JS-only walkers — these bypass the central map via private `TS_EXT`)

- [ ] `extractor/index.ts` — wire the ASP.NET op pass: a new `eachParsedSource` block gated
      `if (s.lang === 'csharp')` calling the §4.1 extractor, deduped by `identity` (template: the FastAPI
      block). Note its hardcoded `TS_EXT` is independent of `SOURCE_EXTENSIONS`.
- [ ] `extractor/auth-presence.ts` — `aspNetFileHasAuthRouter` (`[Authorize]`, `RequireAuthorization()`,
      `AddAuthentication()`) + `s.lang === 'csharp'` pass. Own `TS_EXT`.
- [ ] `extractor/idempotency-presence.ts` (**JS-only today — no Python arm even**) — author C#
      `Request.Headers["Idempotency-Key"]` detection from scratch.
- [ ] `extractor/manifests.ts` — add `.csproj` (`<PackageReference Include/Version>`), `packages.config`,
      `Directory.Packages.props` (`<PackageVersion>`, central package management — merge with `.csproj`).
      Feeds `forbidden` + ArchitectureDecision with zero downstream edits. *(The existing `!== 'python'`
      guard at `manifests.ts:137` is pyproject-only — it won't fire on `.csproj`, so no C# arm needed there.)*
- [ ] `extractor/mount-graph.ts` — `.cs` candidate resolution for route mounting (if C# MapGroup/controller
      composition is in scope). This is verify-internal path logic, **not** an analyzer resolver.

### 4.5 Edit — architecture detectors (data-only `ChoiceSpec` edits, low-risk)

`architecture/build-system.ts` (`msbuild`/`dotnet` + `*.csproj`/`*.sln`), `runtime.ts` (`dotnet`,
`global.json`), `auth-strategy.ts` (`JwtBearer`, `Identity`), `data-store.ts`, `package-manager.ts` (NuGet),
`frontend-framework.ts` (Blazor), `shared/config-files.ts` (`bin`/`obj` → `SKIP_DIRS`).

### 4.6 No change

`extractor/file-based-routes.ts` (Next/Astro/SvelteKit FS routing — N/A for C#); `parser/` (parses the
`.tc` DSL, not source); `resolver/` + lifters (spec side, language-neutral); **all comparators except
`authorization-rule.ts`**.

## 5. Risks (verify-scoped)

1. **Silent two-arm failures (the core risk).** ~19 inline `=== 'python'` ternaries across ~7 extractor
   files map a generic concept to a tree-sitter node-type name. They compile with only two arms, so C#
   would fall through to the JS branch and match the **wrong** node types **with no type error**. The
   densest is `state-machine-facts/index.ts` (~10 sites). **Mitigation:** the `extractor/node-types.ts`
   table (§4.1) — make the missing-arm case a compile error, not a silent mismatch.
2. **Tree-sitter grammar gate (Phase 0).** `tree-sitter-c-sharp`'s newest line is 0.23.x (older ABI) vs
   the repo's `web-tree-sitter@^0.26`. ABI 14/15 *probably* overlaps, but **verify with a throwaway
   `Language.load`** before sizing — do not assume.
3. **New extractor fidelity.** The ASP.NET operation extractor and EF/Dapper query extractors are the only
   substantial *new* code; their false-positive rate is the quality bar (battle-test → fixture → fix cycle).
4. **Minor — partial classes.** A C# class split across files could fragment entity/state-machine facts.
   Verify's fact extractors are largely per-tree; cross-file class merging is a verify-internal enhancement
   to add only if a fixture exposes the gap — not a headline blocker.

## 6. Tree-sitter grammar acquisition

- **Grammar:** `tree-sitter/tree-sitter-c-sharp` (MIT, Roslyn-derived, covers C# 1–14), npm `tree-sitter-c-sharp`.
- **WASM provenance (preferred order):** (1) the npm tarball already ships the prebuilt `.wasm` — verify
  with `npm pack tree-sitter-c-sharp && tar tzf *.tgz | grep wasm`; if present, the `parser.ts` + `build.ts`
  edits are one-liners. (2) aggregator (`tree-sitter-wasms` / `@vscode/tree-sitter-wasm`). (3) **worst** —
  compile via `tree-sitter build --wasm` (needs Emscripten/Docker, a toolchain the repo avoids). Filename
  underscore: `tree-sitter-c_sharp.wasm`.

## 7. Fixtures & testing

Realistic ASP.NET Core + EF Core fixtures (no synthetic samples), mirroring `sample-python-project-il`:

- [ ] `tests/fixtures/sample-csharp-project-il/` — `code/` + `docs/` + `reference/` subdirs. Marker-equality:
      extraction over `code/` must equal the hand-authored `reference/` specs/contracts (the fixture is the
      oracle), NOT the generated `.truecourse/` output.
- [ ] `tests/contract-verifier/verify-csharp-end-to-end.test.ts` — *(Template: `verify-python-end-to-end.test.ts`.)*
- [ ] C# cases in `infer-fixture.test.ts` / `infer-full-mirror.test.ts` (infer coverage is free — assert it).
- [ ] Confirm `core/services/telemetry.service.ts` (already maps `.cs → csharp`) reports correctly.

## 8. Phasing

- **Phase 0 — grammar spike (½–1 day).** `npm pack tree-sitter-c-sharp`, confirm the `.wasm` loads under
  web-tree-sitter 0.26 via a throwaway `Language.load`. Gates everything.
- **Phase 1 — parse + core facts (~1 wk).** §2 parser layer; `source-walker` `.cs` key; `node-types.ts`
  table; `cs-enums`/`cs-constants`; `manifests` (`.csproj`) → `forbidden` + ArchitectureDecision. A C# repo
  starts producing enum/constant/forbidden/architecture drift. First fixture + `verify-csharp-end-to-end`.
- **Phase 2 — operations + behavioral facts (~1.5–2 wks).** `operation-aspnet.ts` (unlocks Operation/
  ErrorEnvelope/Pagination/Auth/Idempotency at once); Tier-2 behavioral extractors (entity/state-machine/
  formula/effect facts) via the node-type table; `auth-presence` + `idempotency-presence` C# arms; EF Core
  entity-schema enumeration + EF/Dapper query extractors; `authorization-rule` C# arm. infer C# falls out for
  free — add the marker tests.
- **Phase 3 — depth (open-ended).** Partial-class merging if a fixture demands it; broaden architecture
  `ChoiceSpec` coverage; any long-tail framework shapes the fixtures surface.

**Effort ranking (largest first):** (1) `operation-aspnet.ts` + EF/Dapper query extractors — the bulk of new
code; (2) the Tier-2 behavioral-fact branches + node-type table; (3) fixtures; (4) everything else — mechanical
matcher-key edits.

## 9. Decisions (resolved — full coverage in v1)

- **Scope = all.** EF Core entity **and** query drift, **both** ASP.NET Controllers and Minimal APIs, Dapper raw
  SQL, and the `infer` marker tests are all in v1. `DatabaseType += 'sqlserver'` (§3) is therefore required.
- **Node-type table** (`extractor/node-types.ts`) — **yes, build it first** (the §5 silent-failure defense).
- **C# config-file textual scan** — **yes**, `.csproj`/`.config` join `CONFIG_EXT` (`forbidden/index.ts`) for fuller
  forbidden-artifact coverage.

Still genuinely open (implementation detail, decide during build):
- EF Core entity detection: import-based (`SCHEMA_PARSERS`-style) vs file-based (`*DbContext.cs` + `Migrations/`).
  Lean file-based — EF schema lives in the `DbContext`, like Prisma.

---

**Bottom line:** C# for `verify` is a tree-sitter-only effort — **no language server, no scan/analyze machinery.**
The analyzer touch is ~4 lines (just the grammar). The real work lives entirely in `contract-verifier`: per-language
matcher keys, the behavioral-fact branches (guarded by a node-type table to avoid silent two-arm bugs), and two
substantial new extractors (ASP.NET operations, EF/Dapper queries). `spec` and `contract`-from-prose stay
language-agnostic, and `infer` gets C# for free.
