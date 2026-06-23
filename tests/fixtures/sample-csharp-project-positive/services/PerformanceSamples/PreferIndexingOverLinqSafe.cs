using System.Collections.Generic;

namespace Positive.Boundary.Performance;

/// <summary>Reads the last element of a list by direct index instead of LINQ Last().</summary>
public sealed class PreferIndexingOverLinqSafe
{
    /// <summary>Returns the most recent signup by indexing from the end.</summary>
    internal string MostRecentSignup(List<string> recentSignups)
    {
        // SAFE: performance/deterministic/prefer-indexing-over-linq
        return recentSignups[^1];
    }
}
