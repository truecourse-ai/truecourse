using System.Collections.Generic;

namespace Positive.Boundary.Performance;

/// <summary>Evicts entries from a map in a single lookup.</summary>
public sealed class RedundantContainsKeyBeforeRemoveSafe
{
    /// <summary>Removes the key directly, returning whether anything was evicted.</summary>
    internal bool Evict(Dictionary<string, int> map, string key)
    {
        // SAFE: performance/deterministic/redundant-containskey-before-remove
        return map.Remove(key);
    }
}
