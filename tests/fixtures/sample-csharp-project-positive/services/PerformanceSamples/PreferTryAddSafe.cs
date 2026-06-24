using System.Collections.Generic;

namespace Positive.Boundary.Performance;

/// <summary>Registers entries into a map without a redundant lookup.</summary>
public sealed class PreferTryAddSafe
{
    /// <summary>Adds the entry only when the key is absent, in a single lookup.</summary>
    public void Register(Dictionary<string, int> map, string key, int value)
    {
        // SAFE: performance/deterministic/prefer-tryadd
        map.TryAdd(key, value);
    }
}
