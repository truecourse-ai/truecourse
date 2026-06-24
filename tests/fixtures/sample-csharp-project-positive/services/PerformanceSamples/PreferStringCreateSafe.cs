using System.Globalization;

namespace Positive.Boundary.Performance;

/// <summary>Builds culture-invariant cache keys for tenant resources.</summary>
public sealed class PreferStringCreateSafe
{
    private readonly string _prefix;

    /// <summary>Captures the key prefix for this builder.</summary>
    public PreferStringCreateSafe(string prefix)
    {
        _prefix = prefix;
    }

    /// <summary>Formats the interpolation directly through string.Create with no FormattableString allocation.</summary>
    public string ForTenant(int tenantId, string resource)
    {
        // SAFE: performance/deterministic/prefer-string-create
        return string.Create(CultureInfo.InvariantCulture, $"{_prefix}:tenant:{tenantId}:{resource}");
    }
}
