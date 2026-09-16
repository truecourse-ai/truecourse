# Deploying TrueCourse

Each environment is one Ubuntu VM running the app under systemd behind Caddy. The release flow:

| Action | Result |
|---|---|
| Add `deploy-dev` to a same-repository PR | Build and deploy dev. Further pushes while labeled redeploy it. |
| Actions → Deploy (dev) → Run workflow | Deploy any branch's HEAD to dev. |
| Create a GitHub Release (or push a tag) `vX.Y.Z` on a `main` commit | Build and deploy that exact commit to production. A tag on a commit that is not on `main`, or a prerelease tag such as `v1.2.3-rc.1`, does not deploy. |
| Actions → Deploy (prod) → Run workflow, on `main` | Build main's HEAD and deploy it to production. Use it to re-roll a version after a bad host state. |

Nothing deploys on merge. Production only ever ships commits reachable from `main`; the workflow checks that before building. If production has an environment reviewer, its deployment waits for that approval.

## What a release does

Both workflows use one [shared action](../../../.github/actions/deploy-vm/action.yml). It reads the provisioned settings from Azure, builds the checked-out source in the environment's ACR (tagged `pr-<n>-<sha>` or `<branch>-<sha>`), resolves the immutable digest and runs the release on the VM through Run Command. On the VM the release helper:

1. Unpacks the image's `/app` and Node runtime into `/opt/truecourse/releases/<digest>` (skipped when that digest is already staged).
2. Reads the app's secrets from Key Vault into `/etc/truecourse/app.json`.
3. Points `/opt/truecourse/current` at the new release.
4. Restarts the `truecourse` systemd unit.
5. Polls `GET /api/health` on localhost until it answers as the new release (two minutes).

The process is down for the restart, so Caddy answers 502 for a short while and any job running at that moment ends as `interrupted by server restart` in the dashboard. Database migrations run at startup as part of the reviewed release. If the new release never becomes healthy, the helper restarts the previous release and the workflow fails; if there is no previous release the unhealthy one stays active. Rolling back is deploying the previous commit again from the workflow.

After a successful release the action applies [`../vm-monitoring.bicep`](../vm-monitoring.bicep) with alerts enabled.

## One-time manual setup

Both environments are provisioned: dev at `https://truecourse-dev.westus3.cloudapp.azure.com`, production at `https://app.truecourse.dev`. The deployment outputs are the record of each environment's address and SSH command. The steps below are what it took, kept for a rebuild.

1. Review [`../vm.bicep`](../vm.bicep). It holds both environments' resource names and settings. Dev is `dev`, VM `truecourse-dev`, Azure hostname `truecourse-dev.westus3.cloudapp.azure.com`. Production is `prod`, VM `truecourse-production`, hostname `app.truecourse.dev`. Both use 4 vCPU / 16 GiB and 256 GiB Standard SSD in westus3.
2. In Azure Monitor, create the environment's action group in its existing resource group: `truecourse-dev-operators` in `rg-truecourse-dev`, or `truecourse-production-operators` in `rg-truecourse-prod`. Configure and test email recipients in Azure only. The templates reference the group without reading, outputting or changing its recipients.
3. Sign in to Azure with resource-creation permissions. Preview and provision the selected environment from the reviewed checkout:

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

   Keep the deployment name shown here; GitHub reads its outputs. The template creates its monitoring resources through [`../vm-monitoring.bicep`](../vm-monitoring.bicep), with alerts disabled until the first successful release. SSH is restricted to the supplied IP as a /32. Provisioning installs Docker and Caddy; the application starts with the first release.
4. Wait for cloud-init to finish: `sudo cloud-init status --wait` and `/var/lib/truecourse/deployment/bootstrap-complete`. Dev's Azure DNS record is created automatically. For production, use the static public IP printed by the deployment to create `app.truecourse.dev`'s A record. Caddy obtains and renews HTTPS certificates automatically; ports 80 and 443 must remain reachable. Until the first release Caddy answers 502.
5. Update the corresponding WorkOS allowed callback to `https://<hostname>/api/auth/callback`, plus application/logout origins. Update that environment's GitHub App URLs, including `/api/github/setup` and `/api/github/webhook`.
6. **Only one worker may run against a database.** If a previous host of the same environment is still up, stop it before the first release; startup fails the jobs it left queued or running.
7. Reuse the existing GitHub `dev` and `prod` environments and the OIDC variables `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`. Set `AZURE_VM_DEPLOYMENT_ENABLED=true` in the environment whose VM is ready; the action refuses to run without it.
8. Release with the normal flow above. Check HTTPS health, sign-in, repository access and a real Guard run with Docker dependencies, then the alert emails.

No database copy is required. Both VMs reuse their environment's existing PostgreSQL, Key Vault, ACR, managed identity and Log Analytics.

## Monitoring

The VM ships `/var/log/truecourse/dashboard.log` and a once-a-minute `health.log` (one JSON line: timestamp, healthy, release, from the public `/api/health`) to the existing Log Analytics workspace, plus host metrics and syslog. Alerts: health record missing for 10 minutes, three consecutive unhealthy samples, VM memory/disk/CPU, PostgreSQL CPU/storage. Optional Sentry error reporting is configured through the `sentry-dsn` Key Vault secret. Email recipients live only in the Azure action group.

## Files maintained by developers

| File | Purpose |
|---|---|
| [`../vm.bicep`](../vm.bicep) | Both environments' settings, VM/network/identity references, bootstrap and deployment outputs |
| [`../vm-monitoring.bicep`](../vm-monitoring.bicep) | Logging and alert resources |
| [Shared GitHub action](../../../.github/actions/deploy-vm/action.yml) | Build and release steps |
| [GitHub scripts](../../../.github/scripts) | Host bootstrap, the release helper and the Run Command wrapper |

Initial cloud-init is immutable on an existing VM, so host package/unit changes need reviewed maintenance rather than rerunning bootstrap. Monitoring changes are applied by the action without reapplying VM custom data.

Local validation is `bash tests/infra/azure/check-vm.sh`. Set `BICEP_BIN` to a standalone compiler to include Bicep compilation.

## If a deployment fails

Read the failed Actions step first. On the VM, `sudo /usr/local/sbin/truecourse-vm status` prints the app's health and `sudo journalctl -u truecourse -u caddy` its logs. To go back to a known-good build, run the deploy workflow on that commit. Never print `/etc/truecourse/app.json` in CI logs.

One VM is a single failure domain, and repository Docker access effectively grants host administrator access. This first version assumes trusted repository code.
