# Adding a New Language to TrueCourse

This guide covers every file that needs to change when adding support for a new programming language to the analyzer.

## Architecture Overview

The analyzer uses a **hybrid approach**: tree-sitter for fast AST extraction and metrics, and language-specific semantic analysis via LSP servers (or the TypeScript Compiler API for JS/TS).

```
File Discovery → Parse (tree-sitter) → Extract (per-language) → FileAnalysis
                                                                      ↓
                                              Semantic Analysis (LSP or TS Compiler)
                                              → Module Resolution
                                              → Export Detection
                                              → Type Information
                                              → Interface/Protocol Implementations
                                                                      ↓
                                              Downstream (language-agnostic): dependency graph,
                                              module extraction, service detection, violation rules
```

### Key design decisions

- **Structural entry point detection**: Files that import other files but are never imported themselves are detected as entry points. No hardcoded framework patterns — works for any framework automatically.
- **Tree-sitter for metrics**: Statement count, nesting depth, line count, parameter count — fast bulk computation.
- **LSP for semantics**: Non-JS languages use LSP servers for module resolution, export lists, type information. TypeScript uses its own compiler API (in-process).
- **Per-language registries**: Language-specific logic lives in dedicated files and registers via registries. The core pipeline is language-agnostic.

---

## Step-by-Step Checklist

### 1. Add to the SupportedLanguage enum

**File:** `packages/shared/src/types/analysis.ts`

```typescript
export const SupportedLanguageSchema = z.enum(['typescript', 'tsx', 'javascript', 'python', 'YOUR_LANGUAGE'])
```

TypeScript will then flag every switch/case that needs updating.

### 2. Create the language config

**File:** `packages/analyzer/src/language-config.ts`

Add a new config constant with all required fields:

```typescript
export const YOUR_LANG_CONFIG: LanguageConfig = {
  name: 'your_language',
  fileExtensions: ['.ext'],
  moduleResolution: {
    extensions: ['.ext'],
    indexFiles: ['index.ext'],        // barrel/entry files
  },
  functionNodeTypes: ['...'],          // tree-sitter node types
  classNodeTypes: ['...'],
  importNodeTypes: ['...'],
  exportNodeTypes: ['...'],
  callNodeTypes: ['...'],
  urlInterpolation: { ... },           // how this language embeds variables in URL strings
  packageIndicatorFiles: ['...'],      // files that indicate a directory is a project (e.g., go.mod)
  ignorePatterns: ['...'],             // directories to exclude (e.g., __pycache__/)
  testPatterns: ['...'],               // test file patterns to exclude
  bootstrap: {
    filePattern: /regex/,              // entry point file names (e.g., main.go)
    functionNames: ['main', ...],      // bootstrap function names to skip in flow tracing
  },
}
```

Add to `LANGUAGE_CONFIGS` array.

### 3. Add the tree-sitter parser

**File:** `packages/analyzer/src/parser.ts`

```typescript
import YourParser from 'tree-sitter-your-language'

case 'your_language': return YourParser
```

Install: `pnpm add tree-sitter-your-language` in `packages/analyzer`.

### 4. Create the language extractor

**File:** `packages/analyzer/src/extractors/languages/your_language.ts` (new file)

Export 4 functions:

```typescript
export function extractYourFunctions(tree: Tree, filePath: string): FunctionDefinition[]
export function extractYourClasses(tree: Tree, filePath: string): ClassDefinition[]
export function extractYourImports(tree: Tree, filePath: string): ImportStatement[]
export function extractYourExports(tree: Tree, filePath: string): ExportStatement[]
```

See `python.ts` or `typescript.ts` for reference.

### 5. Wire up the file analyzer

**File:** `packages/analyzer/src/file-analyzer.ts`

Add a `case 'your_language':` in both `analyzeFile()` and `analyzeFileContent()` switches.

### 6. Export from the package

**File:** `packages/analyzer/src/index.ts`

Export your extractor functions and any new registries.

### 7. Add semantic analysis support (LSP server)

**For TypeScript/JavaScript/TSX:** Uses the TS Compiler API in-process (`ts-compiler.ts`).

**For all other languages:** Uses LSP servers via `lsp-client.ts`.

#### Steps:

1. **Create server config:** `packages/analyzer/src/lsp-servers/your_language.ts`
   - Binary path, launch args, initialization options

2. **Register in:** `packages/analyzer/src/lsp-servers/registry.ts`
   ```typescript
   const LSP_SERVER_FACTORIES: Partial<Record<SupportedLanguage, () => LspServerConfig>> = {
     python: createPyrightConfig,
     your_language: createYourServerConfig,  // ← add here
   }
   ```

3. No changes needed to `analyzer.service.ts` — the LSP loop picks it up automatically.

**Known LSP servers per language:**

| Language | LSP Server | Install |
|---|---|---|
| Python | Pyright | `pnpm add pyright` |
| C# | OmniSharp | binary download |
| Go | gopls | `go install golang.org/x/tools/gopls@latest` |
| Java | Eclipse JDT | binary download |
| Rust | rust-analyzer | binary download |
| PHP | Intelephense | `pnpm add intelephense` |

