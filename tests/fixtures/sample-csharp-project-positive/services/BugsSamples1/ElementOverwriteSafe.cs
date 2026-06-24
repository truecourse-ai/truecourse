using System.Collections.Generic;

namespace Positive.Boundary.Bugs;

/// <summary>Seeds and then accumulates a counter slot, reading between writes.</summary>
public sealed class ElementOverwriteSafe
{
    /// <summary>Returns the running total stored in the first slot.</summary>
    internal int Accumulate(int seed, int delta)
    {
        var slots = new List<int> { 0 };
        slots[0] = seed;
        // SAFE: bugs/deterministic/element-overwrite
        slots[0] = slots[0] + delta;
        return slots[0];
    }
}
