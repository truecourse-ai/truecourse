# csharp-roslyn-host

The C# **semantic** analysis backend — the role `ts-compiler.ts` plays for JS/TS
and Pyright plays for Python. It exists to implement the C# rules that a build-free
tree-sitter pass cannot detect without false positives: anything needing resolved
types, dataflow, nullability, or cross-file symbols (≈210 rules deferred from the
tree-sitter track).

It is a small .NET worker spawned by the Node analyzer as a child process (the same
pattern as the Pyright LSP), speaking **newline-delimited JSON over stdin/stdout**.

## Why a custom host (not an off-the-shelf LSP)
We run **our own** rules on Roslyn's semantic model and return them in our violation
schema — our keys/logic, no third-party analyzer bundled. An LSP would only surface
its own diagnostics.

## Protocol
One JSON request per line in, one JSON response per line out. Two analysis modes:

```jsonc
// ping
{"op":"ping"}                                  -> {"ok":true}

// analyze: compile the given file texts with the runtime's reference set and run
// the enabled rules. Fast, no restore needed — the build-free host rules.
{"op":"analyze","files":[{"path":"A.cs","text":"..."}],"rules":["bugs/deterministic/referenceequals-on-value-type"]}
// -> {"ok":true,"violations":[{"ruleKey":"...","path":"A.cs","line":1,"column":52,"message":"..."}]}

// analyze-project: open a real .csproj/.sln via MSBuildWorkspace (the project's
// own references + metadata) and run the enabled rules — including the
// project-aware ones (IProjectAwareRule). Requires a restored, buildable project.
{"op":"analyze-project","project":"/abs/path/App.csproj","rules":["architecture/deterministic/namespace-folder-mismatch"]}
// -> {"ok":true,"violations":[...]}   // generated obj/bin files are excluded
```
`rules` is optional; omit to run all registered rules. Errors come back as
`{"ok":false,"error":"..."}`. In `analyze-project`, an unrestored project (no
reference set — `System.Object` unresolved) is reported as an error, not analyzed.

## Working directory & SDK resolution
`ping` and `analyze` need only the .NET **runtime** — they compile file texts with
the runtime's own reference set and never build the target. So MSBuild/SDK resolution
is deferred and **guarded**: it runs lazily only for `analyze-project`, and an
SDK-resolution failure comes back as a normal `{"ok":false,...}` error rather than
aborting the process. The Node client also spawns the host in a neutral working
directory (`os.tmpdir()`), so a target repo's `global.json` SDK pin is never on the
resolver's search path and can't block read-only analysis (issue #658).

## Adding a semantic rule
Mirror the tree-sitter recipe, but in C#/Roslyn. Add a file under `Rules/<Domain>/`
implementing one of:
- `ISemanticRule` — needs only the `SemanticModel` + `SyntaxTree`. Runs in both
  modes. `yield return` a `Violation` with the **same `ruleKey`** the catalog uses.
  Catalog `engine: 'roslyn-host'`.
- `IProjectAwareRule` — also needs project metadata (`ProjectContext`: RootNamespace,
  project directory, output kind, assembly name). Runs only in `analyze-project`.
  Catalog `engine: 'roslyn-workspace'`.

Both are auto-discovered by reflection (parameterless ctor) — no central registry
edit, so parallel rule authoring never conflicts. The Node side maps the violations
into the normal analyzer pipeline.

`ReferenceEqualsOnValueType` (Roslyn CA2013) is the `ISemanticRule` reference
implementation; `NamespaceFolderMismatch` is the `IProjectAwareRule` one.

## Build & smoke-test
```bash
dotnet build -c Release          # restores Microsoft.CodeAnalysis.CSharp
cat test.jsonl | ./bin/Release/net8.0/csharp-roslyn-host
```

## Status / next steps
- [x] Host skeleton: stdio JSON protocol, in-process `CSharpCompilation`, reflection-discovered rule registry.
- [x] **Node client** (`packages/analyzer/src/roslyn-host-client.ts`) + analyze-pipeline integration. Build-required, **fail-hard** (no tree-sitter fallback).
- [x] **147 semantic rules** ported as `ISemanticRule` walkers across all domains, zero-FP, validated end-to-end. The single-compilation-decidable set is exhausted.
- [x] Framework refs: `Microsoft.Extensions.Logging.Abstractions` + `Newtonsoft.Json` (so the model resolves `ILogger`/Json types).
- [x] **MSBuildWorkspace** project loading (`analyze-project` op): opens the real `.csproj`/`.sln` with its own references + metadata. Adds the `IProjectAwareRule` contract (`ProjectContext`: RootNamespace, project dir, output kind, assembly name) and the `roslyn-workspace` engine tag, routed by the pipeline only when the repo has C# and a discoverable project. **Product decision:** these rules require a *restored, buildable* project; an unrestored project is reported as an error, never half-analyzed.
- [x] First project-aware rule: `namespace-folder-mismatch` (a type's namespace must mirror its folder under the project root).
- [ ] Niche framework rules (Blazor, MEF, WCF, Azure, test frameworks; WinForms/WPF are Windows-only): now *implementable* under `analyze-project` once the analyzed project references the framework, but each needs a framework-specific restored fixture to validate zero-FP — port framework-by-framework, not in bulk.
- [ ] ~20 deferred rules stay unshipped by the zero-FP bar (dataflow-heavy / heuristic) — the semantic analog of `not-applicable`.
- [ ] Distribution: ship a self-contained per-platform binary, or require the SDK.
