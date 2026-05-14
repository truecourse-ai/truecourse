# Phase 2: Spec Discovery and Deterministic Parsing

## Status

`STATUS: TODO`

## Goal

Find spec files, split prose specs into stable chunks, extract deterministic requirements from structured specs where possible, and preserve source ranges.

## Dependencies

- Phase 1 schemas and ID helpers
- Existing file discovery utilities
- Existing repo ignore handling

## Tasks

- [ ] Add default spec include globs for `docs/**`, `specs/**`, `requirements/**`, `rfcs/**`, `adr/**`, `*.spec.md`, `*.prd.md`, and `*.requirements.md`.
- [ ] Add configurable spec include/exclude support through `SpecComplianceConfig`.
- [ ] Reuse existing repo file discovery and ignore handling where possible.
- [ ] Sort discovered spec files deterministically by normalized path.
- [ ] Add Markdown/MDX chunking by heading sections with stable chunk IDs and start/end line ranges.
- [ ] Preserve fenced code blocks and lists inside the owning Markdown section.
- [ ] Add plain text chunking with deterministic paragraph or heading-like boundaries.
- [ ] Add deterministic extraction for OpenAPI paths, methods, request schemas, response schemas, and auth hints.
- [ ] Add deterministic extraction for JSON/YAML specs where the shape is known or strongly typed.
- [ ] Mark unsupported structured spec shapes as unverifiable or unsupported rather than failing the analysis.
- [ ] Return a spec extraction manifest containing files, chunks, hashes, source ranges, and extractor versions.

## Test Tasks

- [ ] Add fixture specs with nested Markdown headings and lists.
- [ ] Add tests proving Markdown chunk ranges point to correct lines.
- [ ] Add tests proving chunk IDs are stable across repeated runs.
- [ ] Add tests for spec include/exclude patterns.
- [ ] Add OpenAPI fixture tests for route requirement extraction.
- [ ] Add malformed JSON/YAML tests that fail safely.

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

