# Phase 1: Core Data Model

## Status

`STATUS: DONE`

## Goal

Add the shared types, schemas, stable ID helpers, canonical serialization, config shape, and finding category needed by the spec compliance analyzer.

## Dependencies

- Existing shared schema/type exports in `packages/shared`
- Existing analyzer/core finding model
- Existing config loading path in `packages/core`

## Tasks

- [x] Inventory the current finding/problem model and decide where `spec-compliance` metadata belongs.
- [x] Add shared Zod schemas for source ranges, extractor metadata, requirement constraints, requirements, code facts, compliance results, and compliance finding metadata.
- [x] Export TypeScript types inferred from the schemas.
- [x] Add enum-like schemas for requirement kind, modality, compliance status, and compliance severity.
- [x] Add a `SpecComplianceConfig` schema with defaultable fields for enablement, spec globs, exclusions, LLM usage, satisfied-result visibility, and failure behavior.
- [x] Add schema/version constants for requirement, code fact, compliance result, matcher, and prompt compatibility.
- [x] Add a canonical JSON serialization helper that sorts object keys recursively and produces stable strings for hashing/snapshots.
- [x] Add stable ID helpers for requirements and code facts using normalized paths, source ranges, canonical values, and extractor versions.
- [x] Add `spec-compliance` as a finding category without changing default analyzer behavior.
- [x] Document where future spec compliance artifacts should live in the core/analyzer package boundaries.

## Test Tasks

- [x] Add schema validation tests for valid requirement, code fact, and compliance result examples.
- [x] Add rejection tests for malformed LLM-shaped output.
- [x] Add stable ID tests proving repeated calls produce identical IDs.
- [x] Add canonical serialization tests for nested objects with different key orders.
- [x] Add config default tests.

## Acceptance Criteria

- Valid examples from the PRD validate successfully.
- Invalid structured output is rejected before it reaches matchers.
- Requirement IDs are stable across repeated runs for identical inputs.
- Code fact IDs are stable across repeated runs for identical inputs.
- Canonical serialization produces identical output for semantically identical objects with different key order.
- Existing analyzer output is unchanged unless spec compliance is explicitly enabled later.

## Notes

- Keep the data model framework-agnostic.
- Do not introduce LLM-specific fields into the core requirement model except extractor metadata and confidence.
- Prefer shared schemas for API/dashboard/CLI compatibility.

## Package Boundaries

- `packages/shared` owns the spec compliance data contracts, schema/version constants, canonical serialization, and stable ID helpers so CLI, dashboard, core, and analyzer integrations consume one contract.
- `packages/analyzer` should own future deterministic code fact extractors because they inspect source files, ASTs, configs, schemas, and manifests.
- `packages/core` should own orchestration, config loading, artifact persistence under `.truecourse/`, LLM-backed requirement extraction/cache integration, matcher execution, and conversion from compliance results into persisted findings.
