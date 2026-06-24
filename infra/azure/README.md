# Azure infra — TrueCourse hosted deployment

Provisions our hosted environment on **Azure Container Apps + Azure DB for
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
- `containerapp.bicep` — one Container App (deploy per RG)
- `set-secrets.sh` — write that env's secrets into *its* Key Vault

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
export WORKOS_REDIRECT_URI="https://<dev-app-fqdn>/api/ee/auth/callback"  WORKOS_APP_URL="https://<dev-app-fqdn>"
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

**Per-environment** — set the *same two variable names* under BOTH the `dev` and
`prod` Environments, each with that env's values. The workflow **discovers** the
ACR, Container Apps env, identity, and Key Vault from the RG at runtime, so those
are NOT variables:

| Variable | dev | prod |
|---|---|---|
| `AZURE_RG` | `rg-truecourse-dev` | `rg-truecourse-prod` |
| `APP_NAME` | `truecourse-dev` | `truecourse-prod` |

Create the `dev` and `prod` **Environments** (Settings → Environments) — the
federated subjects above point at them. Add a required reviewer on `prod` for a
manual gate before production rolls.

> The workflows run `containerapp.bicep` (create-or-update), so the **first
> deploy creates** the Container App and later runs roll the image — the manual
> step 4 above is only needed if you'd rather create the app by hand.

## Deploy triggers (both manual — nothing auto-deploys)

Neither environment deploys on open or merge. You opt in each time:

- **Dev (`deploy-dev.yml`)** — two opt-in ways:
  - **Label** a PR **`deploy-dev`** → builds that PR's branch and rolls the
    shared Dev Container App. Pushing more commits while the label is on
    re-deploys; remove the label to stop. (Create the label once under the
    repo's Labels, or just type it when adding it to a PR.)
  - **Manual:** Actions → Deploy (dev) → **Run workflow** → pick a branch
    (usually `main`) → builds that branch's HEAD. Use this to roll merged main
    onto Dev. Dev allows any branch and has no reviewer gate.
- **Prod (`deploy-prod.yml`)** — **Actions → Deploy (prod) → Run workflow**, on
  the **`main`** branch. It builds main's current HEAD; a `main`-only guard
  refuses any other branch, and the `prod` Environment's required reviewer still
  gates the rollout. Prod only ever ships merged code, never a PR branch.

> If dev and prod live in **different subscriptions**, make `AZURE_SUBSCRIPTION_ID`
> environment-scoped too.
