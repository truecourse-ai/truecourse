using System.Collections.Generic;

namespace Positive.Boundary.Performance;

/// <summary>Predicate membership over a List using its own Exists, not LINQ Any.</summary>
public sealed class PreferExistsSafe
{
    /// <summary>True when any signup in the list is active.</summary>
    internal bool AnyActive(List<bool> activeFlags)
    {
        // SAFE: performance/deterministic/prefer-exists
        return activeFlags.Exists(flag => flag);
    }
}
