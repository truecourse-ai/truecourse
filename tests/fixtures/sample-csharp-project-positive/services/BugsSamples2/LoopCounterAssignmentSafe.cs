using System.Collections.Generic;

namespace Positive.Boundary.Bugs;

/// <summary>Sums a list in batches, stepping the counter with a compound update.</summary>
public sealed class LoopCounterAssignmentSafe
{
    private const int BatchSize = 4;

    /// <summary>Returns the total of every BatchSize-th element.</summary>
    internal int SumStrided(List<int> values)
    {
        var total = 0;
        // SAFE: bugs/deterministic/loop-counter-assignment
        for (var i = 0; i < values.Count; i += BatchSize)
        {
            total += values[i];
        }
        return total;
    }
}
