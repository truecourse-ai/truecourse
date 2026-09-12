# Deploying TrueCourse

The normal release flow is:

| Action | Result |
|---|---|
| Add `deploy-dev` to a same-repository PR | Build and deploy staging. Further pushes while labeled redeploy it. |
| Push a stable version tag, such as `v1.2.3` | Run the release tests, then build and deploy that exact commit to production. |
| Push a prerelease tag, such as `v1.2.3-beta.1` | Do not deploy production. |

There are no deployment commands, image digests or migration flags to supply for routine releases. Staging also retains **Actions → Deploy (dev) → Run workflow**. If production requires an environment reviewer, its deployment waits for that approval.

After the new workflows are merged, a stable version tag triggers production directly. All four test shards must pass before deployment, and the VM builds the exact commit they tested. The new workflow set removes npm publishing. The remote production workflows have not been changed during staging setup.

## One-time manual setup

Staging infrastructure was provisioned on 2026-09-12 at `https://truecourse-staging-k7m2x9q4.westus3.cloudapp.azure.com` with static IP `20.38.11.213`. The application is live. HTTPS, database/worker health, Docker Compose dependencies, and application/health log ingestion are verified. The old Container App is stopped with ingress blocked. Production has not been deployed. Validate staging before repeating for production.

1. Review [`../vm.bicep`](../vm.bicep). It holds both environments' resource names and settings. Staging is `dev`, VM `truecourse-staging`, Azure hostname `truecourse-staging-k7m2x9q4.westus3.cloudapp.azure.com`. Production is `prod`, VM `truecourse-production`, hostname `app.truecourse.dev`. Both use 4 vCPU / 16 GiB and 256 GiB Standard SSD in westus3.
2. In Azure Monitor, create the environment's action group in its existing resource group: `truecourse-staging-operators` in `rg-truecourse-dev`, or `truecourse-production-operators` in `rg-truecourse-prod`. Configure and test email recipients in Azure only. The templates reference the group without reading, outputting or changing its recipients. No email values belong in GitHub source, variables or secrets.
3. Sign in to Azure with resource-creation and role-assignment permissions. Preview and provision the selected environment from the reviewed checkout:

   ```bash
   az login
   export AZURE_SUBSCRIPTION_ID='<subscription UUID>'
   VM_ENV=dev
   VM_ARGS=(
     --subscription "$AZURE_SUBSCRIPTION_ID"
     --resource-group "rg-truecourse-$VM_ENV"
     --name "truecourse-vm-$VM_ENV"
     --template-file infra/azure/vm.bicep
     --parameters environment="$VM_ENV"
       sshPublicKey="$(cat "$HOME/.ssh/id_ed25519.pub")"
       sshSourceIp='<your public IPv4 address>'
   )
   az deployment group what-if "${VM_ARGS[@]}"
   az deployment group create "${VM_ARGS[@]}" --query properties.outputs
   ```

   Keep the deployment name shown here; GitHub reads its outputs. The VM template creates its monitoring resources through [`../vm-monitoring.bicep`](../vm-monitoring.bicep), with alerts disabled until the first successful release. SSH is restricted to the supplied IP as a /32. Provisioning installs Docker and Caddy and leaves the application stopped.
