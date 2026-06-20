# C# Rule Coverage Gap — SonarC# / Roslyn / StyleCop / Roslynator vs TrueCourse

> Status: analysis only. No code yet. This is the C# analog of the JS/Python
> coverage work tracked in the private `truecourse-rules-sync` repo, which never
> included a single C#/.NET source. It answers: *what C#-native rules do the
> standard C# linters catch that we don't, and which of those can our build-free
> analyzer actually implement?*

## TL;DR

- Our C# rule set (308 visitors) was **ported from the JS/Python catalog**, never
  sourced from C#'s own linters. `truecourse-rules-sync` tracks ESLint, SonarJS,
  Ruff, SonarPython — **zero C# sources**.
- The single most important constraint: **our analyze is build-free** (tree-sitter
  only, no Roslyn semantic model). So the *addressable* universe is the
  **syntactic** (type-independent) external rules. Type-dependent rules are
  out of scope by design (deferred to the .NET SDK's analyzers at compile time —
  this is exactly what `language-support.ts` already documents).
- Against **SonarC#** (the benchmark — 470 rules, **147 syntactic**): we already
  cover **~60**, leaving **~87 net-new syntactic**. Of those, **~45 are worth
  porting** (real bugs/smells) and **~40 are low-value** (formatting, assembly
  attributes, framework-niche).
- **Roslyn CA** adds only ~5 genuinely-new syntactic rules (it's 310/326
  type-dependent; its syntactic rules overlap Sonar's).
- **StyleCop (190 syntactic)** and **Roslynator (216 syntactic)** are
  overwhelmingly formatting / mechanical-refactor rules — deprioritize wholesale;
  they're a `dotnet format` + `.editorconfig` concern, not a decisions/contracts
  concern.
- **The real gap is the 323 type-dependent SonarC# rules** (IDisposable/dispose,
  nullability/dataflow, LINQ-method resolution, ConfigureAwait, ASP.NET/Blazor,
  crypto). We can't touch those without a semantic model (Roslyn or an LSP) — a
  separate, larger architectural decision.

## The numbers

| Source | Total | Syntactic (addressable) | Type-dependent (out of scope, build-free) |
|---|---|---|---|
| SonarC# | 470 | 147 | 323 |
| Roslyn CA (quality) | 326 | 16 | 310 |
| Roslyn IDE (style) | 125 | 42 | 83 |
| StyleCop SA | 195 | 190 | 5 |
| Roslynator RCS | 340 | 216 | 124 |

Our current C#: **308 visitors**. `language-support.ts` already records the
deliberate exclusions: **671 not-applicable**, **58 unsupported** (51 of which
read "requires a type checker"), **26 partial**.

## SonarC# syntactic diff (the benchmark)

147 syntactic rules. **~60 already covered**, **~87 net-new**. Net-new triaged:

### Tier 1 — port first (real bugs / hotspots, clearly syntactic)

| Sonar | What it flags | Notes |
|---|---|---|
| S2183 | integer shift by zero or ≥ bit-width | no shift rule today |
| S1313 | hardcoded IP address literals | we only catch `0.0.0.0`/`IPAddress.Any` |
| S6640 | `unsafe` code block used | security hotspot |
| S5753 | ASP.NET request validation disabled | |
| S1116 | empty statements / stray `;` | |
| S3458 | empty `case` falling through to `default` | |
| S3532 | empty `default` clause | |
| S1048 | `throw` inside a finalizer | we have throw-in-`finally` only |
| S3880 | empty finalizer (≡ CA1821) | |
| S2327 | adjacent `try` with identical catch/finally | |
| S1940 | inverted boolean check — `!(a==b)` → `a!=b` | |
| S2437 | useless bit ops (`& -1`, `\| 0`, `^ 0`) | |
| S3052 | member initialized to its default (≡ CA1805) | |
| S6418 | secret-named var assigned high-entropy literal | broadens our AWS-only secret check |
| S2345/S2346/S2344/S4016/S4022 | Flags-enum & enum hygiene (powers-of-two, zero-`None`, no `Enum`/`Flags` suffix, no `Reserved`, Int32 storage) | group as one "enum hygiene" visitor family |

### Tier 2 — valuable smells / cleanups

S126 (if/else-if missing final else), S1110 + S1121 (broaden our redundant-parens
& assignment-in-subexpression beyond return/throw/condition), S1123 (`[Obsolete]`
without explanation), S2292 (trivial property → auto-property), S2302 (`nameof`
instead of string param name in throw), S2357 (fields should be private), S2339 +
S2360 (public `const` / optional params — contested), S2342 (enum naming),
S3261 (empty namespace), S3400 (broaden method-returns-constant), S3441 (redundant
property name in anonymous object), S3442 (≡ CA1012 abstract class public ctor),
S3447/S3450/S3451 (`[Optional]`/`[DefaultParameterValue]`/`[DefaultValue]`
correctness), S3872 (param name duplicates method name), S3874 (≡ CA1021/CA1045
`out`/`ref` in public method), S3967 (multidim array), S4136 (overloads grouped),
S4201 (redundant null-check combined with `is`), S4663 (empty comment), S3235
(redundant empty parens), S3237 (`value` unused in setter).

