using System.Collections.Generic;

namespace Positive.Boundary.Performance;

/// <summary>Exposes tags through a read-only view rather than a per-read copy.</summary>
public sealed class PropertyReturnsCollectionCopySafe
{
    private readonly List<string> _tags = new();

    // SAFE: performance/deterministic/property-returns-collection-copy
    /// <summary>Returns the backing list as a read-only view, so no copy is allocated on read.</summary>
    public IReadOnlyList<string> Tags => _tags;
}
