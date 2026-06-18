using System;
using System.Collections.Generic;
using System.Linq;

namespace UserServiceApp.Violations.Reliability;

internal sealed class ConfigurationLoader
{
    internal int ResolveCacheTtlSeconds()
    {
        // VIOLATION: reliability/deterministic/invalid-envvar-default
        return int.Parse(Environment.GetEnvironmentVariable("CACHE_TTL_SECONDS"));
    }

    internal string PrimaryRegionName(IReadOnlyList<RegionConfig> regions)
    {
        // VIOLATION: reliability/deterministic/missing-null-check-after-find
        return regions.FirstOrDefault(r => r.IsPrimary).Name;
    }

    internal string? BillingCity(CustomerAccount? account)
    {
        // VIOLATION: reliability/deterministic/unchecked-optional-chain-depth
        return account?.Profile?.Billing?.Address?.City;
    }
}
