#!/usr/bin/env bash
#
# Populate Key Vault with the secrets the VM release reads into
# /etc/truecourse/app.json. Run AFTER foundation.bicep and BEFORE the first release.
#
# Values come from your shell env — NEVER commit them. Example:
#
#   export KEY_VAULT_NAME=<foundation output keyVaultName>
#   export DATABASE_URL='postgres://tcadmin:<pw>@<pgFqdn>:5432/truecourse?sslmode=require'
#   export TRUECOURSE_SECRET_KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")"
#   export WORKOS_API_KEY=... WORKOS_CLIENT_ID=... WORKOS_COOKIE_PASSWORD=...
#   export GITHUB_APP_ID=... GITHUB_APP_PRIVATE_KEY="$(base64 -i app.private-key.pem | tr -d '\n')" \
#          GITHUB_APP_WEBHOOK_SECRET=... GITHUB_APP_SLUG=truecourse-gate \
#          GITHUB_APP_CLIENT_ID=... GITHUB_APP_CLIENT_SECRET=...
#   ./infra/azure/set-secrets.sh
#
# Each name set here is the dashed form of a name in .github/scripts/vm-release.py
# SECRET_NAMES; the release fails on a missing required one.
set -euo pipefail

KV="${KEY_VAULT_NAME:?set KEY_VAULT_NAME (foundation output keyVaultName)}"

set_secret() { # dashed-name  value  [required|optional|integer]
  local name="$1" value="${2:-}" kind="${3:-optional}"
  if [ -z "$value" ]; then
    if [ "$kind" = required ]; then
      echo "ERROR: $name is required but empty" >&2; exit 1
    fi
    echo "skip  $name (empty)"; return
  fi
  # Same rule as vm-release.py INTEGER_SECRETS; a bad value there fails every release.
  if [ "$kind" = integer ] && ! [[ "$value" =~ ^[1-9][0-9]*$ ]]; then
    echo "ERROR: $name must be a positive integer, got '$value'" >&2; exit 1
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
# GitHub App PR gate
set_secret github-app-id            "${GITHUB_APP_ID:-}"            required
set_secret github-app-private-key   "${GITHUB_APP_PRIVATE_KEY:-}"   required
set_secret github-app-webhook-secret "${GITHUB_APP_WEBHOOK_SECRET:-}" required
set_secret github-app-slug          "${GITHUB_APP_SLUG:-}"          required
set_secret github-app-client-id     "${GITHUB_APP_CLIENT_ID:-}"     required
set_secret github-app-client-secret "${GITHUB_APP_CLIENT_SECRET:-}" required

# Optional — absent means the app's default.
set_secret sentry-dsn                    "${SENTRY_DSN:-}"
set_secret truecourse-max-concurrency    "${TRUECOURSE_MAX_CONCURRENCY:-}"    integer
set_secret truecourse-max-api-concurrency "${TRUECOURSE_MAX_API_CONCURRENCY:-}" integer

# CREDITS, hosted only: the platform's own OpenAI key, for the workspaces that
# pick "TrueCourse credits" on the Models page instead of bringing a key. The
# key and the model are required together or the choice is not offered at all;
# the base URL names another endpoint serving that model (an Azure AI Foundry
# resource takes the same key as its bearer token, and the model is then its
# DEPLOYMENT name), and the price model is the list-price model that deployment
# serves, without which a deployment name prices as nothing and nobody is
# debited. The key is read per run and never stored, logged or answered with.
set_secret truecourse-credits-openai-api-key  "${TRUECOURSE_CREDITS_OPENAI_API_KEY:-}"
set_secret truecourse-credits-model           "${TRUECOURSE_CREDITS_MODEL:-}"
set_secret truecourse-credits-openai-base-url "${TRUECOURSE_CREDITS_OPENAI_BASE_URL:-}"
set_secret truecourse-credits-price-model     "${TRUECOURSE_CREDITS_PRICE_MODEL:-}"

echo "Done. Now provision or release the VM (see infra/azure/vm/DEPLOYMENT.md)."
