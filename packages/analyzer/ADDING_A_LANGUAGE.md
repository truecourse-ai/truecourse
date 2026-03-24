# Adding a New Language to TrueCourse

This guide covers every file that needs to change when adding support for a new programming language to the analyzer.

## Architecture Overview

The analyzer uses a **hybrid approach**: tree-sitter for fast AST extraction and metrics, and the **TypeScript Compiler API** for semantic analysis (module resolution, export detection, JSX references, polymorphic dispatch). For non-JS languages, the equivalent compiler/analyzer should be used (e.g., Python's `ast` module, Go's `go/packages`).

```
File Discovery → Parse (tree-sitter) → Extract (per-language) → FileAnalysis
                                                                      ↓
                                              TS Compiler API → Module Resolution
                                                              → Export Detection
                                                              → JSX References
                                                              → Interface Implementations
                                                                      ↓
                                              Downstream (language-agnostic): dependency graph,
                                              module extraction, service detection, violation rules
```

### Key design decisions

- **Structural entry point detection**: Files that import other files but are never imported themselves are detected as entry points (framework routes, scripts, CLI tools). No hardcoded framework patterns — works for any framework automatically.
- **Tree-sitter for metrics**: Statement count, nesting depth, line count, parameter count — fast bulk computation.
- **Language compiler for semantics**: Module resolution, export lists, type information — correct by construction.
- **Symlink resolution**: Workspace package imports resolve through `node_modules` symlinks. The dependency graph resolves symlinks to real paths to match analyzed files.

---

## Step-by-Step Checklist

### 1. Add to the SupportedLanguage enum

**File:** `packages/shared/src/types/analysis.ts`

```typescript
export const SupportedLanguageSchema = z.enum(['typescript', 'tsx', 'javascript', 'python'])
```

TypeScript will then flag every switch/case that needs updating.

Note: `tsx` is a separate language variant from `typescript` — it uses a different tree-sitter grammar that recognizes JSX syntax nodes. If your language has a similar variant (e.g., JSX for JavaScript), consider adding it as a separate entry.

### 2. Create the language config

**File:** `packages/analyzer/src/language-config.ts`

Create a new config constant and add it to `LANGUAGE_CONFIGS`:

```typescript
export const PYTHON_CONFIG: LanguageConfig = {
  name: 'python',
  fileExtensions: ['.py'],
  moduleResolution: {
    extensions: ['.py'],
    indexFiles: ['__init__.py'],
  },
  functionNodeTypes: ['function_definition'],
  classNodeTypes: ['class_definition'],
  importNodeTypes: ['import_statement', 'import_from_statement'],
  exportNodeTypes: [],  // Python doesn't have explicit exports
  callNodeTypes: ['call'],
  urlInterpolation: {
    baseUrlVar: /\{[^}]*[Uu]rl[^}]*\}/gi,
    paramVar: /\{[^}]+\}/g,
  },
  functionQuery: `(function_definition) @function`,
  classQuery: `(class_definition) @class`,
  importQuery: `
    (import_statement) @import
    (import_from_statement) @import
  `,
}

const LANGUAGE_CONFIGS: LanguageConfig[] = [TYPESCRIPT_CONFIG, TSX_CONFIG, JAVASCRIPT_CONFIG, PYTHON_CONFIG]
```

**What each field does:**

| Field | Purpose |
|-------|---------|
| `name` | Must match the `SupportedLanguage` enum value |
| `fileExtensions` | Used by `detectLanguage()` to match files during discovery |
| `moduleResolution.extensions` | Extensions to try when resolving imports (fallback only — used when no language compiler is available) |
| `moduleResolution.indexFiles` | Files to try for directory imports (fallback only) |
| `functionNodeTypes` | Tree-sitter AST node types that represent function declarations |
| `classNodeTypes` | Tree-sitter AST node types that represent class declarations |
| `importNodeTypes` | Tree-sitter AST node types for import statements |
| `exportNodeTypes` | Tree-sitter AST node types for export statements |
| `callNodeTypes` | Tree-sitter AST node types for function calls |
| `urlInterpolation` | Regex patterns for normalizing URL strings (see below) |
| `functionQuery` | Tree-sitter query string for capturing functions |
| `classQuery` | Tree-sitter query string for capturing classes |
| `importQuery` | Tree-sitter query string for capturing imports |
| `exportQuery` | Tree-sitter query string for capturing exports |

