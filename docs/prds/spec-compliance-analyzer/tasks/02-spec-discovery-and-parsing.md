# Phase 2: Spec Discovery and Deterministic Parsing

## Status

`STATUS: DONE`

## Goal

Find spec files, split prose specs into stable chunks, extract deterministic requirements from structured specs where possible, and preserve source ranges.

## Dependencies

- Phase 1 schemas and ID helpers
- Existing file discovery utilities
- Existing repo ignore handling

## Tasks

- [x] Add default spec include globs for `docs/**`, `specs/**`, `requirements/**`, `rfcs/**`, `adr/**`, `*.spec.md`, `*.prd.md`, and `*.requirements.md`.
- [x] Add configurable spec include/exclude support through `SpecComplianceConfig`.
- [x] Reuse existing repo file discovery and ignore handling where possible.
- [x] Sort discovered spec files deterministically by normalized path.
- [x] Add Markdown/MDX chunking by heading sections with stable chunk IDs and start/end line ranges.
- [x] Preserve fenced code blocks and lists inside the owning Markdown section.
- [x] Add plain text chunking with deterministic paragraph or heading-like boundaries.
- [x] Add deterministic extraction for OpenAPI paths, methods, request schemas, response schemas, and auth hints.
- [x] Add deterministic extraction for JSON/YAML specs where the shape is known or strongly typed.
- [x] Mark unsupported structured spec shapes as unverifiable or unsupported rather than failing the analysis.
- [x] Return a spec extraction manifest containing files, chunks, hashes, source ranges, and extractor versions.

## Test Tasks

- [x] Add fixture specs with nested Markdown headings and lists.
- [x] Add tests proving Markdown chunk ranges point to correct lines.
- [x] Add tests proving chunk IDs are stable across repeated runs.
- [x] Add tests for spec include/exclude patterns.
- [x] Add OpenAPI fixture tests for route requirement extraction.
- [x] Add malformed JSON/YAML tests that fail safely.

## Acceptance Criteria

- Configured spec files are discovered in deterministic order.
- Markdown chunks are stable across repeated runs.
- Source references point to correct lines.
- Structured specs can produce requirements without LLM usage.
- Unsupported or malformed specs do not crash the analyzer.

## Notes

- This phase should not require live LLM calls.
- Chunk hashes should be ready for the LLM cache introduced in Phase 3.
- Avoid ad hoc parsing where a structured parser already exists in the toolchain.
