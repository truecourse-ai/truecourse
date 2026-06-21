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
schema — clean-room, our keys/logic, no third-party analyzer bundled. An LSP would
only surface its own diagnostics. (See `docs/CSHARP_OUTPERFORM_SONAR_PLAN.md`.)

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

`ReferenceEqualsOnValueType` (Sonar S2995 / CA2013) is the reference implementation.

## Build & smoke-test
```bash
dotnet build -c Release          # restores Microsoft.CodeAnalysis.CSharp
cat test.jsonl | ./bin/Release/net8.0/csharp-roslyn-host
```

## Status / next steps
- [x] Host skeleton: stdio JSON protocol, in-process `CSharpCompilation`, semantic-rule registry.
- [x] First real semantic rule (`referenceequals-on-value-type`) — validated end-to-end.
- [ ] **Node client**: spawn the host from the analyzer, stream changed files, ingest
      violations (a `csharp` entry in `lsp-servers/registry.ts` / a sibling of the
      Pyright path). Gate on `.NET SDK present`; fall back to tree-sitter-only when absent.
- [ ] **MSBuildWorkspace** project loading (replace the runtime-assembly reference set)
      for full cross-file / project fidelity.
- [ ] Port the ~210 deferred rules as `ISemanticRule`s, in waves (mirroring the
      tree-sitter waves), fixture-first to 0% FP.
- [ ] Distribution: ship a self-contained per-platform binary, or require the SDK.
