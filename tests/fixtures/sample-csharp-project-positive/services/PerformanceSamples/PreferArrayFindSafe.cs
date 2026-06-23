using System;

namespace Positive.Boundary.Performance;

/// <summary>Finds the first matching entry in an array.</summary>
public sealed class PreferArrayFindSafe
{
    /// <summary>Uses Array.Find rather than LINQ FirstOrDefault, so no enumerator is allocated.</summary>
    internal int FindMatch(int[] roster, int target)
    {
        // SAFE: performance/deterministic/prefer-array-find
        return Array.Find(roster, value => value == target);
    }
}
