# Phase 3: LLM Requirement Extraction

## Status

`STATUS: TODO`

## Goal

Use LLMs only to convert prose spec chunks into validated atomic requirements, with prompt versioning, caching, secret redaction, and deterministic reuse.

## Dependencies

- Phase 1 schemas and canonical serialization
- Phase 2 spec chunks and hashes
- Existing LLM provider abstraction in `packages/core`
- File-based store writes through `packages/core/src/lib/analysis-store.ts` and `atomicWriteJson`

## Tasks

- [ ] Add a versioned prompt for prose-to-requirements extraction.
- [ ] Require strict JSON output matching the shared requirement schema.
- [ ] Validate all model output with Zod before use.
- [ ] Canonicalize valid model output before hashing, caching, or comparison.
- [ ] Add LLM cache keys using spec file hash, selected text hash, prompt version, schema version, and model.
- [ ] Store cache entries through the existing file-based store write path.
- [ ] Reuse cached extraction when the cache key is unchanged.
- [ ] Add `--no-llm` compatible behavior that skips prose extraction and reports unsupported or unverifiable prose chunks.
- [ ] Set provider parameters for deterministic behavior where supported, including temperature `0`.
- [ ] Add secret redaction before sending spec text to any model.
- [ ] Ensure source code is not sent to the LLM by default.
- [ ] Add failure handling for malformed output, provider errors, empty output, and unsupported requirement categories.

## Test Tasks

- [ ] Add mocked provider tests for valid extraction.
- [ ] Add mocked provider tests for malformed model output.
- [ ] Add cache hit tests proving no provider call occurs when inputs are unchanged.
- [ ] Add cache miss tests for prompt version, schema version, model, and chunk hash changes.
- [ ] Add `--no-llm` behavior tests.
- [ ] Add secret redaction tests.
- [ ] Add idempotency tests around cached extraction output.

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

