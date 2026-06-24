using System;

namespace ApiGateway.Violations.Performance;

/// <summary>
/// Builds culture-invariant cache keys for tenant resources. It reaches for
/// FormattableString.Invariant, which allocates a FormattableString on every key just
/// to format the interpolation — wasteful on a path that runs per request.
/// </summary>
internal sealed class CacheKeyBuilder
{
    private readonly string _prefix;

    public CacheKeyBuilder(string prefix)
    {
        _prefix = prefix;
    }

    /// <summary>Composes the cache key for one tenant resource.</summary>
    public string ForTenant(int tenantId, string resource)
    {
        // VIOLATION: performance/deterministic/prefer-string-create
        return FormattableString.Invariant($"{_prefix}:tenant:{tenantId}:{resource}");
    }
}
