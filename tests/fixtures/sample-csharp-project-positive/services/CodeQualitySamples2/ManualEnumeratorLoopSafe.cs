using System.Collections.Generic;

namespace Positive.Boundary.CodeQuality;

/// <summary>Iterates a sequence with foreach rather than a hand-rolled enumerator.</summary>
public sealed class ManualEnumeratorLoopSafe
{
    /// <summary>Returns the count of non-empty items in the sequence.</summary>
    internal int CountNonEmpty(IEnumerable<string> items)
    {
        var count = 0;
        // SAFE: code-quality/deterministic/manual-enumerator-loop
        foreach (var item in items)
        {
            if (item.Length > 0)
            {
                count++;
            }
        }
        return count;
    }
}
