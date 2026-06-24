using System.Collections.Generic;

namespace Positive.Boundary.CodeQuality;

/// <summary>Sums positive even values using four nested levels — the allowed maximum.</summary>
public sealed class MaxNestingDepthSafe
{
    /// <summary>Returns the running total of qualifying values in the matrix.</summary>
    internal int SumQualifying(IEnumerable<int[]> matrix, bool enabled)
    {
        var total = 0;
        if (enabled)
        {
            foreach (var row in matrix)
            {
                foreach (var value in row)
                {
                    // SAFE: code-quality/deterministic/max-nesting-depth
                    if (value > 0)
                    {
                        total += value;
                    }
                }
            }
        }
        return total;
    }
}
