# Implementation status

The broader Guard roadmap is maintained in [docs/SPEC_GUARD_PLAN.md](docs/SPEC_GUARD_PLAN.md).

## Staging and production VM deployment

STATUS: STAGING DEPLOYED on 2026-09-12. Production remains pending.

- STATUS: COMPLETE. Native Ubuntu/Docker hosts, Caddy HTTPS, private readiness and workload draining, immutable releases and migration-aware rollback. Reuse each environment's managed PostgreSQL, Key Vault, ACR, identity and Log Analytics; retain seven-day backups and disabled storage auto-growth.
- STATUS: COMPLETE. PR-label staging and stable-tag production workflows share the VM release action. Production runs four test shards first. Remove npm publishing; keep initial provisioning manual and email recipients exclusively in Azure.
- STATUS: COMPLETE. Staging cutover and a repeat release passed. Old Container App stopped after ingress and queue checks. Verify HTTPS, database/worker health, Docker Compose/localhost access, Chromium launch, application/health logs, host metrics and seven alert queries. GitHub webhook moved to staging.
- STATUS: COMPLETE. 25 local Python release/workflow tests, shell checks and Bicep compilation. Live rollout fixed context exclusions, portable Corepack links, Run Command response parsing, monitoring startup ordering and log-reader ACLs.
- STATUS: COMPLETE. Rebased deployment changes onto origin/main; full package build, 48 application/job tests, 25 Python tests, Bicep compilation, workflow YAML parsing and diff checks passed. The rebased application has not been redeployed.
- STATUS: ACCEPTED PENDING CONFIRMATION. Alert delivery to operator-1 verified; operator-0 awaits address confirmation. Both remain configured in Azure only.
- STATUS: PENDING. User sign-in, full Guard acceptance run, GitHub App Setup URL, draining with active workloads, compatible rollback, idle reboot and separate-server PostgreSQL restore before production. Keep the legacy staging workflow disabled until the new workflow is merged and enabled.
- Staging uses `truecourse-staging-k7m2x9q4.westus3.cloudapp.azure.com`; production uses `app.truecourse.dev`. See the [VM deployment guide](infra/azure/vm/DEPLOYMENT.md).

## Hosted Guard extraction recovery

STATUS: COMPLETE — 2026-09-10.

- Give extraction sessions at most two terminal schema corrections within their existing turn and token budgets. Keep strict verification boundaries.
- Save partial hosted generation results when extraction remains incomplete, then fail the job and Activity run, mark the extraction step as failed, and skip the automatic baseline run.
- Regression tests cover the stale conversion response claim, retention of other claims, repair and token limits, persisted partial results, error notifications, and both file and Postgres activity history.
- Validation passed: 141 tests across extraction, agent-loop, onboarding, provider, cache and hosted conflict suites; core and dashboard-server TypeScript builds; `git diff --check`.