### 8. Add import resolver

**File:** `packages/analyzer/src/resolvers/your_language.ts` (new file)

Implement import resolution for your language's module system:

```typescript
export function resolveYourImport(
  importSource: string,
  containingFile: string,
  rootPath: string,
  analyzedFiles: Set<string>,
): string | null { ... }
```

**Register in:** `packages/analyzer/src/resolvers/registry.ts`

### 9. Add service detection

**File:** `packages/analyzer/src/service-detectors/your_language.ts` (new file)

Implement dependency reading and library detection:

```typescript
export const yourServiceDetector: LanguageServiceDetector = {
  readDependencies(servicePath) { ... },   // read from go.mod, Cargo.toml, etc.
  isLibrary(servicePath, files, ...) { ... },
}
```

**Register in:** `packages/analyzer/src/service-detectors/registry.ts`

### 10. Add framework and library detection patterns

**Files in `packages/analyzer/src/patterns/`:**

Add your language's frameworks, ORMs, drivers, HTTP clients to the existing pattern arrays with `// YourLanguage` comments:

- `service-patterns.ts` — API frameworks, worker frameworks, entry point files
- `layer-patterns.ts` — ORMs, database drivers, API imports, HTTP clients
- `database-patterns.ts` — DATABASE_IMPORT_MAP entries, SCHEMA_FILE_PATTERNS

### 11. Add HTTP call detection

**File:** `packages/analyzer/src/extractors/http/matchers.ts`

Add a matcher for your language's HTTP client libraries:

```typescript
const yourMatcher: HttpMatcher = {
  isHttpCall(calleeName) { ... },
  getClientType(calleeName) { ... },
}
```

Register in the `MATCHERS` map.

### 12. Add route detection

**File:** `packages/analyzer/src/extractors/routes/your_language.ts` (new file)

Implement route extraction for your language's web frameworks:

```typescript
export function extractYourRoutes(tree, filePath): { routes, mounts } { ... }
```

**Register in:** `packages/analyzer/src/extractors/route-registrations.ts` (add a `case` in the switch).

### 13. Add code rule visitors

**File:** `packages/analyzer/src/rules/code-visitors/your_language.ts` (new file)

Implement language-specific code rule visitors:

```typescript
export const YOUR_VISITORS: CodeRuleVisitor[] = [ ... ]
```

**Register in:** `packages/analyzer/src/rules/code-rule-visitor.ts` (spread into `ALL_CODE_VISITORS`).

### 14. Add schema parser (if the language has ORMs)

**File:** `packages/analyzer/src/schema-parsers/your_orm.ts` (new file)

**Register in:** `packages/analyzer/src/schema-parsers/registry.ts`

---

## What Does NOT Need to Change

These are language-agnostic and work on `FileAnalysis` objects:

- `module-extractor.ts` — module/method extraction from analyzed files
- `dependency-graph.ts` — dispatches to per-language resolvers automatically
- `split-analyzer.ts` — service grouping and architecture detection
- `rules/module-rules-checker.ts` — deterministic rules use structural entry point detection
- `flow-tracer.ts` — uses language config for bootstrap detection
- `file-discovery.ts` — uses language config for ignore/test patterns
- All frontend code
- All server code
- Database schema

---

## Summary: Files to Create/Edit

### New files (per language):

| File | Purpose |
|---|---|
| `extractors/languages/{lang}.ts` | Tree-sitter extractor (functions, classes, imports, exports) |
| `lsp-servers/{lang}.ts` | LSP server configuration |
| `resolvers/{lang}.ts` | Import resolution |
| `service-detectors/{lang}.ts` | Dependency reading, library detection |
| `extractors/routes/{lang}.ts` | Route/endpoint detection |
| `rules/code-visitors/{lang}.ts` | Code rule visitors |
| `schema-parsers/{orm}.ts` | ORM schema parser (optional) |

### Registries to update (one line each):

| Registry | Purpose |
|---|---|
| `lsp-servers/registry.ts` | LSP server lookup |
| `resolvers/registry.ts` | Import resolver lookup |
| `service-detectors/registry.ts` | Service detection |
| `extractors/http/matchers.ts` | HTTP call matching |
| `extractors/route-registrations.ts` | Route dispatch (switch case) |
| `rules/code-rule-visitor.ts` | Code visitor assembly |
| `schema-parsers/registry.ts` | Schema parser lookup |

### Config to update:

| File | What to add |
|---|---|
| `shared/types/analysis.ts` | Language name to enum |
| `language-config.ts` | Full language config |
| `parser.ts` | Tree-sitter parser case |
| `file-analyzer.ts` | Extractor dispatch case |
| `patterns/*.ts` | Framework/ORM/driver names |

---

## Testing

Add tests in `tests/analyzer/`:

1. **Parser test** — verify tree-sitter parser loads and parses
2. **Extractor tests** — test each of the 4 extract functions
3. **Flow test** — verify flows trace correctly for a fixture project
4. **Graph snapshot test** — full pipeline against a fixture, compare with `expected-graph.json`

Create a fixture project under `tests/fixtures/sample-{lang}-project/` that mirrors the existing `sample-project` architecture.
