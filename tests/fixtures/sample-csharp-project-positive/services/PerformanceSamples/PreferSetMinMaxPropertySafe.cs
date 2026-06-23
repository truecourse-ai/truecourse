using System.Collections.Generic;

namespace Positive.Boundary.Performance;

/// <summary>Tracks priority scores for live sessions in a sorted set.</summary>
public sealed class PreferSetMinMaxPropertySafe
{
    private readonly SortedSet<int> _priorityScores = new();

    /// <summary>Returns the highest score via the set's O(1) Max property, not the LINQ scan.</summary>
    public int HighestPriority()
    {
        // SAFE: performance/deterministic/prefer-set-minmax-property
        return _priorityScores.Max;
    }
}
