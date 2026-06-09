// Architecture regression: forbidden-alternative fires when chosen is present
// but another data-store is also in use.
//
// Contract `arch.regression.forbidden-alt-only` asserts `chosen postgres`.
// The codebase (SampleApi.csproj) has both Npgsql (postgres) and MongoDB.Driver
// (mongodb). Postgres IS detected, so no `unmet-choice`. But mongodb is also
// detected and is not the chosen value, so `forbidden-alternative` fires.
//
// IL-DRIFT: ArchitectureDecision:arch.regression.forbidden-alt-only / architecture.data-store.forbidden-alternative
namespace SampleApi;

internal static class ArchitectureRegressionForbiddenAltOnly
{
}
