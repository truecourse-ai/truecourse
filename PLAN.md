# Implementation plan

This checkout had no root `PLAN.md`; existing product plans remain under `docs/`.
This entry tracks the Azure dev infrastructure change and its separate rollout.

## Azure dev workload-profiles replacement

STATUS: IMPLEMENTED AND LOCALLY VALIDATED

- Reuse the dev foundation through an environment-only Bicep module with a
  Consumption profile. Keep existing foundation/prod defaults compatible.
- Parameterize app CPU, memory and workload profile. Pin dev to 4 vCPU / 8 GiB
  and one replica in checked-in configuration.
- Replace ambiguous environment discovery with named resources and Bicep outputs.
- Add explicit prepare/migrate modes, require operator drain confirmation and
  stop all legacy replicas before URL changes or replacement startup.
- Document WorkOS/GitHub URL updates, post-deployment checks and rollback in
  `infra/azure/README.md`.

Validation completed: all three Bicep templates compiled locally; both deployment
workflows passed actionlint; the migration helper passed Bash syntax validation;
15 fake-Azure-CLI tests passed, covering preparation, migration ordering, normal
deployment, stuck replicas, API/secret-write failures and refusal paths. Compiled
templates preserve the production CPU/memory/profile defaults. `git diff --check`
passed. No cloud deployment was used for validation.

## Actual dev migration

STATUS: NOT STARTED, REQUIRES REVIEWED GITHUB ACTIONS RUN

No environment/app deployment, Azure secret update, legacy deactivation, external
URL change or migration has been performed as part of implementation. Preparation,
drain verification, cutover, authentication/event-streaming/guard checks and
rollback readiness remain operator work under the documented runbook.
