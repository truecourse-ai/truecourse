#!/usr/bin/env bash
# Called by GitHub Actions. Never infer absence from a failed Azure command.
set -euo pipefail

MODE=${1:?Expected assert-stopped or deactivate}
RG=${2:?Expected resource group}
APP=${3:?Expected legacy app name}
EXPECTED_ENV=${4:?Expected legacy environment name}

fail() { echo "::error::$*" >&2; exit 1; }
case "$MODE" in assert-stopped|deactivate) ;; *) fail 'Unknown legacy-app mode' ;; esac
if [[ "$MODE" == deactivate ]]; then
  [[ "${MIGRATION_CONFIRMATION:-}" == 'jobs-drained-producers-paused' ]] ||
    fail 'Migration requires confirmation that every workspace is drained and all producers remain paused.'
fi

apps=$(az containerapp list -g "$RG" -o json)
app=$(jq -c --arg name "$APP" '[.[] | select(.name == $name)]' <<< "$apps")
if [[ $(jq 'length' <<< "$app") == 0 ]]; then
  [[ "$MODE" == assert-stopped ]] || fail 'Legacy app is missing; investigate before migration.'
  exit 0
fi
jq -e --arg suffix "/managedEnvironments/$EXPECTED_ENV" \
  'length == 1 and ((.[0].properties.environmentId // .[0].properties.managedEnvironmentId) | endswith($suffix))' \
  <<< "$app" >/dev/null || fail 'Legacy app does not belong to the expected environment.'

revisions=$(az containerapp revision list -g "$RG" -n "$APP" --all -o json)
if [[ "$MODE" == deactivate ]]; then
  # --all includes inactive revisions, which may still have terminating replicas.
  active=$(jq -r '.[] | select(.properties.active == true) | .name' <<< "$revisions")
  while IFS= read -r revision; do
    [[ -n "$revision" ]] || continue
    az containerapp revision deactivate -g "$RG" -n "$APP" --revision "$revision" -o none
  done <<< "$active"
fi

# Do not equate an inactive flag with a stopped worker. Check every revision's
# replica list as well, and fail closed on permission/API errors or a timeout.
for ((attempt=0; attempt<60; attempt++)); do
  revisions=$(az containerapp revision list -g "$RG" -n "$APP" --all -o json)
  active_count=$(jq '[.[] | select(.properties.active == true)] | length' <<< "$revisions")
  replica_count=0
  names=$(jq -r '.[].name' <<< "$revisions")
  while IFS= read -r revision; do
    [[ -n "$revision" ]] || continue
    replicas=$(az containerapp replica list -g "$RG" -n "$APP" --revision "$revision" -o json)
    count=$(jq 'length' <<< "$replicas")
    replica_count=$((replica_count + count))
  done <<< "$names"
  if [[ "$active_count" == 0 && "$replica_count" == 0 ]]; then
    echo "Legacy app $APP has no active revisions or replicas."
    exit 0
  fi
  [[ "$MODE" == deactivate ]] || fail "Legacy app is still active ($active_count revisions, $replica_count replicas). Use the reviewed migration runbook."
  sleep 10
done
fail 'Legacy replicas did not stop within 10 minutes. Replacement deployment is blocked; investigate before retrying.'
