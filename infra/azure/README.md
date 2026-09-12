# Azure infra — TrueCourse hosted deployment

The new [staging and production VM runbook](vm/DEPLOYMENT.md) replaces application
compute with native Ubuntu + Docker while reusing the managed services below.
Staging is deployed; production remains pending. Start with that runbook for VM
provisioning, first cutover, releases, rollback and monitoring. The isolated
[VM experiment](vm/README.md) remains a separate deployment with a local database.

The existing foundation provisions **Azure Container Apps + Azure DB for
PostgreSQL**. GitHub runs **only** Actions; everything in the runtime path is
Azure.

**Dev and prod are fully isolated** — each is its own resource group with its own
ACR, Container Apps environment, Key Vault, managed identity, and Postgres. So
dev can never touch prod data or secrets. `foundation.bicep` is a complete
*single-environment* stack; you deploy it **once per RG**.

```
rg-truecourse-dev                 rg-truecourse-prod
  ACR · Container Apps env           ACR · Container Apps env
  Key Vault · managed identity       Key Vault · managed identity
  Postgres · Container App (dev)      Postgres · Container App (prod)
```

Files:
- `foundation.bicep` — one environment's foundation (deploy per RG)
- `environment.bicep` — workload-profiles environment using an existing Log Analytics workspace
- `containerapp.bicep` — one Container App, 4 vCPU / 8 GiB on Consumption
- `set-secrets.sh` — write that env's secrets into *its* Key Vault
- `vm-test.bicep` + `deploy-vm-test.sh` — isolated 16 GiB staging VM with Docker,
  its own Postgres, and HTTPS. Reuses dev Key Vault and ACR. See the
  [VM experiment runbook](vm/README.md) for provisioning, copying dev, and sign-in.

> **Region:** examples use `westus3` (open for our subscription, at the cheapest
> price tier — same as the restricted `eastus`).
> Popular regions like `eastus`/`eastus2` are commonly **offer-restricted** for
> Postgres Flexible Server on program/sponsorship/PAYG subscriptions
> (`LocationIsOfferRestricted`). To find a region YOUR subscription can use, query
> the capabilities API — an **empty `reason`** means it's open:
>
> ```bash
> az rest --method get --query "value[].reason" \
>   --url "https://management.azure.com/subscriptions/<sub>/providers/Microsoft.DBforPostgreSQL/locations/<region>/capabilities?api-version=2023-06-01-preview"
> ```
>
> Keep app + Postgres + ACR in the same region — they inherit the RG's location.

---

## One-time setup

Prereq: `az` CLI logged in (`az login`), Owner/Contributor on the subscription.
None of this requires the deploy files to be merged — Bicep runs from your local
checkout.

For fresh dev setup, pass `environmentName=truecourse-dev-cae-v2` to foundation.
For existing dev, use the migration note below; do not redeploy the full foundation.

### 1. Resource groups + foundation (once per environment)

```bash
for E in dev prod; do
  az group create -n rg-truecourse-$E -l westus3
  az deployment group create -g rg-truecourse-$E -f infra/azure/foundation.bicep \
    -p postgresAdminPassword='<a-distinct-password-per-env>'
done
```

Grab each env's outputs (you'll reuse them):

```bash
az deployment group show -g rg-truecourse-dev -n foundation \
  --query properties.outputs -o json
# acrLoginServer, acrName, environmentId, identityId, keyVaultName,
# keyVaultUri, postgresFqdn, postgresDatabase   (repeat for -prod)
```

### 2. Secrets → each env's Key Vault

The vault is **RBAC-mode**, so even as its creator you have no data-plane access
by default. Grant yourself **Key Vault Secrets Officer** on the vault first (once
per env) and wait ~1–2 min for it to propagate:

```bash
az role assignment create \
  --assignee "$(az ad signed-in-user show --query id -o tsv)" \
  --role "Key Vault Secrets Officer" \
  --scope "$(az keyvault show -n <keyVaultName> --query id -o tsv)"
```

Then run `set-secrets.sh` **once per env**, pointed at that env's Key Vault +
Postgres, with that env's WorkOS app and GitHub App:

```bash
export KEY_VAULT_NAME=<dev keyVaultName>
export DATABASE_URL="postgres://tcadmin:<dev-pw>@<dev postgresFqdn>:5432/truecourse?sslmode=require"
export TRUECOURSE_SECRET_KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")"
export WORKOS_API_KEY=...  WORKOS_CLIENT_ID=...  WORKOS_COOKIE_PASSWORD=...
export WORKOS_REDIRECT_URI="https://<dev-app-fqdn>/api/auth/callback"  WORKOS_APP_URL="https://<dev-app-fqdn>"
export GITHUB_APP_ID=...  GITHUB_APP_PRIVATE_KEY="$(base64 -i app.private-key.pem | tr -d '\n')"
export GITHUB_APP_WEBHOOK_SECRET=...  GITHUB_APP_SLUG=truecourse-gate

./infra/azure/set-secrets.sh        # then repeat with the PROD values + prod Key Vault
```

> Use a **distinct** `TRUECOURSE_SECRET_KEY` and **separate** WorkOS / GitHub apps
> per env — a dev key or webhook must never reach prod. That's the point of the
> isolation.

