#!/usr/bin/env bash
# Local checks only. No az commands, Docker, guest execution, or deployment.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../../.."
bash -n .github/scripts/vm-bootstrap.sh
python3 -m unittest discover -s tests/infra/azure -p 'test_vm_*.py' -v
# Use the standalone Bicep compiler to avoid Azure CLI login/config writes.
if [[ -n "${BICEP_BIN:-}" ]]; then
  CHECK_DIR="$(mktemp -d)"
  trap 'rm -rf "$CHECK_DIR"' EXIT
  DOTNET_BUNDLE_EXTRACT_BASE_DIR="$CHECK_DIR/bicep-cache" "$BICEP_BIN" build infra/azure/vm.bicep --outfile "$CHECK_DIR/vm.json"
  DOTNET_BUNDLE_EXTRACT_BASE_DIR="$CHECK_DIR/bicep-cache" "$BICEP_BIN" build infra/azure/vm-monitoring.bicep --outfile "$CHECK_DIR/monitoring.json"
else
  echo 'Bicep compilation skipped; set BICEP_BIN to the standalone compiler to include it.'
fi
