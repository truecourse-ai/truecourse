# Phase 5: Compliance Matchers

## Status

`STATUS: DONE`

## Goal

Compare structured requirements to deterministic code facts and produce stable compliance results and findings.

## Dependencies

- Phase 1 compliance result schema
- Phase 2/3 requirement extraction
- Phase 4 code fact extraction

## Tasks

- [x] Add a `ComplianceMatcher` interface with stable matcher name/version metadata.
- [x] Add a matcher registry and deterministic matcher selection order.
- [x] Ensure every requirement receives exactly one compliance result.
- [x] Add status mapping for `satisfied`, `missing`, `conflicting`, `partial`, `unverifiable`, and `ambiguous`.
- [x] Add severity mapping based on requirement modality and result status.
- [x] Implement `api.route.exists`.
- [x] Implement `api.route.auth_required`.
- [x] Implement `api.request.field_required` where request schema facts exist.
- [x] Implement `ui.route.exists`.
- [x] Implement `ui.text.exists`.
- [x] Implement `ui.form.field_exists`.
- [x] Implement `ui.form.validation_message_exists`.
- [x] Implement `auth.role_required`.
- [x] Implement `config.env_var_required`.
- [x] Implement `data.field_exists` where data facts exist.
- [x] Implement `test.coverage_hint_exists`.
- [x] Add fallback handling for unsupported requirement kinds as `unverifiable`.
- [x] Add ambiguous requirement handling when extraction confidence or fields are insufficient.
- [x] Add optional unspecified implementation detection for code facts that appear related to spec scope but have no matching requirement.
- [x] Sort compliance results and findings deterministically.

## Test Tasks

- [x] Add unit tests for each matcher.
- [x] Add tests for modality-to-severity behavior.
- [x] Add tests proving each requirement gets exactly one result.
- [x] Add tests for missing, partial, conflicting, ambiguous, and unverifiable outcomes.
- [x] Add unspecified implementation tests.
- [x] Add snapshot tests for canonical compliance output.
- [x] Add repeated-run idempotency tests.

## Acceptance Criteria

- Matchers assign deterministic statuses from requirements and code facts.
- Final pass/fail decisions do not call an LLM.
- Findings include spec evidence and implementation evidence when available.
- Satisfied results can be hidden without affecting deterministic output generation.
- Repeated runs over identical inputs produce identical results and finding order.

## Notes

- Keep matching conservative. Prefer `unverifiable` over an unjustified `satisfied`.
- Matcher versions should change when behavior changes.
- Store enough evidence for users to understand why a mismatch was reported.
