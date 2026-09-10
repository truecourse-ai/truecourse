# Implementation status

The broader Guard roadmap is maintained in [docs/SPEC_GUARD_PLAN.md](docs/SPEC_GUARD_PLAN.md).

## Hosted Guard extraction recovery

STATUS: COMPLETE — 2026-09-10.

- Give extraction sessions at most two terminal schema corrections within their existing turn and token budgets. Keep strict verification boundaries.
- Save partial hosted generation results when extraction remains incomplete, then fail the job and Activity run, mark the extraction step as failed, and skip the automatic baseline run.
- Regression tests cover the stale conversion response claim, retention of other claims, repair and token limits, persisted partial results, error notifications, and both file and Postgres activity history.
- Validation passed: 141 tests across extraction, agent-loop, onboarding, provider, cache and hosted conflict suites; core and dashboard-server TypeScript builds; `git diff --check`.
