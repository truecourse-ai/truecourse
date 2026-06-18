# Deployment

How TrueCourse is deployed to our hosted **Azure** environment. CD runs on
GitHub Actions: every PR deploys to **dev**, every merge to **main** deploys to
**prod**.

## What ships

One container image (`Dockerfile`) — the dashboard server with the EE plugin and
the built client. It's deliberately cloud-neutral: all config comes from env vars
and a Postgres `DATABASE_URL`, with no cloud SDK at runtime, so it can move clouds
later. The image is built **with** the EE overlay (`VITE_TC_EE=true`) so the
enterprise UI is included.

- **Runtime:** Node 20, Express + Socket.io, served on `PORT` (default 3001).
- **Database:** Postgres via `DATABASE_URL`; Drizzle migrations apply at boot.
- **No object storage:** hosted content is content-addressed in Postgres.

## Azure resources

Provisioned with Bicep — see [`infra/azure/README.md`](../infra/azure/README.md):

- **Azure Container Apps** — dev + prod, HTTPS ingress, websockets, revisions.
- **Azure Container Registry (ACR)** — the image registry.
- **Azure Database for PostgreSQL** — the database.
- **Azure Key Vault** — bootstrap secrets, read by the app via managed identity.
- **User-assigned managed identity** — ACR pull + Key Vault read (no stored creds).

## CD

| Trigger | Workflow | Action |
|---|---|---|
| Pull request | `.github/workflows/deploy-dev.yml` | `az acr build` → update the **dev** Container App → comment the URL |
| Push to `main` | `.github/workflows/deploy-prod.yml` | `az acr build` → update the **prod** Container App |

GitHub authenticates to Azure with **OIDC federated credentials** — no cloud
secret is stored in GitHub. The dev environment is **shared** (most recent PR
push wins).

## Secrets

Two tiers:
- **App-managed** — LLM provider keys + connector tokens are entered in-app and
  stored encrypted in Postgres (keyed by `TRUECOURSE_SECRET_KEY`). Not infra.
- **Bootstrap** (~8 env values: `DATABASE_URL`, `TRUECOURSE_SECRET_KEY`,
  `WORKOS_*`, `GITHUB_APP_*`) — live in **Key Vault**, injected as env via the
  managed identity. Guard `TRUECOURSE_SECRET_KEY` hardest — it decrypts the rest.

## Local validation

`docker compose up --build` boots the image + a Postgres locally to sanity-check
the build before it ships.

## Notes

- The PR gate is a GitHub App with a **single webhook URL** — point it at the dev
  app's ingress to exercise the gate against a real deployment.
- Container Apps run **≥1 replica** (the in-process graphile-worker must keep
  running). Scaling past one replica needs Socket.io sticky sessions or a Redis
  adapter.
- `pnpm build:dist` is the **OSS** packaging path and excludes EE — it is **not**
  used for this image; the Dockerfile builds the full workspace incl. `ee/`.
