using System.Collections.Generic;

namespace Positive.Boundary.Performance;

/// <summary>Reads a LinkedList head via its O(1) First property, not the LINQ extension.</summary>
public sealed class PreferLinkedListFirstLastSafe
{
    /// <summary>Returns the oldest session id, or null when there are none.</summary>
    internal string? OldestSession(LinkedList<string> arrivalOrder)
    {
        // SAFE: performance/deterministic/prefer-linkedlist-first-last
        return arrivalOrder.First?.Value;
    }
}
