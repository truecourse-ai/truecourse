using System.Collections.Generic;

namespace Positive.Boundary.Architecture;

/// <summary>Aggregates a small, bounded set of collaborators.</summary>
public sealed class ClassCoupledToTooManySafe
{
    private readonly List<string> _items = new();

    // SAFE: architecture/deterministic/class-coupled-to-too-many
    /// <summary>Record an item and report the running total.</summary>
    public int Track(string item)
    {
        _items.Add(item);
        return _items.Count;
    }
}
