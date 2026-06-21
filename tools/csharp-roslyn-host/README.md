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
One JSON request per line in, one JSON response per line out.

```jsonc
// ping
{"op":"ping"}                                  -> {"ok":true}

// analyze: compile the given files, run the enabled semantic rules
{"op":"analyze","files":[{"path":"A.cs","text":"..."}],"rules":["bugs/deterministic/referenceequals-on-value-type"]}
// -> {"ok":true,"violations":[{"ruleKey":"...","path":"A.cs","line":1,"column":52,"message":"..."}]}
```
`rules` is optional; omit to run all registered semantic rules. Errors come back as
`{"ok":false,"error":"..."}`.

## Adding a semantic rule
Mirror the tree-sitter recipe, but in C#/Roslyn:
1. Implement `ISemanticRule` in `Program.cs` (or a file under `Rules/`): walk the
   syntax tree, consult the `SemanticModel` for the type/symbol facts you need,
   `yield return` a `Violation` with the **same `ruleKey`** the catalog uses.
2. Register it in `SemanticRules.All`.
3. The Node side maps those violations into the normal analyzer pipeline (see
   "Node integration" below).

`ReferenceEqualsOnValueType` (Roslyn CA2013) is the reference implementation.

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
- [ ] **MSBuildWorkspace** project loading — the next infra step, to unlock the ~18 rules needing `.csproj` properties / `RootNamespace` / library-vs-entry / cross-project / assembly attributes. **Product decision:** it makes C# semantic analysis require a *restored, buildable* project.
- [ ] Add the remaining niche framework refs (Blazor, MEF, WCF, Azure, test frameworks; WinForms/WPF are Windows-only) to unlock ~25 more rules — or load them via MSBuildWorkspace instead.
- [ ] ~20 deferred rules stay unshipped by the zero-FP bar (dataflow-heavy / heuristic) — the semantic analog of `not-applicable`.
- [ ] Distribution: ship a self-contained per-platform binary, or require the SDK.
