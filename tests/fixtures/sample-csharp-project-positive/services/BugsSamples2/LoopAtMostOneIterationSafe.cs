using System.Collections.Generic;

namespace Positive.Boundary.Bugs;

/// <summary>Find-first scan: the no-match path continues, so the loop can iterate.</summary>
public sealed class LoopAtMostOneIterationSafe
{
    /// <summary>Returns the first negative offset, or -1 when none exist.</summary>
    internal int FirstNegative(IEnumerable<int> offsets)
    {
        // SAFE: bugs/deterministic/loop-at-most-one-iteration
        foreach (var offset in offsets)
        {
            if (offset < 0)
            {
                return offset;
            }
        }
        return -1;
    }
}
