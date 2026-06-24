using System;

namespace Positive.Boundary.CodeQuality;

/// <summary>Prefix checks spelled the idiomatic way, never via Substring/IndexOf equality.</summary>
public sealed class SubstringOverStartsEndsSafe
{
    /// <summary>True when the route is under the admin area.</summary>
    public bool IsAdminRoute(string route)
    {
        // SAFE: code-quality/deterministic/substring-over-starts-ends
        return route.StartsWith("/admin", StringComparison.Ordinal);
    }

    /// <summary>True when the value ends with the supplied suffix.</summary>
    public bool HasSuffix(string value, string suffix)
    {
        return value.EndsWith(suffix, StringComparison.Ordinal);
    }
}
