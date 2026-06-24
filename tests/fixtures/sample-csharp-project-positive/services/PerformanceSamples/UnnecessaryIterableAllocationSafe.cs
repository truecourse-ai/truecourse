using System.Collections.Generic;
using System.Linq;

namespace Positive.Boundary.Performance;

/// <summary>Prunes expired entries from a registry while iterating it.</summary>
public sealed class UnnecessaryIterableAllocationSafe
{
    private readonly List<string> _registry = new();

    /// <summary>Snapshots with ToList because the loop body removes from the source list.</summary>
    internal void PruneExpired(IReadOnlyCollection<string> expired)
    {
        // SAFE: performance/deterministic/unnecessary-iterable-allocation
        foreach (var entry in _registry.Where(expired.Contains).ToList())
        {
            _registry.Remove(entry);
        }
    }
}
