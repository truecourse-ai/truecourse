# Phase 6: CLI and Dashboard Integration

## Status

`STATUS: DONE`

## Goal

Expose spec compliance analysis through the CLI and dashboard while preserving the existing analyzer flow.

## Dependencies

- Phase 1 through Phase 5
- Existing CLI command structure in `tools/cli`
- Existing dashboard/server analysis APIs
- Existing shared types used by frontend and backend

## Tasks

- [x] Add a core orchestration entry point for spec compliance analysis.
- [x] Wire spec compliance into the existing analyze command behind an explicit flag.
- [x] Add CLI flag support for `--spec-compliance`.
- [x] Add CLI flag support for `--specs`.
- [x] Add CLI flag support for `--no-llm`.
- [x] Add CLI flag support for `--show-satisfied`.
- [x] Ensure JSON output includes compliance results and findings.
- [x] Add server-side analysis integration so dashboard-triggered analysis can include spec compliance when enabled.
- [x] Add dashboard summary counts by compliance status.
- [x] Add a `Spec Compliance` findings category.
- [x] Add filters for status, severity, spec file, domain, matcher, and confidence where the existing UI supports similar filtering.
- [x] Display spec source references and implementation evidence.
- [x] Hide satisfied requirements by default.
- [x] Document new commands, flags, and config in `README.md`.
- [x] Update `docs/PLAN.md` status tags as implementation progresses.

## Test Tasks

- [x] Add CLI tests for each new flag.
- [x] Add CLI JSON output tests.
- [x] Add server route or service tests for spec compliance analysis options.
- [x] Add shared serialization tests for dashboard-facing payloads.
- [x] Add dashboard component tests if the repo has an existing frontend test pattern.
- [x] Add no-LLM integration tests.

## Acceptance Criteria

- Users can run spec compliance from the CLI.
- CLI JSON output is stable for fixed fixtures.
- Dashboard can display spec compliance findings separately from other analyzer checks.
- Findings link to spec source and implementation source when available.
- README accurately documents new commands and configuration.

## Notes

- Do not start, stop, or restart dev servers during implementation.
- Keep spec compliance disabled unless the user explicitly enables it or config says it is enabled.
- Prefer CLI JSON integration before building richer dashboard UI.