### Tier 3 — low value / defer

- **Formatting/layout** (a formatter's job): S103 line length, S104 file LOC,
  S105 tabs, S113 newline-at-EOF, S122 statements-per-line, S1109 brace
  placement, S1659 multi-var declarations, S2148 number underscores, S3937 digit
  groups, S818 literal-suffix case, S3972/S3973 conditional layout, S1151 case
  length, S1451 license header, S1199/S121 brace style (partly covered).
- **Comment tracking**: S1134 (FIXME), S1135 (TODO), S1309 (suppressions — partly
  covered by our `ban-ts-comment`).
- **Assembly-level**: S3904 (AssemblyVersion), S3990 (CLSCompliant), S3992
  (ComVisible).
- **Framework / language niche**: S3598/S3603 (WCF/`[Pure]`), S6421/S6802
  (Azure Functions/Blazor markup), S6798/S6930 (Blazor/route backslash), S2290
  (virtual event), S2306 (async as identifier), S4061 (`__arglist`), S2436
  (generic-param count), S2368 (multidim param), S2156 (sealed protected member),
  S8368/S8380/S8381 (C# 14 contextual-keyword escaping), S2857 (SQL keyword
  whitespace), S3343 (caller-info param order), S7039 (CSP header — we mark the
  CSP family not-applicable for C#), S5856 already covered.

## Roslyn CA syntactic (16) — small net-new

Most overlap Sonar (CA1502≡S1541, CA1707≡naming, CA1012≡S3442, CA1021≡S3874,
CA1805≡S3052). **Genuinely net-new and worth it:** CA1716 (identifiers matching
keywords), CA1008 (enum zero value), CA1505 (maintainability-index metric).
**Niche:** CA1200 (cref prefix), CA1509 (metrics config), CA2243 (attribute
literal parse). Note: CA1708 (identifiers differ only by case) and CA1069 (enum
duplicate values) are things we *deliberately* marked not-applicable — worth a
second look since Sonar/Roslyn both flag them.

## StyleCop (190) + Roslynator (216) — deprioritize as a class

- **StyleCop**: 190/195 syntactic, but 100% formatting/spacing/ordering/
  documentation-presence/naming-text. This is what `dotnet format` + an
  `.editorconfig` enforce. Not a TrueCourse differentiator.
- **Roslynator**: RCS0xxx (62) is pure formatting; RCS1xxx syntactic (~150) is
  mechanical "remove redundant / merge / simplify" refactors, heavily overlapping
  the Sonar Tier-2 cleanups above. Cherry-pick from Tier 2; skip the rest.

## The bigger gap: 323 type-dependent SonarC# rules

These are where C# "feels" under-covered, and **none are reachable build-free**:
dispose/`IDisposable` correctness (S2930/S2931/S2952/S3881/CA1063…), nullability &
dataflow (S2259/S1854/S2583/S2589/S3655), LINQ-method resolution (the S660x band),
`ConfigureAwait(false)` (S3216), logging-framework rules (S66xx), ASP.NET/Blazor
(S69xx), and the crypto/TLS/deserialization security families (S44xx/S5xxx — many
of which we approximate syntactically today but Sonar does semantically).

Closing this requires a **semantic model** — Roslyn as a backend, or a C# LSP/
OmniSharp seam — which is a deliberate architecture decision, not a rule port.
That is the fork in the road below.

## Recommendation

1. **Now (build-free, no architecture change):** port SonarC# Tier 1 (~18 rules,
   several grouped) + the high-value Tier-2/CA rules (~30). Net ~45 new visitors,
   same engine, same fixture-first cycle. This is the direct analog of the
   JS/Python rules-sync work.
2. **Add C# sources to `truecourse-rules-sync`** (SonarC# RSPEC JSON + Roslyn CA
   index) so the catalog tracks C# linter releases the same way it tracks ESLint/
   Ruff — otherwise this gap silently reopens every release.
3. **Separately decide** whether to invest in a Roslyn/LSP semantic backend to
   unlock the 323 type-dependent rules. Big lift; the only path to true Sonar/
   Roslyn parity for C#.

### Sources

- SonarC#: `SonarSource/sonar-dotnet` → `analyzers/rspec/cs/*.json` (470/470).
- Roslyn CA/IDE: `dotnet/docs` quality-rules + style-rules indexes.
- StyleCop: `DotNetAnalyzers/StyleCopAnalyzers` documentation.
- Roslynator: `dotnet/roslynator` → `src/Analyzers.xml`.
- Our inventory: `packages/analyzer/src/rules/<domain>/visitors/csharp/` +
  `language-support.ts`.
