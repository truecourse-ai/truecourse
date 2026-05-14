# Phase 4: Code Fact Extraction

## Status

`STATUS: DONE`

## Goal

Extract deterministic facts from source, config, schema, and test files so requirements can be evaluated without asking an LLM to summarize code.

## Dependencies

- Phase 1 code fact schema and stable ID helpers
- Existing tree-sitter and TypeScript analysis pipeline in `packages/analyzer`
- Existing fixture project under `tests/fixtures/sample-project`

## Tasks

- [x] Define the package boundary for code fact extraction between `packages/analyzer` and `packages/core`.
- [x] Add a code fact extractor registry with stable extractor names and versions.
- [x] Extract Express routes, methods, paths, route source ranges, and direct middleware references.
- [x] Extract common router patterns such as `router.get`, `router.post`, `app.use`, mounted routers, and nested route prefixes where statically resolvable.
- [x] Extract basic auth and permission signals from middleware names, guard calls, and role checks.
- [x] Extract React Router routes and page/component mappings.
- [x] Extract JSX visible text literals from TSX/JSX files.
- [x] Extract JSX form fields, labels, required flags, button labels, and validation message literals where statically visible.
- [x] Extract environment variable reads from `process.env.*` and `process.env["NAME"]`.
- [x] Extract package scripts and relevant manifest metadata from `package.json`.
- [x] Extract test names and string references that may indicate coverage of a requirement.
- [x] Attach source files and source ranges wherever possible.
- [x] Sort all emitted facts deterministically.
- [x] Ignore unsupported files safely.

## Test Tasks

- [x] Add Express route fixture tests.
- [x] Add mounted router and prefix fixture tests.
- [x] Add React Router fixture tests.
- [x] Add JSX visible text fixture tests.
- [x] Add JSX form field fixture tests.
- [x] Add env var fixture tests.
- [x] Add package script fixture tests.
- [x] Add test name/reference fixture tests.
- [x] Add repeated-run tests proving identical code facts and sort order.

## Acceptance Criteria

- All emitted facts validate against the shared code fact schema.
- Facts include source references when available.
- Extractors do not use LLMs.
- Unsupported syntax or files do not crash analysis.
- Repeated runs over identical code produce identical facts.

## Notes

- Prefer AST and TypeScript compiler data over string matching when reasonable.
- Keep extractor output factual, not interpretive.
- Avoid broad "summary" facts that make deterministic matching difficult.
