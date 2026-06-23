using System.Collections.Generic;
using System.Linq;

namespace Positive.Boundary.Performance;

/// <summary>Returns large orders sorted by placement time, filtering first.</summary>
public sealed class FilterBeforeSortSafe
{
    /// <summary>Keeps only orders above the threshold, then sorts the smaller set.</summary>
    internal List<Order> LargeOrdersSorted(List<Order> orders, decimal threshold)
    {
        // SAFE: performance/deterministic/filter-before-sort
        return orders.Where(o => o.Total > threshold).OrderBy(o => o.PlacedAt).ToList();
    }
}

/// <summary>Minimal order record used by the boundary case.</summary>
public sealed class Order
{
    /// <summary>Total monetary value of the order.</summary>
    public decimal Total { get; init; }

    /// <summary>UTC tick at which the order was placed.</summary>
    public long PlacedAt { get; init; }
}
