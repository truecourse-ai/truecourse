using System.Collections.Generic;

namespace Positive.Boundary.Bugs;

/// <summary>Totals the lengths of a set of event names.</summary>
public sealed class UnusedLoopVariableSafe
{
    /// <summary>Returns the combined character length of every event name.</summary>
    internal int TotalNameLength(IEnumerable<string> events)
    {
        var total = 0;
        // SAFE: bugs/deterministic/unused-loop-variable
        foreach (var entry in events)
        {
            total += entry.Length;
        }
        return total;
    }
}