**How to find node types:** Use the [tree-sitter playground](https://tree-sitter.github.io/tree-sitter/playground) or inspect the grammar's `node-types.json` in the tree-sitter language package.

#### URL interpolation config

The `urlInterpolation` field tells the URL normalizer how this language embeds variables in URL strings. The flow-tracer is **language-agnostic** — it only sees normalized URLs like `/users/:param`. All language-specific interpolation syntax is stripped upstream using these patterns.

| Field | Purpose | Example (TypeScript) | Example (C#) |
|-------|---------|---------------------|---------------|
| `baseUrlVar` | Regex matching base-URL variables (removed entirely) | `/\$\{[^}]*URL[^}]*\}/gi` | `/\{[^}]*[Uu]rl[^}]*\}/gi` |
| `paramVar` | Regex matching interpolated path parameters (replaced with `:param`) | `/\$\{[^}]+\}/g` | `/\{[^}]+\}/g` |
| `stripChars` | Characters to strip from raw URL strings (optional) | `` /`/g `` (backticks) | not needed |

**How it works**: When building cross-service calls in `flow.service.ts`, raw URLs from source code are normalized via `normalizeUrl(url, language)`. This function applies the language's `urlInterpolation` config to produce clean route patterns.

- TypeScript `${BASE_URL}/users/${id}` → `/users/:param`
- C# `$"{baseUrl}/users/{id}"` → `/users/:param`

### 3. Add the tree-sitter parser

**File:** `packages/analyzer/src/parser.ts`

```typescript
import PythonParser from 'tree-sitter-python'

function getTreeSitterLanguage(language: SupportedLanguage): any {
  switch (language) {
    case 'typescript': return TypeScriptParser.typescript
    case 'tsx':        return TypeScriptParser.tsx
    case 'javascript': return JavaScriptParser
    case 'python':     return PythonParser
    // ...
  }
}
```

Also install the dependency:

```bash
cd packages/analyzer
pnpm add tree-sitter-python
```

### 4. Create the language extractor

**File:** `packages/analyzer/src/extractors/languages/{language}.ts` (new file)

Every language extractor must export 4 functions with these exact signatures:

```typescript
import type { Tree } from 'tree-sitter'
import type { FunctionDefinition, ClassDefinition, ImportStatement, ExportStatement } from '@truecourse/shared'

export function extractPythonFunctions(tree: Tree, filePath: string): FunctionDefinition[]
export function extractPythonClasses(tree: Tree, filePath: string): ClassDefinition[]
export function extractPythonImports(tree: Tree, filePath: string): ImportStatement[]
export function extractPythonExports(tree: Tree, filePath: string): ExportStatement[]
```

**Return types are defined in `packages/shared/src/types/analysis.ts`:**

- `FunctionDefinition` — name, params, returnType, isAsync, isExported, location, lineCount, statementCount, maxNestingDepth
- `ClassDefinition` — name, methods, properties, superClass, interfaces, location
- `ImportStatement` — source, specifiers, isTypeOnly
- `ExportStatement` — name, isDefault, source (for re-exports)

**Use helpers from `common.ts`:**

- `createSourceLocation(node, filePath)` — converts tree-sitter node position to SourceLocation
- `extractDocComment(node)` — extracts doc comments (preceding comment nodes)
- `computeFunctionMetrics(node)` — calculates lineCount, statementCount, maxNestingDepth

**Key extraction rules:**

- **Function names:** Only extract functions with real names. Nested lambdas/closures inside other functions should return `'anonymous'` — they get filtered out downstream.
- **Deduplication:** Use a `Set<string>` keyed on `startLine:startColumn` to skip duplicate AST captures.
- **Exports:** For languages without explicit export syntax (e.g., Python), infer from conventions (e.g., no leading underscore = public).
- **isExported:** For TS/JS, this is a basic heuristic (checks direct parent for `export_statement`). The TS compiler's export map overwrites it with the correct answer during analysis. For non-JS languages, provide the best heuristic you can — it may be the only source of export info.

### 5. Wire up the file analyzer

**File:** `packages/analyzer/src/file-analyzer.ts`

Add a case to both `analyzeFile()` and `analyzeFileContent()`:

```typescript
case 'python':
  functions = extractPythonFunctions(tree, filePath)
  classes = extractPythonClasses(tree, filePath)
  imports = extractPythonImports(tree, filePath)
  exports = extractPythonExports(tree, filePath)
  break
```

### 6. Export from the package

**File:** `packages/analyzer/src/index.ts`

```typescript
export {
  extractPythonFunctions,
  extractPythonClasses,
  extractPythonImports,
  extractPythonExports,
} from './extractors/languages/python.js'
```

### 7. Add semantic analysis support (compiler integration)

**File:** `packages/analyzer/src/ts-compiler.ts` (for TS/JS) or new file for other languages

For TS/JS/TSX, the TypeScript Compiler API handles:

- **Module resolution** — `ts.resolveModuleName()` resolves path aliases, workspace packages, re-exports, extension probing. Used in `dependency-graph.ts`.
- **Export detection** — `checker.getExportsOfModule()` gives the definitive list of exports per file, including grouped exports (`export { a, b }`), re-exports, and barrel files. Used in `analyzer.service.ts` to overwrite tree-sitter's basic `isExported` heuristic.
- **JSX reference extraction** — `extractJsxReferences()` uses `ts.createSourceFile()` to parse JSX and extract attribute references (`onClick={handler}`) and component tags (`<Child />`). Used in `extractors/calls.ts`.
- **Interface implementation detection** — `analyzeSemantics()` finds which classes implement interfaces, enabling polymorphic method call resolution.

For a new language, you'd need equivalent functionality:

| Capability | TS/JS implementation | What to build for new language |
|-----------|---------------------|-------------------------------|
| Module resolution | `ts.resolveModuleName()` | Language's module resolver (e.g., Python's import system, Go's module resolution) |
| Export detection | `checker.getExportsOfModule()` | Language's equivalent (e.g., Python AST for `__all__`, Go exported identifiers start with uppercase) |
| Template references | `extractJsxReferences()` | Language's template system (e.g., Jinja `{% include %}`, Go `template.Execute()`) |
| Interface implementations | `analyzeSemantics()` | Language's type system (e.g., Python ABC, Go interface satisfaction) |

### 8. Add framework and library detection patterns

The pattern files in `packages/analyzer/src/patterns/` drive service type detection (frontend vs API vs worker vs library), layer detection (data vs API vs external vs service), and database detection. They currently only contain **JS/TS ecosystem package names**. A new language needs its own equivalents.

#### Service detection patterns

**File:** `packages/analyzer/src/patterns/service-patterns.ts`

These patterns determine **what type of service** a directory is (frontend, API server, worker, library) by checking `package.json` dependencies. For a non-JS language, the service detector (`service-detector.ts`) would need to be extended to check the language's equivalent dependency file.

| Pattern group | JS/TS examples | Python equivalents | Go equivalents |
|---------------|---------------|-------------------|----------------|
| `metaFrameworks` | `next`, `nuxt`, `@nestjs/core` | `django`, `flask` | — |
| `frontendFrameworks` | `react`, `vue`, `svelte` | `jinja2`, `mako` | `templ` |
| `apiFrameworks` | `express`, `fastify`, `hono` | `flask`, `fastapi`, `django-rest-framework` | `gin`, `echo`, `fiber` |
| `workerFrameworks` | `bullmq`, `bee-queue` | `celery`, `dramatiq`, `rq` | `asynq`, `machinery` |
| `entryPointPatterns` | `index.ts`, `server.ts`, `main.ts` | `main.py`, `app.py`, `manage.py` | `main.go`, `cmd/*/main.go` |

**How framework detection works** (`service-detector.ts:detectFramework()`):
1. Reads `package.json` in the service directory
2. Checks `dependencies` + `devDependencies` against the pattern lists
3. Returns the first matching framework name (meta-frameworks checked first)

For non-JS languages, this needs a parallel path — e.g., parse `requirements.txt` / `pyproject.toml` for Python, or `go.mod` for Go.

#### Layer detection patterns

**File:** `packages/analyzer/src/patterns/layer-patterns.ts`

These patterns classify files into architectural layers by checking **import sources** against known library names.

| Layer | What it detects | JS/TS examples | Python equivalents | Go equivalents |
|-------|----------------|---------------|-------------------|----------------|
| **Data** | ORM/database imports | `prisma`, `drizzle-orm`, `mongoose` | `sqlalchemy`, `django.db`, `tortoise` | `gorm.io/gorm`, `ent` |
| **Data** | Database drivers | `pg`, `ioredis`, `mongodb` | `psycopg2`, `redis`, `pymongo` | `database/sql`, `go-redis` |
| **API** | Web framework imports | `express`, `next/server`, `@trpc/server` | `flask`, `fastapi`, `django.http` | `gin`, `net/http` |
| **API** | Route decorators/patterns | `@Get()`, `router.get(` | `@app.route()`, `@router.get()` | — |
| **External** | HTTP clients | `axios`, `node-fetch`, `got` | `requests`, `httpx`, `aiohttp` | `net/http` (client) |
| **External** | Cloud SDKs | `@aws-sdk/*`, `@google-cloud/*` | `boto3`, `google-cloud-*` | `aws-sdk-go` |
| **External** | Message queues | `bullmq`, `kafkajs`, `amqplib` | `celery`, `pika`, `kafka-python` | `confluent-kafka-go` |

**How layer detection works** (`layer-detector.ts`):
- For each analyzed file, checks its `imports[].source` against these pattern lists
- Also checks file path patterns (e.g., `**/models/**` → data layer, `**/routes/**` → API layer)
- File path patterns are mostly language-agnostic but may need language-specific extensions added

#### Database detection patterns

**File:** `packages/analyzer/src/patterns/database-patterns.ts`

Detects which databases are used and parses schema files.

| What | JS/TS examples | Python equivalents | Go equivalents |
|------|---------------|-------------------|----------------|
| ORM schema files | `prisma/schema.prisma`, `drizzle/*.ts` | `models.py`, `alembic/` | `ent/schema/` |
| Database drivers | `pg`, `mysql2`, `ioredis` | `psycopg2`, `pymysql`, `redis` | `lib/pq`, `go-redis` |

### 9. Add ORM/database detection

The analyzer has a database detection pipeline that identifies which databases and ORMs a project uses, then parses schema files to extract tables and relations. This is heavily language-specific.

#### Database import map

**File:** `packages/analyzer/src/patterns/database-patterns.ts`

`DATABASE_IMPORT_MAP` maps import source strings to database types. Currently all npm packages — a new language needs its equivalents:

| JS/TS import | Python equivalent | Go equivalent |
|-------------|------------------|---------------|
| `@prisma/client` | — | — |
| `drizzle-orm` | — | — |
| `mongoose` | `mongoengine` | — |
| `pg` | `psycopg2`, `asyncpg` | `lib/pq`, `pgx` |
| `ioredis` | `redis` | `go-redis` |
| `sequelize` | `sqlalchemy` | `gorm.io/gorm` |

`SCHEMA_FILE_PATTERNS` tells the detector where to look for schema files per ORM:

```typescript
prisma: ['**/prisma/schema.prisma'],
drizzle: ['**/drizzle/**/*.ts', '**/db/schema*.ts'],
// Python example:
// sqlalchemy: ['**/models/**/*.py', '**/models.py'],
// Go example:
// ent: ['**/ent/schema/*.go'],
```

#### Schema parsers

**Directory:** `packages/analyzer/src/schema-parsers/`

Each ORM that supports schema extraction has a dedicated parser:
- `prisma.ts` — parses `.prisma` schema files (custom syntax, not tree-sitter)
- `drizzle.ts` — parses Drizzle TypeScript schema files (uses tree-sitter)

These parsers extract `TableInfo[]` and `RelationInfo[]` from schema files. For a new language's ORMs, you'd add a new parser (e.g., `sqlalchemy.ts` that parses Python model classes).

**File:** `packages/analyzer/src/database-detector.ts`

The `detectDatabases()` function orchestrates everything:
1. Scans `imports[].source` against `DATABASE_IMPORT_MAP`
2. Parses Docker Compose for database services
3. Finds and parses schema files using ORM-specific parsers
4. Returns detected databases with tables, relations, and service connections

For a new language, you'd need to:
- Add entries to `DATABASE_IMPORT_MAP` for the language's database packages
- Add schema file patterns to `SCHEMA_FILE_PATTERNS`
- Optionally create a schema parser for the language's popular ORMs

### 10. Optional: HTTP call detection

**File:** `packages/analyzer/src/extractors/http-calls.ts`

Add the language to the guard at the top of `extractHttpCalls()`. The current implementation looks for common HTTP libraries (fetch, axios) via call expressions — this may work as-is if the language uses `call_expression` nodes. Otherwise, implement language-specific detection.

Each language has different HTTP client patterns:

| Language | Patterns |
|----------|----------|
| TypeScript/JavaScript | `fetch()`, `axios.get()`, `http.get()` |
| C# | `HttpClient.GetAsync()`, `HttpClient.PostAsync()` |
| Python | `requests.get()`, `httpx.get()`, `aiohttp` |

### 11. Optional: Route registration detection

**File:** `packages/analyzer/src/extractors/route-registrations.ts`

Add language-specific route registration detection. Each framework has different patterns:

| Language/Framework | Route Pattern | Mount Pattern |
|-------------------|---------------|---------------|
| TypeScript (Express) | `router.get('/path', handler)` | `app.use('/prefix', router)` |
| C# (ASP.NET) | `[HttpGet("/path")]` attribute on methods | `app.MapGet("/path", handler)` |
| C# (Minimal APIs) | `app.MapGet("/path", handler)` | `app.MapGroup("/prefix")` |
| Python (FastAPI) | `@app.get("/path")` decorator | `app.include_router(router, prefix="/prefix")` |
| Python (Flask) | `@app.route("/path")` decorator | `app.register_blueprint(bp, url_prefix="/prefix")` |

Either extend the existing extractor with language branches, or create per-language extractor files following the pattern in `extractors/languages/`.

### 12. Optional: Entity extraction

**File:** `packages/analyzer/src/extractors/entities.ts`

If the language has its own ORM patterns (e.g., SQLAlchemy for Python, GORM for Go), add import patterns to the `detectFrameworkFromSource()` method.

---

## What Does NOT Need to Change

These are language-agnostic and work on `FileAnalysis` objects:

- `module-extractor.ts` — module/method extraction from analyzed files
- `dependency-graph.ts` — uses TS compiler for JS/TS resolution; falls back to basic relative resolution for other languages
- `split-analyzer.ts` — service grouping and architecture detection
- `rules/module-rules-checker.ts` — deterministic rules use structural entry point detection (`findEntryPoints`), not hardcoded patterns. New frameworks are supported automatically.
- All frontend code
- All server code
- Database schema

### How entry point detection works

Instead of hardcoded framework patterns, entry points are detected **structurally**: after building the dependency graph, any file that imports other files but is never imported itself is an entry point. This automatically covers:

- Framework-routed files (`page.tsx`, `layout.tsx`, `manage.py`, `main.go`)
- CLI scripts and entry points
- Test files (excluded separately via test/config pattern)
- Worker entry points

No configuration needed per framework — it just works.

### How export detection works (TS/JS)

For TypeScript/JavaScript/TSX projects, the TS compiler's `checker.getExportsOfModule()` provides the definitive export list per file. This is computed during analysis in `analyzer.service.ts` and overwrites the tree-sitter `isExported` heuristic. It correctly handles:

- `export function foo()` — named export
- `export default function foo()` — default export (reported as `'default'`, matched to function name via `ExportStatement.isDefault`)
- `export { a, b, c }` — grouped exports
- `export { foo } from './bar'` — re-exports
- Barrel files (`index.ts` re-exporting from sub-modules)

For non-JS languages, the tree-sitter `isExported` heuristic is the only source — make it as accurate as possible.

### Gotchas

- **Workspace symlinks**: In monorepos, workspace package imports resolve through `node_modules` symlinks. The dependency graph uses `realpathSync` to resolve symlinks to actual file paths. If adding a language with its own workspace/package mechanism, ensure resolved paths match the analyzed file set.
- **JSX/template references are invisible to tree-sitter**: Static import analysis only tracks `import` statements. Component references in JSX (`<Foo />`), template syntax (`{% include %}`), or dependency injection are not captured as method-level calls by tree-sitter. For TS/JS, the TS compiler extracts JSX references via `extractJsxReferences()`. For other languages, you may need equivalent template reference extraction.
- **Default exports**: The TS compiler reports default exports with the name `'default'`, not the function name. The export map correction in `analyzer.service.ts` handles this by matching against the file's `ExportStatement.isDefault` flag.

---

## Testing

Add tests in `tests/analyzer/`:

1. **Parser test** — verify the tree-sitter parser loads and parses sample code
2. **Extractor tests** — test each of the 4 extract functions with representative code snippets
3. **Integration test** — analyze a sample file end-to-end via `analyzeFileContent()`
4. **Test fixtures** — create a sample project in the new language under `tests/fixtures/`, include a tsconfig.json (or equivalent) for module resolution
5. **Dependency graph tests** — verify imports resolve correctly for the language's module system
6. **Entry point tests** — verify framework entry files are detected structurally

---

## Reference: Existing Language Extractors

| Feature | TypeScript | TSX | JavaScript |
|---------|-----------|-----|------------|
| Return type annotations | Yes | Yes | No (always `undefined`) |
| Decorators | Yes | Yes | No |
| Interfaces / `implements` | Yes | Yes | No |
| Abstract classes | Yes | Yes | No |
| Type-only imports | Yes | Yes | No |
| Generator functions | No | No | Yes |
| Arrow functions | Yes | Yes | Yes |
| Async functions | Yes | Yes | Yes |
| Class properties | Yes | Yes | Yes |
| JSX references | No | Yes (via TS compiler) | No |

Use the TypeScript extractor as the most complete reference, and the JavaScript extractor to see how to omit features. TSX extends TypeScript with JSX support via a separate tree-sitter grammar.