4. Wait for cloud-init on the new VM to finish. Check `sudo cloud-init status --wait` and `/var/lib/truecourse/deployment/bootstrap-complete`. Staging's Azure DNS record is created automatically; Cloudflare access is not needed. For production, use the static public IP printed by the deployment to create `app.truecourse.dev`'s A record. Caddy obtains and renews HTTPS certificates automatically; ports 80 and 443 must remain reachable. A valid HTTPS response with maintenance status 503 is expected before activation.
5. Update the corresponding WorkOS allowed callback to `https://<hostname>/api/auth/callback`, plus application/logout origins. Update that environment's GitHub App URLs, including `/api/github/setup` and `/api/github/webhook` on the new hostname. Keep the existing keys and environment separation.
6. Verify PostgreSQL backup availability and migration compatibility. Pause producers on the old Container App and wait for queued/running jobs and their followups to finish, then stop it. The old app is `truecourse-dev` or `truecourse-prod`. Use the Azure portal or the [Container Apps stop API](https://learn.microsoft.com/en-us/rest/api/resource-manager/containerapps/container-apps/stop?view=rest-resource-manager-containerapps-2025-07-01). **The old and new workers must never run against the same database simultaneously.** Provisioning a VM is safe while the old app runs because the VM application is still stopped and does not open the application database. Before the first application activation, the manager checks that the old app is stopped or absent and refuses to start otherwise. It never stops or deletes the old app automatically. After the new VM is verified, delete the old Container App compute if desired. Retain the shared database, vault, registry, identity and logging workspace; do not delete the resource group.
7. Reuse the existing GitHub `dev` and `prod` environments and OIDC variables `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`. Set `AZURE_VM_DEPLOYMENT_ENABLED=true` in the environment that is ready. Keep it unset in environments not ready for cutover. Routine CI needs its existing ACR and VM Run Command permissions; provisioning also needs role-assignment permission.
8. Deploy using the normal flow above: a staging PR label or stable production version tag. First activation is detected automatically. Check HTTPS health, sign-in, repository access and a real Guard run with Docker dependencies. Verify logs and test delivery to both alert emails. Redeliver any failed GitHub webhooks from the maintenance window. Exercise a compatible release/rollback and idle reboot on staging, and a separate-server PostgreSQL restore, before production.

No database copy is required. Both VMs reuse their environment's existing PostgreSQL, Key Vault, ACR, managed identity and Log Analytics. Existing encryption keys, seven-day database backups and disabled storage auto-growth are retained. The isolated VM experiment and its local database are separate and are not part of this cutover.

## Current staging rollout

The initial release is `truecourse@sha256:1d8003390905e62488e71d3ab8bd5b614fc4d9161f7bf7fb40ee1de0af1e0564`, built from the local checkout by ACR run `ds2y`. A repeat release of the same image passed maintenance, drain, restart and readiness checks. Docker Compose/localhost database access and Chromium launch passed as the application user. No new database migration was needed. The `truecourse-chaos` GitHub App webhook now targets this VM; its Setup URL still needs confirmation for new installations. WorkOS accepts the callback and the application sends login redirects to it; a complete user sign-in and Guard run remain acceptance checks.

All ten alerts are configured. Azure confirmed the test notification for receiver `operator-1`. The user confirmed that `operator-0` has not confirmed the address yet and accepts deferring that delivery test. Both recipients remain configured; retest the first after address confirmation. Email addresses are intentionally omitted here.

The remote `Deploy (dev)` workflow is disabled because it still deploys the old Container App. Keep it disabled until the new workflow and shared action/scripts are reviewed and merged. After verifying the merged workflow targets VMs, enable `deploy-dev.yml` again. Do not enable the legacy workflow or restart the old Container App alongside the VM. No commits or pushes were made during initial provisioning.

## What GitHub handles

The two deployment workflows use one [shared deployment action](../../../.github/actions/deploy-vm/action.yml). It reads the provisioned settings from Azure, builds the checked-out source in the environment's existing ACR, resolves its immutable digest, invokes the VM release and enables monitoring after success. Production builds the tagged commit rather than copying a separately selected staging image. No operator needs to track a digest.

Routine releases reuse the same VM. A release pauses new API work, waits for existing requests and jobs to finish, stops the current service, then starts the replacement and checks private readiness plus public HTTPS. It never starts a second application instance alongside the old service. It retains compatible rollback. A drain timeout leaves jobs running and maintenance enabled. Never cancel a deployment just to bypass draining.

Database migrations run as part of a normal reviewed release, as they did at application startup before. There is no separate migration switch in the workflows. If a changed migration manifest has been applied, automatic rollback to incompatible application code is refused. A failed first activation has no previous VM release to restore. Review migrations in the PR or version release and investigate failures before restarting the old application.

Monitoring includes application and health logs in the existing workspace, host metrics, optional Sentry, and alerts through the Azure-managed action group. Email recipients remain exclusively in Azure. Alerts cover application/HTTPS health, missing telemetry, failed/stalled jobs, excessive maintenance, VM CPU/memory/disk and PostgreSQL CPU/storage. Custom log retention is 30 days. PostgreSQL storage auto-growth remains disabled.

## Files maintained by developers

| File | Purpose |
|---|---|
| [`../vm.bicep`](../vm.bicep) | Both environments' settings, VM/network/identity references, bootstrap and deployment outputs |
| [`../vm-monitoring.bicep`](../vm-monitoring.bicep) | Logging and alert resources |
| [Shared GitHub action](../../../.github/actions/deploy-vm/action.yml) | Common build and deployment steps |
| [GitHub scripts](../../../.github/scripts) | Internal host bootstrap, release safety and Azure Run Command handling |

The host bootstrap and release helper are implementation details, not extra operator entry points. Bicep provisions the VM; it cannot implement guest process draining or install Docker by itself. Initial cloud-init is immutable on an existing VM, so host package/unit changes need reviewed maintenance rather than rerunning bootstrap. Monitoring changes are applied separately by GitHub without reapplying VM custom data.

Local developer validation is `bash tests/infra/azure/check-vm.sh`. Set `BICEP_BIN` to an installed standalone compiler to include Bicep compilation. Tests mock Azure and guest execution; live bootstrap, DNS/certificates, provider callbacks, migrations, workload behavior and alert delivery remain to be verified during rollout.

## If a deployment fails

Read the failed Actions step first. On the VM, use `sudo /usr/local/sbin/truecourse-vm status` and `sudo journalctl -u truecourse -u caddy` to inspect it. The private manager also provides `maintenance`, `resume` and compatible `rollback` commands for recovery. These are not routine deployment steps. Never print `/etc/truecourse/app.json` or the operations token in CI logs.

One VM is still a single failure domain, and repository Docker access effectively grants host administrator access. This first version assumes trusted repository code. Host failures can interrupt jobs. Old release artifacts and Docker images remain for recovery; remove verified unused data during maintenance when disk alerts require it. The existing experiment scripts remain available in their original locations.
