# Azure infrastructure

The hosted enterprise app runs in Azure Container Apps with PostgreSQL. Dev and
prod use separate resource groups, registries, vaults, identities, and databases.
GitHub Actions builds images in ACR and deploys with OIDC.

The dev replacement is implemented in this checkout. **The Azure migration has
not been performed.** Run the migration below through GitHub Actions only after
review. Do not deploy these templates or run the migration helper locally.

## Templates and dev configuration

| File | Purpose |
|---|---|
| `foundation.bicep` | Complete foundation for a fresh resource group |
| `environment.bicep` | Reusable environment module referencing an existing Log Analytics workspace |
| `containerapp.bicep` | App, managed identity, registry access, Key Vault references, ingress and replica resources |
| `dev.json` | Checked-in dev names, location, CPU, memory and replica count |
| `legacy-app.sh` | Migration deactivation and read-only checks that the legacy app has stopped |
| `set-secrets.sh` | Initial vault population for a fresh setup; not part of this migration |

The legacy dev app `truecourse-dev` lives in `truecourse-cae`, a Consumption-only
environment that rejected the requested 4 vCPU / 8 GiB size. Its last reported URL
is `https://truecourse-dev.greenpond-69a51954.westus3.azurecontainerapps.io`.

`dev.json` targets `truecourse-dev-v2` in `truecourse-dev-cae-v2`, in
`rg-truecourse-dev`, West US 3. The new environment has only the `Consumption`
workload profile. Azure documents a maximum of 4 vCPU and 8 GiB per replica for
that profile; no dedicated nodes are provisioned.
[Azure workload profile limits](https://learn.microsoft.com/en-us/azure/container-apps/workload-profiles-overview#consumption-profile-details).

Every dev deployment passes `cpu=4`, `memory=8Gi`,
`workloadProfileName=Consumption`, and `minReplicas=maxReplicas=1`. Shared app
defaults remain `0.5` vCPU / `1Gi`, one replica, with the workload profile omitted.
`deploy-prod.yml` is unchanged.

Dev reuses `truecourse-logs`, ACR `truecourseacrk7ncoyeug2nb2`, the
`truecourse-id` identity, the existing Key Vault and PostgreSQL database. The
workflow requires exactly one vault in the dev resource group and fails on
ambiguity. It resolves other resources by their checked-in names and gets the
new environment ID and domain from Bicep outputs. It never selects the first
environment returned by Azure, and it never deploys the full foundation.

The environment module defaults to workload profiles. Foundation explicitly
passes `workloadProfilesEnabled=false` by default to preserve existing legacy
setups. For a **fresh** foundation, pass `workloadProfilesEnabled=true` and the
intended `environmentName`. Do not enable that parameter against an existing
legacy environment: create a separate environment with a distinct name instead.
The module references the workspace created by foundation and keeps its shared
key inside ARM. Outputs contain no credentials.

## GitHub setup

Keep the existing OIDC registration and federated credentials with subjects
`repo:truecourse-ai/truecourse:environment:dev` and
`repo:truecourse-ai/truecourse:environment:prod`.

| Variable | Scope / value |
|---|---|
| `AZURE_CLIENT_ID` | Existing CI Entra application ID |
| `AZURE_TENANT_ID` | Existing tenant ID |
| `AZURE_SUBSCRIPTION_ID` | Subscription ID, environment-scoped if dev/prod differ |
| `AZURE_RG` | Dev: `rg-truecourse-dev`; prod: `rg-truecourse-prod` |
| `APP_NAME` | Prod only: `truecourse-prod`; dev now reads `dev.json` |

The workflow checks that dev's `AZURE_RG` matches `dev.json` before Azure login.
A stale dev `APP_NAME=truecourse-dev` is ignored. Remove it after migration to
avoid confusing operators.

CI needs Contributor on the dev resource group for ACR builds, the environment,
app deployments and revision deactivation. The **migration only** also needs
permission to set the existing `workos-app-url` and `workos-redirect-uri` secrets.
Contributor does not grant Key Vault data-plane access. Arrange a reviewed,
time-limited Key Vault Secrets Officer assignment scoped to those secrets before
the window; remove it after successful migration. This workflow does not grant
roles. The app's existing managed identity retains ACR pull and Key Vault Secrets
User access. Neither the DB credentials nor WorkOS/GitHub credentials change.

Configure any required reviewer for dev in GitHub's Environment settings before
the migration if a platform-enforced approval is desired. Prod retains its
required reviewer gate. No environment protection settings are changed by this PR.

For a fresh installation, provision the resource group, OIDC role assignments,
foundation, initial secrets and bootstrap image in a separately reviewed setup
workflow. `foundation.bicep` requires a secure `postgresAdminPassword`; never put
it in checked-in parameters or workflow output. This dev migration workflow
assumes those foundation resources already exist.

## Deployment triggers

- Dev PR deployments require a PR targeting `main` with the `deploy-dev` label.
  Adding the label or pushing while it is present runs normal `deploy` mode.
  Labels cannot select `prepare` or `migrate`.
- Manual **Actions → Deploy (dev) → Run workflow** offers `prepare`, `migrate`,
  and `deploy`, with `deploy` as the default. Use a reviewed ref containing these
  changes. Merge the workflow into the default branch before relying on its new
  dispatch inputs in the Actions UI.
- Prod is manual, on `main` only, with its existing reviewer gate.
- Opening or merging this PR does not deploy. Neither deploy workflow has a
  branch-push trigger.

All dev operations use the same `deploy-dev` concurrency group and do not cancel
an in-progress run. Remove `deploy-dev` labels and clear queued deploy runs before
migration; keep other operators from dispatching older workflow revisions or
manually changing either app. Old workflow code does not know about these guards.
After migration, only use refs that include the replacement configuration.

Normal `deploy` requires the replacement to exist in the expected environment
and the legacy app to have no active revisions or replicas. It updates only the
replacement. It does not deactivate the legacy app or rewrite URL secrets.
Single-revision mode can still overlap old/new revisions while rolling an app;
this change does not make the in-process worker safe for overlapping restarts.
Schedule routine deployments during a quiet, drained window as well.

## First migration through GitHub Actions

This is a maintenance window with downtime and a changed URL. There is no
worker-only switch. `apps/dashboard/server/src/index.ts` starts server jobs;
`ee/packages/server/src/index.ts` registers enterprise jobs, whose registration
starts its worker. `packages/jobs/src/index.ts` calls `failOrphaned()` on startup,
and `packages/data-store/src/jobs-store.ts` fails **all queued and running rows**.
Enterprise startup also drains pending follow-ups and can launch guard backfill.
A second app must not start against this DB while the old worker is still alive.

1. Review and merge the infrastructure change. Confirm dev names, region, OIDC
   permissions and the secret-write permission above. Record the old app's active
   revision names, image, CPU/memory, URL and the two URL secret version IDs in the
   change record. Confirm DB backup/restore readiness. Do not print secret values.
2. Dispatch **Deploy (dev)** with `operation=prepare`. This deploys only
   `environment.bicep`, using Incremental mode. It creates no app, runs no worker,
   builds no image and changes no secrets. Record the replacement URL in the run
   summary, derived from the environment's `defaultDomain`:
   `https://truecourse-dev-v2.<defaultDomain>`.
3. In the **dev WorkOS application**, add
   `https://truecourse-dev-v2.<defaultDomain>/api/auth/callback` to the allowed
   redirect URIs. Prepare the new app/homepage URL and any configured allowed
   origins or logout return URLs. Keep the old callback allowed during the rollback
   window. Key Vault and WorkOS dashboard settings are separate; neither updates
   the other.
4. Announce downtime and pause producers: disable dev GitHub App webhook delivery,
   pause external schedules/automation and stop users from starting scans, syncs,
   guard setup or other jobs. Keep producers paused through the image build and
   the whole migration. Let active jobs and their chained/pending follow-ups finish.
   Use the operator view across **every workspace**, not one user's job list, and
   an authorized read-only DB check if needed to verify no queued/running jobs or
   deferred follow-ups remain. Do not clear job rows to fake a drain. The workflow
   does not query the DB; its confirmation is an operator attestation of this check.
5. Dispatch **Deploy (dev)** on the same reviewed ref with `operation=migrate` and
   `migration_confirmation=jobs-drained-producers-paused`. The run refuses if v2
   already exists. It provisions/references the new environment and builds the
   image before taking the old app down. It then deactivates every active legacy
   revision and waits up to ten minutes for **zero active revisions and zero
   replicas across all revisions**, including inactive ones. API errors and a
   timeout block the new app. No traffic-weight or scale-to-zero shortcut is used.
6. Only after that stop succeeds, the same run sets Key Vault's `workos-app-url`
   to the new origin and `workos-redirect-uri` to its `/api/auth/callback`, with
   command output suppressed. It checks the legacy app is still stopped, then
   deploys v2 with 4 vCPU / 8 GiB and one replica. **These are shared, versionless
   URL secret references: the old app will also read the changed URLs if restarted.**
7. Update the dev GitHub App webhook to
   `https://truecourse-dev-v2.<defaultDomain>/api/github/webhook`. Also update its
   setup URL to `/api/github/setup` on the new origin and any homepage URL that
   points to the old app. Keep the existing webhook secret. Finish the WorkOS
   app/homepage and allowed-origin settings prepared above.
8. Complete the checks below before reopening access and webhook delivery.
   Redeliver missed GitHub events deliberately, checking for duplicate work.
   Keep the old app and environment stopped for the rollback window; cleanup
   requires a later reviewed change. Record migration completion separately in
   `PLAN.md` and remove the temporary secret-write permission.

## Post-deployment checks, still pending

These are future operator checks, not claims of tests already run:

- Verify the actual ingress FQDN equals the prepared URL, environment ID/profile
  match `dev.json`, CPU is 4, memory is 8 GiB and exactly one replica is ready.
  Recheck that every legacy revision has zero replicas.
- Check startup logs for DB connection/migration, worker startup, managed-identity
  ACR/KV access and unexpected orphan recovery. An HTTP-ready app can still have
  a failed worker; enterprise registration catches worker startup errors.
- Sign in through WorkOS, complete `/api/auth/callback`, refresh the session and
  sign out on the new URL. Verify cookies and return URLs stay on the new origin.
- Exercise authenticated SSE job progress, reconnect after interruption and
  persisted job/notification history. Check Socket.io upgrade where used by the
  dashboard. Watch for proxy timeouts or stale client connections to the old URL.
- Connect or reopen a dev repository, run guard setup/generation and a baseline,
  then send a test PR webhook. Verify delivery signature acceptance, queued job
  completion, streamed progress and the resulting GitHub Check. Check org isolation.
- Monitor memory, CPU, errors and readiness during a representative analysis.
  Verify the next normal `deploy` keeps v2, the Consumption profile and 4/8 sizing.

## Failure recovery and rollback

No failure handler automatically reactivates the old app. After the stop, a failed
secret write or app deployment leaves downtime for the operator to resolve.
Keep producers paused and inspect the run's failed step and Azure state first.

If v2 was never created, correct the cause and rerun explicit `migrate`; it can
handle an already stopped legacy app and repeats the two URL writes. If v2 exists,
inspect its configuration and use normal `deploy` on a corrected reviewed ref.
The workflow writes both URL secrets before attempting app creation, but check
for partial writes if the failure happened during that step. Normal `deploy`
intentionally does not repair or rewrite secrets.

For rollback, use a separately reviewed manual **GitHub Actions** recovery change
with `environment: dev` and the same `deploy-dev` concurrency group. Do not run
Azure mutation commands from a workstation. The recovery must:

1. Pause producers again and drain v2, including startup backfill, if it processed
   any work. Deactivate all v2 revisions and verify zero replicas before proceeding.
2. Restore `workos-app-url` and `workos-redirect-uri` to the recorded old URLs in
   the shared vault, and restore WorkOS and GitHub App URL settings. Never restart
   the old app against v2's URL secrets.
3. Check database schema compatibility with the recorded old image. Reusing the
   database means image rollback does not reverse schema/data changes. Use the
   agreed backup recovery plan if compatibility cannot be established.
4. Reactivate only the recorded legacy revision, refresh its Key Vault references
   as required, and repeat authentication, worker, streaming and guard checks.
   The legacy environment cannot run 4/8; retain its recorded supported size.

After rollback, normal v2 deploys deliberately fail while the legacy app is active.
A second cutover needs a reviewed recovery plan because the first-migration mode
refuses an existing v2 app. Do not delete either environment or DB as a shortcut.

## Local validation

These commands compile/lint locally and do not create Azure deployments:

```bash
bicep build infra/azure/environment.bicep --outfile /tmp/truecourse-environment.json
bicep build infra/azure/foundation.bicep --outfile /tmp/truecourse-foundation.json
bicep build infra/azure/containerapp.bicep --outfile /tmp/truecourse-containerapp.json
actionlint .github/workflows/deploy-dev.yml .github/workflows/deploy-prod.yml
bash -n infra/azure/legacy-app.sh
python3 -m unittest discover -s tests/infra -p 'test_*.py'
```

The focused tests replace `az` with a local fake and exercise migration ordering,
refusal paths and replica shutdown checks. Compilation cannot establish live
Azure permissions, quota, capacity, image health or external URL settings.
