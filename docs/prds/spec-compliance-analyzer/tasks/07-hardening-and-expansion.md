# Phase 7: Hardening and Expansion

## Status

`STATUS: TODO`

## Goal

Improve coverage, performance, framework support, and reporting after the MVP loop is stable and idempotent.

## Dependencies

- MVP implementation from Phase 1 through Phase 6
- Idempotency snapshot tests
- Real-world fixture coverage

## Tasks

- [ ] Add deeper OpenAPI comparison for request bodies, response bodies, status codes, auth schemes, and operation IDs.
- [ ] Add data/schema extractors for the repo's supported ORM/schema systems.
- [ ] Expand auth matchers for roles, permissions, public routes, admin-only routes, and ownership checks.
- [ ] Improve React extraction for composed components and imported labels where statically resolvable.
- [ ] Add support for additional backend routing frameworks once core Express support is stable.
- [ ] Add infrastructure/config extractors for Docker, CI workflows, deployment manifests, and feature flags.
- [ ] Add better test coverage mapping from requirement IDs, names, descriptions, and route/text references.
- [ ] Add performance timing metadata for spec discovery, requirement extraction, fact extraction, matching, and rendering.
- [ ] Add incremental analysis using spec chunk hashes and code file hashes.
- [ ] Add reports for cache hit rate and LLM call count.
- [ ] Add optional manual requirement-to-code mapping support if real users need overrides.
- [ ] Add documentation for interpreting ambiguous and unverifiable results.
- [ ] Add larger mixed-domain fixtures.

## Test Tasks

- [ ] Add OpenAPI comparison fixture tests.
- [ ] Add schema/data fixture tests.
- [ ] Add auth contradiction fixture tests.
- [ ] Add infrastructure/config fixture tests.
- [ ] Add performance regression tests around unchanged specs and code.
- [ ] Add large fixture idempotency snapshots.
- [ ] Add cache metrics tests.

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

