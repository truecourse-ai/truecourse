# Staging VM experiment

One Ubuntu VM runs the dashboard and its existing in-process worker under systemd.
Docker runs the VM's own Postgres and the temporary dependencies that guard recipes
declare. TrueCourse runs on the host, so recipe bind mounts and published localhost
ports refer to the same filesystem and network as the runner.

`../vm-test.bicep` creates the VM, a 256 GiB Standard SSD OS disk, VNet, NIC,
network security group and a static public IP with an Azure DNS hostname.
It reuses the existing dev managed identity, ACR and Key Vault. No load balancer is
needed for one VM. The default size is `Standard_D4s_v7`, 4 vCPUs / 16 GiB.

## Deployed experiment

- Resource group: `rg-truecourse-dev`; deployment: `vm-test`; VM: `truecourse-vmtest`.
- Region/size: `westus3`, `Standard_D4s_v7`; disk: `truecourse-vmtest-os`, 256 GiB.
- URL: https://truecourse-vmtest-hkce5wb6blhaq.westus3.cloudapp.azure.com
- Public IP: `20.118.187.21`; SSH key on the operator machine: `~/.ssh/truecourse-vmtest`.
- Shared Key Vault: `truecoursekvk7ncoyeug2nb`; identity: `truecourse-id`.
- Initial image: `truecourseacrk7ncoyeug2nb2.azurecr.io/truecourse@sha256:d8a7c84a28af104d884175e1da3245342818daed6c3aa08100e2e3ad325f6593`,
  resolved from dev's `pr-897-d7df6c5` on 2026-09-10.

## Provision

Prerequisites: logged-in Azure CLI, Bicep (`az bicep install`), existing dev foundation,
an SSH public key and available VM quota. Register `Microsoft.Compute` and
`Microsoft.Network` if this subscription has not used VMs before.

```bash
export SSH_PUBLIC_KEY_FILE="$HOME/.ssh/truecourse-vmtest.pub"
export SSH_SOURCE_CIDR='<your-public-IP>/32'
bash infra/azure/deploy-vm-test.sh
```

Optional inputs are `AZURE_RG`, `VM_NAME`, `VM_SIZE`, and `APP_IMAGE`. The deployment
helper discovers dev's current image and pins its digest. The default resource group
is `rg-truecourse-dev`, and the resource prefix is `truecourse-vmtest`.

Only ports 80 and 443 are public. SSH is restricted to the supplied CIDR. Postgres
publishes port 5432 on loopback only. The app's port 3001 and Docker's API are not
exposed to the internet. Caddy terminates HTTPS and proxies to the app.

Cloud-init installs Docker Engine, Compose, Caddy and Playwright's Chromium. It starts local Postgres,
pulls the existing dev image through managed-identity ACR authentication, and
extracts `/app` and its Node runtime onto the host. No repository rebuild or GitHub
checkout credential is needed. The app remains stopped until the database choice
below. Bootstrap progress is in `/var/log/cloud-init-output.log`.

## Copy dev and start

```bash
ssh -i "$HOME/.ssh/truecourse-vmtest" azureuser@<hostname-from-deployment>
sudo cloud-init status --wait
sudo truecourse-vm copy-dev
sudo truecourse-vm start
```

`copy-dev` reads `database-url` from dev Key Vault through the VM's identity and
runs `pg_dump` with a read-only source connection. It restores into the EMPTY local
database and refuses to overwrite existing tables. It excludes `graphile_worker`,
clears copied pending baseline requests, and marks copied active jobs/activity as
failed so startup does not replay them. The source database is unchanged. The
initial snapshot stays in `/var/lib/truecourse/backups/dev-initial.dump`, root-only.
For an empty installation, skip `copy-dev` and run `start` directly.

The VM generates its own database password in `/etc/truecourse/db.env`. The app
reads a separate `/etc/truecourse/app.json`. Shared WorkOS/GitHub/encryption secrets
come from dev Key Vault; the VM overrides `DATABASE_URL`, `WORKOS_APP_URL`, and
`WORKOS_REDIRECT_URI`. Reusing `TRUECOURSE_SECRET_KEY` is necessary to decrypt the
copied LLM settings. No shared Key Vault secret is rewritten.

Add `https://<vm-hostname>/api/auth/callback` to the existing WorkOS application's
allowed redirect URIs. Keep the existing dev URI. The GitHub App webhook remains
on the existing dev instance; the VM proxy rejects webhook delivery. Already copied
repository connections can be used for manual guard tests. New GitHub installations
may still return to dev through the GitHub App's existing setup URL.

## Operate and verify

```bash
sudo systemctl status truecourse caddy docker
sudo journalctl -u truecourse -n 80 --no-pager
sudo tail -n 80 /var/log/truecourse/dashboard.log
sudo -u truecourse docker info
sudo -u truecourse docker compose version
curl --fail https://<vm-hostname>/
free -h
df -h /
```

From the repository, run the disposable Compose/SQL smoke test over SSH:

```bash
ssh -i "$HOME/.ssh/truecourse-vmtest" azureuser@<vm-hostname> \
  'sudo -u truecourse bash -s' < tests/infra/azure/vm-smoke-docker.sh
```

It starts its own Postgres on `127.0.0.1:54322`, performs a create/insert/select
round trip from host Node, and removes the container afterward. Run it when no
guard job is using that test port.

Verified on 2026-09-10: Docker/Compose as the service user, the disposable SQL
round trip, Chromium launch, HTTPS 200, and automatic recovery after a VM reboot.
The copied database retained four repositories and had zero queued/running jobs.
WorkOS still needs the additional callback URI before browser sign-in works.
Documenso's saved setup bundle was cleared on 2026-09-10 so the next setup derives
a fresh recipe. Both scanned spec artifacts and historical jobs were retained.
The removed bundle manifest was backed up on the VM at
`/var/lib/truecourse/backups/documenso-setup-reset-1789061794623.json`.
The five guard-setup Activity runs and their 228 transcript events were subsequently
removed as well. The completed spec-scan Activity run remains. Activity backup:
`/var/lib/truecourse/backups/documenso-setup-activity-reset-1789062090575.json`.

The app restarts on process failure and starts at boot. Postgres uses Docker's
`unless-stopped` restart policy. Service output uses journald; application diagnostics
are in `/var/log/truecourse/dashboard.log`. Postgres Docker logs rotate.
The app's `TRUECOURSE_MAX_CONCURRENCY=1` limits guard/LLM execution within a run.
It does not change the job queue's default two worker slots: run one guard job at
a time during the comparison.

The database and Docker storage are on the persistent OS disk, not ephemeral VM
storage. Bicep sets the OS disk's delete option to `Detach`. This protects against
accidental VM-only deletion, but it is not an off-machine backup policy. The
experiment starts with an initial snapshot; add scheduled external backups if it
becomes a long-lived staging environment.

Use trusted test repositories on this VM. The application user can operate Docker,
which grants host-level control. This is not an isolation boundary for untrusted
customer code.

Cloud-init runs only on initial provisioning. Redeploying Bicep does not update
installed application files or rerun database imports. For a later app release,
deploy it explicitly; `prepare` refuses to overwrite an existing application tree.

To stop compute charges while retaining the experiment:

```bash
az vm deallocate -g rg-truecourse-dev -n truecourse-vmtest
```

Disks and the public IP continue to incur charges while deallocated. When retiring
the experiment, remove only its VM/NIC/IP/NSG/VNet and detached OS disk. Do not delete
the shared dev resource group, Key Vault, identity, registry, or managed Postgres.
