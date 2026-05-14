# Phase 5: Compliance Matchers

## Status

`STATUS: TODO`

## Goal

Compare structured requirements to deterministic code facts and produce stable compliance results and findings.

## Dependencies

- Phase 1 compliance result schema
- Phase 2/3 requirement extraction
- Phase 4 code fact extraction

## Tasks

- [ ] Add a `ComplianceMatcher` interface with stable matcher name/version metadata.
- [ ] Add a matcher registry and deterministic matcher selection order.
- [ ] Ensure every requirement receives exactly one compliance result.
- [ ] Add status mapping for `satisfied`, `missing`, `conflicting`, `partial`, `unverifiable`, and `ambiguous`.
- [ ] Add severity mapping based on requirement modality and result status.
- [ ] Implement `api.route.exists`.
- [ ] Implement `api.route.auth_required`.
- [ ] Implement `api.request.field_required` where request schema facts exist.
- [ ] Implement `ui.route.exists`.
- [ ] Implement `ui.text.exists`.
- [ ] Implement `ui.form.field_exists`.
- [ ] Implement `ui.form.validation_message_exists`.
- [ ] Implement `auth.role_required`.
- [ ] Implement `config.env_var_required`.
- [ ] Implement `data.field_exists` where data facts exist.
- [ ] Implement `test.coverage_hint_exists`.
- [ ] Add fallback handling for unsupported requirement kinds as `unverifiable`.
- [ ] Add ambiguous requirement handling when extraction confidence or fields are insufficient.
- [ ] Add optional unspecified implementation detection for code facts that appear related to spec scope but have no matching requirement.
- [ ] Sort compliance results and findings deterministically.

## Test Tasks

- [ ] Add unit tests for each matcher.
- [ ] Add tests for modality-to-severity behavior.
- [ ] Add tests proving each requirement gets exactly one result.
- [ ] Add tests for missing, partial, conflicting, ambiguous, and unverifiable outcomes.
- [ ] Add unspecified implementation tests.
- [ ] Add snapshot tests for canonical compliance output.
- [ ] Add repeated-run idempotency tests.

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

