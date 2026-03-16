# Adding a New Language to TrueCourse

This guide covers every file that needs to change when adding support for a new programming language to the analyzer.

## Architecture Overview

The analyzer pipeline is:

```
File Discovery → Parse (tree-sitter) → Extract (per-language) → FileAnalysis → downstream (language-agnostic)
```

Once files are extracted into `FileAnalysis` objects, everything downstream (dependency graph, module extraction, layer detection, service detection) is **language-agnostic**. The language-specific work is isolated to parsing and extraction.

---

## Step-by-Step Checklist

### 1. Add to the SupportedLanguage enum

**File:** `packages/shared/src/types/analysis.ts`

```typescript
export const SupportedLanguageSchema = z.enum(['typescript', 'javascript', 'python'])
```

TypeScript will then flag every switch/case that needs updating.

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
  frameworkEntryPatterns: [
    /\bmanage\.py$/,
    /\bwsgi\.py$/,
    /\basgi\.py$/,
  ],
  functionQuery: `(function_definition) @function`,
  classQuery: `(class_definition) @class`,
  importQuery: `
    (import_statement) @import
    (import_from_statement) @import
  `,
}

const LANGUAGE_CONFIGS: LanguageConfig[] = [TYPESCRIPT_CONFIG, JAVASCRIPT_CONFIG, PYTHON_CONFIG]
```

**What each field does:**

| Field | Purpose |
|-------|---------|
| `name` | Must match the `SupportedLanguage` enum value |
| `fileExtensions` | Used by `detectLanguage()` to match files during discovery |
| `moduleResolution.extensions` | Extensions to try when resolving import paths |
| `moduleResolution.indexFiles` | Files to try for directory imports (e.g., `__init__.py`) |
| `functionNodeTypes` | Tree-sitter AST node types that represent function declarations |
| `classNodeTypes` | Tree-sitter AST node types that represent class declarations |
| `importNodeTypes` | Tree-sitter AST node types for import statements |
| `exportNodeTypes` | Tree-sitter AST node types for export statements |
| `callNodeTypes` | Tree-sitter AST node types for function calls |
| `frameworkEntryPatterns` | RegExp patterns for framework entry files (invoked by framework, not user code) |
| `functionQuery` | Tree-sitter query string for capturing functions |
| `classQuery` | Tree-sitter query string for capturing classes |
| `importQuery` | Tree-sitter query string for capturing imports |
| `exportQuery` | Tree-sitter query string for capturing exports |

**Framework entry patterns** deserve special attention. These are file naming conventions where the framework invokes the file directly (not user code). For example, Next.js automatically routes requests to `page.tsx`, `route.ts`, `layout.tsx`, etc. These files won't be imported by any other file in the codebase, so without this list they'd be flagged as "dead modules" by the analysis.

The `isFrameworkEntryFile()` function (exported from the analyzer) checks a file path against all registered language configs' `frameworkEntryPatterns`. It's used in `graph.service.ts` to exclude framework entry files from dead module detection.

Examples by framework:

| Framework | Entry file patterns |
|-----------|-------------------|
| Next.js | `page.tsx`, `route.ts`, `layout.tsx`, `loading.tsx`, `error.tsx`, `middleware.ts` |
| Django | `views.py`, `urls.py`, `admin.py`, `models.py`, `apps.py` |
| Flask | `app.py`, `wsgi.py` |
| Go (net/http) | `main.go` |

**How to find node types:** Use the [tree-sitter playground](https://tree-sitter.github.io/tree-sitter/playground) or inspect the grammar's `node-types.json` in the tree-sitter language package.

### 3. Add the tree-sitter parser

**File:** `packages/analyzer/src/parser.ts`

```typescript
import PythonParser from 'tree-sitter-python'

function getTreeSitterLanguage(language: SupportedLanguage): any {
  switch (language) {
    case 'typescript': return TypeScriptParser.typescript
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

### 7. Add framework and library detection patterns

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

### 8. Add ORM/database detection

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

### 9. Optional: HTTP call detection

**File:** `packages/analyzer/src/extractors/http-calls.ts`

Add the language to the guard at the top of `extractHttpCalls()`. The current implementation looks for common HTTP libraries (fetch, axios) via call expressions — this may work as-is if the language uses `call_expression` nodes. Otherwise, implement language-specific detection.

### 9. Optional: Entity extraction

**File:** `packages/analyzer/src/extractors/entities.ts`

If the language has its own ORM patterns (e.g., SQLAlchemy for Python, GORM for Go), add import patterns to the `detectFrameworkFromSource()` method.

---

## What Does NOT Need to Change

These are language-agnostic and work on `FileAnalysis` objects:

- `module-extractor.ts` — module/method extraction from analyzed files
- `dependency-graph.ts` — import resolution (uses language config automatically)
- `split-analyzer.ts` — service grouping and architecture detection
- `rules/` — analysis rules (operate on extracted data, not source code)
- All frontend code
- All server code
- Database schema

---

## Testing

Add tests in `tests/analyzer/`:

1. **Parser test** — verify the tree-sitter parser loads and parses sample code
2. **Extractor tests** — test each of the 4 extract functions with representative code snippets
3. **Integration test** — analyze a sample file end-to-end via `analyzeFileContent()`
4. **Test fixtures** — create a sample project in the new language under `tests/fixtures/`

---

## Reference: Existing Language Extractors

| Feature | TypeScript | JavaScript |
|---------|-----------|------------|
| Return type annotations | Yes | No (always `undefined`) |
| Decorators | Yes | No |
| Interfaces / `implements` | Yes | No |
| Abstract classes | Yes | No |
| Type-only imports | Yes | No |
| Generator functions | No | Yes |
| Arrow functions | Yes | Yes |
| Async functions | Yes | Yes |
| Class properties | Yes | Yes |

Use the TypeScript extractor as the most complete reference, and the JavaScript extractor to see how to omit features.
