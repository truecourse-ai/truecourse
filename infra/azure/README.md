# Azure infra — TrueCourse hosted deployment

Each environment is one Ubuntu VM (Docker + Caddy, the app under systemd) over
a set of managed services. GitHub runs **only** Actions; everything in the
runtime path is Azure. The [VM runbook](vm/DEPLOYMENT.md) covers provisioning,
releases and monitoring; this file covers the foundation under it, secrets, and
the GitHub side.

**Dev and prod are fully isolated** — each is its own resource group with its own
ACR, Key Vault, managed identity, Postgres and Log Analytics, so dev can never
touch prod data or secrets. `foundation.bicep` is a complete *single-environment*
stack; you deploy it **once per RG**. Both are deployed.

```
rg-truecourse-dev                  rg-truecourse-prod
  ACR · Key Vault · identity          ACR · Key Vault · identity
  Postgres · Log Analytics            Postgres · Log Analytics
  VM truecourse-dev (+ monitoring)    VM truecourse-production (+ monitoring)
```

Files:
- `foundation.bicep` — one environment's managed services (deploy per RG)
- `set-secrets.sh` — write that env's secrets into *its* Key Vault
- `vm.bicep` + `vm-monitoring.bicep` — one environment's VM host and its alerts

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

Both environments already have their foundation; these steps are the record
for a rebuild. Do not redeploy the foundation over a live environment.

### 1. Resource groups + foundation (once per environment)

One environment at a time, and `what-if` before `create`: the foundation
derives its resource names from the resource group, so a deployment against a
group that already has one targets its live Postgres server and resets the
admin password.

```bash
E=dev   # or prod, with its own password
az group create -n rg-truecourse-$E -l westus3
FOUNDATION_ARGS=(-g rg-truecourse-$E -f infra/azure/foundation.bicep
  -p postgresAdminPassword='<password-for-this-env>')
az deployment group what-if "${FOUNDATION_ARGS[@]}"
az deployment group create "${FOUNDATION_ARGS[@]}"
```

Grab each env's outputs (you'll reuse them):

```bash
az deployment group show -g rg-truecourse-dev -n foundation \
  --query properties.outputs -o json
# acrLoginServer, acrName, identityId, identityClientId, keyVaultName,
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
export GITHUB_APP_ID=...  GITHUB_APP_PRIVATE_KEY="$(base64 -i app.private-key.pem | tr -d '\n')"
export GITHUB_APP_WEBHOOK_SECRET=...  GITHUB_APP_SLUG=truecourse-gate
export GITHUB_APP_CLIENT_ID=...  GITHUB_APP_CLIENT_SECRET=...

./infra/azure/set-secrets.sh        # then repeat with the PROD values + prod Key Vault
```

> Use a **distinct** `TRUECOURSE_SECRET_KEY` and **separate** WorkOS / GitHub apps
> per env — a dev key or webhook must never reach prod. That's the point of the
> isolation.

### 3. The VM host

Provision the environment's VM with `vm.bicep` and release onto it, following
the [VM runbook](vm/DEPLOYMENT.md). The runbook's deployment outputs hold each
environment's URL and SSH command; point that environment's WorkOS callback and
GitHub App URLs at that URL.

---

## GitHub Actions OIDC (so CI deploys without secrets)

One Entra app registration, a **federated credential per environment**, and
**Contributor on each RG** (covers `az acr build`, the VM Run Command and the monitoring deploy):

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

Environment resource names live in `vm.bicep`; GitHub reads the provisioned
deployment's outputs, so no resource name is a GitHub variable. Each environment
also carries `AZURE_VM_DEPLOYMENT_ENABLED=true`, set once its manual VM setup is
complete; without it a release fails before Azure login. Keep a required
reviewer on `prod`.

## Deployment triggers

- Add `deploy-dev` to a same-repository PR to deploy dev. Further pushes while
  labeled redeploy it. Manual **Deploy (dev)** dispatch deploys any branch.
- Create a GitHub Release / push a stable `vX.Y.Z` tag on a `main` commit to
  deploy production. **Deploy (prod)** dispatch on `main` re-rolls main's HEAD.
  Both refuse a commit that is not on `main`; nothing deploys on merge.

Both use the shared `.github/actions/deploy-vm` action: build the image in the
environment's ACR, resolve its digest, restart the VM's service on it and wait
for its health check, then enable alerts. Initial VM provisioning is manual.
Configure alert recipients only in Azure Monitor action groups.

See the [VM setup and release guide](vm/DEPLOYMENT.md).
