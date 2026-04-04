# Madge Research: Lessons for TrueCourse

Deep analysis of [Madge](https://github.com/pahen/madge) (state-of-the-art JS/TS dependency graph tool) and comparison with TrueCourse's analyzer.

## Where TrueCourse is already ahead

| Area | Madge | TrueCourse |
|------|-------|------------|
| **Granularity** | File-level only (A→B) | File → Module → Method level |
| **What's imported** | Not tracked (Madge issue #437, #456) | Tracks `importedNames` per dependency |
| **Architecture awareness** | None | Detects services, layers (data/api/service/external) |
| **Issue detection** | Only circular deps & orphans | Circular deps, god services, dead code, unused imports, large functions, layer violations |
| **Type imports** | Coarse toggle (Madge issue #445) | Proper `typeOnly` flag per import |
| **Monorepo support** | Broken (Madge issue #428) | Native: pnpm workspaces, lerna, nx, turbo |
| **Barrel file handling** | Delegated, buggy (Madge issue #426) | Explicit bridging logic for re-export-only files |
| **AI analysis** | None | LLM-powered contextual rules |

## What we can learn from Madge

Ordered by impact:

### 1. CI exit codes for circular dependency checks

Madge exits with code 1 when `--circular` finds cycles — directly usable as a CI gate. Our CLI (`tools/cli/`) should support a `--ci` or `--strict` flag that returns non-zero exit codes when violations are found. This is a simple, high-value feature for adoption.

### 2. Reverse dependency lookup (`--depends <module>`)

Madge's `depends()` method answers "who depends on X?" — essential for impact analysis before refactoring. We build the forward graph but don't expose a reverse lookup API. Adding this is trivial (invert the adjacency list) but very useful.

### 3. Orphan/leaf detection as first-class features

Madge surfaces orphans (no incoming deps → potential dead code) and leaves (no outgoing deps → leaf nodes) as explicit queries. We detect dead modules but don't expose orphan/leaf queries as standalone features in the CLI or UI. These are low-hanging fruit.

### 4. DOT/Graphviz export

Madge can export to DOT format, enabling users to render with any Graphviz tool or integrate into docs. We only have the React Flow UI. Adding `--dot` and `--json` export from the CLI would make the tool usable in more workflows (CI reports, documentation, custom visualizations).

### 5. Stdin/JSON piping for composability

Madge's `--stdin` reads a pre-built dependency tree, enabling Unix-style composition. We could accept a JSON graph as input, allowing users to transform/filter the graph with `jq` or other tools before visualizing.

### 6. Progress feedback during analysis

Madge shows which file is currently being processed via an `ora` spinner. For large codebases, our analyzer runs silently. Adding progress callbacks (file count, current file) would improve UX, especially in CLI mode.

### 7. Configurable exclude patterns for dependency edges

Madge supports `excludeRegExp` arrays for filtering modules. We use `.truecourseignore` (gitignore-style), which is good, but adding regex-based exclusion for dependency edges (not just files) would allow users to ignore known acceptable cycles or noisy dependencies.

### 8. Summary view with dependency counts

Madge's `--summary` sorts modules by dependency count (descending), instantly revealing the most coupled modules. We could add a similar view — "top 10 most depended-upon modules" and "top 10 modules with most dependencies" — to quickly spot architectural hotspots.

### 9. Cycle detection algorithm improvements

Madge uses simple DFS which can miss cycles or report inconsistently (their issue #447). We also use simple bidirectional edge checking for services. We should implement **Tarjan's SCC algorithm** for proper strongly-connected-component detection — this would find ALL cycles reliably, including transitive ones (A→B→C→A), and group overlapping cycles into components. This is more correct than what either tool currently does.

### 10. Dynamic vs static import distinction

Madge's issue #450 notes they can't distinguish `import()` from `import` — lazy circular deps are often safe. We already extract dynamic imports separately but should use this information in our circular dependency analysis: flag static circular deps as errors but dynamic ones as warnings.

### 11. `dependencyFilter` callback for programmatic use

Madge allows a function callback to filter dependencies programmatically. For our API/SDK surface, exposing similar hooks would enable advanced users to customize analysis without forking.

## Madge's architecture (for reference)

Madge is remarkably lean — ~500 lines of logic across 6 source files. It delegates all parsing to the `dependency-tree` / `precinct` / `detective-*` ecosystem:

- **`lib/api.js`** — Main `Madge` class. Accepts paths, merges config, exposes query methods (`.circular()`, `.depends()`, `.orphans()`, `.leaves()`, `.dot()`, `.image()`, `.svg()`).
- **`lib/tree.js`** — File discovery + dependency extraction via `dependency-tree`. Flattens deep nested trees into shallow adjacency lists.
- **`lib/cyclic.js`** — DFS with coloring for circular dependency detection (~50 lines).
- **`lib/graph.js`** — Graphviz DOT generation via `ts-graphviz`.
- **`lib/output.js`** — CLI output formatting (JSON, text, summary).
- **`bin/cli.js`** — CLI entry point using `commander`.

### Graph representation

Shallow adjacency list as a plain object:

```javascript
{
  "src/app.js": ["src/utils.js", "src/config.js"],
  "src/utils.js": ["src/helpers.js"],
  "src/config.js": []
}
```

### Cycle detection algorithm

Classic DFS with two tracking sets (`resolved` and `unresolved`). When a node is encountered that is in `unresolved`, a cycle is found. Cycle path is extracted by exploiting JavaScript's guaranteed property insertion order. This is NOT Tarjan's SCC — it finds individual cycle paths, which can produce redundant output for highly interconnected graphs.

### Madge's known limitations

1. No `package.json` `"imports"` field / `#hash` subpath imports (issue #406)
2. Barrel file resolution problems (issue #426)
3. TypeScript version sensitivity, especially with Vue (issues #416, #441)
4. No monorepo/pnpm workspace support (issue #428)
5. Inconsistent circular detection depending on traversal order (issue #447)
6. No distinction between static and dynamic imports (issue #450)
7. No tracking of what's imported, only that A depends on B (issues #437, #456)
8. No CSS `url()` support (issue #407)
9. Single-threaded, no worker parallelism
10. No incremental/cached analysis — full re-scan every run
11. Graph rendering requires external Graphviz installation

## Key architectural takeaway

Madge's genius is its simplicity — delegation to battle-tested parsers keeps the codebase tiny. But this is also its ceiling. It's a presentation layer over someone else's parser, which means it can't go deeper than file-level granularity.

TrueCourse owns the full pipeline (tree-sitter parsing → extraction → resolution → graph → rules), giving us capabilities Madge fundamentally cannot achieve: method-level dependencies, architectural layer detection, AI-driven analysis. The tradeoff is complexity, but it's the right tradeoff for a tool that aims to be more than a cycle detector.

**The biggest gaps to close are around CLI ergonomics and composability (items 1-6) — Madge excels at being a Unix citizen, and we should match that.**
