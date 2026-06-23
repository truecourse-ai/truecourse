using System.Collections.Generic;

namespace Positive.Boundary.Bugs;

/// <summary>Base handle for a pooled item.</summary>
internal class PoolItem
{
    /// <summary>Identifier of the item.</summary>
    internal int Id { get; set; }
}

/// <summary>A cached pooled item.</summary>
internal sealed class CachedPoolItem : PoolItem
{
    /// <summary>Whether the cached copy is warm.</summary>
    internal bool IsWarm { get; set; }
}

/// <summary>Iterates a derived-typed collection through a base-typed loop variable.</summary>
internal sealed class ForeachImplicitDowncastSafe
{
    /// <summary>Sums the identifiers of every cached item, viewed as base items.</summary>
    internal int SumIds(IEnumerable<CachedPoolItem> items)
    {
        int total = 0;
        // SAFE: bugs/deterministic/foreach-implicit-downcast
        foreach (PoolItem item in items)
        {
            total += item.Id;
        }
        return total;
    }
}
