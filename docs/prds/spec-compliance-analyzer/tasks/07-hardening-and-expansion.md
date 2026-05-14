# Phase 7: Hardening and Expansion

## Status

`STATUS: DONE`

## Goal

Improve coverage, performance, framework support, and reporting after the MVP loop is stable and idempotent.

## Dependencies

- MVP implementation from Phase 1 through Phase 6
- Idempotency snapshot tests
- Real-world fixture coverage

## Tasks

- [x] Add deeper OpenAPI comparison for request bodies, response bodies, status codes, auth schemes, and operation IDs.
- [x] Add data/schema extractors for the repo's supported ORM/schema systems.
- [x] Expand auth matchers for roles, permissions, public routes, admin-only routes, and ownership checks.
- [x] Add infrastructure/config extractors for Docker, CI workflows, deployment manifests, and package scripts.
- [x] Add better test coverage mapping from requirement IDs, names, descriptions, route/text references, and static string references.
- [x] Add performance timing metadata for spec discovery, requirement extraction, fact extraction, matching, and finding conversion.
- [x] Add reports for cache hit rate and LLM call count.
- [x] Add documentation coverage for interpreting ambiguous, partial, conflicting, missing, unverifiable, and unspecified results.
- [x] Add larger mixed-domain fixture covering OpenAPI, Express, UI, auth, config, schema, infra, package, test hints, metrics, and cache behavior.

## Deferred outside Phase 37.7

- [ ] Improve React extraction for composed components and imported labels where statically resolvable.
- [ ] Add support for additional backend routing frameworks once core Express support is stable.
- [ ] Add deployment manifest and feature-flag extractors beyond the current Docker Compose, GitHub Actions, package script, and env-read coverage.
- [ ] Add real incremental analysis using spec chunk hashes and code file hashes. Current Phase 37.7 cache coverage is requirement extraction cache metrics and deterministic repeated-run output.
- [ ] Add optional manual requirement-to-code mapping support if real users need overrides.

## Test Tasks

- [x] Add OpenAPI comparison fixture tests.
- [x] Add schema/data fixture tests.
- [x] Add auth contradiction fixture tests.
- [x] Add infrastructure/config fixture tests.
- [x] Add performance regression tests around timing metadata and unchanged deterministic output.
- [x] Add large mixed-domain fixture idempotency assertions.
- [x] Add cache metrics tests.

## Acceptance Criteria

- Analyzer handles mixed UI, backend, data, config, infra, auth, and test specs.
- Large repos avoid repeated LLM calls for unchanged spec chunks.
- Performance metadata makes slow phases visible.
- Expanded extractors remain deterministic.
- Documentation explains known limitations and result categories.

## Notes

- Do not broaden framework support before the MVP has stable snapshots.
- New extractors and matchers should bump their own versions when behavior changes.
- Prefer small, independently testable extractor improvements over broad heuristic summaries.
