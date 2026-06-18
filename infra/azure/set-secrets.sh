#!/usr/bin/env bash
#
# Populate Key Vault with the bootstrap secrets the Container Apps reference.
# Run AFTER foundation.bicep and BEFORE deploying the Container Apps.
#
# Values come from your shell env — NEVER commit them. Example:
#
#   export KEY_VAULT_NAME=<foundation output keyVaultName>
#   export DATABASE_URL='postgres://tcadmin:<pw>@<pgFqdn>:5432/truecourse?sslmode=require'
#   export TRUECOURSE_SECRET_KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")"
#   export WORKOS_API_KEY=... WORKOS_CLIENT_ID=... WORKOS_COOKIE_PASSWORD=... \
#          WORKOS_REDIRECT_URI=https://<app-fqdn>/api/ee/auth/callback WORKOS_APP_URL=https://<app-fqdn>
#   export GITHUB_APP_ID=... GITHUB_APP_PRIVATE_KEY="$(base64 -i app.private-key.pem | tr -d '\n')" \
#          GITHUB_APP_WEBHOOK_SECRET=... GITHUB_APP_SLUG=truecourse-gate
#   ./infra/azure/set-secrets.sh
#
# Each name set here must match the containerapp.bicep `secretEnv` list (dashed).
set -euo pipefail

KV="${KEY_VAULT_NAME:?set KEY_VAULT_NAME (foundation output keyVaultName)}"

set_secret() { # dashed-name  value  [required]
  local name="$1" value="${2:-}" required="${3:-optional}"
  if [ -z "$value" ]; then
    if [ "$required" = required ]; then
      echo "ERROR: $name is required but empty" >&2; exit 1
    fi
    echo "skip  $name (empty)"; return
  fi
  az keyvault secret set --vault-name "$KV" --name "$name" --value "$value" --output none
  echo "set   $name"
}

# Required
set_secret database-url             "${DATABASE_URL:-}"             required
set_secret truecourse-secret-key    "${TRUECOURSE_SECRET_KEY:-}"    required
# SSO (WorkOS) — required for the enterprise edition
set_secret workos-api-key           "${WORKOS_API_KEY:-}"           required
set_secret workos-client-id         "${WORKOS_CLIENT_ID:-}"         required
set_secret workos-cookie-password   "${WORKOS_COOKIE_PASSWORD:-}"   required
set_secret workos-redirect-uri      "${WORKOS_REDIRECT_URI:-}"      required
set_secret workos-app-url           "${WORKOS_APP_URL:-}"           required
# GitHub App PR gate
set_secret github-app-id            "${GITHUB_APP_ID:-}"            required
set_secret github-app-private-key   "${GITHUB_APP_PRIVATE_KEY:-}"   required
set_secret github-app-webhook-secret "${GITHUB_APP_WEBHOOK_SECRET:-}" required
set_secret github-app-slug          "${GITHUB_APP_SLUG:-}"          required

# Optional — to use these, also add the env name to containerapp.bicep `secretEnv`.
set_secret resend-api-key           "${RESEND_API_KEY:-}"
set_secret sentry-dsn               "${SENTRY_DSN:-}"

echo "Done. Now deploy the Container Apps (see infra/azure/README.md)."
