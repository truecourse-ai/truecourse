# Phase 4: Code Fact Extraction

## Status

`STATUS: TODO`

## Goal

Extract deterministic facts from source, config, schema, and test files so requirements can be evaluated without asking an LLM to summarize code.

## Dependencies

- Phase 1 code fact schema and stable ID helpers
- Existing tree-sitter and TypeScript analysis pipeline in `packages/analyzer`
- Existing fixture project under `tests/fixtures/sample-project`

## Tasks

- [ ] Define the package boundary for code fact extraction between `packages/analyzer` and `packages/core`.
- [ ] Add a code fact extractor registry with stable extractor names and versions.
- [ ] Extract Express routes, methods, paths, route source ranges, and direct middleware references.
- [ ] Extract common router patterns such as `router.get`, `router.post`, `app.use`, mounted routers, and nested route prefixes where statically resolvable.
- [ ] Extract basic auth and permission signals from middleware names, guard calls, and role checks.
- [ ] Extract React Router routes and page/component mappings.
- [ ] Extract JSX visible text literals from TSX/JSX files.
- [ ] Extract JSX form fields, labels, required flags, button labels, and validation message literals where statically visible.
- [ ] Extract environment variable reads from `process.env.*` and `process.env["NAME"]`.
- [ ] Extract package scripts and relevant manifest metadata from `package.json`.
- [ ] Extract test names and string references that may indicate coverage of a requirement.
- [ ] Attach source files and source ranges wherever possible.
- [ ] Sort all emitted facts deterministically.
- [ ] Ignore unsupported files safely.

## Test Tasks

- [ ] Add Express route fixture tests.
- [ ] Add mounted router and prefix fixture tests.
- [ ] Add React Router fixture tests.
- [ ] Add JSX visible text fixture tests.
- [ ] Add JSX form field fixture tests.
- [ ] Add env var fixture tests.
- [ ] Add package script fixture tests.
- [ ] Add test name/reference fixture tests.
- [ ] Add repeated-run tests proving identical code facts and sort order.

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

