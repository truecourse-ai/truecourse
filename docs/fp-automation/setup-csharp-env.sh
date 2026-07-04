#!/usr/bin/env bash
#
# Provision the .NET toolchain the C# (cs-) fp-automation scope needs.
#
# WHY: C# analyze is fail-hard on the Roslyn semantic host
# (tools/csharp-roslyn-host, a net8.0 framework-dependent DLL). `pnpm build:dist`
# only builds/publishes that host when `dotnet` is on PATH — otherwise it just
# warns and SKIPS it (scripts/build.ts), so the build "succeeds" with no host and
# the first C# `analyze` later throws RoslynHostUnavailableError. There is no
# tree-sitter-only fallback, by design (see CLAUDE.md + violation-pipeline.service.ts).
#
# The default (TS/JS + Python) account does not need this. Only the cs- account,
# whose campaigns analyze C#, does.
#
# WHERE THIS RUNS (two entry points, same script):
#   1. The cs- environment's setup script points at this file, so it runs ONCE
#      per container (fast path — dotnet is already present for every session).
#   2. The routine prompts (fp-discover / fp-next-fix) run it as a FALLBACK when
#      `dotnet` is missing, so a mis-provisioned environment still self-heals.
# It is idempotent: if `dotnet` is already on PATH it exits immediately.
#
set -euo pipefail

DOTNET_DIR="${DOTNET_ROOT:-$HOME/.dotnet}"

if command -v dotnet >/dev/null 2>&1; then
  echo "dotnet already on PATH ($(dotnet --version)) — nothing to do."
  exit 0
fi

echo "=== Installing .NET for the C# (cs-) fp-automation scope into $DOTNET_DIR ==="

# The .NET download hosts must be on this environment's egress allowlist. They are
# NOT reachable under the default network policy (npm/pypi/crates/go are allowlisted,
# the Microsoft CDN is not), so this download 403s unless the cs- environment's policy
# permits at least: dot.net, builds.dotnet.microsoft.com, dotnetcli.azureedge.net,
# dotnetbuilds.azureedge.net — plus api.nuget.org / *.nuget.org for `dotnet restore`.
if ! curl -fsSL https://dot.net/v1/dotnet-install.sh -o /tmp/dotnet-install.sh; then
  echo "ERROR: could not download the .NET install script (likely a 403 from the egress proxy)." >&2
  echo "The .NET download hosts are not on this environment's allowlist. Allowlist them on the" >&2
  echo "cs- environment's network policy (see docs/fp-automation/README.md → 'C# account: .NET" >&2
  echo "toolchain + egress'), then re-run. Do NOT route around the policy." >&2
  exit 1
fi
chmod +x /tmp/dotnet-install.sh

# .NET 10 SDK — abp's global.json pins 10.0.100 (rollForward latestFeature); the
# roslyn-workspace tier restores abp's real solution with this SDK.
/tmp/dotnet-install.sh --channel 10.0 --install-dir "$DOTNET_DIR"

# .NET 8 runtime — the Roslyn host targets net8.0 and is launched framework-
# dependent (`dotnet <dll>`); .NET does not roll forward across majors by default,
# so a net8 app will not run on a net10-only runtime.
/tmp/dotnet-install.sh --channel 8.0 --runtime dotnet --install-dir "$DOTNET_DIR"

export DOTNET_ROOT="$DOTNET_DIR"
export PATH="$DOTNET_DIR:$PATH"

# Persist for the routine's subsequent shells. Each Bash step runs in a fresh
# non-login shell initialized from the profile, so an in-shell `export` alone is
# lost after this script returns — the routine would still see no `dotnet`.
PROFILE="$HOME/.bashrc"
if ! grep -q 'DOTNET_ROOT' "$PROFILE" 2>/dev/null; then
  {
    echo ''
    echo '# .NET toolchain for the cs- fp-automation scope (added by setup-csharp-env.sh)'
    echo "export DOTNET_ROOT=\"$DOTNET_DIR\""
    echo "export PATH=\"$DOTNET_DIR:\$PATH\""
  } >> "$PROFILE"
fi

echo "=== .NET ready ($(dotnet --version)); Roslyn host will build on the next 'pnpm build:dist' ==="
