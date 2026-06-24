using System.Collections.Generic;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Fills a local list and then reads it back via its count, so the collection's
/// contents are genuinely consumed and the unused-collection rule must not fire.
/// </summary>
public sealed class UnusedCollectionSafe
{
    /// <summary>Returns how many of the given amounts are negative.</summary>
    internal int RejectedCount(IEnumerable<int> amounts)
    {
        // SAFE: code-quality/deterministic/unused-collection
        var rejected = new List<int>();
        foreach (var amount in amounts)
        {
            if (amount < 0)
            {
                rejected.Add(amount);
            }
        }

        return rejected.Count;
    }
}
