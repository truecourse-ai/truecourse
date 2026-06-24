using System;

namespace Positive.Boundary.Performance;

/// <summary>Compares two names case-insensitively without allocating.</summary>
public sealed class TolowerForComparisonSafe
{
    /// <summary>Compares in place via StringComparison rather than lowercasing both sides.</summary>
    internal bool SameName(string left, string right)
    {
        // SAFE: performance/deterministic/tolower-for-comparison
        return string.Equals(left, right, StringComparison.OrdinalIgnoreCase);
    }
}