### 3. A bootstrap image (one per env's ACR)

The Container Apps need an image to start; CI replaces it on every deploy.

```bash
az acr build --registry <dev acrName>  --image truecourse:bootstrap --file Dockerfile .
az acr build --registry <prod acrName> --image truecourse:bootstrap --file Dockerfile .
```

### 4. Deploy the Container App into each RG

```bash
# dev
az deployment group create -g rg-truecourse-dev -f infra/azure/containerapp.bicep \
  -p name=truecourse-dev image=<dev acrLoginServer>/truecourse:bootstrap \
     environmentId=<dev environmentId> identityId=<dev identityId> \
     acrLoginServer=<dev acrLoginServer> keyVaultUri=<dev keyVaultUri>

# prod — same command with the prod outputs + name=truecourse-prod
```

The deployment output `url` is each app's public URL. Point the **dev** GitHub
App's webhook at the dev URL to exercise the PR gate against a real deployment.

---

## GitHub Actions OIDC (so CI deploys without secrets)

One Entra app registration, a **federated credential per environment**, and
**Contributor on each RG** (covers `az acr build` + the `containerapp.bicep` deploy):

```bash
APP_ID=$(az ad app create --display-name truecourse-cicd --query appId -o tsv)
az ad sp create --id "$APP_ID"
SP_OID=$(az ad sp show --id "$APP_ID" --query id -o tsv)

for E in dev prod; do
  az ad app federated-credential create --id "$APP_ID" --parameters '{
    "name":"gh-'$E'",
    "issuer":"https://token.actions.githubusercontent.com",
    "subject":"repo:truecourse-ai/truecourse:environment:'$E'",
    "audiences":["api://AzureADTokenExchange"]
  }'
  az role assignment create --assignee "$SP_OID" --role Contributor \
    --scope "$(az group show -n rg-truecourse-$E --query id -o tsv)"
done
```

## GitHub variables

The workflows declare `environment: dev` / `prod`, so the env-specific values are
set as **Environment variables** (Settings → Environments → dev/prod → Variables);
the shared identity is repo-level.

**Repo-level** (Settings → Secrets and variables → Actions → Variables) — none are
secret, they're IDs:

| Variable | Value |
|---|---|
| `AZURE_CLIENT_ID` | the `$APP_ID` above |
| `AZURE_TENANT_ID` | `az account show --query tenantId -o tsv` |
| `AZURE_SUBSCRIPTION_ID` | `az account show --query id -o tsv` |

For VM releases, environment resource names live in `vm.bicep`; GitHub reads the
provisioned deployment's outputs. `AZURE_RG` and `APP_NAME` are no longer used by
the deployment workflows. Keep the existing `dev` and `prod` GitHub environments
and OIDC variables. Set `AZURE_VM_DEPLOYMENT_ENABLED=true` once an environment's
manual VM setup and old-app shutdown are complete. Before that, releases fail
before Azure login. Keep a required reviewer on `prod` if desired.

## Deployment triggers

- Add `deploy-dev` to a same-repository PR to deploy staging. Further pushes while
  labeled redeploy it. Manual **Deploy (dev)** dispatch is also available.
- Push a stable version tag such as `v1.2.3` to run the existing release tests,
  then deploy that exact commit to production. Prerelease tags do not deploy.
  npm publication is disabled. Production waits for all release tests to pass.

Both use the shared `.github/actions/deploy-vm` action. GitHub builds the image,
resolves its digest, drains the old application, releases it, checks HTTPS and
enables alerts. No separate deployment commands, image promotion or migration
flags are required for normal releases. Initial VM provisioning remains manual. Configure alert recipients only in Azure
Monitor action groups; the templates and workflows never contain the addresses.

See the [short VM setup and release guide](vm/DEPLOYMENT.md). The commands earlier
in this file describe the existing Container Apps foundation; do not run them to
create replacement VMs.

## Historical Container Apps dev migration

The earlier Container Apps migration procedure below is retained for reference; the VM cutover now follows its own runbook. Keep the app name `truecourse-dev`: after pausing producers
and draining all queued/running jobs and follow-ups, delete the old app and wait
for deletion to finish before recreating it in the new environment. Startup fails
orphaned queued/running jobs, so the two workers must never run together.

Create only the new environment from your machine, reusing the existing logs:

```bash
az deployment group create -g rg-truecourse-dev -f infra/azure/environment.bicep \
  -p name=truecourse-dev-cae-v2 location=westus3 logAnalyticsWorkspaceName=truecourse-logs
```

Use its `environmentId` output to redeploy `containerapp.bicep` with the same app
name, image, identity, ACR and Key Vault. The new URL is
`https://truecourse-dev.<defaultDomain>`. After the old app is deleted and before
recreation, update Key Vault's `workos-app-url` and `workos-redirect-uri`, plus the
WorkOS allowed callback `/api/auth/callback`. Update the GitHub App webhook
`/api/github/webhook` and setup URL `/api/github/setup` to the new origin.

Keep deployments paused during migration. Save the old image/configuration and
URLs first; rollback requires recreating the old app in the old environment and
restoring those URLs after deleting the replacement. Keep the existing database,
identity and other foundation resources. Verify login, worker startup, event
streaming and guard setup before resuming traffic and routine Actions deployments.
