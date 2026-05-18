# Spec Compliance Analyzer Tasks

## Status

`STATUS: IN_PROGRESS`

This folder breaks the Spec Compliance Analyzer PRD into implementation task files. The PRD remains the product source; these files are the execution plan.

Related docs:

- PRD: `docs/prds/spec-compliance-analyzer/PRD.md`
- Project plan: `docs/PLAN.md`

## Status Legend

- `TODO`: not started
- `IN_PROGRESS`: actively being implemented
- `BLOCKED`: cannot proceed without a decision or dependency
- `DONE`: implemented and verified

## Task Files

1. `01-core-data-model.md` - schemas, stable IDs, canonical serialization, config, finding category (`STATUS: DONE`)
2. `02-spec-discovery-and-parsing.md` - spec discovery, Markdown chunking, structured spec parsing
3. `03-llm-requirement-extraction.md` - prose requirement extraction, prompt versioning, cache, validation
4. `04-code-fact-extraction.md` - deterministic implementation fact extractors
5. `05-compliance-matchers.md` - requirement-to-fact matching and compliance result generation
6. `06-cli-and-dashboard-integration.md` - CLI flags, analysis integration, dashboard category
7. `07-hardening-and-expansion.md` - scale, additional frameworks, OpenAPI/data/auth/test coverage improvements

## Recommended Build Order

1. Build schemas, IDs, and canonical output first.
2. Add spec discovery and Markdown chunking without LLMs.
3. Add mocked LLM extraction and cache behavior before connecting real providers.
4. Add a thin set of deterministic code fact extractors.
5. Add matchers and idempotency snapshot tests.
6. Wire the feature into CLI output before dashboard UI.
7. Expand coverage only after the core loop is deterministic.

## Definition of Done

Each task file is done only when:

- implementation is complete
- relevant tests are added under `tests/`
- idempotency behavior is covered where applicable
- `docs/PLAN.md` status is updated if the phase status changed
- `README.md` is updated if commands, config, packages, endpoints, or project structure changed
- no LLM is used for final compliance pass/fail decisions
