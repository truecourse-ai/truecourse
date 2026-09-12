#!/usr/bin/env bash
# Provision only the isolated experiment. The application starts after copy-dev.
set -euo pipefail
RG="${AZURE_RG:-rg-truecourse-dev}"
NAME="${VM_NAME:-truecourse-vmtest}"
SSH_PUBLIC_KEY="${SSH_PUBLIC_KEY_FILE:?set SSH_PUBLIC_KEY_FILE to an existing .pub file}"
SSH_CIDR="${SSH_SOURCE_CIDR:?set SSH_SOURCE_CIDR to your public IP/32}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
IDENTITY_ID="$(az identity show -g "$RG" -n truecourse-id --query id -o tsv)"
IDENTITY_CLIENT_ID="$(az identity show -g "$RG" -n truecourse-id --query clientId -o tsv)"
KV="$(az keyvault list -g "$RG" --query '[0].name' -o tsv)"
IMAGE="${APP_IMAGE:-$(az containerapp show -g "$RG" -n truecourse-dev --query 'properties.template.containers[0].image' -o tsv)}"
# Resolve tags to a digest, so the VM uses the exact artifact inspected here.
if [[ "$IMAGE" != *@sha256:* ]]; then
  REGISTRY="${IMAGE%%.*}"
  IMAGE_NAME="${IMAGE#*/}"
  DIGEST="$(az acr manifest show-metadata -r "$REGISTRY" -n "$IMAGE_NAME" --query digest -o tsv)"
  IMAGE="${IMAGE%:*}@$DIGEST"
fi
az deployment group create -g "$RG" -n vm-test \
  --template-file "$SCRIPT_DIR/vm-test.bicep" \
  --parameters name="$NAME" vmSize="${VM_SIZE:-Standard_D4s_v7}" \
    sshPublicKey="$(cat "$SSH_PUBLIC_KEY")" sshSourceCidr="$SSH_CIDR" \
    identityId="$IDENTITY_ID" identityClientId="$IDENTITY_CLIENT_ID" \
    keyVaultName="$KV" image="$IMAGE" \
  --query properties.outputs -o json
