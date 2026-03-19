# Adding a New Language

This guide covers what needs to change when adding support for a new programming language (e.g., C#, Python, Go).

## 1. Language Config (`packages/analyzer/src/language-config.ts`)

Add a new `LanguageConfig` object and register it in `LANGUAGE_CONFIGS`. Required fields:

### `urlInterpolation`

Tells the URL normalizer how this language embeds variables in URL strings. The flow-tracer is **language-agnostic** — it only sees normalized URLs like `/users/:param`. All language-specific interpolation syntax is stripped upstream using these patterns.

| Field | Purpose | Example (TypeScript) | Example (C#) |
|-------|---------|---------------------|---------------|
| `baseUrlVar` | Regex matching base-URL variables (removed entirely) | `/\$\{[^}]*URL[^}]*\}/gi` | `/\{[^}]*[Uu]rl[^}]*\}/gi` |
| `paramVar` | Regex matching interpolated path parameters (replaced with `:param`) | `/\$\{[^}]+\}/g` | `/\{[^}]+\}/g` |
| `stripChars` | Characters to strip from raw URL strings (optional) | `/\`/g` (backticks) | not needed |

**How it works**: When building cross-service calls in `flow.service.ts`, raw URLs from source code are normalized via `normalizeUrl(url, language)`. This function applies the language's `urlInterpolation` config to produce clean route patterns.

TypeScript `${BASE_URL}/users/${id}` → `/users/:param`
C# `$"{baseUrl}/users/{id}"` → `/users/:param`

### Other required fields

- `fileExtensions` — e.g., `['.cs']`
- `moduleResolution` — how imports resolve to files
- `functionNodeTypes`, `classNodeTypes`, etc. — tree-sitter AST node types for this language
- `frameworkEntryPatterns` — regex patterns for framework entry files

## 2. Tree-sitter Parser (`packages/analyzer/src/parser.ts`)

Install the tree-sitter grammar package and register it:
- `npm install tree-sitter-c-sharp` (or equivalent)
- Add the language to the parser initialization

## 3. Language Extractors (`packages/analyzer/src/extractors/languages/`)

Create a new file (e.g., `csharp.ts`) implementing extraction functions:
- `extractCSharpFunctions`
- `extractCSharpClasses`
- `extractCSharpImports`
- `extractCSharpExports`

These use tree-sitter queries specific to the language's AST.

## 4. HTTP Call Extractor (`packages/analyzer/src/extractors/http-calls.ts`)

Add language-specific HTTP call detection. Each language has different HTTP client patterns:

| Language | Patterns |
|----------|----------|
| TypeScript/JavaScript | `fetch()`, `axios.get()`, `http.get()` |
| C# | `HttpClient.GetAsync()`, `HttpClient.PostAsync()` |
| Python | `requests.get()`, `httpx.get()`, `aiohttp` |

## 5. Route Registration Extractor (`packages/analyzer/src/extractors/route-registrations.ts`)

Add language-specific route registration detection. Each framework has different patterns:

| Language/Framework | Route Pattern | Mount Pattern |
|-------------------|---------------|---------------|
| TypeScript (Express) | `router.get('/path', handler)` | `app.use('/prefix', router)` |
| C# (ASP.NET) | `[HttpGet("/path")]` attribute on methods | `app.MapGet("/path", handler)` |
| C# (Minimal APIs) | `app.MapGet("/path", handler)` | `app.MapGroup("/prefix")` |
| Python (FastAPI) | `@app.get("/path")` decorator | `app.include_router(router, prefix="/prefix")` |
| Python (Flask) | `@app.route("/path")` decorator | `app.register_blueprint(bp, url_prefix="/prefix")` |

Either extend the existing extractor with language branches, or create per-language extractor files following the pattern in `extractors/languages/`.

## 6. File Analyzer (`packages/analyzer/src/file-analyzer.ts`)

Add the new language to the `switch` statements in both `analyzeFile` and `analyzeFileContent`.

## 7. Shared Types (`packages/shared/src/types/analysis.ts`)

Add the new language to `SupportedLanguageSchema`:

```ts
export const SupportedLanguageSchema = z.enum(['typescript', 'javascript', 'csharp'])
```

## Architecture Notes

### What is language-agnostic (do NOT add language-specific code here)

- **`flow-tracer.ts`** — Receives normalized data. URLs use `:param` convention. Route handlers are a simple `Map<string, RouteHandler>`. No language-specific string handling.
- **`flow.service.ts`** — Orchestrates normalization using `normalizeUrl()` from language config. Does not contain language-specific logic itself.
- **Shared types** — `RouteRegistration`, `RouterMount`, `CrossServiceCall` are language-agnostic data structures.

### What is language-specific (add new code here for each language)

- **Language config** — `urlInterpolation` patterns
- **Extractors** — HTTP calls, route registrations, functions, classes, imports, exports
- **Parser** — tree-sitter grammar registration

### Testing

- Add extractor tests in `tests/analyzer/` (e.g., `csharp-extractors.test.ts`)
- Add route registration tests for the new framework patterns
- Add fixture files in `tests/fixtures/` for the new language
- Existing flow-tracer tests should continue to pass (they use normalized data)
