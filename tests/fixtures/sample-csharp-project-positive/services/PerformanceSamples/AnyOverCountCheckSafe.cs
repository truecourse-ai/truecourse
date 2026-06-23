using System.Collections.Generic;

namespace Positive.Boundary.Performance;

/// <summary>Reports whether a batch of items has any entries.</summary>
public sealed class AnyOverCountCheckSafe
{
    // SAFE: performance/deterministic/any-over-count-check
    /// <summary>Tests emptiness via the list's O(1) Count instead of building an enumerator.</summary>
    public bool HasItems(IReadOnlyList<int> items)
    {
        return items.Count > 0;
    }
}
