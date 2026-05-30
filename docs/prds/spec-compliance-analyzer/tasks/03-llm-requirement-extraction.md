# Phase 3: LLM Requirement Extraction

## Status

`STATUS: DONE`

## Goal

Use LLMs only to convert prose spec chunks into validated atomic requirements, with prompt versioning, caching, secret redaction, and deterministic reuse.

## Dependencies

- Phase 1 schemas and canonical serialization
- Phase 2 spec chunks and hashes
- Existing LLM provider abstraction in `packages/core`
- File-based store writes through `packages/core/src/lib/analysis-store.ts` and `atomicWriteJson`

## Tasks

- [x] Add a versioned prompt for prose-to-requirements extraction.
- [x] Require strict JSON output matching the shared requirement schema.
- [x] Validate all model output with Zod before use.
- [x] Canonicalize valid model output before hashing, caching, or comparison.
- [x] Add LLM cache keys using spec file hash, selected text hash, prompt version, schema version, and model.
- [x] Store cache entries through the existing file-based store write path.
- [x] Reuse cached extraction when the cache key is unchanged.
- [x] Add `--no-llm` compatible behavior that skips prose extraction and reports unsupported or unverifiable prose chunks.
- [x] Set provider parameters for deterministic behavior where supported, including temperature `0`.
- [x] Add secret redaction before sending spec text to any model.
- [x] Ensure source code is not sent to the LLM by default.
- [x] Add failure handling for malformed output, provider errors, empty output, and unsupported requirement categories.

## Test Tasks

- [x] Add mocked provider tests for valid extraction.
- [x] Add mocked provider tests for malformed model output.
- [x] Add cache hit tests proving no provider call occurs when inputs are unchanged.
- [x] Add cache miss tests for prompt version, schema version, model, and chunk hash changes.
- [x] Add `--no-llm` behavior tests.
- [x] Add secret redaction tests.
- [x] Add idempotency tests around cached extraction output.

## Acceptance Criteria

- Same cached input produces byte-stable requirements.
- No LLM call is made when a valid cache entry exists.
- Malformed model output is rejected safely.
- LLM usage is limited to spec text unless explicitly configured otherwise.
- `--no-llm` mode produces deterministic unsupported or unverifiable results for prose chunks.

## Notes

- LLMs are not the final compliance authority.
- The cache is what provides practical idempotency for prose extraction.
- Keep prompt versions explicit and easy to bump.
